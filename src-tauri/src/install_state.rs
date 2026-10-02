//! Shared install-progress state. Each long-running installer (Python, ComfyUI,
//! LM Studio, Claude Code, SearXNG) owns one of these and the frontend polls
//! `install_*_status` to render progress + logs.

use serde::Serialize;
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Serialize)]
pub struct InstallProgress {
    pub status: String,
    pub logs: Vec<String>,
    pub download_progress: u64,
    pub download_total: u64,
    pub download_speed: u64,
    pub error: Option<String>,
}

impl Default for InstallProgress {
    fn default() -> Self {
        Self {
            status: "idle".into(),
            logs: Vec::new(),
            download_progress: 0,
            download_total: 0,
            download_speed: 0,
            error: None,
        }
    }
}

#[derive(Clone, Default)]
pub struct InstallSlot {
    inner: Arc<Mutex<InstallProgress>>,
}

impl InstallSlot {
    pub fn snapshot(&self) -> InstallProgress {
        self.inner.lock().unwrap().clone()
    }

    pub fn is_running(&self) -> bool {
        self.inner.lock().unwrap().status == "installing"
    }

    pub fn start(&self) {
        let mut g = self.inner.lock().unwrap();
        *g = InstallProgress {
            status: "installing".into(),
            ..Default::default()
        };
    }

    pub fn log(&self, line: impl Into<String>) {
        let mut g = self.inner.lock().unwrap();
        let entry = line.into();
        tracing::info!("[install] {entry}");
        g.logs.push(entry);
        if g.logs.len() > 200 {
            let drop = g.logs.len() - 200;
            g.logs.drain(..drop);
        }
    }

    pub fn set_download(&self, progress: u64, total: u64, speed: u64) {
        let mut g = self.inner.lock().unwrap();
        g.download_progress = if total > 0 { progress.min(total) } else { progress };
        g.download_total = total;
        g.download_speed = speed;
    }

    pub fn complete(&self, msg: impl Into<String>) {
        let mut g = self.inner.lock().unwrap();
        g.status = "complete".into();
        g.logs.push(msg.into());
    }

    pub fn fail(&self, msg: impl Into<String>) {
        let mut g = self.inner.lock().unwrap();
        let m = msg.into();
        tracing::error!("[install] failed: {m}");
        g.status = "error".into();
        g.error = Some(m.clone());
        g.logs.push(format!("ERROR: {m}"));
    }
}

/// What THIS run added to a shared cache. Never negative: a cache that is
/// pruned mid-download must not make the bar walk backwards.
fn downloaded_into_shared(shared: Option<&std::path::Path>, base: u64) -> u64 {
    shared.map(|p| dir_size(p).saturating_sub(base)).unwrap_or(0)
}

fn dir_size(path: &std::path::Path) -> u64 {
    let Ok(read) = std::fs::read_dir(path) else {
        return 0;
    };
    read.flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

/// Feed a slot's byte progress from the size of the directory the download
/// writes into, until the slot leaves "installing". The installers shell out
/// to `huggingface_hub.snapshot_download`, which reports nothing machine-
/// readable on stdout; the growing target directory is the one progress
/// signal that exists on every platform.
///
/// `shared` is a cache directory that the SAME download also writes into but
/// that other downloads share. Only its GROWTH during this run counts, because
/// whatever lay there when we started belongs to somebody else's model.
///
/// Why the second directory exists at all: since huggingface_hub 1.x the
/// default transport is Xet, and Xet does not stream into
/// `<repo>/blobs/<sha>.incomplete` the way the plain HTTP path does. It fills
/// its own chunk cache at `$HF_HOME/xet`, a SIBLING of the repo folder we
/// watch. So the watched folder stayed near empty while the line was busy, and
/// the downloads bar read "1.7 MB / 8.0 GB 0%" after four and a half minutes
/// of real traffic (bauer-m on the Mac, 11.09.2026, N1). The bytes were never
/// missing, they were being counted in the wrong place.
pub fn watch_dir_size(
    slot: InstallSlot,
    dir: std::path::PathBuf,
    shared: Option<std::path::PathBuf>,
    total_bytes: u64,
) {
    std::thread::spawn(move || {
        let mut last: Option<(std::time::Instant, u64)> = None;
        let shared_base = shared.as_deref().map(dir_size).unwrap_or(0);
        while slot.is_running() {
            let size = dir_size(&dir) + downloaded_into_shared(shared.as_deref(), shared_base);
            let speed = match last {
                Some((t, prev)) if size > prev => {
                    ((size - prev) as f64 / t.elapsed().as_secs_f64().max(0.001)) as u64
                }
                _ => 0,
            };
            last = Some((std::time::Instant::now(), size));
            slot.set_download(size, total_bytes, speed);
            std::thread::sleep(std::time::Duration::from_millis(1000));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_download_clamps_to_total_and_keeps_speed() {
        let slot = InstallSlot::default();
        slot.start();
        slot.set_download(500, 1000, 42);
        let s = slot.snapshot();
        assert_eq!((s.download_progress, s.download_total, s.download_speed), (500, 1000, 42));
        // A convert step growing the dir past the download size must not
        // report more than 100%.
        slot.set_download(1500, 1000, 7);
        assert_eq!(slot.snapshot().download_progress, 1000);
        // No known total: pass the raw byte count through.
        slot.set_download(1500, 0, 0);
        assert_eq!(slot.snapshot().download_progress, 1500);
    }

    /// Der Stillstand der Anzeige, als Rechnung.
    ///
    /// bauer-m auf dem Mac, 11.09.2026 (N1): nach viereinhalb Minuten stand
    /// "1.7 MB / 8.0 GB 0%" in der Leiste, waehrend die Leitung arbeitete. Die
    /// Bytes lagen im Xet-Zwischenspeicher, einem GESCHWISTER des beobachteten
    /// Repo-Ordners, und wurden deshalb nicht gezaehlt.
    #[test]
    fn the_shared_cache_counts_what_this_run_added_to_it() {
        let root = std::env::temp_dir().join(format!("lu-shared-{}", std::process::id()));
        let xet = root.join("xet");
        std::fs::create_dir_all(&xet).unwrap();
        // Was beim Start schon dalag, gehoert einem anderen Modell.
        std::fs::write(xet.join("alt.bin"), vec![0u8; 2_000]).unwrap();
        let base = dir_size(&xet);
        assert_eq!(base, 2_000);
        assert_eq!(downloaded_into_shared(Some(&xet), base), 0, "fremde Bytes zaehlen nicht mit");

        // Und was dieser Lauf dazulegt, zaehlt sofort.
        std::fs::write(xet.join("neu.bin"), vec![0u8; 500]).unwrap();
        assert_eq!(downloaded_into_shared(Some(&xet), base), 500);

        // Ein geleerter Zwischenspeicher laesst den Balken nicht rueckwaerts laufen.
        std::fs::remove_file(xet.join("alt.bin")).unwrap();
        assert_eq!(downloaded_into_shared(Some(&xet), base), 0);

        // Gegenprobe: ohne zweiten Ordner bleibt es bei null, also genau beim
        // Verhalten von vorher.
        assert_eq!(downloaded_into_shared(None, 0), 0);
        assert_eq!(downloaded_into_shared(Some(&root.join("gibt-es-nicht")), 0), 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn dir_size_sums_nested_files() {
        let root = std::env::temp_dir().join(format!("lu-dirsize-{}", std::process::id()));
        let sub = root.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(root.join("a.bin"), vec![0u8; 100]).unwrap();
        std::fs::write(sub.join("b.bin"), vec![0u8; 50]).unwrap();
        assert_eq!(dir_size(&root), 150);
        std::fs::remove_dir_all(&root).unwrap();
        // A directory that does not exist yet reads as empty, not an error;
        // the watcher starts before snapshot_download creates the target.
        assert_eq!(dir_size(&root), 0);
    }
}

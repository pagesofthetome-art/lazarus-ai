use once_cell::sync::Lazy;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

static PREVIEW_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));
const PREVIEW_PORT: u16 = 5274;

#[tauri::command]
pub fn developer_preview_start(workspace_root: String) -> Result<String, String> {
    let root = Path::new(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
    if !root.is_dir() { return Err("Developer sandbox workspace is missing.".into()); }
    let mut slot = PREVIEW_PROCESS.lock().map_err(|e| e.to_string())?;
    if let Some(child) = slot.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(format!("http://127.0.0.1:{PREVIEW_PORT}"));
        }
    }
    let mut command = if cfg!(windows) { Command::new("npm.cmd") } else { Command::new("npm") };
    let child = command
        .args(["run", "dev", "--", "--host", "127.0.0.1", "--port", &PREVIEW_PORT.to_string()])
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Could not start sandbox preview: {e}"))?;
    *slot = Some(child);
    Ok(format!("http://127.0.0.1:{PREVIEW_PORT}"))
}

#[tauri::command]
pub fn developer_preview_stop() -> Result<(), String> {
    let mut slot = PREVIEW_PROCESS.lock().map_err(|e| e.to_string())?;
    if let Some(mut child) = slot.take() { let _ = child.kill(); let _ = child.wait(); }
    Ok(())
}

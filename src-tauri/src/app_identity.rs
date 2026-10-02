//! App-owned storage and credential names live here in one place. Rust data
//! folders are not derived from Tauri's `identifier`, so keep each current
//! name centralized and covered by tests. Previous names below are read only by
//! the one-time migration so existing data and provider keys remain available.
//!
//! ## Names owned by other configuration
//!
//! * Die Tauri-`identifier` (`tauri.conf.json`) — sie steuert
//!   `app_data_dir()`/`app_config_dir()`, den Single-Instance-Socket und den
//!   WebView-Speicher **gebündelter** Builds.
//! * Der Binärname (`Cargo.toml`, `[package] name`) — er steuert unter macOS
//!   im `tauri dev`-Modus das WebKit-Verzeichnis (`~/Library/WebKit/<Name>`).

/// Haupt-Datenverzeichnis dieser App unter `data_local_dir()`, `cache_dir()`
/// und `config_dir()`.
///
/// * macOS:   `~/Library/Application Support/<APP_DIR>`
/// * Windows: `%LOCALAPPDATA%\<APP_DIR>`
/// * Linux:   `~/.local/share/<APP_DIR>`, `~/.cache/<APP_DIR>`,
///   `~/.config/<APP_DIR>`
pub const APP_DIR: &str = "lazarus";

/// Älterer Ordner unter `config_dir()` bzw. `data_local_dir()`: hält
/// `config.json` (ComfyUI-Pfad/-Port, Ollama-Basis, Trainer-Root) und
/// `bin/cloudflared`.
pub const APP_CONFIG_DIR: &str = "lazarus-config";

/// Die Anzeige-Schreibweise desselben Namens. Zwei Verwendungen:
/// `%APPDATA%\<APP_DISPLAY_DIR>` (Store-Backups + Onboarding-Marker, Windows)
/// und `<data_dir>/<APP_DISPLAY_DIR>/models` (Modelle der eingebauten Engine).
pub const APP_DISPLAY_DIR: &str = "Lazarus";

/// Previous on-disk names used only by the one-time, non-destructive migration.
pub const LEGACY_APP_DIR: &str = "lu-labs";
pub const LEGACY_APP_CONFIG_DIR: &str = "locally-uncensored";
pub const LEGACY_APP_DISPLAY_DIR: &str = "Locally Uncensored";
pub const LEGACY_TAURI_IDENTIFIER: &str = "com.purpledoubled.locally-uncensored";
pub const TAURI_IDENTIFIER: &str = "app.lazarus.desktop";

/// Sandkasten-Wurzel der Agenten unter `$HOME`. Pro Chat entsteht darin ein
/// Unterordner; der Agent darf nichts außerhalb anfassen.
pub const AGENT_WORKSPACE_DIR: &str = "agent-workspace";

/// Service-Name im OS-Schlüsselbund (macOS Keychain / Windows Credential
/// Manager) für Provider-Schlüssel.
///
/// Gehört hierher, obwohl es kein Pfad ist: der Name war ebenfalls
/// hartkodiert, und wer ihn ändert, verwaist alle Schlüssel, die der Nutzer
/// unter dem alten Namen gespeichert hat. Ein Build mit einem abweichenden
/// Service-Namen liest und **überschreibt** außerdem fremde Einträge.
// Only the Windows and macOS keychain paths read this; Linux has no keychain
// backend yet, and its clippy gate runs with -D warnings.
#[cfg_attr(not(any(target_os = "windows", target_os = "macos")), allow(dead_code))]
pub const KEYCHAIN_SERVICE: &str = "app.lazarus.desktop.providerkeys";
/// Previous keychain namespace. Read only during provider-key migration.
#[cfg_attr(not(any(target_os = "windows", target_os = "macos")), allow(dead_code))]
pub const LEGACY_KEYCHAIN_SERVICE: &str = "com.locallyuncensored.providerkeys";

#[cfg(test)]
mod tests {
    use super::*;

    /// Die Namen, die dieser App gehören.
    ///
    /// Bewusst als eigene Literale wiederholt und **nicht** aus den
    /// Konstanten oben abgeleitet: ein Test, der seine Erwartung aus dem holt,
    /// was er absichern soll, prüft nichts.
    const NAMEN_DER_ECHTEN_APP: [&str; 4] = [
        "lazarus",
        "lazarus-config",
        "Lazarus",
        "agent-workspace",
    ];

    /// Ein Build, der unter einem anderen Namen läuft, findet die Daten des
    /// Nutzers nicht mehr und legt daneben neue an. Genau das ist am
    /// 2026-08-31 passiert, nur in die andere Richtung. Die fünf Werte stehen
    /// deshalb doppelt: einmal als Auslieferungscode, einmal hier.
    #[test]
    fn die_namen_sind_die_der_echten_app() {
        assert_eq!(APP_DIR, "lazarus");
        assert_eq!(APP_CONFIG_DIR, "lazarus-config");
        assert_eq!(APP_DISPLAY_DIR, "Lazarus");
        assert_eq!(AGENT_WORKSPACE_DIR, "agent-workspace");
        assert_eq!(KEYCHAIN_SERVICE, "app.lazarus.desktop.providerkeys");
        assert_eq!(LEGACY_KEYCHAIN_SERVICE, "com.locallyuncensored.providerkeys");
        // Und kein Name trägt einen Anhang: ein Build aus einem
        // Experimentierzweig darf nicht versehentlich ausgeliefert werden.
        for name in [APP_DIR, APP_CONFIG_DIR, APP_DISPLAY_DIR, AGENT_WORKSPACE_DIR] {
            assert!(
                NAMEN_DER_ECHTEN_APP.contains(&name),
                "'{name}' ist keiner der Namen dieser App"
            );
        }
    }

    #[test]
    fn keine_quelldatei_baut_einen_pfad_der_echten_app_von_hand() {
        let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut funde: Vec<String> = Vec::new();

        for eintrag in walkdir::WalkDir::new(&src)
            .into_iter()
            .filter_map(Result::ok)
            .filter(|e| e.path().extension().is_some_and(|x| x == "rs"))
        {
            let Ok(inhalt) = std::fs::read_to_string(eintrag.path()) else {
                continue;
            };
            for name in NAMEN_DER_ECHTEN_APP {
                for nadel in [
                    format!(".join(\"{name}\")"),
                    format!("starts_with(\"{name}\")"),
                    format!("\"{name}*\""),
                    format!("\"{name}/"),
                    format!("\"{name}\\\\"),
                ] {
                    if inhalt.contains(&nadel) {
                        funde.push(format!(
                            "{}: {nadel}",
                            eintrag.path().strip_prefix(&src).unwrap_or(eintrag.path()).display()
                        ));
                    }
                }
            }
        }

        assert!(
            funde.is_empty(),
            "Pfade der ECHTEN App im Quelltext zusammengebaut — jeder dieser Namen \
             gehört über die Konstanten in app_identity abgeleitet:\n  {}",
            funde.join("\n  ")
        );
    }
}

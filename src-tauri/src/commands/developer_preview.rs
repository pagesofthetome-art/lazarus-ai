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
    if root.file_name().and_then(|name| name.to_str()) != Some(".lazarus-sandbox") {
        return Err("Developer preview must run from the isolated Lazarus sandbox.".into());
    }
    // The sandbox is a child of the source project. Reuse its installed Vite
    // package without copying node_modules into the backup or sandbox.
    let project_root = root.parent().filter(|p| p.join("node_modules/vite/bin/vite.js").is_file())
        .ok_or_else(|| "Could not find the Lazarus Vite runtime beside the sandbox.".to_string())?;
    let vite = project_root.join("node_modules/vite/bin/vite.js");
    let mut slot = PREVIEW_PROCESS.lock().map_err(|e| e.to_string())?;
    if let Some(child) = slot.as_mut() {
        if child.try_wait().map_err(|e| e.to_string())?.is_none() {
            return Ok(format!("http://127.0.0.1:{PREVIEW_PORT}"));
        }
    }
    let child = Command::new("node")
        .arg(vite)
        .args(["--host", "127.0.0.1", "--port", &PREVIEW_PORT.to_string(), "--strictPort"])
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

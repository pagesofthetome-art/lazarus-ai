use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use zip::write::SimpleFileOptions;
use zip::ZipArchive;

fn rotate_backups(root: &Path, keep: usize) -> Result<(), String> {
    let mut files = fs::read_dir(root)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().and_then(|e| e.to_str()) == Some("zip"))
        .map(|entry| {
            let modified = entry.metadata().and_then(|m| m.modified()).ok();
            (modified, entry.path())
        })
        .collect::<Vec<_>>();
    files.sort_by(|a, b| a.0.cmp(&b.0));
    while files.len() > keep {
        let (_, oldest) = files.remove(0);
        fs::remove_file(oldest).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn developer_sandbox_latest_backup(backup_root: String) -> Result<String, String> {
    let root = PathBuf::from(backup_root);
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())?.filter_map(Result::ok) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("zip") { continue; }
        let modified = entry.metadata().and_then(|m| m.modified()).map_err(|e| e.to_string())?;
        if newest.as_ref().is_none_or(|(time, _)| modified > *time) {
            newest = Some((modified, path));
        }
    }
    newest.map(|(_, path)| path.to_string_lossy().into_owned()).ok_or_else(|| "No Developer sandbox backup exists yet.".into())
}

#[tauri::command]
pub fn developer_sandbox_boot(backup_zip: String, sandbox_root: String) -> Result<String, String> {
    let target = PathBuf::from(sandbox_root);
    if target.exists() { fs::remove_dir_all(&target).map_err(|e| e.to_string())?; }
    fs::create_dir_all(&target).map_err(|e| e.to_string())?;
    let file = File::open(backup_zip).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|e| e.to_string())?;
        let Some(name) = entry.enclosed_name().map(|p| p.to_owned()) else { continue; };
        let path = target.join(name);
        if entry.is_dir() { fs::create_dir_all(&path).map_err(|e| e.to_string())?; continue; }
        if let Some(parent) = path.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        let mut output = File::create(path).map_err(|e| e.to_string())?;
        io::copy(&mut entry, &mut output).map_err(|e| e.to_string())?;
    }
    Ok(target.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn developer_sandbox_discard(sandbox_root: String) -> Result<(), String> {
    let target = PathBuf::from(sandbox_root);
    if target.exists() { fs::remove_dir_all(target).map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn developer_sandbox_apply(sandbox_root: String, workspace_root: String) -> Result<(), String> {
    let sandbox = PathBuf::from(sandbox_root).canonicalize().map_err(|e| e.to_string())?;
    let workspace = PathBuf::from(workspace_root).canonicalize().map_err(|e| e.to_string())?;
    if !sandbox.is_dir() || !workspace.is_dir() { return Err("Developer sandbox or workspace is missing.".into()); }
    if sandbox == workspace { return Err("Sandbox and published workspace must be separate.".into()); }
    for entry in WalkDir::new(&sandbox).into_iter().filter_map(Result::ok) {
        let source = entry.path();
        if !allowed(source) { continue; }
        let relative = source.strip_prefix(&sandbox).map_err(|e| e.to_string())?;
        if relative.as_os_str().is_empty() { continue; }
        let target = workspace.join(relative);
        if source.is_dir() { fs::create_dir_all(&target).map_err(|e| e.to_string())?; }
        else {
            if let Some(parent) = target.parent() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
            fs::copy(source, target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn developer_sandbox_restore(backup_zip: String, workspace_root: String) -> Result<(), String> {
    let workspace = PathBuf::from(workspace_root).canonicalize().map_err(|e| e.to_string())?;
    let restore_root = workspace.join(".lazarus-restore");
    developer_sandbox_boot(backup_zip, restore_root.to_string_lossy().into_owned())?;
    let result = developer_sandbox_apply(restore_root.to_string_lossy().into_owned(), workspace.to_string_lossy().into_owned());
    let _ = fs::remove_dir_all(&restore_root);
    result
}

fn allowed(path: &Path) -> bool {
    !path.components().any(|part| matches!(part.as_os_str().to_str(), Some("node_modules" | "dist" | ".git" | ".lazarus-backups" | ".lazarus-sandbox" | ".lazarus-restore")))
}

#[tauri::command]
pub fn developer_sandbox_backup(workspace_root: String, backup_root: String) -> Result<String, String> {
    let source = PathBuf::from(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
    if !source.is_dir() { return Err("Developer workspace is not a directory.".into()); }
    let root = PathBuf::from(&backup_root);
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let name = format!("developer-backup-{}.zip", chrono::Utc::now().timestamp_millis());
    let target = root.join(name);
    let file = File::create(&target).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for entry in WalkDir::new(&source).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if !allowed(path) { continue; }
        let relative = path.strip_prefix(&source).map_err(|e| e.to_string())?;
        if relative.as_os_str().is_empty() { continue; }
        let name = relative.to_string_lossy().replace('\\', "/");
        if path.is_dir() { archive.add_directory(name, options).map_err(|e| e.to_string())?; }
        else {
            let mut input = File::open(path).map_err(|e| e.to_string())?;
            archive.start_file(name, options).map_err(|e| e.to_string())?;
            io::copy(&mut input, &mut archive).map_err(|e| e.to_string())?;
        }
    }
    archive.finish().map_err(|e| e.to_string())?;
    rotate_backups(&root, 2)?;
    Ok(target.to_string_lossy().into_owned())
}

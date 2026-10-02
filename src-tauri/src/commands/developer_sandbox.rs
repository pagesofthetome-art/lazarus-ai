use std::fs::{self, File};
use std::io;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
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
    if sandbox.parent() != Some(workspace.as_path()) || !matches!(sandbox.file_name().and_then(|name| name.to_str()), Some(".lazarus-sandbox" | ".lazarus-restore")) {
        return Err("The sandbox must be the Lazarus sandbox or restore folder inside the source project.".into());
    }
    // Remove source files that the sandbox deleted. Keep excluded/generated
    // trees untouched (notably .git, node_modules and build output).
    let mut existing = WalkDir::new(&workspace).into_iter().filter_map(Result::ok).collect::<Vec<_>>();
    existing.sort_by_key(|entry| std::cmp::Reverse(entry.depth()));
    for entry in existing {
        let target = entry.path();
        if entry.file_type().is_symlink() { continue; }
        let relative = target.strip_prefix(&workspace).map_err(|e| e.to_string())?;
        if relative.as_os_str().is_empty() || !allowed(relative) { continue; }
        if !sandbox.join(relative).exists() {
            if target.is_dir() {
                // Don't remove directories that contain excluded content.
                if fs::read_dir(target).map_err(|e| e.to_string())?.next().is_none() {
                    fs::remove_dir(target).map_err(|e| e.to_string())?;
                }
            } else {
                fs::remove_file(target).map_err(|e| e.to_string())?;
            }
        }
    }
    for entry in WalkDir::new(&sandbox).into_iter().filter_map(Result::ok) {
        let source = entry.path();
        if entry.file_type().is_symlink() { continue; }
        let relative = source.strip_prefix(&sandbox).map_err(|e| e.to_string())?;
        if relative.as_os_str().is_empty() || !allowed(relative) { continue; }
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

/// Build the sandbox as a standalone executable, apply it to source only when
/// the build succeeds, then relaunch the executable after this process exits.
/// No installer is produced in Developer Mode.
#[tauri::command]
pub async fn developer_sandbox_publish(app: tauri::AppHandle, sandbox_root: String, workspace_root: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let sandbox = PathBuf::from(&sandbox_root).canonicalize().map_err(|e| e.to_string())?;
        let workspace = PathBuf::from(&workspace_root).canonicalize().map_err(|e| e.to_string())?;
        if sandbox.parent() != Some(workspace.as_path()) || sandbox.file_name().and_then(|name| name.to_str()) != Some(".lazarus-sandbox") {
            return Err("The preview must be the isolated Lazarus sandbox inside the selected source project.".into());
        }
        let vite = workspace.join("node_modules/vite/bin/vite.js");
        let tauri_cli = workspace.join("node_modules/@tauri-apps/cli/tauri.js");
        if !vite.is_file() || !tauri_cli.is_file() || !sandbox.join("src-tauri/Cargo.toml").is_file() {
            return Err("Choose the Lazarus source project with its installed Node dependencies.".to_string());
        }

        let publish_root = workspace.join(".lazarus-published");
        let target_root = publish_root.join("target");
        fs::create_dir_all(&publish_root).map_err(|e| e.to_string())?;
        let config_path = publish_root.join("developer-build.conf.json");
        let vite_path = vite.to_string_lossy().replace('\\', "/");
        let build_config = serde_json::json!({
            "build": { "beforeBuildCommand": format!("node \"{vite_path}\" build") }
        });
        fs::write(&config_path, serde_json::to_vec_pretty(&build_config).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;

        let output = Command::new("node")
            .arg(tauri_cli)
            .args(["build", "--no-bundle", "--ci", "--config"])
            .arg(&config_path)
            .current_dir(&sandbox)
            .env("CARGO_TARGET_DIR", &target_root)
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("Could not start the Lazarus build: {e}"))?;
        if !output.status.success() {
            let combined = format!("{}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
            let tail = combined.lines().rev().take(30).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n");
            return Err(format!("Lazarus executable build failed:\n{tail}"));
        }

        let exe = target_root.join("release/lazarus.exe");
        if !exe.is_file() { return Err(format!("Build completed, but {} was not found.", exe.display())); }
        developer_sandbox_apply(sandbox.to_string_lossy().into_owned(), workspace.to_string_lossy().into_owned())?;

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            let quote_ps = |path: &Path| path.to_string_lossy().replace('\'', "''");
            let pid = std::process::id();
            let script = format!(
                "$ErrorActionPreference='Stop'; if (Get-Process -Id {pid} -ErrorAction SilentlyContinue) {{ Wait-Process -Id {pid} }}; Start-Process -FilePath '{}' -WorkingDirectory '{}'",
                quote_ps(&exe), quote_ps(&workspace)
            );
            Command::new("powershell.exe")
                .args(["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", &script])
                .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| format!("Built and applied changes, but relaunch could not be scheduled: {e}"))?;
            app.exit(0);
            Ok(format!("Built and applied {} without an installer; relaunching.", exe.display()))
        }
        #[cfg(not(windows))]
        {
            let _ = app;
            Err("Executable relaunch is currently supported only on Windows.".into())
        }
    }).await.map_err(|e| format!("Developer publish task failed: {e}"))?
}

fn allowed(path: &Path) -> bool {
    !path.components().any(|part| matches!(part.as_os_str().to_str(), Some("node_modules" | "dist" | ".git" | ".lazarus-backups" | ".lazarus-sandbox" | ".lazarus-restore" | ".lazarus-published" | "target")))
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
        if entry.file_type().is_symlink() { continue; }
        let relative = path.strip_prefix(&source).map_err(|e| e.to_string())?;
        if relative.as_os_str().is_empty() { continue; }
        if !allowed(relative) { continue; }
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

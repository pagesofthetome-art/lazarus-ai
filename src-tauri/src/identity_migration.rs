//! Safe, one-time migration of app-owned files from the previous product identity.
//!
//! A missing destination is renamed in place where possible, avoiding a second
//! copy of multi-gigabyte model files. If Lazarus already has a destination,
//! only missing files are copied into it; existing files are never replaced
//! and the source remains available for recovery.

use crate::app_identity::{
    APP_CONFIG_DIR, APP_DIR, APP_DISPLAY_DIR, LEGACY_APP_CONFIG_DIR, LEGACY_APP_DIR,
    LEGACY_APP_DISPLAY_DIR, LEGACY_TAURI_IDENTIFIER, TAURI_IDENTIFIER,
};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub fn migrate_legacy_app_paths() -> Vec<String> {
    let Some(data_local) = dirs::data_local_dir() else { return Vec::new() };
    let Some(data) = dirs::data_dir() else { return Vec::new() };
    let Some(config) = dirs::config_dir() else { return Vec::new() };
    let Some(cache) = dirs::cache_dir() else { return Vec::new() };

    let paths = [
        (data_local.join(LEGACY_APP_DIR), data_local.join(APP_DIR)),
        (cache.join(LEGACY_APP_DIR), cache.join(APP_DIR)),
        (config.join(LEGACY_APP_DIR), config.join(APP_DIR)),
        (
            config.join(LEGACY_APP_CONFIG_DIR),
            config.join(APP_CONFIG_DIR),
        ),
        (
            data.join(LEGACY_APP_DISPLAY_DIR),
            data.join(APP_DISPLAY_DIR),
        ),
        (
            data_local.join(LEGACY_TAURI_IDENTIFIER),
            data_local.join(TAURI_IDENTIFIER),
        ),
        (
            data.join(LEGACY_TAURI_IDENTIFIER),
            data.join(TAURI_IDENTIFIER),
        ),
        (
            config.join(LEGACY_TAURI_IDENTIFIER),
            config.join(TAURI_IDENTIFIER),
        ),
    ];

    paths
        .into_iter()
        .filter_map(|(source, destination)| {
            if source == destination || !source.exists() {
                return None;
            }
            migrate_directory(&source, &destination)
                .err()
                .map(|error| format!("{} -> {}: {error}", source.display(), destination.display()))
        })
        .collect()
}

fn migrate_directory(source: &Path, destination: &Path) -> io::Result<()> {
    let source_meta = fs::symlink_metadata(source)?;
    if !source_meta.is_dir() || source_meta.file_type().is_symlink() {
        return Ok(());
    }

    if fs::symlink_metadata(destination).is_err() {
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        if fs::rename(source, destination).is_ok() {
            return Ok(());
        }
    }

    match fs::symlink_metadata(destination) {
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "destination exists and is not a regular directory",
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => fs::create_dir_all(destination)?,
        Err(error) => return Err(error),
    }

    copy_missing_files(source, destination)
}

fn copy_missing_files(source: &Path, destination: &Path) -> io::Result<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let metadata = fs::symlink_metadata(&source_path)?;
        if metadata.file_type().is_symlink() {
            continue;
        }

        let destination_path: PathBuf = destination.join(entry.file_name());
        if metadata.is_dir() {
            match fs::symlink_metadata(&destination_path) {
                Ok(dest_meta) if dest_meta.file_type().is_symlink() || !dest_meta.is_dir() => continue,
                Ok(_) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    fs::create_dir(&destination_path)?;
                }
                Err(error) => return Err(error),
            }
            copy_missing_files(&source_path, &destination_path)?;
        } else if metadata.is_file() && fs::symlink_metadata(&destination_path).is_err() {
            fs::copy(source_path, destination_path)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::migrate_directory;
    use std::fs;

    #[test]
    fn renames_the_legacy_directory_without_copying_its_contents() {
        let root = tempfile::tempdir().expect("temporary test root");
        let old = root.path().join("old");
        let new = root.path().join("new");
        fs::create_dir_all(old.join("nested")).expect("create source tree");
        fs::write(old.join("nested/chat.json"), "chat data").expect("write source data");

        migrate_directory(&old, &new).expect("migrate source tree");

        assert!(!old.exists());
        assert_eq!(fs::read_to_string(new.join("nested/chat.json")).unwrap(), "chat data");
    }

    #[test]
    fn merges_missing_files_and_never_overwrites_or_removes_source_data() {
        let root = tempfile::tempdir().expect("temporary test root");
        let old = root.path().join("old");
        let new = root.path().join("new");
        fs::create_dir_all(old.join("nested")).expect("create source tree");
        fs::create_dir_all(new.join("nested")).expect("create destination tree");
        fs::write(old.join("nested/settings.json"), "legacy settings").expect("write source settings");
        fs::write(old.join("nested/chat.json"), "legacy chat").expect("write source chat");
        fs::write(new.join("nested/chat.json"), "newer destination chat").expect("write destination chat");

        migrate_directory(&old, &new).expect("merge source tree");

        assert!(old.join("nested/settings.json").exists());
        assert_eq!(fs::read_to_string(old.join("nested/chat.json")).unwrap(), "legacy chat");
        assert_eq!(fs::read_to_string(new.join("nested/settings.json")).unwrap(), "legacy settings");
        assert_eq!(fs::read_to_string(new.join("nested/chat.json")).unwrap(), "newer destination chat");
    }
}

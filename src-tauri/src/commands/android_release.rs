use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::time::Duration;

const BUILD_SCRIPT: &str = "build_and_publish_android.ps1";

/// Build and publish an Android update from the project folder the user chose
/// in Developer Studio. The frontend presents a confirmation dialog before it
/// invokes this command; the executable and script arguments stay fixed here.
#[tauri::command]
pub async fn developer_build_android(workspace_root: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_android_build(&workspace_root))
        .await
        .map_err(|error| format!("Android build task failed: {error}"))?
}

fn android_project_in(workspace_root: &str) -> Result<PathBuf, String> {
    let selected = Path::new(workspace_root)
        .canonicalize()
        .map_err(|error| format!("Could not open the selected project folder: {error}"))?;
    if !selected.is_dir() {
        return Err("Choose a project folder before building the Android update.".into());
    }

    let candidates = [selected.clone(), selected.join("Lazarus APK")];
    for candidate in candidates {
        let Ok(project) = candidate.canonicalize() else { continue };
        // Do not follow a child symlink out of the folder the user selected.
        if candidate != selected && !project.starts_with(&selected) {
            continue;
        }
        let app_gradle = project.join("app").join("build.gradle.kts");
        let publisher = project.join("publish_android.ps1");
        let builder = project.join(BUILD_SCRIPT);
        if app_gradle.is_file() && publisher.is_file() && builder.is_file() {
            return Ok(project);
        }
    }
    Err(format!(
        "The selected folder does not contain a Lazarus Android project with app/build.gradle.kts, publish_android.ps1, and {BUILD_SCRIPT}. Pick the Lazarus repository folder or its Lazarus APK folder."
    ))
}

fn run_android_build(workspace_root: &str) -> Result<String, String> {
    let project = android_project_in(workspace_root)?;
    let script = project.join(BUILD_SCRIPT);

    #[cfg(windows)]
    let mut command = {
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File"]);
        command
    };
    #[cfg(not(windows))]
    let mut command = {
        let mut command = Command::new("pwsh");
        command.args(["-NoProfile", "-NonInteractive", "-File"]);
        command
    };

    let mut child = command
        .arg(&script)
        .current_dir(&project)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Could not start PowerShell to build the APK: {error}"))?;

    // Drain both pipes while Gradle runs so its output cannot fill an OS pipe
    // and hang the build. The shared shell helper caps retained output.
    let stdout = child.stdout.take().ok_or("Could not read build output")?;
    let stderr = child.stderr.take().ok_or("Could not read build errors")?;
    let (stdout_text, stdout_done) = crate::commands::shell::drain(stdout);
    let (stderr_text, stderr_done) = crate::commands::shell::drain(stderr);
    let status = child
        .wait()
        .map_err(|error| format!("Could not wait for the Android build: {error}"))?;
    while !stdout_done.load(Ordering::Acquire) || !stderr_done.load(Ordering::Acquire) {
        std::thread::sleep(Duration::from_millis(10));
    }

    let output = format!(
        "{}\n{}",
        crate::commands::shell::captured_text(&stdout_text),
        crate::commands::shell::captured_text(&stderr_text)
    );
    let output: String = output.chars().rev().take(30_000).collect::<String>().chars().rev().collect();
    if !status.success() {
        return Err(format!(
            "Android APK build/publish failed ({}).\n\n{}",
            status,
            output.trim()
        ));
    }
    Ok(output.trim().to_string())
}

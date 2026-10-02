#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]
// Platform bootstrap for the shared Lazarus frontend.
// Desktop keeps the complete native service graph; Android starts from the
// same Tauri WebView and can add Android-native commands without importing
// desktop-only tray, dialog, and process APIs.
#[cfg(not(target_os = "android"))]
include!("desktop_main.rs");

#[cfg(target_os = "android")]
mod android_runtime;

#[cfg(target_os = "android")]
#[tauri::mobile_entry_point]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            android_runtime::android_runtime_status,
            android_runtime::android_model_load_state
        ])
        .run(tauri::generate_context!())
        .expect("error while running Lazarus Android");
}

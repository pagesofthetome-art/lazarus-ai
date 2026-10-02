// Mobile entrypoint; the Windows executable retains its full desktop runtime.
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

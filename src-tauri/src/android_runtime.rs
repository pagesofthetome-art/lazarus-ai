use serde_json::json;

/// Android-safe runtime information exposed to the shared UI. Models remain
/// unloaded until the user explicitly selects one.
#[tauri::command]
pub fn android_runtime_status() -> serde_json::Value {
    json!({
        "platform": "android",
        "modelsLoaded": false,
        "nativeBackend": "tauri",
        "storage": "app-private",
        "capabilities": ["shared-ui", "network", "app-storage"]
    })
}

#[tauri::command]
pub fn android_model_load_state() -> serde_json::Value {
    json!({ "loaded": false, "model": null })
}

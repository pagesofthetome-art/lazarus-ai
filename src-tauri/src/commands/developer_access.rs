//! Short-lived, user-granted full-machine access for one Developer Studio chat.
//!
//! The capability exists only in memory, is tied to an unguessable token and
//! conversation id, and disappears when Lazarus exits. It does not elevate the
//! Windows process or grant administrator rights.

use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::State;

use crate::state::AppState;

static DEVELOPER_VM_ACCESS: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

/// Called only from the Developer Studio confirmation button. The returned
/// token stays in frontend memory and is included only in that chat's native
/// filesystem requests.
#[tauri::command]
#[allow(non_snake_case)]
pub fn developer_vm_access_grant(
    conversationId: String,
    _state: State<'_, AppState>,
) -> Result<String, String> {
    let id = conversationId.trim();
    if id.is_empty() || id.len() > 160 {
        return Err("A valid Developer conversation is required.".into());
    }
    let token = uuid::Uuid::new_v4().to_string();
    DEVELOPER_VM_ACCESS
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id.to_string(), token.clone());
    Ok(token)
}

/// Revoke only the matching task capability. A stale view cannot revoke a
/// newer grant for the same conversation.
#[tauri::command]
#[allow(non_snake_case)]
pub fn developer_vm_access_revoke(
    conversationId: String,
    accessToken: String,
    _state: State<'_, AppState>,
) -> Result<bool, String> {
    let mut access = DEVELOPER_VM_ACCESS.lock().map_err(|e| e.to_string())?;
    if access.get(conversationId.trim()).is_some_and(|expected| expected == &accessToken) {
        access.remove(conversationId.trim());
        return Ok(true);
    }
    Ok(false)
}

/// The filesystem backend is the authority boundary: frontend state alone
/// cannot turn on out-of-workspace file access.
pub(crate) fn is_authorized(conversation_id: Option<&str>, token: Option<&str>) -> Result<bool, String> {
    let (Some(id), Some(token)) = (conversation_id, token) else {
        return Ok(false);
    };
    let id = id.trim();
    if id.is_empty() || token.is_empty() {
        return Err("Developer VM access was not granted for this task.".into());
    }
    let access = DEVELOPER_VM_ACCESS.lock().map_err(|e| e.to_string())?;
    match access.get(id) {
        Some(expected) if expected == token => Ok(true),
        _ => Err("Developer VM access has expired or was revoked. Grant it again to continue.".into()),
    }
}

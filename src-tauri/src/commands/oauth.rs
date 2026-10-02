//! Short-lived loopback OAuth callback for first-party provider adapters.
//!
//! The listener binds only to 127.0.0.1, accepts one callback, returns a small
//! confirmation page, and then drops the socket. It never receives or stores a
//! provider token; the frontend exchanges the authorization code with PKCE.

use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::{oneshot, Mutex};

static CALLBACKS: Lazy<Mutex<HashMap<u16, oneshot::Receiver<String>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

#[tauri::command]
pub async fn oauth_start() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|_| "Could not start the local sign-in callback.".to_string())?;
    let port = listener.local_addr().map_err(|_| "Could not read callback port.".to_string())?.port();
    let (sender, receiver) = oneshot::channel();
    CALLBACKS.lock().await.insert(port, receiver);

    tokio::spawn(async move {
        let accepted = tokio::time::timeout(Duration::from_secs(300), listener.accept()).await;
        let Ok(Ok((mut stream, _))) = accepted else { return };
        let mut buffer = vec![0_u8; 8192];
        let Ok(size) = stream.read(&mut buffer).await else { return };
        let request = String::from_utf8_lossy(&buffer[..size]);
        let target = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or("/");
        let query = query_from_callback_target(target);
        let body = "<html><body style=\"font-family:sans-serif;background:#151019;color:#eee;padding:3rem\"><h2>Sign-in complete</h2><p>You can close this window and return to Lazarus.</p></body></html>";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(), body
        );
        let _ = stream.write_all(response.as_bytes()).await;
        let _ = sender.send(query);
    });
    Ok(port)
}

fn query_from_callback_target(target: &str) -> String {
    let Some((path, query)) = target.split_once('?') else {
        return String::new();
    };
    if path == "/" || path == "/oauth/callback" {
        query.to_string()
    } else {
        String::new()
    }
}

#[tauri::command]
pub async fn oauth_wait(port: u16, timeout_secs: u64) -> Result<String, String> {
    let receiver = CALLBACKS.lock().await.remove(&port)
        .ok_or_else(|| "The sign-in callback is no longer available.".to_string())?;
    tokio::time::timeout(Duration::from_secs(timeout_secs.clamp(1, 600)), receiver)
        .await
        .map_err(|_| "Timed out waiting for the provider sign-in.".to_string())?
        .map_err(|_| "The provider sign-in was closed before it returned.".to_string())
}

#[cfg(test)]
mod tests {
    use super::query_from_callback_target;

    #[test]
    fn accepts_google_loopback_root_redirect() {
        assert_eq!(query_from_callback_target("/?code=abc&state=xyz"), "code=abc&state=xyz");
    }

    #[test]
    fn keeps_the_legacy_callback_path_working() {
        assert_eq!(query_from_callback_target("/oauth/callback?code=abc"), "code=abc");
    }

    #[test]
    fn ignores_unknown_callback_paths() {
        assert_eq!(query_from_callback_target("/elsewhere?code=abc"), "");
    }
}

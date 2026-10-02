pub mod agent;
pub mod android_release;
pub mod bg_tasks;
pub mod chat_attachments;
pub mod repo_map;
pub mod comfy_folders;
pub mod comfy_ws;
pub mod custom_models;
pub mod download;
pub mod developer_access;
pub mod engine;
pub mod engine_sanity;
pub mod filesystem;
pub mod gguf;
pub mod gpu;
pub mod health;
pub mod install;
pub mod install_method;
pub mod install_method_cmd;
pub mod self_migrate;
pub mod self_migrate_cmd;
pub mod local_api;
pub mod logging;
pub mod media_cmds;
pub mod mlx;
pub mod mlx_snapshot;
pub mod model_sniff;
pub mod process;
pub mod proxy;
pub mod remote;
pub mod search;
pub mod secret;
pub mod shell;
pub mod system;
pub mod torch_wheels;
pub mod trainer;
pub mod tts;
pub mod video;
pub mod gallery_files;
pub mod whisper;
pub mod oauth;
pub mod developer_sandbox;
pub mod developer_preview;

// ── prior implementation-compat error helpers ────────────────────────────────────────
//
// prior implementation's bridge daemon (axum) uses `internal(msg)` / `bad_request(msg)` /
// `not_found(msg)` helpers that return a structured (StatusCode, Json)
// tuple. The desktop Tauri command convention is `Result<Value, String>`
// where every error collapses to a plain String — Tauri's IPC bridge
// turns it into a JS-side rejection. Re-export the same three names as
// no-op `Into<String>` helpers so files ported verbatim from prior implementation
// compile without rewriting every `bad_request(...)` call site.
pub type CmdResult = Result<serde_json::Value, String>;

#[allow(dead_code)]
pub fn internal(msg: impl Into<String>) -> String { msg.into() }
#[allow(dead_code)]
pub fn bad_request(msg: impl Into<String>) -> String { msg.into() }
#[allow(dead_code)]
pub fn not_found(msg: impl Into<String>) -> String { msg.into() }

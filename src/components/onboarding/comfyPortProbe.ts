// aq (3.0.1): `detect_all_comfyui_installs` walks known install locations on
// disk; it finds nothing when ComfyUI lives somewhere the scan never looks
// (a custom venv launched by hand, a network drive, a path the scan's
// heuristics miss) even though the user already has it running. The legacy
// `find_comfyui` fallback has the same blind spot: it also reasons from disk
// paths and env vars, never from "is anything actually listening".
//
// This is the one further fallback: knock on the configured ComfyUI port's
// `/internal/folder_paths` (the same endpoint `comfy_folders::folders_of`
// reads on the Rust side for a running-instance probe) directly from the
// renderer, the same way the rest of this file already talks to a live
// ComfyUI once it knows where one is. No new Rust command needed, `fetchFn`
// is `localFetch` in production, which already proxies localhost requests
// through Tauri where the webview's own fetch cannot reach them.
//
// Short-circuits to false on any error (network refused, timeout, non-OK
// status): a probe that cannot tell is not a positive result, and the
// existing "not found" UI is the correct honest state for that case.
export async function probeRunningComfyPort(
  fetchFn: (url: string, opts?: { timeoutMs?: number }) => Promise<{ ok: boolean }>,
  url: string,
): Promise<boolean> {
  try {
    const res = await fetchFn(url, { timeoutMs: 2000 })
    return res.ok
  } catch {
    return false
  }
}

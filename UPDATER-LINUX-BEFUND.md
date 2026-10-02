# Linux updater status

Lazarus does not currently configure a first-party update feed. The Tauri updater endpoint list is empty, so the app cannot check for or download supplier-hosted releases. The former release URL and signing-key instructions have been removed from this guide.

The installed desktop executable and bundled inference sidecar use Lazarus names:

- Main executable: `lazarus`
- Sidecar: `lazarus-llama-server`

Linux packages can be built with `npm run tauri:build` after building the sidecar with `scripts/build-llama.sh`. Distribution and signing should be configured only after Lazarus has its own release endpoint and signing key.

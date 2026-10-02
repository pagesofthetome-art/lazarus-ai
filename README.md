<p align="center"><img src="public/lazarus-mark.svg" alt="Lazarus" width="88"></p>

# Lazarus

Lazarus is a local-first AI workspace for desktop. It brings chat, document retrieval, coding tools, and image and video workflows into one application.

## What it does

- Chat with models served by the bundled Lazarus Engine, Ollama, LM Studio, or another backend you configure.
- Keep conversations, memories, model files, and settings on your device.
- Use image and video workflows with a local ComfyUI or supported Apple Silicon backend.
- Connect optional third-party providers with your own endpoint and credentials. Requests to those providers leave your device and follow their policies.
- Use local speech, model discovery and downloads, and an agent workspace with configurable tool permissions.

Lazarus does not include a first-party hosted inference service, hosted model catalog, account login, or cross-device memory sync. Local inference requires compatible hardware and model files. Downloads and configured remote providers communicate with their respective services.

## Platforms

The release workflow currently packages Windows and Linux desktop builds. The Tauri configuration also contains macOS settings, but macOS release availability depends on a signed build from the project maintainer.

## Build from source

Requirements: Node.js 22 or newer, Rust stable, and the platform prerequisites for Tauri 2. Some optional local workflows install their own runtime dependencies when enabled.

```sh
npm ci
npm run tauri:dev
```

For the browser-based developer preview, run `npm run dev` and open
`http://localhost:5273`. The Windows `start.bat` launcher starts Vite and waits
for it to respond before opening the preview.

To create a release build:

```sh
npm run tauri:build
```

Useful checks:

```sh
npm run typecheck
npm test
```

## Existing installations

The first Lazarus launch migrates the previous app’s local data without overwriting files already present at the new location. Windows installers also recognize the previous product entry so upgrades do not leave duplicate installs. Provider credentials remain in the existing OS credential store.

## License

Lazarus is distributed under the GNU Affero General Public License v3.0. See [LICENSE](LICENSE) for the license text and attribution.

# Lazarus Windows build and verification

This guide describes the current Windows desktop app. Lazarus runs local models by default. The retired hosted account and generation services are not included; third-party providers can be configured by the user in Settings.

## Requirements

- Windows 10 or 11
- Node.js 22 or newer
- Rust stable with the `x86_64-pc-windows-msvc` target
- Visual Studio Build Tools with the MSVC C++ workload and Windows SDK
- WebView2 Runtime
- Git

To build the bundled inference sidecar, also install Git Bash, CMake, and the Vulkan SDK.

## Install and check the frontend

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

## Build the bundled engine sidecar

From Git Bash:

```bash
bash scripts/build-llama.sh x86_64-pc-windows-msvc
```

The script produces `src-tauri/bin/lazarus-llama-server-x86_64-pc-windows-msvc.exe` and validates its runtime dependencies.

## Build the Windows installer

```powershell
npm run tauri:build
```

The installer is written under `src-tauri/target/release/bundle/`.

## Identity and service checks

Run the dependency security checks and identity audit with Node:

```powershell
node --test scripts/security-dependencies.test.mjs scripts/identity-overhaul-audit.test.mjs
```

The app has no configured first-party hosted endpoint or updater feed. Its retired service client rejects before network access. Requests to an endpoint configured by the user go to that provider.

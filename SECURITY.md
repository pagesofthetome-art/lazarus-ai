# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do NOT open a public issue.** Instead:

1. Use this repository's private vulnerability reporting feature, or
2. Contact the project maintainers through the current project support channel.

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

### Response Timeline

- **Acknowledgment**: Within 48 hours
- **Assessment**: Within 1 week
- **Fix**: Depends on severity, but we aim for patches within 2 weeks for critical issues

### In-Scope

Lazarus runs locally by default, but optional configured providers, downloads,
connected tools, and remote access can communicate outside your device. We still
take the following seriously:

- **XSS in the chat UI** — malicious model outputs that could execute scripts
- **Path traversal** — file access outside intended directories
- **ComfyUI API abuse** — unintended command execution through the ComfyUI bridge
- **Remote Access** — auth bypass, passcode brute-force, unauthorized chat dispatch over LAN or Cloudflare Tunnel
- **Dependency vulnerabilities** — outdated npm or Cargo packages with known CVEs

### Out of Scope

- Vulnerabilities in Ollama, ComfyUI, LM Studio, or other backends themselves (report to their maintainers)
- Issues that require physical access to the machine
- Social engineering attacks
- Antivirus false positives (see the next section)

---

## Antivirus & Browser False Positives

Some antivirus engines and browser SmartScreen prompts flag the Windows installer as suspicious or as a generic trojan. This is a **false positive** caused by heuristics, not actual malware. Reports we have seen so far:

- **ESET**: blocks the installer at run-time
- **Avast**: `Win32:NSIS_Error[Heur]` heuristic on the NSIS bootstrap
- **Microsoft SmartScreen**: "unrecognized app" warning on first run

### Why it happens

1. **The installer is not yet Authenticode-signed.** We sign the auto-update channel with a Tauri / minisign key (see below), but the NSIS `.exe` you download from GitHub Releases does not yet carry a Microsoft code-signing certificate. Without that certificate, every reputation-based heuristic starts at zero trust.
2. **The app pattern looks suspicious to behavioural scanners.** Lazarus is a Tauri app (small Rust binary + WebView), packaged with NSIS, that can download and run optional local backends and model files. Review the installer and download code (`src-tauri/src/commands/install.rs`, `src-tauri/src/commands/ollama.rs`).
3. **NSIS itself is a frequently-flagged installer format**, since some malware families have used NSIS in the past.

### What you can do as a user

- **Verify the source and checksum.** Use the release source supplied by the current Lazarus maintainers and compare the published SHA-256 before installing.
- **Verify updates.** This build has no updater feed configured. Do not assume an update is official unless the current Lazarus maintainers publish its source and signature details.
- **Submit the false positive.** Antivirus vendors fix false positives quickly when users submit the file. Direct links:
  - [ESET](https://support.eset.com/en/kb141-submit-a-virus-spyware-or-suspicious-file-to-eset-virus-lab)
  - [Microsoft Defender](https://www.microsoft.com/en-us/wdsi/filesubmission)
  - [Avast / AVG](https://www.avast.com/false-positive-file-form.php)
  - [Bitdefender](https://www.bitdefender.com/consumer/support/answer/29358/)
  - [Kaspersky](https://opentip.kaspersky.com/?tab=fileupload)
  - [Norton / Symantec](https://submit.norton.com/falsepositive)
  - [McAfee](https://www.mcafee.com/threat-intelligence/disputed-detection.aspx)
- **Build it yourself.** AGPL-3.0 lets you inspect and build the source. See `CONTRIBUTING.md` for the build steps.

### Code-signing roadmap

A proper Authenticode-signed installer is the long-term fix. Two paths are in flight:

- **SignPath.io OSS plan** — free EV code-signing for verified open-source projects. Application status: pending.
- **Self-funded EV certificate** — ~$300-600/year. On the list once the project justifies the cost.

The auto-update channel is already signed (minisign), so the trust path *after* you have a working install is intact. The first install is the only weak link, and it is the one we are working to close.

If you have experience with cross-signing, EV cert provisioning, or SignPath onboarding — please get in touch via the Discord.

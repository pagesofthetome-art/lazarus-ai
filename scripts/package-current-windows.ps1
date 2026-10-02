param(
    [string]$OutputRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)),
    [string]$BuildStartedAt
)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$output = [IO.Path]::GetFullPath($OutputRoot)
New-Item -ItemType Directory -Path $output -Force | Out-Null
$installer = Join-Path $project 'src-tauri\target\release\bundle\nsis\Lazarus_3.0.3_x64-setup.exe'
$executable = Join-Path $project 'src-tauri\target\release\lazarus.exe'
foreach ($artifact in @($installer, $executable)) {
    if (!(Test-Path -LiteralPath $artifact)) { throw "Missing build artifact: $artifact" }
    if ($BuildStartedAt -and (Get-Item -LiteralPath $artifact).LastWriteTimeUtc -lt [DateTime]::Parse($BuildStartedAt).ToUniversalTime()) {
        throw "Build artifact is older than this build: $artifact"
    }
}
$stage = Join-Path $output ('delivery-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item -LiteralPath $installer -Destination (Join-Path $stage 'Lazarus-Setup.exe')
$runtime = Join-Path $stage 'Program'
New-Item -ItemType Directory -Path $runtime | Out-Null
Copy-Item -LiteralPath $executable -Destination (Join-Path $runtime 'Lazarus.exe')
Copy-Item -LiteralPath (Join-Path $project 'src-tauri\bin\lazarus-llama-server-x86_64-pc-windows-msvc.exe') -Destination (Join-Path $runtime 'lazarus-llama-server.exe')
Get-ChildItem (Join-Path $project 'src-tauri\resources\llama\x86_64-pc-windows-msvc') -File -Filter '*.dll' | Copy-Item -Destination $runtime
New-Item -ItemType Directory -Path (Join-Path $runtime 'resources') | Out-Null
Copy-Item -LiteralPath (Join-Path $project 'src-tauri\resources\whisper_server.py') -Destination (Join-Path $runtime 'resources\whisper_server.py')

$source = Join-Path $stage 'Source'
New-Item -ItemType Directory -Path $source | Out-Null
function Copy-ProjectDirectory([string]$from, [string]$to, [string]$relative) {
    New-Item -ItemType Directory -Path $to -Force | Out-Null
    foreach ($item in Get-ChildItem -LiteralPath $from -Force) {
        $rel = if ($relative) { $relative + '/' + $item.Name } else { $item.Name }
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { continue }
        if ($item.PSIsContainer) {
            if ($item.Name -in @('node_modules', 'target', '.git', '.gradle', '.pnpm-store', '.cache', '.codex', '.codex-bin', '.android', '.aws', '.agents')) { continue }
            if ($item.FullName -eq $stage) { continue }
            if ($rel -eq 'src-tauri/gen' -or $rel -eq 'dist') { continue }
            Copy-ProjectDirectory $item.FullName (Join-Path $to $item.Name) $rel
        } else {
            if ($item.Extension -in @('.apk', '.aab', '.zip', '.log', '.pdb', '.jks', '.keystore')) { continue }
            if ($item.Name -like '.env*' -and $item.Name -ne '.env.example') { continue }
            if ($item.Name -match '(?i)(\.pem$|\.key$|id_rsa|id_ed25519)') { continue }
            Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $to $item.Name)
        }
    }
}
Copy-ProjectDirectory $project $source ''
Copy-Item -LiteralPath (Join-Path $project 'LICENSE') -Destination (Join-Path $stage 'LICENSE')
@'
Lazarus - current Windows desktop build

Install in your Windows x64 VM:
1. Extract this ZIP to a short folder, such as C:\Lazarus.
2. Run Lazarus-Setup.exe inside Windows.
3. Launch Lazarus from its installed shortcut.

There is exactly one installer. Program contains the application files from
the same build, including the local inference engine and its runtime DLLs.
Source contains the matching React, Rust/Tauri, assets, configuration,
lockfiles, desktop build scripts, and project documentation.

The EXE embeds the compiled interface shown in the current desktop web preview.
WebView2 is checked by the installer and installed if needed (internet may be
needed for that prerequisite). Models, optional backends, plugin credentials,
chats and gallery data belong to the user's environment and are not bundled.
Python/ComfyUI and other optional providers are configured by the application.

Source rebuild: install Node.js 22+, pnpm, Rust and the Visual Studio C++ build
tools, then run pnpm install --frozen-lockfile and pnpm tauri build --bundles nsis
in Source. Developer sandbox previews also require a Node/npm toolchain.

Android binaries, older installers, build caches, dependency caches, generated
Android projects, and private credentials are excluded from this Windows package.
This installer has not been tested inside your specific VM.

MANIFEST.json records each delivered file's size and SHA-256 checksum.
'@ | Set-Content -LiteralPath (Join-Path $stage 'README.txt') -Encoding utf8
$manifest = @(Get-ChildItem -LiteralPath $stage -Recurse -File | Sort-Object FullName | ForEach-Object {
    [ordered]@{
        path = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')
        bytes = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
})
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stage 'MANIFEST.json') -Encoding utf8
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $output 'Lazarus-current-Windows.zip'
# Keep the candidate outside the archived tree.
$candidate = $stage + '.zip'
[IO.Compression.ZipFile]::CreateFromDirectory($stage, $candidate, [IO.Compression.CompressionLevel]::Optimal, $false)
$archive = [IO.Compression.ZipFile]::OpenRead($candidate)
try {
    if (@($archive.Entries | Where-Object { $_.FullName -match '(?i)\.(apk|aab)$' }).Count) { throw 'Android binary found in desktop package.' }
    if (@($archive.Entries | Where-Object { $_.FullName -eq 'Lazarus-Setup.exe' }).Count -ne 1) { throw 'Installer missing or duplicated.' }
    foreach ($required in @('Program/Lazarus.exe', 'Program/llama-server-impl.dll', 'Program/ggml-base.dll', 'Source/src/App.tsx', 'Source/src-tauri/src/desktop_main.rs', 'Source/pnpm-lock.yaml')) {
        if (!$archive.GetEntry($required)) { throw "Missing package entry: $required" }
    }
    $longest = ($archive.Entries | Sort-Object { $_.FullName.Length } -Descending | Select-Object -First 1).FullName.Length
    if ($longest -gt 150) { throw "Package has excessive path length: $longest" }
} finally { $archive.Dispose() }
Move-Item -LiteralPath $candidate -Destination $zip -Force
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
"$hash  Lazarus-current-Windows.zip" | Set-Content -LiteralPath ($zip + '.sha256') -Encoding ascii
Write-Output "Package: $zip"
Write-Output "Files: $($manifest.Count)"
Write-Output "Longest internal path: $longest"
Write-Output "Size: $((Get-Item -LiteralPath $zip).Length)"

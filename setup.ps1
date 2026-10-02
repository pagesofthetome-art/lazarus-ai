# Lazarus - Developer Setup (PowerShell)
# Runs Lazarus in dev-mode (Vite at localhost:5273). For the desktop app,
# use the installer: the Lazarus project release page

$Host.UI.RawUI.WindowTitle = "Lazarus - Dev Setup"

Write-Host ""
Write-Host "   +---------------------------------------------------------------+" -ForegroundColor Yellow
Write-Host "   | This script starts Lazarus in DEVELOPER mode.     |" -ForegroundColor Yellow
Write-Host "   | It runs via Vite at http://localhost:5273 in your browser,   |" -ForegroundColor Yellow
Write-Host "   | which has fewer features than the installed desktop app.     |" -ForegroundColor Yellow
Write-Host "   |                                                               |" -ForegroundColor Yellow
Write-Host "   | Just want to USE the app? Download the installer instead:    |" -ForegroundColor Yellow
Write-Host "   | the Lazarus project release page |" -ForegroundColor Cyan
Write-Host "   +---------------------------------------------------------------+" -ForegroundColor Yellow
Write-Host ""
$answer = Read-Host "Continue with developer setup? (y/N)"
if ($answer -notmatch '^[Yy]') {
    Write-Host ""
    Write-Host "Cancelled. Download the installer from:" -ForegroundColor White
    Write-Host "  the Lazarus project release page" -ForegroundColor Cyan
    Read-Host "Press Enter to exit"
    exit
}
Write-Host ""
Write-Host ""
Write-Host "    Lazarus" -ForegroundColor Magenta
Write-Host "    Local-first AI tools for chat, code, and media." -ForegroundColor DarkGray
Write-Host ""

# Check Node.js
if (Get-Command node -ErrorAction SilentlyContinue) {
    $v = node --version
    $nodeMajor = [int]($v.TrimStart('v').Split('.')[0])
    if ($LASTEXITCODE -ne 0 -or $nodeMajor -lt 22) {
        Write-Host " [!] Lazarus requires Node.js 22 or newer. Upgrade Node.js, then run setup.ps1 again." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host " [+] Node.js $v" -ForegroundColor Green
} else {
    Write-Host " [::] Installing Node.js..." -ForegroundColor Yellow
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    Write-Host " [+] Node.js installed. Please restart PowerShell and run .\setup.ps1 again." -ForegroundColor Green
    Read-Host "Press Enter to exit"
    exit
}

# Check Git
if (Get-Command git -ErrorAction SilentlyContinue) {
    Write-Host " [+] Git" -ForegroundColor Green
} else {
    Write-Host " [::] Installing Git..." -ForegroundColor Yellow
    winget install Git.Git --accept-package-agreements --accept-source-agreements
    Write-Host " [+] Git installed. Please restart PowerShell and run .\setup.ps1 again." -ForegroundColor Green
    Read-Host "Press Enter to exit"
    exit
}

# Check Ollama
if (Get-Command ollama -ErrorAction SilentlyContinue) {
    Write-Host " [+] Ollama" -ForegroundColor Green
} else {
    Write-Host " [::] Installing Ollama..." -ForegroundColor Yellow
    winget install Ollama.Ollama --accept-package-agreements --accept-source-agreements
    Write-Host " [+] Ollama installed" -ForegroundColor Green
}

# Start Ollama if not running
$ollamaRunning = Get-Process -Name "ollama" -ErrorAction SilentlyContinue
if (-not $ollamaRunning) {
    Start-Process -FilePath "ollama" -ArgumentList "serve" -WindowStyle Hidden
    Start-Sleep -Seconds 3
}

# Install dependencies
Write-Host ""
Write-Host " [::] Installing dependencies..." -ForegroundColor Yellow
Set-Location $PSScriptRoot
npm install --loglevel=error 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host " [!] Dependency installation failed. Check the npm output and try again." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host " [+] Dependencies installed" -ForegroundColor Green

# Check AI models
Write-Host ""
$models = ollama list 2>$null
if ($models -match "abliterated|llama|qwen|mistral|deepseek|gemma|phi") {
    Write-Host " [+] AI models found" -ForegroundColor Green
} else {
    Write-Host " [::] No AI model found." -ForegroundColor Yellow
    Write-Host " [::] Downloading Llama 3.1 8B Uncensored (~5.7 GB)..." -ForegroundColor Yellow
    Write-Host "      This is a one-time download. Grab a coffee." -ForegroundColor DarkGray
    Write-Host ""
    ollama pull mannix/llama3.1-8b-abliterated:q5_K_M
    Write-Host ""
    Write-Host " [+] AI model installed" -ForegroundColor Green
}

# Create desktop shortcut
$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut([System.IO.Path]::Combine([Environment]::GetFolderPath('Desktop'), 'Lazarus.lnk'))
$shortcut.TargetPath = Join-Path $PSScriptRoot "start.bat"
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = "Lazarus - Private AI Chat"
$shortcut.WindowStyle = 7
$shortcut.Save()

Write-Host ""
Write-Host " ________________________________________________" -ForegroundColor Green
Write-Host ""
Write-Host " Setup complete! Opening in your browser..." -ForegroundColor White
Write-Host ""

# Use the shared launcher so the browser opens only after Vite is responding.
& (Join-Path $PSScriptRoot "start.bat")
if ($LASTEXITCODE -ne 0) {
    Write-Host " [!] Lazarus could not start. Check the Lazarus Dev Server window." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

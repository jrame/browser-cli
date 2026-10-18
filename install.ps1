param(
    [string]$InstallDir,
    [string]$BinDir,
    [switch]$SkipBrowsers
)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 20 or newer is required. Install Node.js, then run this installer again.'
}
$installerArgs = @((Join-Path $PSScriptRoot 'scripts\install-release.cjs'))
if ($InstallDir) { $installerArgs += @('--install-dir', $InstallDir) }
if ($BinDir) { $installerArgs += @('--bin-dir', $BinDir) }
if ($SkipBrowsers) { $installerArgs += '--skip-browsers' }
& node @installerArgs
if ($LASTEXITCODE -ne 0) { throw 'browser installation failed.' }

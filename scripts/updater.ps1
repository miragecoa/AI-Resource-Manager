$host.UI.RawUI.WindowTitle = 'AI Resource Manager Updater'
Write-Host 'Waiting for app to exit...' -ForegroundColor Cyan
while (Get-Process -Id __PID__ -EA SilentlyContinue) { Start-Sleep 1 }
Start-Sleep 3

$appDir     = '__APP_DIR__'
$zipPath    = '__ZIP_PATH__'
$exePath    = '__EXE_PATH__'
$oldExeName = [System.IO.Path]::GetFileName($exePath)

# Extract to a separate temp dir first — never overwrite in-place
$extractDir = Join-Path (Split-Path $zipPath -Parent) 'extracted'
if (Test-Path $extractDir) { Remove-Item $extractDir -Recurse -Force -EA SilentlyContinue }
New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

Write-Host 'Extracting update...' -ForegroundColor Cyan
try {
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force -EA Stop
    Write-Host 'Extraction OK' -ForegroundColor Green
} catch {
    Write-Host "Extract failed: $_" -ForegroundColor Red
    Read-Host 'Press Enter to exit'
    exit 1
}

# Support both flat zip (files at root) and single-subfolder zip
$topItems  = Get-ChildItem -Path $extractDir
$sourceDir = if ($topItems.Count -eq 1 -and $topItems[0].PSIsContainer) {
    $topItems[0].FullName
} else {
    $extractDir
}

# Remember new exe name (for rename step later)
$newExeInSource = Get-ChildItem -Path $sourceDir -Filter '*.exe' -File | Select-Object -First 1

Write-Host 'Installing...' -ForegroundColor Cyan
$script:failed = 0

Get-ChildItem -Path $sourceDir -Recurse -File | ForEach-Object {
    $rel     = $_.FullName.Substring($sourceDir.Length).TrimStart('\/')
    $dest    = Join-Path $appDir $rel
    $destDir = Split-Path $dest -Parent

    if (-not (Test-Path $destDir)) {
        New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    }

    # If a file already exists, rename it to .bak first.
    # Windows allows renaming memory-mapped / open-handle files — the handle
    # stays valid on the old name, freeing the target path for the new file.
    $bakPath = "$dest.bak"
    if (Test-Path $dest) {
        Remove-Item $bakPath -Force -EA SilentlyContinue
        try {
            Rename-Item $dest $bakPath -Force -EA Stop
        } catch {
            Write-Host "  Warn: could not rename $rel — $_" -ForegroundColor Yellow
        }
    }

    try {
        Copy-Item $_.FullName $dest -Force -EA Stop
        # Remove backup only after successful copy
        Remove-Item $bakPath -Force -EA SilentlyContinue
    } catch {
        Write-Host "  Error: could not install $rel — $_" -ForegroundColor Red
        # Restore backup if copy failed
        if (Test-Path $bakPath) { Rename-Item $bakPath $dest -Force -EA SilentlyContinue }
        $script:failed++
    }
}

if ($script:failed -gt 0) {
    Write-Host "$($script:failed) file(s) failed to install." -ForegroundColor Red
    Write-Host 'Press any key to exit...' -ForegroundColor Yellow
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    exit 1
}

# Clean up any leftover .bak files
Get-ChildItem -Path $appDir -Recurse -Filter '*.bak' | Remove-Item -Force -EA SilentlyContinue

# Exe rename: if new exe has a different name, replace old exe with it
if ($newExeInSource -and $newExeInSource.Name -ne $oldExeName) {
    $installedNewExe = Join-Path $appDir $newExeInSource.Name
    if (Test-Path $installedNewExe) {
        Remove-Item $exePath -Force -EA SilentlyContinue
        Rename-Item $installedNewExe $oldExeName -Force -EA SilentlyContinue
    }
}

# Cleanup: remove the entire .update-temp directory
Remove-Item (Split-Path $zipPath -Parent) -Recurse -Force -EA SilentlyContinue

Write-Host 'Done! Launching...' -ForegroundColor Green
Start-Process $exePath

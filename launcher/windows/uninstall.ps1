# Lecture Studio uninstaller (Windows). Started by the API (POST /api/system/uninstall) through uninstall.vbs, from a copy
# in %TEMP%: the app folder it deletes holds the original. The plan is a UTF-8 file of tab-separated lines:
#   pid <api pid> | ui_port <port> | profile <app window profile> | message <final text> | failed <label>
#   remove <path> | remove_if_empty <path>
# Self-contained on purpose: common.ps1 is inside the app folder that goes.

param([Parameter(Mandatory = $true)][string]$Plan)

$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName System.Windows.Forms
$apiPid = 0
$uiPort = 0
$profileDir = ''
$message = ''
$failed = ''
$remove = New-Object System.Collections.Generic.List[string]
$removeIfEmpty = New-Object System.Collections.Generic.List[string]
foreach ($line in (Get-Content -LiteralPath $Plan -Encoding UTF8)) {
    $key, $value = $line -split "`t", 2
    switch ($key) {
        'pid' { $apiPid = [int]$value }
        'ui_port' { $uiPort = [int]$value }
        'profile' { $profileDir = $value }
        'message' { $message = $value }
        'failed' { $failed = $value }
        'remove' { $remove.Add($value) }
        'remove_if_empty' { $removeIfEmpty.Add($value) }
    }
}

# 1. The API stops itself after answering: wait for it (up to 30 s), then close whatever is left.
for ($i = 0; $i -lt 60; $i++) {
    if (-not $apiPid -or -not (Get-Process -Id $apiPid -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
}
if ($apiPid) { Stop-Process -Id $apiPid -Force -ErrorAction SilentlyContinue }
if ($uiPort) {
    Get-NetTCPConnection -State Listen -LocalPort $uiPort -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 } |
        ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
}
if ($profileDir) {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains("--user-data-dir=$profileDir") } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 1

# 2. The Desktop shortcut, only our own (it runs start.vbs).
$shortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Lecture Studio.lnk'
if (Test-Path -LiteralPath $shortcut) {
    try {
        $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
        if ($link.Arguments -like '*start.vbs*') { Remove-Item -LiteralPath $shortcut -Force -ErrorAction SilentlyContinue }
    } catch { }
}

# 3. Delete. Never a drive root or anything that contains the user profile, whatever the plan says.
#    Retries: Windows keeps files locked for a moment after a process exits. Mirroring an empty folder (robocopy) clears
#    paths too long for Remove-Item (deep node_modules).
$userHome = [Environment]::GetFolderPath('UserProfile').TrimEnd('\')
function Test-Deletable([string]$Path) {
    $p = $Path.TrimEnd('\')
    if ($p.Length -le 3) { return $false }
    if ($p -eq $userHome -or $userHome.StartsWith($p + '\', [StringComparison]::OrdinalIgnoreCase)) { return $false }
    return $true
}
$empty = Join-Path (Split-Path -Parent $Plan) 'empty'
New-Item -ItemType Directory -Force -Path $empty | Out-Null
$left = @()
foreach ($p in $remove) {
    if (-not (Test-Deletable $p)) { continue }
    for ($try = 0; $try -lt 10 -and (Test-Path -LiteralPath $p); $try++) {
        Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path -LiteralPath $p -PathType Container) {
            & robocopy.exe $empty $p /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
            Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $p) { Start-Sleep -Seconds 2 }
    }
    if (Test-Path -LiteralPath $p) { $left += $p }
}
foreach ($p in $removeIfEmpty) {
    if (-not (Test-Deletable $p) -or -not (Test-Path -LiteralPath $p)) { continue }
    $rest = @(Get-ChildItem -LiteralPath $p -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'desktop.ini' })
    if ($rest.Count -eq 0) { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue }
}
if ($left.Count) { $message += "`n`n$failed " + ($left -join ', ') }

[System.Windows.Forms.MessageBox]::Show($message, 'Lecture Studio', 'OK', 'Information') | Out-Null
Remove-Item -LiteralPath (Split-Path -Parent $Plan) -Recurse -Force -ErrorAction SilentlyContinue

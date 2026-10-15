# Lecture Studio (Windows): shared helpers for launcher\windows\start.ps1, stop.ps1 and installer\windows\install.ps1.
# Dot-source:  . (Join-Path $PSScriptRoot 'common.ps1')

$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$AppHome = if ($env:LECTURE_STUDIO_HOME) { $env:LECTURE_STUDIO_HOME } else { Join-Path $env:APPDATA 'Lecture Studio' }
$Logs = Join-Path $AppHome 'logs'
$State = Join-Path $AppHome 'state'
$BrowserProfile = Join-Path $AppHome 'chrome-profile'
$SettingsFile = Join-Path $AppHome 'settings.json'
$ApiPort = 3000
$UiPort = 5173
$ApiUrl = "http://127.0.0.1:$ApiPort"
$UiUrl = "http://127.0.0.1:$UiPort"
New-Item -ItemType Directory -Force -Path $Logs, $State | Out-Null

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

function Update-Path {
    # Tools installed by winget/uv during this session are not on the inherited PATH yet.
    $parts = @(
        [Environment]::GetEnvironmentVariable('Path', 'Machine'),
        [Environment]::GetEnvironmentVariable('Path', 'User'),
        (Join-Path $env:USERPROFILE '.local\bin'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links')
    )
    $env:Path = ($parts | Where-Object { $_ }) -join ';'
}

function Write-Log([string]$File, [string]$Message) {
    Add-Content -Path $File -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message) -Encoding UTF8
}

function Show-Message([string]$Text, [string]$Buttons = 'OK', [string]$Icon = 'Information') {
    return [System.Windows.Forms.MessageBox]::Show($Text, 'Lecture Studio', $Buttons, $Icon)
}

function Join-Args([string[]]$Arguments) {
    # Windows PowerShell 5.1 does not quote -ArgumentList items.
    ($Arguments | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
}

function Invoke-Logged {
    # Runs a command, appends its output to LogFile, returns the exit code. Tick runs while waiting (UI refresh).
    param([string]$Exe, [string[]]$Arguments = @(), [string]$Cwd = $Repo, [string]$LogFile, [scriptblock]$Tick)
    $out = [IO.Path]::GetTempFileName()
    $err = [IO.Path]::GetTempFileName()
    $p = Start-Process -FilePath $Exe -ArgumentList (Join-Args $Arguments) -WorkingDirectory $Cwd -NoNewWindow -PassThru `
        -RedirectStandardOutput $out -RedirectStandardError $err
    $null = $p.Handle  # keeps ExitCode readable after exit
    while (-not $p.HasExited) {
        if ($Tick) { & $Tick }
        Start-Sleep -Milliseconds 120
    }
    $p.WaitForExit()
    Get-Content -Path $out, $err -ErrorAction SilentlyContinue | Add-Content -Path $LogFile -Encoding UTF8
    Remove-Item -Path $out, $err -ErrorAction SilentlyContinue
    return $p.ExitCode
}

function Get-ListeningPids([int[]]$Ports) {
    Get-NetTCPConnection -State Listen -LocalPort $Ports -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 }
}

function Get-AppWindowPids {
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine.Contains("--user-data-dir=$BrowserProfile") } |
        Select-Object -ExpandProperty ProcessId
}

function Stop-Pids([int[]]$Pids) {
    foreach ($id in ($Pids | Where-Object { $_ -and $_ -ne $PID } | Sort-Object -Unique)) {
        Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
    }
}

function Find-Browser {
    $candidates = @(
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe')
    )
    return $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

function Open-AppWindow {
    # Chrome or Edge in app mode with a dedicated profile (no tabs, no address bar); else the default browser.
    $browser = Find-Browser
    if ($browser) {
        Start-Process -FilePath $browser -ArgumentList (Join-Args @("--app=$UiUrl", "--user-data-dir=$BrowserProfile", '--no-first-run', '--no-default-browser-check', '--window-size=1480,940'))
    } else {
        Start-Process $UiUrl
    }
}

function Test-Http([string]$Url) {
    try { $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 1; return $true } catch { return $false }
}

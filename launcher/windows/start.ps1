# Lecture Studio — clean-slate launcher (Windows). Target of the Desktop shortcut (through start.vbs: no console window).
#   API: FastAPI on 127.0.0.1:3000      UI: Vite on 127.0.0.1:5173 (proxies /api -> 3000)
# Every launch: stop old processes -> sync deps if changed -> start API + UI -> open the app window.
# Lesson data is never touched; temp\ is cleared by the API on startup.

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')
$Log = Join-Path $Logs 'launcher.log'
Write-Log $Log "=== launch from $Repo"
Update-Path

function Fail([string]$Message) {
    Write-Log $Log "FAIL: $Message"
    Show-Message $Message 'OK' 'Error' | Out-Null
    exit 1
}

function Get-Fingerprint([string[]]$Files) {
    ($Files | ForEach-Object { (Get-FileHash -Algorithm SHA256 -Path (Join-Path $Repo $_)).Hash }) -join ''
}

function Test-Changed([string]$Name, [string]$Fingerprint) {
    $f = Join-Path $State $Name
    return -not (Test-Path $f) -or ((Get-Content $f -Raw).Trim() -ne $Fingerprint)
}

# ---- 0. Already running and busy? Don't kill a long job by accident.
try { $status = Invoke-RestMethod -Uri "$ApiUrl/api/system/status" -TimeoutSec 2 } catch { $status = $null }
if ($status -and $status.busy) {
    $answer = Show-Message "Сейчас идёт обработка. Перезапуск прервёт её.`n`nПерезапустить всё равно?" 'YesNo' 'Warning'
    if ($answer -ne 'Yes') {
        if (-not (Get-AppWindowPids)) { Open-AppWindow }
        exit 0
    }
}

# ---- 1. Stop previous instance: API, UI, app window.
$old = @()
foreach ($name in 'server.pid', 'frontend.pid') {
    $f = Join-Path $AppHome $name
    if (Test-Path $f) { $old += (Get-Content $f | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ }) }
}
$old += Get-ListeningPids @($ApiPort, $UiPort)
if ($old) { Write-Log $Log "stopping: $($old -join ' ')" }
Stop-Pids $old
Stop-Pids (Get-AppWindowPids)
Remove-Item -Path (Join-Path $AppHome 'server.pid'), (Join-Path $AppHome 'frontend.pid') -ErrorAction SilentlyContinue

# ---- 2. Toolchain.
foreach ($tool in 'uv', 'node', 'ffmpeg') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "Не найден $tool. Запустите installer\windows\Setup.cmd." }
}

# ---- 3. Dependencies, only when lockfiles changed.
$pyFp = Get-Fingerprint @('pyproject.toml', 'uv.lock')
if (-not (Test-Path (Join-Path $Repo '.venv\Scripts\python.exe')) -or (Test-Changed 'python' $pyFp)) {
    Write-Log $Log 'uv sync'
    if ((Invoke-Logged -Exe (Get-Command uv).Source -Arguments @('sync', '--frozen') -LogFile $Log) -ne 0) { Fail "uv sync не удался. Лог: $Log" }
    Set-Content -Path (Join-Path $State 'python') -Value $pyFp
}
$nodeFp = Get-Fingerprint @('frontend\package-lock.json')
if (-not (Test-Path (Join-Path $Repo 'frontend\node_modules\vite')) -or (Test-Changed 'node' $nodeFp)) {
    Write-Log $Log 'npm ci'
    if ((Invoke-Logged -Exe 'cmd.exe' -Arguments @('/c', 'npm', 'ci', '--no-audit', '--no-fund') -Cwd (Join-Path $Repo 'frontend') -LogFile $Log) -ne 0) { Fail "npm ci не удался. Лог: $Log" }
    Set-Content -Path (Join-Path $State 'node') -Value $nodeFp
}

# ---- 4. API (writes its own server.pid).
Write-Log $Log "starting api :$ApiPort"
Start-Process -FilePath (Join-Path $Repo '.venv\Scripts\python.exe') -WorkingDirectory $Repo -NoNewWindow `
    -ArgumentList (Join-Args @('-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', "$ApiPort", '--timeout-graceful-shutdown', '3')) `
    -RedirectStandardOutput (Join-Path $Logs 'server.out.log') -RedirectStandardError (Join-Path $Logs 'server.log') | Out-Null

# ---- 5. UI (Vite).
Write-Log $Log "starting ui :$UiPort"
$ui = Start-Process -FilePath (Get-Command node).Source -WorkingDirectory (Join-Path $Repo 'frontend') -NoNewWindow -PassThru `
    -ArgumentList (Join-Args @('node_modules\vite\bin\vite.js', '--host', '127.0.0.1', '--port', "$UiPort", '--strictPort')) `
    -RedirectStandardOutput (Join-Path $Logs 'frontend.log') -RedirectStandardError (Join-Path $Logs 'frontend.err.log')
Set-Content -Path (Join-Path $AppHome 'frontend.pid') -Value $ui.Id

$deadline = (Get-Date).AddSeconds(90)
while (-not (Test-Http "$ApiUrl/api/health") -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
if (-not (Test-Http "$ApiUrl/api/health")) { Fail "API не запустился за 90 с. Лог: $(Join-Path $Logs 'server.log')" }
while (-not (Test-Http "$UiUrl/") -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
if (-not (Test-Http "$UiUrl/")) { Fail "Интерфейс не запустился. Лог: $(Join-Path $Logs 'frontend.log')" }

# ---- 6. App window.
Open-AppWindow
Write-Log $Log 'ready'

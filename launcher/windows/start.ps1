# Lecture Studio — clean-slate launcher (Windows). Target of the Desktop shortcut (through start.vbs: no console window).
#   API: FastAPI on 127.0.0.1:3000      UI: Vite on 127.0.0.1:5173 (proxies /api -> 3000)
# Every launch: stop old processes -> sync deps if changed -> start API + UI -> open the app window.
# Lesson data is never touched; temp\ is cleared by the API on startup.
#   -Mode normal    Desktop shortcut
#   -Mode update    started by the API after it moved the code to a new release (state\update.json):
#                   keeps the app window, rolls back to the previous commit if the new version fails
#   -Mode rollback  the second pass after such a rollback

param([ValidateSet('normal', 'update', 'rollback')][string]$Mode = 'normal')

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot 'common.ps1')
$Log = Join-Path $Logs 'launcher.log'
Write-Log $Log "=== launch ($Mode) from $Repo"
Update-Path

$Handover = Join-Path $State 'update.json'
$FromSha = ''
if ($Mode -eq 'update') {
    try { $FromSha = (Get-Content $Handover -Raw | ConvertFrom-Json).from_sha } catch { $FromSha = '' }
} elseif ($Mode -eq 'normal') {
    Remove-Item $Handover -ErrorAction SilentlyContinue  # stale hand-over from an interrupted update
}

function Fail([string]$Message) {
    Write-Log $Log "FAIL: $Message"
    if ($Mode -eq 'update' -and $FromSha) {
        # The new release did not come up: back to the previous commit, start again (deps re-sync by fingerprint).
        Write-Log $Log "rolling back to $FromSha"
        & git -C $Repo reset --keep $FromSha 2>&1 | Add-Content -Path $Log -Encoding UTF8
        if ($LASTEXITCODE -eq 0) {
            # Same path as the shortcut and the update restart (wscript + start.vbs): a hidden detached powershell.exe
            # is a pattern antivirus may silently kill.
            Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') `
                -ArgumentList (Join-Args @((Join-Path $PSScriptRoot 'start.vbs'), 'rollback'))
            exit 1
        }
    }
    Remove-Item $Handover -ErrorAction SilentlyContinue
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

# ---- 0. Already running and busy? Don't kill a long job by accident. (An update was checked by the API.)
$status = $null
if ($Mode -eq 'normal') { try { $status = Invoke-RestMethod -Uri "$ApiUrl/api/system/status" -TimeoutSec 2 } catch { $status = $null } }
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
if ($Mode -eq 'normal') { Stop-Pids (Get-AppWindowPids) }  # an update keeps the window: it waits and reloads
Remove-Item -Path (Join-Path $AppHome 'server.pid'), (Join-Path $AppHome 'frontend.pid') -ErrorAction SilentlyContinue

# ---- 2. Toolchain.
foreach ($tool in 'uv', 'node', 'ffmpeg') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "Не найден $tool. Запустите installer\windows\Setup.cmd." }
}

# ---- 3. Dependencies, only when lockfiles or the torch build (GPU, driver) changed.
$probe = Get-ComputeProbe
Write-Log $Log "torch: $($probe.torch_build) ($($probe.reason)) gpu='$($probe.gpu)' cap=$($probe.compute_cap) driver=$($probe.driver)"
$pyFp = (Get-Fingerprint @('pyproject.toml', 'uv.lock')) + "-$($probe.torch_build)"
if (-not (Test-Path (Join-Path $Repo '.venv\Scripts\python.exe')) -or (Test-Changed 'python' $pyFp)) {
    Write-Log $Log "uv sync --extra $($probe.torch_build)"
    if ((Invoke-Logged -Exe (Get-Command uv).Source -Arguments @('sync', '--frozen', '--extra', $probe.torch_build) -LogFile $Log) -ne 0) { Fail "uv sync не удался. Лог: $Log" }
    Set-Content -Path (Join-Path $State 'python') -Value $pyFp
}
$nodeFp = Get-Fingerprint @('frontend\package-lock.json')
if (-not (Test-Path (Join-Path $Repo 'frontend\node_modules\vite')) -or (Test-Changed 'node' $nodeFp)) {
    Write-Log $Log 'npm ci'
    # cmd /c npm can return a non-zero code after a successful install: judge by the result, not the exit code.
    $code = Invoke-Logged -Exe 'cmd.exe' -Arguments @('/c', 'npm', 'ci', '--no-audit', '--no-fund') -Cwd (Join-Path $Repo 'frontend') -LogFile $Log
    if (-not (Test-Path (Join-Path $Repo 'frontend\node_modules\vite'))) { Fail "npm ci не удался (npm код $code). Лог: $Log" }
    Set-Content -Path (Join-Path $State 'node') -Value $nodeFp
}

# ---- 4. API (writes its own server.pid).
Write-Log $Log "starting api :$ApiPort"
$api = Start-Process -FilePath (Join-Path $Repo '.venv\Scripts\python.exe') -WorkingDirectory $Repo -NoNewWindow -PassThru `
    -ArgumentList (Join-Args @('-m', 'uvicorn', 'backend.main:app', '--host', '127.0.0.1', '--port', "$ApiPort", '--timeout-graceful-shutdown', '3')) `
    -RedirectStandardOutput (Join-Path $Logs 'server.out.log') -RedirectStandardError (Join-Path $Logs 'server.log')

# ---- 5. UI (Vite).
Write-Log $Log "starting ui :$UiPort"
$ui = Start-Process -FilePath (Get-Command node).Source -WorkingDirectory (Join-Path $Repo 'frontend') -NoNewWindow -PassThru `
    -ArgumentList (Join-Args @('node_modules\vite\bin\vite.js', '--host', '127.0.0.1', '--port', "$UiPort", '--strictPort')) `
    -RedirectStandardOutput (Join-Path $Logs 'frontend.log') -RedirectStandardError (Join-Path $Logs 'frontend.err.log')
Set-Content -Path (Join-Path $AppHome 'frontend.pid') -Value $ui.Id

$deadline = (Get-Date).AddSeconds(90)
# gives up at once if the API process has exited (a broken release: roll back without waiting 90 s)
while (-not (Test-Http "$ApiUrl/api/health") -and -not $api.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
if (-not (Test-Http "$ApiUrl/api/health")) { Fail "API не запустился. Лог: $(Join-Path $Logs 'server.log')" }
while (-not (Test-Http "$UiUrl/") -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
if (-not (Test-Http "$UiUrl/")) { Fail "Интерфейс не запустился. Лог: $(Join-Path $Logs 'frontend.log')" }

# ---- 6. App window.
if (-not (Get-AppWindowPids)) { Open-AppWindow }
Remove-Item $Handover -ErrorAction SilentlyContinue  # the API has read it (outcome is reported once in the UI)
Write-Log $Log 'ready'

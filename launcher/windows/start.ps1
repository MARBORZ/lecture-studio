# Lecture Studio — clean-slate launcher (Windows). Target of the Desktop shortcut (through start.vbs: no console window).
#   One server (backend\serve.py): the app on 127.0.0.1:5173 (built UI + /api), the API also on 127.0.0.1:3000.
# Every launch: stop old processes -> sync deps / rebuild the UI if changed -> start the server -> open the app window.
# The UI is frontend\dist: shipped ready (frontend\dist\.prebuilt, no Node.js needed), else built here whenever its
# sources changed (a clone, an update, a GitHub ZIP).
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
        # The new release did not come up: back to the previous commit, start again (deps and UI rebuild by fingerprint).
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

function Get-TreeFingerprint([string[]]$Paths) {
    # Files under the given files and folders: relative path + content hash, in a stable order.
    $lines = foreach ($rel in $Paths) {
        $full = Join-Path $Repo $rel
        if (Test-Path $full -PathType Leaf) { "$rel $((Get-FileHash -Algorithm SHA256 -Path $full).Hash)" }
        elseif (Test-Path $full) {
            Get-ChildItem -Path $full -Recurse -File | Sort-Object FullName | ForEach-Object {
                "$($_.FullName.Substring($Repo.Length)) $((Get-FileHash -Algorithm SHA256 -Path $_.FullName).Hash)"
            }
        }
    }
    $bytes = [Text.Encoding]::UTF8.GetBytes(($lines -join "`n"))
    return [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)) -replace '-', ''
}

function Test-Changed([string]$Name, [string]$Fingerprint) {
    $f = Join-Path $State $Name
    return -not (Test-Path $f) -or ((Get-Content $f -Raw).Trim() -ne $Fingerprint)
}

# ---- 0. Already running and busy? Don't kill a long job by accident. (An update was checked by the API.)
$status = $null
if ($Mode -eq 'normal') { try { $status = Invoke-RestMethod -Uri "$ApiUrl/api/system/status" -TimeoutSec 2 } catch { $status = $null } }
if ($status -and $status.busy) {
    $answer = Show-Message (L "Сейчас идёт обработка. Перезапуск прервёт её.`n`nПерезапустить всё равно?" "Processing is running. A restart interrupts it.`n`nRestart anyway?") 'YesNo' 'Warning'
    if ($answer -ne 'Yes') {
        if (-not (Get-AppWindowPids)) { Open-AppWindow }
        exit 0
    }
}

# ---- 1. Stop previous instance: server, a Vite UI of an older version, app window.
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

# ---- 2. Toolchain. Node.js only where the UI is built here (not for a ready UI).
$Prebuilt = Test-Path (Join-Path $Repo 'frontend\dist\.prebuilt')
$tools = @('uv', 'ffmpeg'); if (-not $Prebuilt) { $tools += 'node' }
foreach ($tool in $tools) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail (L "Не найден $tool. Запустите setups\windows\Setup.cmd в папке программы." "$tool not found. Run setups\windows\Setup.cmd in the app folder.") }
}
if (-not $Prebuilt) {
    $nodeProblem = Update-Node -LogFile $Log
    if ($nodeProblem) { Fail $nodeProblem }
}

# ---- 3. Dependencies and the UI build, only when lockfiles, the torch build (GPU, driver) or the UI sources changed.
$probe = Get-ComputeProbe
Write-Log $Log "torch: $($probe.torch_build) ($($probe.reason)) gpu='$($probe.gpu)' cap=$($probe.compute_cap) driver=$($probe.driver)"
$pyFp = (Get-Fingerprint @('pyproject.toml', 'uv.lock')) + "-$($probe.torch_build)"
if (-not (Test-Path (Join-Path $Repo '.venv\Scripts\python.exe')) -or (Test-Changed 'python' $pyFp)) {
    Write-Log $Log "uv sync --extra $($probe.torch_build)"
    if ((Invoke-Logged -Exe (Get-Command uv).Source -Arguments @('sync', '--frozen', '--extra', $probe.torch_build) -LogFile $Log) -ne 0) { Fail (L "uv sync не удался. Лог: $Log" "uv sync failed. Log: $Log") }
    Set-Content -Path (Join-Path $State 'python') -Value $pyFp
}
if (-not $Prebuilt) {
    $nodeFp = Get-Fingerprint @('frontend\package-lock.json')
    if (-not (Test-Path (Join-Path $Repo 'frontend\node_modules\vite')) -or (Test-Changed 'node' $nodeFp)) {
        Write-Log $Log 'npm ci'
        # cmd /c npm can return a non-zero code after a successful install: judge by the result, not the exit code.
        $code = Invoke-Logged -Exe 'cmd.exe' -Arguments @('/c', 'npm', 'ci', '--no-audit', '--no-fund') -Cwd (Join-Path $Repo 'frontend') -LogFile $Log
        if (-not (Test-Path (Join-Path $Repo 'frontend\node_modules\vite'))) { Fail (L "npm ci не удался (npm код $code). Лог: $Log" "npm ci failed (npm code $code). Log: $Log") }
        Set-Content -Path (Join-Path $State 'node') -Value $nodeFp
    }
    # The same file list as launcher/macos/start.zsh.
    $uiFp = Get-TreeFingerprint @('frontend\src', 'frontend\public', 'frontend\index.html', 'frontend\package.json', 'frontend\package-lock.json',
        'frontend\vite.config.ts', 'frontend\tsconfig.json', 'frontend\tsconfig.app.json', 'frontend\tsconfig.node.json')
    $dist = Join-Path $Repo 'frontend\dist'
    if (-not (Test-Path (Join-Path $dist 'index.html')) -or (Test-Changed 'ui' $uiFp)) {
        # Into a side folder first: a failed build leaves the previous UI in place. Judged by the result (cmd /c npm).
        Write-Log $Log 'building the interface'
        $next = Join-Path $Repo 'frontend\dist.next'
        Remove-Item -Recurse -Force $next -ErrorAction SilentlyContinue
        $code = Invoke-Logged -Exe 'cmd.exe' -Arguments @('/c', 'npm', 'run', 'build', '--', '--outDir', 'dist.next', '--emptyOutDir') -Cwd (Join-Path $Repo 'frontend') -LogFile $Log
        if (-not (Test-Path (Join-Path $next 'index.html'))) {
            Remove-Item -Recurse -Force $next -ErrorAction SilentlyContinue
            Fail (L "Сборка интерфейса не удалась (npm код $code). Лог: $Log" "Building the interface failed (npm code $code). Log: $Log")
        }
        Remove-Item -Recurse -Force $dist -ErrorAction SilentlyContinue
        Move-Item -Path $next -Destination $dist
        Set-Content -Path (Join-Path $State 'ui') -Value $uiFp
    }
}

# ---- 4. Server: the app on the UI port, the API also on the API port (writes its own server.pid).
Write-Log $Log "starting server :$UiPort + :$ApiPort"
$env:LS_API_PORT = "$ApiPort"
$env:LS_UI_PORT = "$UiPort"
$api = Start-Process -FilePath (Join-Path $Repo '.venv\Scripts\python.exe') -WorkingDirectory $Repo -NoNewWindow -PassThru `
    -ArgumentList (Join-Args @('-m', 'backend.serve')) `
    -RedirectStandardOutput (Join-Path $Logs 'server.out.log') -RedirectStandardError (Join-Path $Logs 'server.log')

$deadline = (Get-Date).AddSeconds(90)
# gives up at once if the server process has exited (a broken release: roll back without waiting 90 s)
while (-not (Test-Http "$ApiUrl/api/health") -and -not $api.HasExited -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
if (-not (Test-Http "$ApiUrl/api/health")) { Fail (L "Сервер не запустился. Лог: $(Join-Path $Logs 'server.log')" "The server did not start. Log: $(Join-Path $Logs 'server.log')") }
if (-not (Test-Http "$UiUrl/")) { Fail (L "Интерфейс не открывается. Лог: $(Join-Path $Logs 'server.log')" "The interface does not open. Log: $(Join-Path $Logs 'server.log')") }

# ---- 5. App window.
if (-not (Get-AppWindowPids)) { Open-AppWindow }
Remove-Item $Handover -ErrorAction SilentlyContinue  # the API has read it (outcome is reported once in the UI)
Write-Log $Log 'ready'

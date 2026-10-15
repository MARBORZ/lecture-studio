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

# ---------------------------------------------------------------- torch build (Windows)
# uv sync --extra cu126 (CUDA 12.6, ~2.5 GB) only when the NVIDIA GPU can run it, else --extra cpu (~200 MB).
# The choice goes to state\compute.json (UTF-8 without BOM): the backend reads it.

$MinComputeCap = 5.0  # Maxwell: the oldest architecture in the CUDA 12 builds of torch
$MinDriver = 528      # the oldest Windows driver for CUDA 12.x

function Find-NvidiaSmi {
    $cmd = Get-Command 'nvidia-smi' -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        (Join-Path $env:WINDIR 'System32\nvidia-smi.exe'),
        (Join-Path $env:ProgramFiles 'NVIDIA Corporation\NVSMI\nvidia-smi.exe')
    )
    return $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

function Invoke-NvidiaSmi([string]$Exe, [string]$Fields) {
    # First GPU as CSV fields, or $null on any error. 15 s timeout: a hung driver must not block the launch.
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $Exe
    $psi.Arguments = "--query-gpu=$Fields --format=csv,noheader,nounits"
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEndAsync()
    $null = $p.StandardError.ReadToEndAsync()
    if (-not $p.WaitForExit(15000)) {
        try { $p.Kill() } catch { }
        return $null
    }
    if ($p.ExitCode -ne 0) { return $null }
    $line = ($out.Result -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
    if (-not $line) { return $null }
    return @($line -split ',' | ForEach-Object { $_.Trim() })
}

function Get-ComputeProbe {
    # -> ordered hashtable: torch_build (cpu | cu126), gpu, compute_cap, driver, reason, probed_at.
    # reason: ok | no_nvidia | old_gpu | old_driver | forced. Never throws: a failed probe means cpu.
    $probe = [ordered]@{ torch_build = 'cpu'; gpu = ''; compute_cap = ''; driver = ''; reason = 'no_nvidia'; probed_at = '' }
    try {
        $smi = Find-NvidiaSmi
        if ($smi) {
            $f = Invoke-NvidiaSmi $smi 'name,compute_cap,driver_version'
            if ($f -and $f.Count -ge 3) {
                $probe.gpu = ($f[0..($f.Count - 3)] -join ',').Trim()
                $probe.compute_cap = $f[$f.Count - 2]
                $probe.driver = $f[$f.Count - 1]
            } else {
                # Drivers before compute_cap existed: still name the card and its (too old) driver.
                $f = Invoke-NvidiaSmi $smi 'name,driver_version'
                if ($f -and $f.Count -ge 2) {
                    $probe.gpu = ($f[0..($f.Count - 2)] -join ',').Trim()
                    $probe.driver = $f[$f.Count - 1]
                }
            }
        }
        if ($probe.gpu) {
            $cap = 0.0
            $capOk = [double]::TryParse($probe.compute_cap, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$cap)
            $major = 0
            $driverOk = [int]::TryParse(($probe.driver -split '\.')[0], [ref]$major)
            if ($capOk -and $cap -lt $MinComputeCap) { $probe.reason = 'old_gpu' }
            elseif (-not $driverOk -or $major -lt $MinDriver) { $probe.reason = 'old_driver' }
            elseif (-not $capOk) { $probe.reason = 'old_gpu' }
            else { $probe.reason = 'ok'; $probe.torch_build = 'cu126' }
        }
    } catch {
        $probe.reason = 'no_nvidia'
        $probe.torch_build = 'cpu'
    }
    if ($env:LS_TORCH_BUILD -in @('cpu', 'cu126')) {
        $probe.torch_build = $env:LS_TORCH_BUILD
        $probe.reason = 'forced'
    }
    $probe.probed_at = (Get-Date).ToString('o')
    try {
        $json = $probe | ConvertTo-Json
        [IO.File]::WriteAllText((Join-Path $State 'compute.json'), $json, (New-Object System.Text.UTF8Encoding $false))  # no BOM
    } catch { }
    return $probe
}

function Get-TorchLabel($Probe) {
    # For the installer window: "PyTorch с CUDA (RTX 3080 Laptop)" / "PyTorch для процессора (видеокарта NVIDIA не найдена)".
    $gpu = ($Probe.gpu -replace '^NVIDIA\s+', '' -replace '^GeForce\s+', '' -replace '\s+GPU$', '')
    if ($Probe.torch_build -eq 'cu126') {
        if ($gpu) { return "PyTorch с CUDA ($gpu)" }
        return 'PyTorch с CUDA'
    }
    switch ($Probe.reason) {
        'old_gpu' { return "PyTorch для процессора ($gpu не поддерживает CUDA 12)" }
        'old_driver' { return "PyTorch для процессора (драйвер NVIDIA $($Probe.driver) старше $MinDriver)" }
        'forced' { return 'PyTorch для процессора (выбрано в LS_TORCH_BUILD)' }
        default { return 'PyTorch для процессора (видеокарта NVIDIA не найдена)' }
    }
}

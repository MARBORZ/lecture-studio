# Lecture Studio Setup (Windows). Started by setups\windows\Setup.cmd (double-click) in a clone of the repository.
# Progress window -> uv, Node.js, FFmpeg (winget / official uv installer) -> Python + UI dependencies
# -> first-run settings -> "Lecture Studio" shortcut on the Desktop. The app runs from this clone.
# Re-running = update dependencies and the shortcut. Lesson data and settings are never touched.

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\..\launcher\windows\common.ps1')
[System.Windows.Forms.Application]::EnableVisualStyles()
$SetupLog = Join-Path $Logs 'setup.log'
Write-Log $SetupLog "=== setup from $Repo"
Update-Path

function Fail([string]$Message) {
    Write-Log $SetupLog "FAIL: $Message"
    Show-Message "$Message`n`n$(L 'Подробности' 'Details'): $SetupLog" 'OK' 'Error' | Out-Null
    exit 1
}

function Test-Tool([string]$Name) { [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

# ---------------------------------------------------------------- questions

$installed = Test-Path $SettingsFile
if ($installed) {
    $intro = L "Lecture Studio уже настроен. Setup проверит зависимости и пересоздаст ярлык. Уроки и настройки не изменятся." "Lecture Studio is already set up. Setup checks the dependencies and recreates the shortcut. Lessons and settings stay as they are."
} else {
    $intro = L "Будут установлены: uv, Node.js, FFmpeg и зависимости Lecture Studio.`nЗаймёт 5–15 минут, нужен интернет. Windows может спросить разрешение (UAC).`n`nИз папки: $Repo" "This installs uv, Node.js, FFmpeg and the Lecture Studio dependencies.`nIt takes 5–15 minutes and needs the internet. Windows may ask for permission (UAC).`n`nFrom the folder: $Repo"
}
if ((Show-Message "$intro`n`n$(L 'Продолжить?' 'Continue?')" 'OKCancel' 'Information') -ne 'OK') { exit 0 }

$dataDir = ''
if (-not $installed) {
    $default = Join-Path $env:USERPROFILE 'Lecture Studio'
    $answer = Show-Message (L "Где хранить уроки (база, видео, стенограммы)?`n`nДа — по умолчанию: $default`nНет — выбрать папку`n`nПозже можно изменить в Настройки → Пути." "Where should lessons live (database, videos, transcripts)?`n`nYes — the default: $default`nNo — choose a folder`n`nYou can change it later in Settings → Paths.") 'YesNoCancel' 'Question'
    if ($answer -eq 'Cancel') { exit 0 }
    if ($answer -eq 'Yes') {
        $dataDir = $default
    } else {
        $dialog = New-Object System.Windows.Forms.FolderBrowserDialog -Property @{ Description = (L 'Папка для уроков Lecture Studio' 'Folder for Lecture Studio lessons'); ShowNewFolderButton = $true }
        if ($dialog.ShowDialog() -ne 'OK') { exit 0 }
        $dataDir = $dialog.SelectedPath
    }
}

# ---------------------------------------------------------------- progress window

$form = New-Object System.Windows.Forms.Form -Property @{
    Text = 'Lecture Studio Setup'; Width = 560; Height = 200; FormBorderStyle = 'FixedDialog'; MaximizeBox = $false
    StartPosition = 'CenterScreen'; BackColor = [System.Drawing.Color]::Black; ForeColor = [System.Drawing.Color]::White
}
try { $form.Icon = New-Object System.Drawing.Icon (Join-Path $Repo 'assets\icon.ico') } catch { }
$title = New-Object System.Windows.Forms.Label -Property @{ Left = 24; Top = 22; Width = 500; Height = 26; Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold) }
$detail = New-Object System.Windows.Forms.Label -Property @{ Left = 24; Top = 54; Width = 500; Height = 22; ForeColor = [System.Drawing.Color]::Gray; Font = New-Object System.Drawing.Font('Segoe UI', 9) }
$bar = New-Object System.Windows.Forms.ProgressBar -Property @{ Left = 24; Top = 96; Width = 496; Height = 12; Style = 'Continuous' }
$form.Controls.AddRange(@($title, $detail, $bar))
$form.Show()

$steps = @(
    @{ Label = 'uv, Node.js, FFmpeg'; Run = {
        if (-not (Test-Tool 'uv')) {
            $code = Invoke-Logged -Exe 'powershell.exe' -Arguments @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'irm https://astral.sh/uv/install.ps1 | iex') -LogFile $SetupLog -Tick $tick
            if ($code -ne 0) { Fail (L 'Не удалось установить uv.' 'Could not install uv.') }
        }
        foreach ($pkg in @(@{ Tool = 'node'; Id = 'OpenJS.NodeJS.LTS' }, @{ Tool = 'ffmpeg'; Id = 'Gyan.FFmpeg' })) {
            if (Test-Tool $pkg.Tool) { continue }
            if (-not (Test-Tool 'winget')) { Fail (L 'Нет winget. Установите «App Installer» из Microsoft Store и запустите Setup снова.' 'winget is missing. Install "App Installer" from the Microsoft Store and run Setup again.') }
            $code = Invoke-Logged -Exe (Get-Command winget).Source -Arguments @('install', '--id', $pkg.Id, '-e', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity') -LogFile $SetupLog -Tick $tick
            Update-Path
            if (-not (Test-Tool $pkg.Tool)) { Fail (L "Не удалось установить $($pkg.Tool) (winget код $code)." "Could not install $($pkg.Tool) (winget code $code).") }
        }
        Update-Path
        $nodeProblem = Update-Node -LogFile $SetupLog -Tick $tick
        if ($nodeProblem) { Fail $nodeProblem }
    } },
    @{ Label = (L 'Python и модели (torch, Whisper) — самый долгий шаг' 'Python and models (torch, Whisper) — the longest step'); Run = {
        $probe = Get-ComputeProbe
        Write-Log $SetupLog "torch: $($probe.torch_build) ($($probe.reason)) gpu='$($probe.gpu)' cap=$($probe.compute_cap) driver=$($probe.driver)"
        $title.Text = Get-TorchLabel $probe
        $script:stepInfo += (L ' · Python и модели, самый долгий шаг' ' · Python and models, the longest step')
        if ((Invoke-Logged -Exe (Get-Command uv).Source -Arguments @('sync', '--frozen', '--extra', $probe.torch_build) -LogFile $SetupLog -Tick $tick) -ne 0) { Fail (L 'Установка Python-зависимостей не удалась.' 'Installing the Python dependencies failed.') }
    } },
    @{ Label = (L 'Интерфейс' 'Interface'); Run = {
        # cmd /c npm can return a non-zero code after a successful install: judge by the result, not the exit code.
        $code = Invoke-Logged -Exe 'cmd.exe' -Arguments @('/c', 'npm', 'ci', '--no-audit', '--no-fund') -Cwd (Join-Path $Repo 'frontend') -LogFile $SetupLog -Tick $tick
        if (-not (Test-Path (Join-Path $Repo 'frontend\node_modules\vite'))) { Fail (L "Установка интерфейса не удалась (npm код $code). Лог: $SetupLog" "Installing the interface failed (npm code $code). Log: $SetupLog") }
    } },
    @{ Label = (L 'Настройки' 'Settings'); Run = {
        if ($installed) { return }
        New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
        $json = @{ data_dir = $dataDir } | ConvertTo-Json
        [IO.File]::WriteAllText($SettingsFile, $json, (New-Object System.Text.UTF8Encoding $false))  # no BOM
    } },
    @{ Label = (L 'Ярлык на Рабочем столе' 'Desktop shortcut'); Run = {
        $desktop = [Environment]::GetFolderPath('Desktop')  # follows OneDrive redirection
        $shell = New-Object -ComObject WScript.Shell
        $link = $shell.CreateShortcut((Join-Path $desktop 'Lecture Studio.lnk'))
        $link.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
        $link.Arguments = '"' + (Join-Path $Repo 'launcher\windows\start.vbs') + '"'
        $link.WorkingDirectory = $Repo
        $link.IconLocation = (Join-Path $Repo 'assets\icon.ico') + ',0'
        $link.Description = 'Lecture Studio'
        $link.Save()
    } }
)

$bar.Maximum = $steps.Count
$started = Get-Date
$tick = {
    $detail.Text = "{0} · {1:mm\:ss}" -f $script:stepInfo, ((Get-Date) - $started)
    [System.Windows.Forms.Application]::DoEvents()
}
for ($i = 0; $i -lt $steps.Count; $i++) {
    $title.Text = $steps[$i].Label
    $script:stepInfo = L "Шаг $($i + 1) из $($steps.Count)" "Step $($i + 1) of $($steps.Count)"
    & $tick
    Write-Log $SetupLog "step: $($steps[$i].Label)"
    try { & $steps[$i].Run } catch { Fail $_.Exception.Message }
    $bar.Value = $i + 1
}
$form.Close()

if ((Show-Message (L 'Готово. Lecture Studio — на Рабочем столе. Открыть сейчас?' 'Done. Lecture Studio is on the Desktop. Open it now?') 'YesNo' 'Information') -eq 'Yes') {
    Start-Process -FilePath (Join-Path $env:WINDIR 'System32\wscript.exe') -ArgumentList ('"' + (Join-Path $Repo 'launcher\windows\start.vbs') + '"')
}

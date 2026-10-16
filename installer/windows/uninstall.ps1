# Lecture Studio Uninstall (Windows). Started by Uninstall.cmd (double-click) in the project root.
# Deletes the app, its settings (API keys, logs) and the Desktop shortcut; lessons stay unless chosen.
# Only asks: the rules and the deleting are the app's own (python -m backend.tools.uninstall -> services/uninstall.py),
# the same as Settings -> Delete Lecture Studio.

$ErrorActionPreference = 'Continue'
. (Join-Path $PSScriptRoot '..\..\launcher\windows\common.ps1')
$env:LECTURE_STUDIO_LANG = L 'ru' 'en'  # the uninstall tool speaks the language of Windows, like these dialogs
$Py = Join-Path $Repo '.venv\Scripts\python.exe'
if (-not (Test-Path $Py)) {
    Show-Message (L "Lecture Studio в $Repo установлена не до конца (нет .venv).`n`nЕсли папка не нужна, удалите её вручную." "Lecture Studio in $Repo is not fully installed (no .venv).`n`nIf you do not need the folder, delete it by hand.") 'OK' 'Error' | Out-Null
    exit 1
}

# The tool prints UTF-8; this process works from %TEMP% (Uninstall.cmd), so the app folder is nobody's current directory.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$env:PYTHONUTF8 = '1'
$env:PYTHONPATH = $Repo
function Invoke-Tool([string[]]$ToolArgs) {
    $out = & $Py -m backend.tools.uninstall @ToolArgs 2>&1
    return @{ Code = $LASTEXITCODE; Text = (($out | ForEach-Object { "$_" }) -join "`n").Trim() }
}

$d = Invoke-Tool @('describe')
if ($d.Code -ne 0) { Show-Message $d.Text 'OK' 'Error' | Out-Null; exit 1 }
$lines = @($d.Text -split "`n")
$state = $lines[0].Trim()
$body = ($lines | Select-Object -Skip 1) -join "`n"

if ($state -eq 'blocked') { Show-Message $body 'OK' 'Error' | Out-Null; exit 1 }
$runArgs = @('run')
if ($state -eq 'lessons_inside') {
    if ((Show-Message "$body`n`n$(L 'Удалить программу вместе с уроками?' 'Delete the app together with the lessons?')" 'OKCancel' 'Warning') -ne 'OK') { exit 0 }
    $runArgs += '--delete-lessons'
} else {
    $answer = Show-Message ("$body`n`n" + (L "Удалить и уроки тоже?`n`nДа — удалить и уроки`nНет — уроки оставить`nОтмена — ничего не удалять" "Delete the lessons too?`n`nYes — delete the lessons as well`nNo — keep the lessons`nCancel — delete nothing")) 'YesNoCancel' 'Warning'
    if ($answer -eq 'Cancel') { exit 0 }
    if ($answer -eq 'Yes') { $runArgs += '--delete-lessons' }
}
if ((Show-Message (L 'Lecture Studio будет удалена. Это нельзя отменить. Продолжить?' 'Lecture Studio will be deleted. This cannot be undone. Continue?') 'OKCancel' 'Warning') -ne 'OK') { exit 0 }

$r = Invoke-Tool $runArgs
if ($r.Code -ne 0) { Show-Message $r.Text 'OK' 'Error' | Out-Null; exit 1 }
# The remover closes the app and shows the final message itself.

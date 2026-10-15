' Runs remove.ps1 (next to this file) without a console window, the way start.vbs runs the launcher.
' Started by the API from a copy in %TEMP% with the plan file as the argument.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "\remove.ps1"" -Plan """ & WScript.Arguments(0) & """", 0, False

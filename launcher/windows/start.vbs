' Runs start.ps1 without a console window. Target of the "Lecture Studio" Desktop shortcut.
' Optional argument: the start.ps1 mode (update | rollback); the API passes "update" after it moved the code.
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
mode = "normal"
If WScript.Arguments.Count > 0 Then
    If WScript.Arguments(0) = "update" Or WScript.Arguments(0) = "rollback" Then mode = WScript.Arguments(0)
End If
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & here & "\start.ps1"" -Mode " & mode, 0, False

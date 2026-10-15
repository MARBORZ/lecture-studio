-- Lecture Studio Uninstall: double-click. Deletes the app, its settings (API keys, logs) and the Desktop shortcut;
-- lessons stay unless chosen. Only asks: the rules and the deleting are the app's own
-- (python -m backend.tools.uninstall -> services/uninstall.py), the same as Settings -> Delete Lecture Studio.
--   next to a clone (Uninstall.app in the project root) -> that clone
--   anywhere else                                       -> the Setup install in ~/Library/Application Support/Lecture Studio/app

on run
	set T to "Lecture Studio Uninstall"
	set appPath to POSIX path of (path to me)
	set repoDir to do shell script "cd " & quoted form of appPath & "/.. && pwd"
	if (do shell script "test -f " & quoted form of (repoDir & "/pyproject.toml") & " && echo yes || echo no") is "no" then
		set repoDir to POSIX path of (path to home folder) & "Library/Application Support/Lecture Studio/app"
	end if
	set py to repoDir & "/.venv/bin/python"
	if (do shell script "test -x " & quoted form of py & " && echo yes || echo no") is "no" then
		display dialog "Lecture Studio не найдена: " & repoDir & return & return & "Если папка осталась, удалите её вручную." with title T buttons {"Закрыть"} default button 1 with icon stop
		return
	end if
	set tool to "cd " & quoted form of repoDir & " && " & quoted form of py & " -m backend.tools.uninstall "

	set ps to paragraphs of (do shell script tool & "describe")
	set state to item 1 of ps
	set AppleScript's text item delimiters to return
	set body to (items 2 thru -1 of ps) as text
	set AppleScript's text item delimiters to ""

	if state is "blocked" then
		display dialog body with title T buttons {"Закрыть"} default button 1 with icon stop
		return
	end if
	set flag to ""
	if state is "lessons_inside" then
		display dialog body with title T buttons {"Отмена", "Удалить вместе с уроками"} default button 1 cancel button 1 with icon caution
		set flag to " --delete-lessons"
	else
		set choice to button returned of (display dialog body with title T buttons {"Отмена", "Удалить и уроки", "Удалить, уроки оставить"} default button 3 cancel button 1 with icon caution)
		if choice is "Удалить и уроки" then set flag to " --delete-lessons"
	end if
	display dialog "Lecture Studio будет удалена. Это нельзя отменить." with title T buttons {"Отмена", "Удалить"} default button 1 cancel button 1 with icon caution

	try
		do shell script tool & "run" & flag
	on error errMsg
		display dialog errMsg with title T buttons {"Закрыть"} default button 1 with icon stop
	end try
	-- The remover closes the app and shows the final message itself.
end run

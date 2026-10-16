-- Lecture Studio Uninstall: double-click. Deletes the app, its settings (API keys, logs) and the Desktop shortcut;
-- lessons stay unless chosen. Only asks: the rules and the deleting are the app's own
-- (python -m backend.tools.uninstall -> services/uninstall.py), the same as Settings -> Delete Lecture Studio.
--   inside a clone (setups/macos/Uninstall.app)        -> that clone
--   anywhere else                                       -> the Setup install in ~/Library/Application Support/Lecture Studio/app

property ru : false

-- Russian on a Mac whose first preferred language is Russian, English everywhere else (as in the .zsh scripts).
on osRussian()
	set primary to do shell script "defaults read -g AppleLanguages 2>/dev/null | sed -n 2p | tr -d ' \",'"
	return primary is "ru" or primary starts with "ru-" or primary starts with "ru_"
end osRussian

on L(ruText, enText)
	if ru then return ruText
	return enText
end L

on run
	set ru to my osRussian()
	set T to "Lecture Studio Uninstall"
	set appPath to POSIX path of (path to me)
	set repoDir to do shell script "cd " & quoted form of appPath & "/../../.. && pwd"
	if (do shell script "test -f " & quoted form of (repoDir & "/pyproject.toml") & " && echo yes || echo no") is "no" then
		set repoDir to POSIX path of (path to home folder) & "Library/Application Support/Lecture Studio/app"
	end if
	set py to repoDir & "/.venv/bin/python"
	if (do shell script "test -x " & quoted form of py & " && echo yes || echo no") is "no" then
		display dialog my L("Lecture Studio не найдена: ", "Lecture Studio is not found: ") & repoDir & return & return & my L("Если папка осталась, удалите её вручную.", "If the folder is still there, delete it by hand.") with title T buttons {my L("Закрыть", "Close")} default button 1 with icon stop
		return
	end if
	-- the tool's texts in the same language as these dialogs (backend/i18n.py reads LECTURE_STUDIO_LANG)
	set tool to "cd " & quoted form of repoDir & " && LECTURE_STUDIO_LANG=" & my L("ru", "en") & " " & quoted form of py & " -m backend.tools.uninstall "

	set ps to paragraphs of (do shell script tool & "describe")
	set state to item 1 of ps
	set AppleScript's text item delimiters to return
	set body to (items 2 thru -1 of ps) as text
	set AppleScript's text item delimiters to ""

	if state is "blocked" then
		display dialog body with title T buttons {my L("Закрыть", "Close")} default button 1 with icon stop
		return
	end if
	set flag to ""
	if state is "lessons_inside" then
		display dialog body with title T buttons {my L("Отмена", "Cancel"), my L("Удалить вместе с уроками", "Delete with the lessons")} default button 1 cancel button 1 with icon caution
		set flag to " --delete-lessons"
	else
		set withLessons to my L("Удалить и уроки", "Delete the lessons too")
		set choice to button returned of (display dialog body with title T buttons {my L("Отмена", "Cancel"), withLessons, my L("Удалить, уроки оставить", "Delete, keep the lessons")} default button 3 cancel button 1 with icon caution)
		if choice is withLessons then set flag to " --delete-lessons"
	end if
	display dialog my L("Lecture Studio будет удалена. Это нельзя отменить.", "Lecture Studio will be deleted. This cannot be undone.") with title T buttons {my L("Отмена", "Cancel"), my L("Удалить", "Delete")} default button 1 cancel button 1 with icon caution

	try
		do shell script tool & "run" & flag
	on error errMsg
		display dialog errMsg with title T buttons {my L("Закрыть", "Close")} default button 1 with icon stop
	end try
	-- The remover closes the app and shows the final message itself.
end run

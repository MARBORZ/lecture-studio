-- Lecture Studio Setup: native installer/updater with a progress window.
-- Two modes, same steps (installer/macos/install.zsh):
--   in a git clone (installer/macos/Setup.app) -> installs in place, from this folder
--   standalone (release zip)              -> copies the code embedded in Resources/source.tar.gz
-- Result: the "Lecture Studio" app on the Desktop.

on run
	set appPath to POSIX path of (path to me)
	set repoDir to do shell script "cd " & quoted form of appPath & "/../../.. && pwd"
	set inPlace to (do shell script "test -f " & quoted form of (repoDir & "/pyproject.toml") & " && test -f " & quoted form of (repoDir & "/installer/macos/install.zsh") & " && echo yes || echo no") is "yes"

	if inPlace then
		set installer to "LS_INSTALL_DIR=" & quoted form of repoDir & " zsh " & quoted form of (repoDir & "/installer/macos/install.zsh")
		set source to "Из папки: " & repoDir
	else
		set installer to "zsh " & quoted form of POSIX path of (path to resource "install.zsh")
		set source to "Код будет скопирован в ~/Library/Application Support/Lecture Studio/app"
	end if

	set installed to (do shell script installer & " has-settings") is "yes"
	if installed then
		set intro to "Lecture Studio уже настроен. Setup проверит зависимости и пересоздаст ярлык. Уроки и настройки не изменятся."
		set actionLabel to "Обновить"
	else
		set intro to "Будут установлены: Homebrew, uv, Node.js, FFmpeg и Lecture Studio." & return & "Займёт 5–15 минут, нужен интернет. Homebrew может спросить пароль администратора."
		set actionLabel to "Установить"
	end if
	display dialog intro & return & return & source with title "Lecture Studio Setup" buttons {"Отмена", actionLabel} default button 2 cancel button 1 with icon note

	set dataDir to ""
	if not installed then
		set defaultDir to POSIX path of (path to home folder) & "Lecture Studio"
		set choice to button returned of (display dialog "Где хранить уроки (база, видео, стенограммы)?" & return & return & "По умолчанию: " & defaultDir & return & "Позже можно изменить в Настройки → Пути." with title "Lecture Studio Setup" buttons {"Выбрать папку…", "По умолчанию"} default button 2 with icon note)
		if choice is "По умолчанию" then
			set dataDir to defaultDir
		else
			set dataDir to POSIX path of (choose folder with prompt "Папка для уроков Lecture Studio")
		end if
	end if

	set steps to {{"homebrew", "Homebrew"}, {"tools", "uv, Node.js, FFmpeg"}}
	if not inPlace then set end of steps to {"fetch", "Копирование Lecture Studio"}
	set steps to steps & {{"python", "Python и модели (torch, Whisper) — самый долгий шаг"}, {"node", "Интерфейс"}, {"configure", "Настройки"}, {"shortcut", "Ярлык на Рабочем столе"}}

	set total to count of steps
	set progress total steps to total
	set progress completed steps to 0
	repeat with i from 1 to total
		set {stepKey, stepLabel} to item i of steps
		set progress description to stepLabel
		set progress additional description to "Шаг " & i & " из " & total
		try
			do shell script installer & " " & stepKey & " " & quoted form of dataDir
		on error errMsg
			display dialog errMsg & return & return & "Подробности: ~/Library/Application Support/Lecture Studio/logs/setup.log" with title "Lecture Studio Setup" buttons {"Закрыть"} default button 1 with icon stop
			return
		end try
		set progress completed steps to i
	end repeat

	display dialog "Готово. Lecture Studio — на Рабочем столе." with title "Lecture Studio Setup" buttons {"Закрыть", "Открыть Lecture Studio"} default button 2 with icon note
	if button returned of result is "Открыть Lecture Studio" then
		do shell script "open " & quoted form of (POSIX path of (path to home folder) & "Desktop/Lecture Studio.app")
	end if
end run

-- Lecture Studio Setup: native installer/updater with a progress window.
-- Two modes, same steps (installer/macos/install.zsh):
--   in a git clone (Setup.app in the project root) -> installs in place, from this folder
--   standalone (release zip)              -> copies the code embedded in Resources/source.tar.gz
-- Result: the "Lecture Studio" app on the Desktop.

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
	set appPath to POSIX path of (path to me)
	set repoDir to do shell script "cd " & quoted form of appPath & "/.. && pwd"
	set inPlace to (do shell script "test -f " & quoted form of (repoDir & "/pyproject.toml") & " && test -f " & quoted form of (repoDir & "/installer/macos/install.zsh") & " && echo yes || echo no") is "yes"

	if inPlace then
		set installer to "LS_INSTALL_DIR=" & quoted form of repoDir & " zsh " & quoted form of (repoDir & "/installer/macos/install.zsh")
		set source to my L("Из папки: ", "From the folder: ") & repoDir
	else
		set installer to "zsh " & quoted form of POSIX path of (path to resource "install.zsh")
		set source to my L("Код будет скопирован в ", "The code will be copied to ") & "~/Library/Application Support/Lecture Studio/app"
	end if

	set installed to (do shell script installer & " has-settings") is "yes"
	if installed then
		set intro to my L("Lecture Studio уже настроен. Setup проверит зависимости и пересоздаст ярлык. Уроки и настройки не изменятся.", "Lecture Studio is already set up. Setup checks the dependencies and recreates the shortcut. Lessons and settings stay as they are.")
		set actionLabel to my L("Обновить", "Update")
	else
		set intro to my L("Будут установлены: Homebrew, uv, Node.js, FFmpeg и Lecture Studio.", "This installs Homebrew, uv, Node.js, FFmpeg and Lecture Studio.") & return & my L("Займёт 5–15 минут, нужен интернет. Homebrew может спросить пароль администратора.", "It takes 5–15 minutes and needs the internet. Homebrew may ask for the administrator password.")
		set actionLabel to my L("Установить", "Install")
	end if
	display dialog intro & return & return & source with title "Lecture Studio Setup" buttons {my L("Отмена", "Cancel"), actionLabel} default button 2 cancel button 1 with icon note

	set dataDir to ""
	if not installed then
		set defaultDir to POSIX path of (path to home folder) & "Lecture Studio"
		set useDefault to my L("По умолчанию", "Default")
		set choice to button returned of (display dialog my L("Где хранить уроки (база, видео, стенограммы)?", "Where should lessons live (database, videos, transcripts)?") & return & return & useDefault & ": " & defaultDir & return & my L("Позже можно изменить в Настройки → Пути.", "You can change it later in Settings → Paths.") with title "Lecture Studio Setup" buttons {my L("Выбрать папку…", "Choose a folder…"), useDefault} default button 2 with icon note)
		if choice is useDefault then
			set dataDir to defaultDir
		else
			set dataDir to POSIX path of (choose folder with prompt my L("Папка для уроков Lecture Studio", "Folder for Lecture Studio lessons"))
		end if
	end if

	set steps to {{"homebrew", "Homebrew"}, {"tools", "uv, Node.js, FFmpeg"}}
	if not inPlace then set end of steps to {"fetch", my L("Копирование Lecture Studio", "Copying Lecture Studio")}
	set steps to steps & {{"python", my L("Python и модели (torch, Whisper) — самый долгий шаг", "Python and models (torch, Whisper) — the longest step")}, {"node", my L("Интерфейс", "Interface")}, {"configure", my L("Настройки", "Settings")}, {"shortcut", my L("Ярлык на Рабочем столе", "Desktop shortcut")}}

	set total to count of steps
	set progress total steps to total
	set progress completed steps to 0
	repeat with i from 1 to total
		set {stepKey, stepLabel} to item i of steps
		set progress description to stepLabel
		set progress additional description to my L("Шаг ", "Step ") & i & my L(" из ", " of ") & total
		try
			do shell script installer & " " & stepKey & " " & quoted form of dataDir
		on error errMsg
			display dialog errMsg & return & return & my L("Подробности: ", "Details: ") & "~/Library/Application Support/Lecture Studio/logs/setup.log" with title "Lecture Studio Setup" buttons {my L("Закрыть", "Close")} default button 1 with icon stop
			return
		end try
		set progress completed steps to i
	end repeat

	set openLabel to my L("Открыть Lecture Studio", "Open Lecture Studio")
	display dialog my L("Готово. Lecture Studio — на Рабочем столе.", "Done. Lecture Studio is on the Desktop.") with title "Lecture Studio Setup" buttons {my L("Закрыть", "Close"), openLabel} default button 2 with icon note
	if button returned of result is openLabel then
		do shell script "open " & quoted form of (POSIX path of (path to home folder) & "Desktop/Lecture Studio.app")
	end if
end run

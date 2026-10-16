#!/bin/zsh
# Stop Lecture Studio from the terminal — same rules as the sidebar power button:
# refuses while anything is processing, uploading or exporting.
#   zsh launcher/stop.zsh
set -u
API="http://127.0.0.1:3000"
# Texts follow the Mac's first preferred language: Russian on a Russian system, English everywhere else
# (LECTURE_STUDIO_LANG=ru|en overrides). The same lines are in setups/macos/install.zsh and launcher/macos/{start,stop}.zsh.
os_lang() {
  [[ ${LECTURE_STUDIO_LANG-} == (ru|en) ]] && { print -r -- $LECTURE_STUDIO_LANG; return }
  local first=${$(defaults read -g AppleLanguages 2>/dev/null | sed -n 2p)//[[:space:]\",]/}
  [[ $first == ru || $first == ru[-_]* ]] && print ru || print en
}
OS_LANG=$(os_lang)
L() { [[ $OS_LANG == ru ]] && print -r -- "$1" || print -r -- "$2" }
resp=$(curl -sS --max-time 5 -X POST -w '\n%{http_code}' "$API/api/system/shutdown" 2>/dev/null) || {
  L "API не отвечает: останавливаю UI (5173), если он остался." "The API does not answer: stopping the UI (5173) if it is still running."
  pids=( $(lsof -ti tcp:5173 -sTCP:LISTEN) )
  (( ${#pids} )) && kill -TERM $pids
  exit 0
}
code=${resp##*$'\n'}
body=${resp%$'\n'*}
case $code in
  200) L "Lecture Studio останавливается." "Lecture Studio is shutting down." ;;
  409) L "Нельзя остановить — система занята:" "Cannot shut down — the app is busy:"; print -r -- "$body"; exit 1 ;;
  *)   L "Ошибка $code: $body" "Error $code: $body"; exit 1 ;;
esac

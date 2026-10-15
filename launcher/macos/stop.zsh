#!/bin/zsh
# Stop Lecture Studio from the terminal — same rules as the sidebar power button:
# refuses while anything is processing, uploading or exporting.
#   zsh launcher/stop.zsh
set -u
API="http://127.0.0.1:3000"
resp=$(curl -sS --max-time 5 -X POST -w '\n%{http_code}' "$API/api/system/shutdown" 2>/dev/null) || {
  print "API не отвечает: останавливаю UI (5173), если он остался."
  pids=( $(lsof -ti tcp:5173 -sTCP:LISTEN) )
  (( ${#pids} )) && kill -TERM $pids
  exit 0
}
code=${resp##*$'\n'}
body=${resp%$'\n'*}
case $code in
  200) print "Lecture Studio останавливается." ;;
  409) print "Нельзя остановить — система занята:"; print -r -- "$body"; exit 1 ;;
  *)   print "Ошибка $code: $body"; exit 1 ;;
esac

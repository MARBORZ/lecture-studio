#!/bin/zsh
# Lecture Studio — clean-slate launcher (macOS). Run by "Lecture Studio.app" on the Desktop.
#   API: FastAPI on 127.0.0.1:3000      UI: Vite on 127.0.0.1:5173 (proxies /api -> 3000)
# Every launch: stop old processes -> sync deps if changed -> start API + UI -> open the app window.
# Lesson data is never touched; temp/ is cleared by the API on startup.

set -u
REPO="${0:A:h:h:h}"
APP_HOME="${LECTURE_STUDIO_HOME:-$HOME/Library/Application Support/Lecture Studio}"
STATE="$APP_HOME/state"
LOGS="$APP_HOME/logs"
PROFILE="$APP_HOME/chrome-profile"
API_PORT=3000
UI_PORT=5173
API="http://127.0.0.1:$API_PORT"
UI="http://127.0.0.1:$UI_PORT"

# Finder starts apps with a bare PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$STATE" "$LOGS"
exec >>"$LOGS/launcher.log" 2>&1
print "\n=== $(date '+%F %T') launch from $REPO"

dialog() { osascript -e "display dialog \"$1\" with title \"Lecture Studio\" buttons {$2} default button 1 with icon ${3:-note}" -e 'button returned of result' 2>/dev/null }
fail() { dialog "$1" '"OK"' stop >/dev/null; print "FAIL: $1"; exit 1 }
fingerprint() { (cd "$REPO" && find "$@" -type f -print0 2>/dev/null | sort -z | xargs -0 shasum 2>/dev/null | shasum | cut -d' ' -f1) }
changed() { [[ "$(cat "$STATE/$1" 2>/dev/null)" != "$2" ]] }
wait_http() { for _ in {1..180}; do curl -fsS --max-time 1 "$1" >/dev/null 2>&1 && return 0; sleep 0.5; done; return 1 }

open_window() {
  if [[ -d "/Applications/Google Chrome.app" ]]; then
    open -na "Google Chrome" --args --app="$UI" --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check --window-size=1480,940
  else
    open "$UI"
  fi
}

# ---- 0. Already running and busy? Don't kill a long job by accident.
if sys_status=$(curl -fsS --max-time 2 "$API/api/system/status" 2>/dev/null) && [[ "$sys_status" == *'"busy":true'* ]]; then
  choice=$(dialog "Сейчас идёт обработка. Перезапуск прервёт её." '"Открыть окно", "Перезапустить"')
  if [[ "$choice" != "Перезапустить" ]]; then
    pgrep -f -- "--user-data-dir=$PROFILE" >/dev/null || open_window
    exit 0
  fi
fi

# ---- 1. Stop previous instance: API, UI, app window.
pids=()
for f in "$APP_HOME/server.pid" "$APP_HOME/frontend.pid"; do
  [[ -f "$f" ]] && pids+=( $(<"$f") )
done
pids+=( $(lsof -ti "tcp:$API_PORT" -sTCP:LISTEN) $(lsof -ti "tcp:$UI_PORT" -sTCP:LISTEN) )
pids=( ${(u)${(M)pids:#<->}} )   # numeric, unique
alive=()
for p in $pids; do kill -0 $p 2>/dev/null && alive+=$p; done
if (( ${#alive} )); then
  print "stopping: $alive"
  kill -TERM $alive 2>/dev/null
  for _ in {1..40}; do
    still=(); for p in $alive; do kill -0 $p 2>/dev/null && still+=$p; done
    (( ${#still} )) || break
    sleep 0.1
  done
  (( ${#still} )) && kill -KILL $still 2>/dev/null
fi
pkill -TERM -f -- "--user-data-dir=$PROFILE" 2>/dev/null
rm -f "$APP_HOME/server.pid" "$APP_HOME/frontend.pid"

# ---- 2. Toolchain.
for tool in uv npm ffmpeg ffprobe lsof; do
  command -v $tool >/dev/null || fail "Не найден $tool. Установите: brew install ${tool/ffprobe/ffmpeg}"
done
cd "$REPO" || fail "Папка проекта не найдена: $REPO"

# ---- 3. Dependencies, only when lockfiles changed.
py_fp=$(fingerprint pyproject.toml uv.lock)
if [[ ! -x .venv/bin/python ]] || changed python "$py_fp"; then
  print "uv sync"
  uv sync --frozen || fail "uv sync не удался. Лог: $LOGS/launcher.log"
  print -r -- "$py_fp" > "$STATE/python"
fi
node_fp=$(fingerprint frontend/package-lock.json)
if [[ ! -x frontend/node_modules/.bin/vite ]] || changed node "$node_fp"; then
  print "npm ci"
  npm --prefix frontend ci --no-audit --no-fund || fail "npm ci не удался. Лог: $LOGS/launcher.log"
  print -r -- "$node_fp" > "$STATE/node"
fi

# ---- 4. API (writes its own server.pid).
print "starting api :$API_PORT"
nohup .venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port $API_PORT --timeout-graceful-shutdown 3 \
  >>"$LOGS/server.log" 2>&1 </dev/null &!

# ---- 5. UI (Vite).
print "starting ui :$UI_PORT"
(cd frontend && nohup node_modules/.bin/vite --host 127.0.0.1 --port $UI_PORT --strictPort \
  >>"$LOGS/frontend.log" 2>&1 </dev/null & print -r -- $! > "$APP_HOME/frontend.pid")

wait_http "$API/api/health" || fail "API не запустился за 90 с. Лог: $LOGS/server.log"
wait_http "$UI/" || fail "Интерфейс не запустился за 90 с. Лог: $LOGS/frontend.log"

# ---- 6. App window.
open_window
print "ready"

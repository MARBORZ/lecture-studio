#!/bin/zsh
# Lecture Studio — clean-slate launcher (macOS). Run by "Lecture Studio.app" on the Desktop.
#   API: FastAPI on 127.0.0.1:3000      UI: Vite on 127.0.0.1:5173 (proxies /api -> 3000)
# Every launch: stop old processes -> sync deps if changed -> start API + UI -> open the app window.
# Lesson data is never touched; temp/ is cleared by the API on startup.
#   start.zsh            normal launch (Desktop shortcut)
#   start.zsh update     started by the API after it moved the code to a new release (state/update.json):
#                        keeps the app window, rolls back to the previous commit if the new version fails
#   start.zsh rollback   the second pass after such a rollback

set -u
SELF="${0:A}"   # inside functions $0 is the function name
REPO="${SELF:h:h:h}"
APP_HOME="${LECTURE_STUDIO_HOME:-$HOME/Library/Application Support/Lecture Studio}"
STATE="$APP_HOME/state"
LOGS="$APP_HOME/logs"
PROFILE="$APP_HOME/chrome-profile"
API_PORT=${LS_API_PORT:-3000}   # overridable for a second instance (dev / update testing)
UI_PORT=${LS_UI_PORT:-5173}
API="http://127.0.0.1:$API_PORT"
UI="http://127.0.0.1:$UI_PORT"
MODE="${1:-normal}"
HANDOVER="$APP_HOME/state/update.json"

# Finder starts apps with a bare PATH.
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$HOME/.cargo/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$STATE" "$LOGS"
exec >>"$LOGS/launcher.log" 2>&1
print "\n=== $(date '+%F %T') launch ($MODE) from $REPO"
from_sha=""
if [[ "$MODE" == update ]]; then
  from_sha=$(sed -n 's/.*"from_sha": *"\([0-9a-f]*\)".*/\1/p' "$HANDOVER" 2>/dev/null)
elif [[ "$MODE" == normal ]]; then
  rm -f "$HANDOVER"   # stale hand-over from an interrupted update
fi

dialog() { osascript -e "display dialog \"$1\" with title \"Lecture Studio\" buttons {$2} default button 1 with icon ${3:-note}" -e 'button returned of result' 2>/dev/null }
fail() {
  print "FAIL: $1"
  if [[ "$MODE" == update && -n "$from_sha" ]]; then
    # The new release did not come up: back to the previous commit, start again (deps re-sync by fingerprint).
    print "rolling back to $from_sha"
    git -C "$REPO" reset --keep "$from_sha" && exec /bin/zsh "$SELF" rollback
  fi
  rm -f "$HANDOVER"
  dialog "$1" '"OK"' stop >/dev/null
  exit 1
}
# The range Vite 8 accepts, as in frontend/package.json engines: ^20.19.0 || >=22.12.0 (same check in installer/macos/install.zsh).
node_ok() {
  local -a v=( ${(s:.:)${$(node --version 2>/dev/null)#v}} )
  [[ ${v[1]-} == <-> && ${v[2]-} == <-> ]] || return 1
  (( (v[1] == 20 && v[2] >= 19) || (v[1] == 22 && v[2] >= 12) || v[1] > 22 ))
}
fingerprint() { (cd "$REPO" && find "$@" -type f -print0 2>/dev/null | sort -z | xargs -0 shasum 2>/dev/null | shasum | cut -d' ' -f1) }
changed() { [[ "$(cat "$STATE/$1" 2>/dev/null)" != "$2" ]] }
# wait_http URL [PID]: up to 90 s; gives up at once if PID (the server being waited for) has exited.
wait_http() {
  for _ in {1..180}; do
    curl -fsS --max-time 1 "$1" >/dev/null 2>&1 && return 0
    [[ -n "${2:-}" ]] && ! kill -0 "$2" 2>/dev/null && return 1
    sleep 0.5
  done
  return 1
}

# A Chromium browser in app mode with a dedicated profile (no tabs, no address bar); else the default browser (Safari).
# Arc is left out: it ignores --app and --user-data-dir, so the window could not be found or closed again.
find_browser() {
  local name
  for name in "Google Chrome" "Microsoft Edge" "Brave Browser" "Chromium" "Vivaldi"; do
    [[ -d "/Applications/$name.app" || -d "$HOME/Applications/$name.app" ]] && { print -r -- "$name"; return 0 }
  done
  return 1
}

open_window() {
  [[ "${LS_NO_WINDOW:-}" == 1 ]] && return 0
  local browser
  if browser=$(find_browser); then
    open -na "$browser" --args --app="$UI" --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check --window-size=1480,940
  else
    open "$UI"
  fi
}

# ---- 0. Already running and busy? Don't kill a long job by accident. (An update was checked by the API.)
if [[ "$MODE" == normal ]] && sys_status=$(curl -fsS --max-time 2 "$API/api/system/status" 2>/dev/null) && [[ "$sys_status" == *'"busy":true'* ]]; then
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
[[ "$MODE" == normal ]] && pkill -TERM -f -- "--user-data-dir=$PROFILE" 2>/dev/null   # an update keeps the window: it waits and reloads
rm -f "$APP_HOME/server.pid" "$APP_HOME/frontend.pid"

# ---- 2. Toolchain.
for tool in uv npm ffmpeg ffprobe lsof; do
  command -v $tool >/dev/null || fail "Не найден $tool. Установите: brew install ${tool/ffprobe/ffmpeg}"
done
node_ok || fail "Нужен Node.js 20.19+ или 22.12+, установлен $(node --version 2>/dev/null). Обновите: brew upgrade node"
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
api_pid=$!

# ---- 5. UI (Vite).
print "starting ui :$UI_PORT"
(cd frontend && nohup node_modules/.bin/vite --host 127.0.0.1 --port $UI_PORT --strictPort \
  >>"$LOGS/frontend.log" 2>&1 </dev/null & print -r -- $! > "$APP_HOME/frontend.pid")

wait_http "$API/api/health" $api_pid || fail "API не запустился. Лог: $LOGS/server.log"
wait_http "$UI/" || fail "Интерфейс не запустился за 90 с. Лог: $LOGS/frontend.log"

# ---- 6. App window.
pgrep -f -- "--user-data-dir=$PROFILE" >/dev/null || open_window
rm -f "$HANDOVER"   # the API has read it (outcome is reported once in the UI)
print "ready"

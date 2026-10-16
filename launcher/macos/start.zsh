#!/bin/zsh
# Lecture Studio — clean-slate launcher (macOS). Run by "Lecture Studio.app" on the Desktop.
#   One server (backend/serve.py): the app on 127.0.0.1:5173 (built UI + /api), the API also on 127.0.0.1:3000.
# Every launch: stop old processes -> sync deps / rebuild the UI if changed -> start the server -> open the app window.
# The UI is frontend/dist: shipped ready in Setup.zip (frontend/dist/.prebuilt, no Node.js needed), else built here
# whenever its sources changed (a clone, an update, a GitHub ZIP).
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
    # The new release did not come up: back to the previous commit, start again (deps and UI rebuild by fingerprint).
    print "rolling back to $from_sha"
    git -C "$REPO" reset --keep "$from_sha" && exec /bin/zsh "$SELF" rollback
  fi
  rm -f "$HANDOVER"
  dialog "$1" '"OK"' stop >/dev/null
  exit 1
}
# The range Vite 8 accepts, as in frontend/package.json engines: ^20.19.0 || >=22.12.0 (same check in setups/macos/install.zsh).
node_ok() {
  local -a v=( ${(s:.:)${$(node --version 2>/dev/null)#v}} )
  [[ ${v[1]-} == <-> && ${v[2]-} == <-> ]] || return 1
  (( (v[1] == 20 && v[2] >= 19) || (v[1] == 22 && v[2] >= 12) || v[1] > 22 ))
}
# Texts follow the Mac's first preferred language: Russian on a Russian system, English everywhere else
# (LECTURE_STUDIO_LANG=ru|en overrides). The same lines are in setups/macos/install.zsh and launcher/macos/{start,stop}.zsh.
os_lang() {
  [[ ${LECTURE_STUDIO_LANG-} == (ru|en) ]] && { print -r -- $LECTURE_STUDIO_LANG; return }
  local first=${$(defaults read -g AppleLanguages 2>/dev/null | sed -n 2p)//[[:space:]\",]/}
  [[ $first == ru || $first == ru[-_]* ]] && print ru || print en
}
OS_LANG=$(os_lang)
L() { [[ $OS_LANG == ru ]] && print -r -- "$1" || print -r -- "$2" }
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
  restart=$(L "Перезапустить" "Restart")
  choice=$(dialog "$(L "Сейчас идёт обработка. Перезапуск прервёт её." "Processing is running. A restart interrupts it.")" "\"$(L "Открыть окно" "Open the window")\", \"$restart\"")
  if [[ "$choice" != "$restart" ]]; then
    pgrep -f -- "--user-data-dir=$PROFILE" >/dev/null || open_window
    exit 0
  fi
fi

# ---- 1. Stop previous instance: server, a Vite UI of an older version, app window.
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

# ---- 2. Toolchain. Node.js only where the UI is built here (not for the ready UI of Setup.zip).
cd "$REPO" || fail "$(L "Папка проекта не найдена: $REPO" "The project folder is not found: $REPO")"
prebuilt=0; [[ -f frontend/dist/.prebuilt ]] && prebuilt=1
tools=(uv ffmpeg ffprobe lsof); (( prebuilt )) || tools+=npm
for tool in $tools; do
  command -v $tool >/dev/null || fail "$(L "Не найден $tool. Установите: brew install ${tool/ffprobe/ffmpeg}" "$tool not found. Install: brew install ${tool/ffprobe/ffmpeg}")"
done
(( prebuilt )) || node_ok || fail "$(L "Нужен Node.js 20.19+ или 22.12+, установлен $(node --version 2>/dev/null). Обновите: brew upgrade node" "Node.js 20.19+ or 22.12+ is needed, $(node --version 2>/dev/null) is installed. Update: brew upgrade node")"

# ---- 3. Dependencies and the UI build, only when their sources changed.
py_fp=$(fingerprint pyproject.toml uv.lock)
if [[ ! -x .venv/bin/python ]] || changed python "$py_fp"; then
  print "uv sync"
  uv sync --frozen || fail "$(L "uv sync не удался. Лог: $LOGS/launcher.log" "uv sync failed. Log: $LOGS/launcher.log")"
  print -r -- "$py_fp" > "$STATE/python"
fi
if (( ! prebuilt )); then
  node_fp=$(fingerprint frontend/package-lock.json)
  if [[ ! -x frontend/node_modules/.bin/vite ]] || changed node "$node_fp"; then
    print "npm ci"
    npm --prefix frontend ci --no-audit --no-fund || fail "$(L "npm ci не удался. Лог: $LOGS/launcher.log" "npm ci failed. Log: $LOGS/launcher.log")"
    print -r -- "$node_fp" > "$STATE/node"
  fi
  # The same file list as setups/macos/build-setup.zsh and launcher/windows/start.ps1 build from.
  ui_fp=$(fingerprint frontend/src frontend/public frontend/index.html frontend/package.json frontend/package-lock.json \
    frontend/vite.config.ts frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.node.json)
  if [[ ! -f frontend/dist/index.html ]] || changed ui "$ui_fp"; then
    # Into a side folder first: a failed build leaves the previous UI in place.
    print "building the interface"
    rm -rf frontend/dist.next
    npm --prefix frontend run build -- --outDir dist.next --emptyOutDir \
      && rm -rf frontend/dist && mv frontend/dist.next frontend/dist \
      || { rm -rf frontend/dist.next; fail "$(L "Сборка интерфейса не удалась. Лог: $LOGS/launcher.log" "Building the interface failed. Log: $LOGS/launcher.log")" }
    print -r -- "$ui_fp" > "$STATE/ui"
  fi
fi

# The Desktop shortcut is built once by Setup; a new logo arrives with an update: refresh its icon in place
# (only the .icns: rebuilding the whole bundle on the iCloud-synced Desktop leaves "Lecture Studio 2" copies).
icon_fp=$(fingerprint assets/icon.svg)
shortcut="$HOME/Desktop/Lecture Studio.app"
if [[ -d "$shortcut" ]] && changed icon "$icon_fp"; then
  print "refreshing the shortcut icon"
  zsh launcher/macos/make-icon.zsh assets/icon.svg "$shortcut/Contents/Resources/AppIcon.icns" \
    && codesign --force --deep -s - "$shortcut" 2>/dev/null; touch "$shortcut"
  print -r -- "$icon_fp" > "$STATE/icon"
fi

# ---- 4. Server: the app on the UI port, the API also on the API port (writes its own server.pid).
print "starting server :$UI_PORT + :$API_PORT"
LS_API_PORT=$API_PORT LS_UI_PORT=$UI_PORT nohup .venv/bin/python -m backend.serve >>"$LOGS/server.log" 2>&1 </dev/null &!
api_pid=$!

wait_http "$API/api/health" $api_pid || fail "$(L "Сервер не запустился. Лог: $LOGS/server.log" "The server did not start. Log: $LOGS/server.log")"
wait_http "$UI/" $api_pid || fail "$(L "Интерфейс не открывается. Лог: $LOGS/server.log" "The interface does not open. Log: $LOGS/server.log")"

# ---- 5. App window.
pgrep -f -- "--user-data-dir=$PROFILE" >/dev/null || open_window
rm -f "$HANDOVER"   # the API has read it (outcome is reported once in the UI)
print "ready"

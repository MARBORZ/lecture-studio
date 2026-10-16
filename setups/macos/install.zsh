#!/bin/zsh
# Lecture Studio installer steps. Driven by "Lecture Studio Setup.app" (one step per call, for the progress window).
#   zsh install.zsh <step> [data_dir]
# Steps: has-settings | homebrew | tools | fetch | python | node | configure | shortcut
# The code ships inside Setup (Resources/source.tar.gz = committed snapshot): no GitHub access or login needed.
# Re-running on an installed machine = update (code replaced, deps synced, shortcut rebuilt). Lesson data is never touched.
# Test overrides: LECTURE_STUDIO_HOME, LS_INSTALL_DIR, LS_SOURCE_ARCHIVE, LS_SHORTCUT_DIRS (colon-separated).

set -eu
STEP="${1:-}"
DATA_DIR="${2:-}"
APP_HOME="${LECTURE_STUDIO_HOME:-$HOME/Library/Application Support/Lecture Studio}"
INSTALL_DIR="${LS_INSTALL_DIR:-$APP_HOME/app}"
SOURCE="${LS_SOURCE_ARCHIVE:-${0:A:h}/source.tar.gz}"
SHORTCUT_DIRS=( ${(s/:/)${LS_SHORTCUT_DIRS:-$HOME/Desktop}} )

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export HOMEBREW_NO_ENV_HINTS=1 HOMEBREW_NO_INSTALL_CLEANUP=1
mkdir -p "$APP_HOME/logs"
LOG="$APP_HOME/logs/setup.log"
print "\n=== $(date '+%F %T') step: $STEP" >>"$LOG"

die() { print -r -- "$1" >&2; print "FAIL: $1" >>"$LOG"; exit 1 }
# Texts follow the Mac's first preferred language: Russian on a Russian system, English everywhere else
# (LECTURE_STUDIO_LANG=ru|en overrides). The same lines are in setups/macos/install.zsh and launcher/macos/{start,stop}.zsh.
os_lang() {
  [[ ${LECTURE_STUDIO_LANG-} == (ru|en) ]] && { print -r -- $LECTURE_STUDIO_LANG; return }
  local first=${$(defaults read -g AppleLanguages 2>/dev/null | sed -n 2p)//[[:space:]\",]/}
  [[ $first == ru || $first == ru[-_]* ]] && print ru || print en
}
OS_LANG=$(os_lang)
L() { [[ $OS_LANG == ru ]] && print -r -- "$1" || print -r -- "$2" }
# The range Vite 8 accepts, as in frontend/package.json engines: ^20.19.0 || >=22.12.0 (same check in launcher/macos/start.zsh).
node_ok() {
  local -a v=( ${(s:.:)${$(node --version 2>/dev/null)#v}} )
  [[ ${v[1]-} == <-> && ${v[2]-} == <-> ]] || return 1
  (( (v[1] == 20 && v[2] >= 19) || (v[1] == 22 && v[2] >= 12) || v[1] > 22 ))
}
run() { "$@" >>"$LOG" 2>&1 }
# A ready UI (frontend/dist/.prebuilt: Setup.zip carries it) needs no Node.js; otherwise the launcher builds it.
prebuilt() { [[ -f "$INSTALL_DIR/frontend/dist/.prebuilt" ]] || { [[ -f "$SOURCE" ]] && tar -tzf "$SOURCE" frontend/dist/.prebuilt >/dev/null 2>&1 } }

case "$STEP" in
  has-settings)
    [[ -f "$APP_HOME/settings.json" ]] && print yes || print no
    ;;

  homebrew)
    command -v brew >/dev/null && { print "brew present" >>"$LOG"; exit 0 }
    dseditgroup -o checkmember -m "$USER" admin >/dev/null 2>&1 || die "$(L "Для установки Homebrew нужна учётная запись администратора Mac." "Installing Homebrew needs an administrator account on this Mac.")"
    ASKPASS=$(mktemp -t ls-askpass)
    cat > "$ASKPASS" <<ASK
#!/bin/sh
exec osascript -e 'text returned of (display dialog "$(L "Homebrew устанавливает инструменты разработчика. Введите пароль администратора этого Mac." "Homebrew installs developer tools. Enter the administrator password of this Mac.")" default answer "" with hidden answer with title "Lecture Studio Setup" with icon caution)'
ASK
    chmod 700 "$ASKPASS"
    SUDO_ASKPASS="$ASKPASS" NONINTERACTIVE=1 run /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
      || { rm -f "$ASKPASS"; die "$(L "Homebrew не установился. Лог: $LOG" "Homebrew did not install. Log: $LOG")" }
    rm -f "$ASKPASS"
    command -v brew >/dev/null || die "$(L "Homebrew установлен, но не найден в PATH. Лог: $LOG" "Homebrew is installed but not on PATH. Log: $LOG")"
    ;;

  tools)
    tools=(uv ffmpeg); prebuilt || tools+=node
    for f in $tools; do
      brew list --formula "$f" >/dev/null 2>&1 || command -v "$f" >/dev/null || run brew install "$f" || die "$(L "Не удалось установить $f. Лог: $LOG" "Could not install $f. Log: $LOG")"
    done
    if ! prebuilt && ! node_ok; then
      print "node $(node --version 2>/dev/null) is older than 20.19 / 22.12" >>"$LOG"
      # Homebrew's node comes first on PATH here and in the launcher, whatever installed the old one.
      if brew list --formula node >/dev/null 2>&1; then run brew upgrade node || true; else run brew install node || true; fi
      hash -r
      node_ok || die "$(L "Нужен Node.js 20.19+ или 22.12+, установлен $(node --version 2>/dev/null). Обновите: brew upgrade node" "Node.js 20.19+ or 22.12+ is needed, $(node --version 2>/dev/null) is installed. Update: brew upgrade node")"
    fi
    ;;

  fetch)
    [[ -f "$SOURCE" ]] || die "$(L "В Setup нет архива кода: $SOURCE" "Setup holds no code archive: $SOURCE")"
    TMP=$(mktemp -d)
    run tar -xzf "$SOURCE" -C "$TMP" || { rm -rf "$TMP"; die "$(L "Архив кода повреждён. Лог: $LOG" "The code archive is damaged. Log: $LOG")" }
    mkdir -p "$INSTALL_DIR"
    # Replace code (and the ready UI, frontend/dist), keep installed environments (.venv, node_modules) so updates stay fast.
    run rsync -a --delete --exclude /.venv --exclude /frontend/node_modules --exclude /workspace "$TMP/" "$INSTALL_DIR/" \
      || { rm -rf "$TMP"; die "$(L "Не удалось записать код в $INSTALL_DIR. Лог: $LOG" "Could not write the code to $INSTALL_DIR. Log: $LOG")" }
    rm -rf "$TMP"
    ;;

  python)
    cd "$INSTALL_DIR"
    run uv sync --frozen || die "$(L "Установка Python-зависимостей не удалась. Лог: $LOG" "Installing the Python dependencies failed. Log: $LOG")"
    ;;

  node)
    prebuilt && { print "ready interface: no npm" >>"$LOG"; exit 0 }
    run npm --prefix "$INSTALL_DIR/frontend" ci --no-audit --no-fund || die "$(L "Установка интерфейса не удалась. Лог: $LOG" "Installing the interface failed. Log: $LOG")"
    ;;

  configure)
    [[ -f "$APP_HOME/settings.json" ]] && { print "settings kept" >>"$LOG"; exit 0 }
    [[ -n "$DATA_DIR" ]] || DATA_DIR="$HOME/Lecture Studio"
    mkdir -p "$DATA_DIR" || die "$(L "Нет доступа к папке данных: $DATA_DIR" "No access to the data folder: $DATA_DIR")"
    "$INSTALL_DIR/.venv/bin/python" -c 'import json, sys; json.dump({"data_dir": sys.argv[2]}, open(sys.argv[1], "w"), ensure_ascii=False, indent=2)' \
      "$APP_HOME/settings.json" "${DATA_DIR%/}"
    ;;

  shortcut)
    for d in $SHORTCUT_DIRS; do
      mkdir -p "$d"
      run zsh "$INSTALL_DIR/launcher/macos/build-app.zsh" "$d" || die "$(L "Не удалось создать ярлык в $d. Лог: $LOG" "Could not create the shortcut in $d. Log: $LOG")"
    done
    ;;

  *)
    die "$(L "Неизвестный шаг: $STEP" "Unknown step: $STEP")"
    ;;
esac

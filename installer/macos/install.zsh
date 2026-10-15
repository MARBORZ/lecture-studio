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
run() { "$@" >>"$LOG" 2>&1 }

case "$STEP" in
  has-settings)
    [[ -f "$APP_HOME/settings.json" ]] && print yes || print no
    ;;

  homebrew)
    command -v brew >/dev/null && { print "brew present" >>"$LOG"; exit 0 }
    dseditgroup -o checkmember -m "$USER" admin >/dev/null 2>&1 || die "Для установки Homebrew нужна учётная запись администратора Mac."
    ASKPASS=$(mktemp -t ls-askpass)
    cat > "$ASKPASS" <<'ASK'
#!/bin/sh
exec osascript -e 'text returned of (display dialog "Homebrew устанавливает инструменты разработчика. Введите пароль администратора этого Mac." default answer "" with hidden answer with title "Lecture Studio Setup" with icon caution)'
ASK
    chmod 700 "$ASKPASS"
    SUDO_ASKPASS="$ASKPASS" NONINTERACTIVE=1 run /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" \
      || { rm -f "$ASKPASS"; die "Homebrew не установился. Лог: $LOG" }
    rm -f "$ASKPASS"
    command -v brew >/dev/null || die "Homebrew установлен, но не найден в PATH. Лог: $LOG"
    ;;

  tools)
    for f in uv node ffmpeg; do
      brew list --formula "$f" >/dev/null 2>&1 || command -v "$f" >/dev/null || run brew install "$f" || die "Не удалось установить $f. Лог: $LOG"
    done
    ;;

  fetch)
    [[ -f "$SOURCE" ]] || die "В Setup нет архива кода: $SOURCE"
    TMP=$(mktemp -d)
    run tar -xzf "$SOURCE" -C "$TMP" || { rm -rf "$TMP"; die "Архив кода повреждён. Лог: $LOG" }
    mkdir -p "$INSTALL_DIR"
    # Replace code, keep installed environments (.venv, node_modules) so updates stay fast.
    run rsync -a --delete --exclude /.venv --exclude /frontend/node_modules --exclude /workspace "$TMP/" "$INSTALL_DIR/" \
      || { rm -rf "$TMP"; die "Не удалось записать код в $INSTALL_DIR. Лог: $LOG" }
    rm -rf "$TMP"
    ;;

  python)
    cd "$INSTALL_DIR"
    run uv sync --frozen || die "Установка Python-зависимостей не удалась. Лог: $LOG"
    ;;

  node)
    run npm --prefix "$INSTALL_DIR/frontend" ci --no-audit --no-fund || die "Установка интерфейса не удалась. Лог: $LOG"
    ;;

  configure)
    [[ -f "$APP_HOME/settings.json" ]] && { print "settings kept" >>"$LOG"; exit 0 }
    [[ -n "$DATA_DIR" ]] || DATA_DIR="$HOME/Lecture Studio"
    mkdir -p "$DATA_DIR" || die "Нет доступа к папке данных: $DATA_DIR"
    "$INSTALL_DIR/.venv/bin/python" -c 'import json, sys; json.dump({"data_dir": sys.argv[2]}, open(sys.argv[1], "w"), ensure_ascii=False, indent=2)' \
      "$APP_HOME/settings.json" "${DATA_DIR%/}"
    ;;

  shortcut)
    for d in $SHORTCUT_DIRS; do
      mkdir -p "$d"
      run zsh "$INSTALL_DIR/launcher/macos/build-app.zsh" "$d" || die "Не удалось создать ярлык в $d. Лог: $LOG"
    done
    ;;

  *)
    die "Неизвестный шаг: $STEP"
    ;;
esac

#!/bin/zsh
# Lecture Studio uninstaller (macOS). Started by the API (POST /api/system/uninstall) from a copy in a temp folder:
# the app folder it deletes holds the original. The plan is a file of tab-separated lines:
#   pid <api pid> | ui_port <port> | profile <app window profile> | message <final text> | failed <label>
#   remove <path> | remove_if_empty <path>
#   zsh remove.zsh <plan.tsv>      (LS_UNINSTALL_QUIET=1: no final dialog)
set -u
PLAN="$1"
api_pid="" ui_port="" profile="" message="" failed=""
remove=() remove_if_empty=()
while IFS=$'\t' read -r key value; do
  case $key in
    pid) api_pid=$value ;;
    ui_port) ui_port=$value ;;
    profile) profile=$value ;;
    message) message=$value ;;
    failed) failed=$value ;;
    remove) remove+=("$value") ;;
    remove_if_empty) remove_if_empty+=("$value") ;;
  esac
done < "$PLAN"

# 1. The API stops itself after answering: wait for it (up to 30 s), then close whatever is left.
for i in {1..60}; do
  [[ -n $api_pid ]] && kill -0 $api_pid 2>/dev/null || break
  sleep 0.5
done
[[ -n $api_pid ]] && kill -KILL $api_pid 2>/dev/null
if [[ -n $ui_port ]]; then
  pids=( $(lsof -ti tcp:$ui_port -sTCP:LISTEN 2>/dev/null) )
  (( ${#pids} )) && kill -TERM $pids 2>/dev/null
fi
[[ -n $profile ]] && pkill -f -- "--user-data-dir=$profile" 2>/dev/null
sleep 1

# 2. The Desktop shortcut, only our own (bundle id from launcher/macos/build-app.zsh).
shortcut="$HOME/Desktop/Lecture Studio.app"
if [[ -d $shortcut ]] && grep -q 'local.lecture-studio.launcher' "$shortcut/Contents/Info.plist" 2>/dev/null; then
  remove+=("$shortcut")
fi

# 3. Delete. Never the root or anything that contains the home folder, whatever the plan says.
deletable() { [[ -n $1 && $1 != / && $1 != "$HOME" && "$HOME/" != "$1/"* ]] }
left=()
for p in $remove; do
  deletable "$p" || continue
  rm -rf -- "$p" 2>/dev/null
  [[ -e $p ]] && left+=("$p")
done
for p in $remove_if_empty; do
  deletable "$p" && [[ -d $p ]] || continue
  rm -f -- "$p/.DS_Store"
  rmdir -- "$p" 2>/dev/null
done
(( ${#left} )) && message="$message"$'\n\n'"$failed ${(j:, :)left}"

# LS_UNINSTALL_QUIET: tests run this script for real, without the dialog.
[[ -n ${LS_UNINSTALL_QUIET:-} ]] || osascript -e 'on run argv' -e 'display dialog (item 1 of argv) with title "Lecture Studio" buttons {"OK"} default button "OK"' -e 'end run' "$message" >/dev/null 2>&1
rm -rf -- "${PLAN:h}"

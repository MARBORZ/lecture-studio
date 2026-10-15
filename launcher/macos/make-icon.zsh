#!/bin/zsh
# SVG -> .icns (QuickLook render + sips + iconutil). Shared by the app and the installer.
#   zsh launcher/make-icon.zsh <input.svg> <output.icns>
set -eu
SVG="$1"
OUT="$2"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
cp "$SVG" "$WORK/icon.svg"
qlmanage -t -s 1024 -o "$WORK" "$WORK/icon.svg" >/dev/null 2>&1
[[ -f "$WORK/icon.svg.png" ]] || { print "icon render failed" >&2; exit 1; }
mkdir "$WORK/i.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s "$WORK/icon.svg.png" --out "$WORK/i.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$WORK/icon.svg.png" --out "$WORK/i.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$WORK/i.iconset" -o "$OUT"

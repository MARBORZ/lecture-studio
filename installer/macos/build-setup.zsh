#!/bin/zsh
# Builds the Setup applet in two flavours:
#   installer/macos/Setup.app        committed; installs in place from the clone it sits in
#   dist/Lecture-Studio-Setup.zip    standalone for Releases; carries the code (git HEAD) inside
set -eu
REPO="${0:A:h:h:h}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

build() {  # build <out.app> <with_source:0|1>
  local app="$1"
  osacompile -o "$app" "$REPO/installer/macos/Setup.applescript"
  zsh "$REPO/launcher/macos/make-icon.zsh" "$REPO/assets/setup-icon.svg" "$app/Contents/Resources/applet.icns"
  # Modern applets take the icon from Assets.car via CFBundleIconName; drop it so applet.icns (ours) is used.
  rm -f "$app/Contents/Resources/Assets.car"
  /usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$app/Contents/Info.plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier local.lecture-studio.setup" "$app/Contents/Info.plist" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string local.lecture-studio.setup" "$app/Contents/Info.plist"
  if (( $2 )); then
    cp "$REPO/installer/macos/install.zsh" "$app/Contents/Resources/install.zsh"
    git -C "$REPO" archive --format=tar.gz -o "$app/Contents/Resources/source.tar.gz" HEAD
  fi
  xattr -cr "$app"
  codesign --force --deep -s - "$app" 2>/dev/null
}

# 1. In-place (committed)
build "$WORK/Setup.app" 0
rm -rf "$REPO/installer/macos/Setup.app"
ditto "$WORK/Setup.app" "$REPO/installer/macos/Setup.app"
print "Built: installer/macos/Setup.app"

# 2. Standalone (release)
[[ -z "$(git -C "$REPO" status --porcelain)" ]] || print "warning: uncommitted changes are NOT in the release archive (it packs HEAD)"
build "$WORK/Lecture Studio Setup.app" 1
mkdir -p "$REPO/dist"
rm -f "$REPO/dist/Lecture-Studio-Setup.zip"
ditto -c -k --keepParent "$WORK/Lecture Studio Setup.app" "$REPO/dist/Lecture-Studio-Setup.zip"
print "Built: dist/Lecture-Studio-Setup.zip"

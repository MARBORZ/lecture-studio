#!/bin/zsh
# Builds the applets:
#   setups/macos/{Setup,Uninstall}.app   committed; work on the clone they sit in
#   dist/Lecture-Studio-Setup.zip    standalone Setup for Releases; carries the code (git HEAD) inside
set -eu
REPO="${0:A:h:h:h}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

build() {  # build <out.app> <with_source:0|1> [script name, default Setup] [bundle id suffix, default setup]
  local app="$1" name="${3:-Setup}" id="${4:-setup}"
  osacompile -o "$app" "$REPO/setups/macos/$name.applescript"
  # each applet its own icon: assets/setup-icon.svg, assets/uninstall-icon.svg
  zsh "$REPO/launcher/macos/make-icon.zsh" "$REPO/assets/${(L)name}-icon.svg" "$app/Contents/Resources/applet.icns"
  # Modern applets take the icon from Assets.car via CFBundleIconName; drop it so applet.icns (ours) is used.
  rm -f "$app/Contents/Resources/Assets.car"
  /usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$app/Contents/Info.plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier local.lecture-studio.$id" "$app/Contents/Info.plist" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string local.lecture-studio.$id" "$app/Contents/Info.plist"
  if (( $2 )); then
    cp "$REPO/setups/macos/install.zsh" "$app/Contents/Resources/install.zsh"
    git -C "$REPO" archive --format=tar.gz -o "$app/Contents/Resources/source.tar.gz" HEAD
  fi
  xattr -cr "$app"
  codesign --force --deep -s - "$app" 2>/dev/null
}

# 1. In-place (committed, setups/macos)
for name in Setup Uninstall; do
  build "$WORK/$name.app" 0 "$name" "${(L)name}"
  rm -rf "$REPO/setups/macos/$name.app"
  ditto "$WORK/$name.app" "$REPO/setups/macos/$name.app"
  print "Built: setups/macos/$name.app"
done

# 2. Standalone (release)
[[ -z "$(git -C "$REPO" status --porcelain)" ]] || print "warning: uncommitted changes are NOT in the release archive (it packs HEAD)"
build "$WORK/Lecture Studio Setup.app" 1
mkdir -p "$REPO/dist"
rm -f "$REPO/dist/Lecture-Studio-Setup.zip"
ditto -c -k --keepParent "$WORK/Lecture Studio Setup.app" "$REPO/dist/Lecture-Studio-Setup.zip"
print "Built: dist/Lecture-Studio-Setup.zip"

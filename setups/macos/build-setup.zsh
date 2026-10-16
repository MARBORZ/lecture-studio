#!/bin/zsh
# Builds the applets:
#   setups/macos/{Setup,Uninstall}.app   committed; work on the clone they sit in
#   dist/Lecture-Studio-Setup.zip    standalone Setup for Releases; carries the code (git HEAD) inside, with the UI
#                                    already built (frontend/dist + .prebuilt): installs from it need no Node.js
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
    cp "$WORK/source.tar.gz" "$app/Contents/Resources/source.tar.gz"
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

# 2. Standalone (release): HEAD + the UI built from that same HEAD (dist is not in git).
[[ -z "$(git -C "$REPO" status --porcelain)" ]] || print "warning: uncommitted changes are NOT in the release archive (it packs HEAD)"
mkdir -p "$WORK/src"
git -C "$REPO" archive HEAD | tar -x -C "$WORK/src"
# from inside frontend/: `npm --prefix` from another folder fails `npm ci` ("Missing: frontend@1.0.0 from lock file")
(cd "$WORK/src/frontend" && npm ci --no-audit --no-fund --prefer-offline && npm run build)
print "built from $(git -C "$REPO" rev-parse --short HEAD)" > "$WORK/src/frontend/dist/.prebuilt"
rm -rf "$WORK/src/frontend/node_modules"
(cd "$WORK/src" && tar -czf "$WORK/source.tar.gz" *(D))   # paths without ./ (install.zsh looks for frontend/dist/.prebuilt)
build "$WORK/Lecture Studio Setup.app" 1
mkdir -p "$REPO/dist"
rm -f "$REPO/dist/Lecture-Studio-Setup.zip"
ditto -c -k --keepParent "$WORK/Lecture Studio Setup.app" "$REPO/dist/Lecture-Studio-Setup.zip"
print "Built: dist/Lecture-Studio-Setup.zip"

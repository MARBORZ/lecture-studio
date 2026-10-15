#!/bin/zsh
# Builds "Lecture Studio.app" (default: on the Desktop). Re-run after moving the repository.
#   zsh launcher/build-app.zsh [target-dir]
set -eu
REPO="${0:A:h:h:h}"
TARGET="${1:-$HOME/Desktop}"
FINAL="$TARGET/Lecture Studio.app"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
# Build and sign outside the (possibly iCloud-synced) Desktop: synced folders add xattrs codesign rejects.
APP="$WORK/Lecture Studio.app"

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Lecture Studio</string>
  <key>CFBundleDisplayName</key><string>Lecture Studio</string>
  <key>CFBundleIdentifier</key><string>local.lecture-studio.launcher</string>
  <key>CFBundleVersion</key><string>1.0.0</string>
  <key>CFBundleShortVersionString</key><string>1.0.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>LectureStudio</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
</dict>
</plist>
PLIST

# Native stub (not a script): lets macOS attribute Desktop access to this app and prompt once.
clang -O2 -o "$APP/Contents/MacOS/LectureStudio" -DLAUNCHER_SCRIPT="\"$REPO/launcher/macos/start.zsh\"" "$REPO/launcher/macos/stub.c"

zsh "$REPO/launcher/macos/make-icon.zsh" "$REPO/assets/icon.svg" "$APP/Contents/Resources/AppIcon.icns" || print "icon skipped"

xattr -cr "$APP"
codesign --force --deep -s - "$APP"
rm -rf "$FINAL"
ditto "$APP" "$FINAL"
touch "$FINAL"
print "Built: $FINAL"

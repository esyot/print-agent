#!/usr/bin/env bash
# scripts/pack-macos.sh
# Packages the universal binary into a DMG and optionally codesigns/notarizes.
#
# Usage:
#   VERSION=1.0.0 ./scripts/pack-macos.sh
#   VERSION=1.0.0 SIGN_ID="Developer ID Application: Me (TEAM)" ./scripts/pack-macos.sh
#
# Env:
#   VERSION     required — must match package.json version
#   SIGN_ID     optional — codesign identity (needed for notarization)
#   APPLE_ID    optional — for notarytool
#   APPLE_PASS  optional — app-specific password
#   APPLE_TEAM  optional — team ID
set -euo pipefail

VERSION="${VERSION:?VERSION env var required}"
DIST="$(pwd)/dist"
BIN="$DIST/print-agent-${VERSION}-mac-universal"
APP="$DIST/PrintAgent.app"
STAGE="$DIST/dmg-stage"
DMG="$DIST/PrintAgent-${VERSION}.dmg"

if [[ ! -f "$BIN" ]]; then
  echo "❌ Universal binary not found at $BIN"
  echo "   Run: npm run build:mac-universal   (on macOS)"
  exit 1
fi

# ---- Build a minimal .app bundle ----
rm -rf "$APP" "$STAGE"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/print-agent"
chmod +x "$APP/Contents/MacOS/print-agent"

cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>            <string>PrintAgent</string>
  <key>CFBundleDisplayName</key>     <string>Silent Print Agent</string>
  <key>CFBundleIdentifier</key>      <string>com.example.printagent</string>
  <key>CFBundleVersion</key>         <string>${VERSION}</string>
  <key>CFBundleShortVersionString</key> <string>${VERSION}</string>
  <key>CFBundleExecutable</key>      <string>print-agent</string>
  <key>CFBundlePackageType</key>     <string>APPL</string>
  <key>LSMinimumSystemVersion</key>  <string>11.0</string>
  <key>LSUIElement</key>             <true/>
</dict>
</plist>
EOF

# ---- Code sign ----
if [[ -n "${SIGN_ID:-}" ]]; then
  echo "🔏 Signing .app with: $SIGN_ID"
  codesign --deep --force --options runtime \
    --sign "$SIGN_ID" "$APP"
  codesign --verify --deep --strict --verbose=2 "$APP"
else
  echo "⚠  SIGN_ID not set — DMG will trigger Gatekeeper warnings on other Macs"
fi

# ---- Stage DMG contents ----
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

# ---- Create DMG ----
echo "💿 Building $DMG"
hdiutil create -volname "Print Agent ${VERSION}" \
  -srcfolder "$STAGE" \
  -ov -format UDZO "$DMG"

# ---- Notarize (optional) ----
if [[ -n "${APPLE_ID:-}" && -n "${APPLE_PASS:-}" && -n "${APPLE_TEAM:-}" ]]; then
  echo "📮 Submitting to notarytool..."
  xcrun notarytool submit "$DMG" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_PASS" \
    --team-id "$APPLE_TEAM" \
    --wait
  xcrun stapler staple "$DMG"
  echo "✅ Notarized and stapled"
fi

rm -rf "$STAGE"
echo "✅ Done: $DMG"
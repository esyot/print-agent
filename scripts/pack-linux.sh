#!/usr/bin/env bash
# scripts/pack-linux.sh
# Packages linux-x64 and/or linux-arm64 binaries into .deb and .rpm installers.
#
# Requires: fpm (gem install fpm)
#
# Usage: VERSION=1.0.0 ./scripts/pack-linux.sh
set -euo pipefail

VERSION="${VERSION:?VERSION env var required}"
DIST="$(pwd)/dist"

command -v fpm >/dev/null || { echo "❌ fpm not installed"; exit 1; }

build_for() {
  local name="$1"
  local arch_deb="$2"
  local arch_rpm="$3"
  local bin="$DIST/print-agent-${VERSION}-${name}"

  [[ -f "$bin" ]] || { echo "⚠  Missing $bin — skipping $name"; return; }

  for fmt in deb rpm; do
    local arch="$arch_deb"
    [[ "$fmt" == "rpm" ]] && arch="$arch_rpm"

    fpm -s dir -t "$fmt" \
      -n print-agent \
      -v "$VERSION" \
      -a "$arch" \
      --description "Silent Print & Display Agent" \
      --url "https://example.com" \
      --maintainer "you@example.com" \
      --after-install installer/linux-postinst.sh \
      --before-remove installer/linux-preremove.sh \
      "$bin=/usr/local/bin/print-agent"
  done
}

# Both arches — fpm picks up the right ones
build_for "linux-x64"   "amd64" "x86_64"
build_for "linux-arm64" "arm64" "aarch64"

echo "✅ Linux packages written to $(pwd)"
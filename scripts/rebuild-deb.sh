#!/bin/bash
# Rebuild .deb from Tauri's build artifacts (workaround for Tauri deb bundler bug)
set -euo pipefail
DEB_DIR="src-tauri/target/release/bundle/deb/Codecan_0.1.0_amd64"
DEB_OUT="$DEB_DIR.deb"
if [ ! -f "$DEB_DIR/debian-binary" ]; then
  echo "Run 'npm run tauri build' first"
  exit 1
fi
ar rcs "$DEB_OUT" "$DEB_DIR/debian-binary" "$DEB_DIR/control.tar.gz" "$DEB_DIR/data.tar.gz"
echo "Created: $DEB_OUT ($(du -h "$DEB_OUT" | cut -f1))"

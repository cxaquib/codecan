#!/bin/bash
# Build AppImage with workaround for missing librsvg2-dev on systems without sudo
set -euo pipefail

PKG_CONFIG_DIR="$HOME/pkgconfig"
PC_FILE="$PKG_CONFIG_DIR/librsvg-2.0.pc"

if [ ! -f "$PC_FILE" ]; then
  echo "Creating stub $PC_FILE (librsvg2-dev not installed)"
  mkdir -p "$PKG_CONFIG_DIR"
  cat > "$PC_FILE" << 'EOF'
prefix=/usr
exec_prefix=${prefix}
libdir=${exec_prefix}/lib/x86_64-linux-gnu
includedir=${prefix}/include
Name: librsvg-2.0
Description: SAX-based renderer library for SVG files
Version: 2.58.0
Requires: glib-2.0, cairo, gdk-pixbuf-2.0, pangocairo, pangoft2
Libs: -L${libdir} -lrsvg-2
Cflags: -I${includedir}/librsvg-2.0
EOF
fi

export PKG_CONFIG_PATH="$PKG_CONFIG_DIR${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
npm run tauri:build -- --bundles appimage "$@"

echo ""
echo "AppImage built:"
ls -lh src-tauri/target/release/bundle/appimage/Codecan_*.AppImage

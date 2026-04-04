#!/bin/bash
set -e
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)
case "$ARCH" in
  x86_64) ARCH="x64" ;;
  aarch64|arm64) ARCH="arm64" ;;
esac
BINARY="cx-${OS}-${ARCH}"
DEST="${INSTALL_DIR:-/usr/local/bin}/cx"
curl -fsSL "https://github.com/brxck/cx/releases/latest/download/${BINARY}" -o "$DEST"
chmod +x "$DEST"
echo "cx installed to $DEST"

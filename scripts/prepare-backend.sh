#!/usr/bin/env bash
# prepare-backend.sh
# Stages the backend for Electron packaging:
#   1. Compiles backend TypeScript
#   2. Copies compiled output + production deps into build/backend/
#   3. Downloads a matching Node.js binary into build/nodejs/bin/

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"
BACKEND_SRC="$ROOT_DIR/backend"
BACKEND_DEST="$BUILD_DIR/backend"
NODE_DEST="$BUILD_DIR/nodejs"

NODE_VERSION="v22.12.0"

echo "=== Preparing backend for packaging ==="

# ── Step 1: Compile backend TypeScript ──────────────────────────
echo "[1/3] Compiling backend TypeScript..."
cd "$BACKEND_SRC"
npx tsc

# ── Step 2: Stage backend dist + production deps ────────────────
echo "[2/3] Staging backend into build/backend/..."
rm -rf "$BACKEND_DEST"
mkdir -p "$BACKEND_DEST"

# Copy compiled JS
cp -r "$BACKEND_SRC/dist" "$BACKEND_DEST/dist"

# Copy package files for production install
cp "$BACKEND_SRC/package.json" "$BACKEND_DEST/package.json"
cp "$BACKEND_SRC/package-lock.json" "$BACKEND_DEST/package-lock.json" 2>/dev/null || true

# Install production-only dependencies
cd "$BACKEND_DEST"
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# ── Step 3: Download Node.js binary ────────────────────────────
echo "[3/3] Downloading Node.js $NODE_VERSION binary..."

# Detect platform and architecture
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$PLATFORM" in
  darwin) NODE_PLATFORM="darwin" ;;
  linux)  NODE_PLATFORM="linux" ;;
  *)      echo "Unsupported platform: $PLATFORM"; exit 1 ;;
esac

case "$ARCH" in
  arm64|aarch64) NODE_ARCH="arm64" ;;
  x86_64|amd64)  NODE_ARCH="x64" ;;
  *)             echo "Unsupported architecture: $ARCH"; exit 1 ;;
esac

NODE_TARBALL="node-${NODE_VERSION}-${NODE_PLATFORM}-${NODE_ARCH}.tar.gz"
NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}"

rm -rf "$NODE_DEST"
mkdir -p "$NODE_DEST/bin"

TMPDIR_NODE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_NODE"' EXIT

echo "  Downloading $NODE_URL ..."
curl -fsSL "$NODE_URL" -o "$TMPDIR_NODE/$NODE_TARBALL"

echo "  Extracting node binary..."
tar -xzf "$TMPDIR_NODE/$NODE_TARBALL" -C "$TMPDIR_NODE"
cp "$TMPDIR_NODE/node-${NODE_VERSION}-${NODE_PLATFORM}-${NODE_ARCH}/bin/node" "$NODE_DEST/bin/node"
chmod +x "$NODE_DEST/bin/node"

echo ""
echo "=== Backend preparation complete ==="
echo "  Backend staged: $BACKEND_DEST"
echo "  Node binary:    $NODE_DEST/bin/node"
echo "  Node version:   $($NODE_DEST/bin/node --version)"

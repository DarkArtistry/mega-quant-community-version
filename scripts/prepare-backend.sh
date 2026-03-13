#!/usr/bin/env bash
# prepare-backend.sh
# Stages the backend for Electron packaging:
#   1. Compiles backend TypeScript
#   2. Copies compiled output + production deps into build/backend/
#   3. Downloads a matching Node.js binary into build/nodejs/
#
# Usage:
#   ./prepare-backend.sh                          # auto-detect host platform
#   ./prepare-backend.sh --platform darwin --arch arm64
#   ./prepare-backend.sh --platform win32  --arch x64
#   ./prepare-backend.sh --platform linux  --arch x64

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$ROOT_DIR/build"
BACKEND_SRC="$ROOT_DIR/backend"
BACKEND_DEST="$BUILD_DIR/backend"
NODE_DEST="$BUILD_DIR/nodejs"

NODE_VERSION="v22.12.0"

# ── Parse arguments ─────────────────────────────────────────────
TARGET_PLATFORM=""
TARGET_ARCH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) TARGET_PLATFORM="$2"; shift 2 ;;
    --arch)     TARGET_ARCH="$2";     shift 2 ;;
    *)          echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Auto-detect if not specified
if [[ -z "$TARGET_PLATFORM" ]]; then
  case "$(uname -s | tr '[:upper:]' '[:lower:]')" in
    darwin) TARGET_PLATFORM="darwin" ;;
    linux)  TARGET_PLATFORM="linux" ;;
    mingw*|msys*|cygwin*) TARGET_PLATFORM="win32" ;;
    *)      echo "Unsupported host platform: $(uname -s)"; exit 1 ;;
  esac
fi

if [[ -z "$TARGET_ARCH" ]]; then
  case "$(uname -m)" in
    arm64|aarch64) TARGET_ARCH="arm64" ;;
    x86_64|amd64)  TARGET_ARCH="x64" ;;
    *)             echo "Unsupported host architecture: $(uname -m)"; exit 1 ;;
  esac
fi

echo "=== Preparing backend for packaging ==="
echo "  Target: ${TARGET_PLATFORM}-${TARGET_ARCH}"

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
echo "[3/3] Downloading Node.js $NODE_VERSION for ${TARGET_PLATFORM}-${TARGET_ARCH}..."

# Map platform names for Node.js download URLs
case "$TARGET_PLATFORM" in
  darwin) NODE_PLATFORM="darwin" ;;
  linux)  NODE_PLATFORM="linux" ;;
  win32)  NODE_PLATFORM="win" ;;
  *)      echo "Unsupported target platform: $TARGET_PLATFORM"; exit 1 ;;
esac

NODE_ARCH="$TARGET_ARCH"

rm -rf "$NODE_DEST"
mkdir -p "$NODE_DEST"

TMPDIR_NODE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_NODE"' EXIT

if [[ "$TARGET_PLATFORM" == "win32" ]]; then
  # Windows: download .zip, extract node.exe
  NODE_ZIP="node-${NODE_VERSION}-${NODE_PLATFORM}-${NODE_ARCH}.zip"
  NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_ZIP}"

  echo "  Downloading $NODE_URL ..."
  curl -fsSL "$NODE_URL" -o "$TMPDIR_NODE/$NODE_ZIP"

  echo "  Extracting node.exe..."
  unzip -q "$TMPDIR_NODE/$NODE_ZIP" -d "$TMPDIR_NODE"
  cp "$TMPDIR_NODE/node-${NODE_VERSION}-${NODE_PLATFORM}-${NODE_ARCH}/node.exe" "$NODE_DEST/node.exe"

  echo ""
  echo "=== Backend preparation complete ==="
  echo "  Backend staged: $BACKEND_DEST"
  echo "  Node binary:    $NODE_DEST/node.exe"
else
  # macOS / Linux: download .tar.gz, extract node binary
  mkdir -p "$NODE_DEST/bin"

  NODE_TARBALL="node-${NODE_VERSION}-${NODE_PLATFORM}-${NODE_ARCH}.tar.gz"
  NODE_URL="https://nodejs.org/dist/${NODE_VERSION}/${NODE_TARBALL}"

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
fi

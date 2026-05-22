#!/usr/bin/env bash
# Build a patched whatsmeow-node binary that forwards history sync messages to Node.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/bin/whatsmeow-node"
PATCH="$ROOT/patches/whatsmeow-node-history-sync.patch"
SRC="${WHATSMEOW_NODE_SRC:-/tmp/wm-node-src}"
REPO="https://github.com/nicastelo/whatsmeow-node.git"

if [[ ! -d "$SRC/cmd/whatsmeow-node" ]]; then
  echo "Cloning whatsmeow-node into $SRC ..."
  git clone --depth 1 "$REPO" "$SRC"
fi

if [[ ! -f "$PATCH" ]]; then
  echo "Missing patch file: $PATCH"
  exit 1
fi

if ! (cd "$SRC" && patch -p1 --dry-run -s < "$PATCH"); then
  if (cd "$SRC" && patch -p1 --reverse --dry-run -s < "$PATCH"); then
    echo "Patch already applied in $SRC"
  else
    echo "Failed to apply patch to whatsmeow-node source at $SRC"
    exit 1
  fi
else
  (cd "$SRC" && patch -p1 < "$PATCH")
  echo "Applied history sync patch"
fi

mkdir -p "$ROOT/bin"
(cd "$SRC/cmd/whatsmeow-node" && go build -o "$OUT" .)
chmod +x "$OUT"
echo "Built $OUT"

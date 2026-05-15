#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PACKAGE_ID="${SUI_PACKAGE_ID:-0x966af2458184bfb30eb839f9df7e93fc89ff58b9b01a3223b398b70edcb79b20}"
POLICY_ID="${SEAL_POLICY_OBJECT_ID:-0x2209797e99d9ebf72e7e4f46f95c1edc054cfbafe3c7ed8c61be811f96d0b4b6}"

INPUT_PATH="$(mktemp /tmp/seal-smoke-input-XXXXXX.bin)"
OUTPUT_PATH="${INPUT_PATH}.sealedcopy"

cleanup() {
  rm -f "$INPUT_PATH" "$OUTPUT_PATH"
}
trap cleanup EXIT

printf 'test document content' > "$INPUT_PATH"

echo "Running Seal smoke test with policy object: $POLICY_ID"
if ! result="$(cd "$SCRIPT_DIR" && SUI_PACKAGE_ID="$PACKAGE_ID" node seal_encrypt.js "$INPUT_PATH" "$POLICY_ID" "$OUTPUT_PATH" 2>&1)"; then
  echo "$result"
  exit 1
fi

echo "$result"

node -e 'const payload = JSON.parse(process.argv[1]); if (!payload.success) { process.exit(2); }' "$result"

echo "Seal smoke test passed."
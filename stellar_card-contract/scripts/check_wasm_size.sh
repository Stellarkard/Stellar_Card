#!/usr/bin/env bash
set -euo pipefail

# Usage: check_wasm_size.sh <wasm-path> <budget-bytes>
#
# Prints the size of <wasm-path> and exits non-zero if it is missing or
# larger than <budget-bytes>. Used by `make wasm-size` for both the raw and
# the optimized binary (Issue #392 - Part 1).

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <wasm-path> <budget-bytes>" >&2
  exit 2
fi

wasm_path="$1"
budget="$2"

if [ ! -f "$wasm_path" ]; then
  echo "wasm-size: $wasm_path not found — run 'make build' first" >&2
  exit 1
fi

size=$(wc -c < "$wasm_path" | tr -d '[:space:]')
headroom=$((budget - size))
echo "wasm-size: $wasm_path is $size bytes (budget: $budget bytes, headroom: $headroom bytes)"

if [ "$size" -gt "$budget" ]; then
  echo "wasm-size: FAIL — $wasm_path exceeds its $budget-byte budget by $((size - budget)) bytes" >&2
  exit 1
fi

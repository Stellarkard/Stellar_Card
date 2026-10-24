#!/usr/bin/env bash
set -euo pipefail

# Usage: optimize.sh [raw-wasm-path]
#
# Optimizes a compiled WASM binary for minimal size. Prefers the Stellar
# CLI's built-in optimizer, falls back to binaryen's wasm-opt, and fails
# if neither is available.
#
# Default input: target/wasm32v1-none/release/stellar_card_receiver.wasm
# Default output: same path with .optimized.wasm suffix.

WASM_TARGET="wasm32v1-none"
DEFAULT_RAW="target/${WASM_TARGET}/release/stellar_card_receiver.wasm"
RAW_WASM="${1:-$DEFAULT_RAW}"
OPTIMIZED_WASM="${RAW_WASM%.wasm}.optimized.wasm"

if [ ! -f "$RAW_WASM" ]; then
  echo "optimize: $RAW_WASM not found — run 'cargo build --target ${WASM_TARGET} --release' first" >&2
  exit 1
fi

raw_size=$(wc -c < "$RAW_WASM" | tr -d '[:space:]')

rm -f "$OPTIMIZED_WASM"

if command -v stellar >/dev/null 2>&1 && \
   stellar contract optimize --wasm "$RAW_WASM" --wasm-out "$OPTIMIZED_WASM" >/dev/null 2>&1; then
  echo "optimize: stellar contract optimize -> $OPTIMIZED_WASM"
elif command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt -Oz --strip-debug --strip-producers -c "$RAW_WASM" -o "$OPTIMIZED_WASM"
  echo "optimize: wasm-opt -Oz -> $OPTIMIZED_WASM"
else
  echo "optimize: neither 'stellar contract optimize' nor 'wasm-opt' is available" >&2
  echo "  Install the Stellar CLI (cargo install --locked stellar-cli) or binaryen for WASM size optimization." >&2
  exit 1
fi

opt_size=$(wc -c < "$OPTIMIZED_WASM" | tr -d '[:space:]')
reduction=$(( (raw_size - opt_size) * 100 / raw_size ))
echo "optimize: $RAW_WASM ($raw_size bytes) -> $OPTIMIZED_WASM ($opt_size bytes, ${reduction}% reduction)"

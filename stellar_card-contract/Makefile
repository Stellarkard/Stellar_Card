.PHONY: build test integration-test

# The [profile.release] section in Cargo.toml already sets opt-level=z,
# strip=symbols, lto=true, codegen-units=1 (issue #432). wasm-opt -Oz is an
# additional binaryen-level pass beyond what rustc's own codegen can do
# (further dead-code elimination, instruction-level size optimizations) —
# skipped gracefully if wasm-opt isn't installed rather than failing the build.
build:
	cargo build --target wasm32-unknown-unknown --release
	@if command -v wasm-opt >/dev/null 2>&1; then \
		wasm-opt -Oz \
			target/wasm32-unknown-unknown/release/stellar_card_receiver.wasm \
			-o target/wasm32-unknown-unknown/release/stellar_card_receiver.wasm; \
	else \
		echo "wasm-opt not found — skipping extra size optimization pass. Install binaryen for a smaller binary."; \
	fi

# The upgrade test imports the compiled contract WASM.
test:
	cargo build --target wasm32v1-none --release
	cargo test

integration-test:
	./scripts/test_local_network.sh

#!/usr/bin/env bash
# Smoke test: load pi-auto-handoff as a package in a real pi and complete one
# tiny prompt in JSON mode. This verifies the extension loads without errors
# (jiti transpiles it, the factory runs, events/commands register).
#
# Auto-handoff intentionally does NOT trigger in json/print mode, so this run
# exercises loading + a normal run only. The decision logic itself is covered
# by the unit tests.
#
# Requires a configured pi (model + auth). Skip with PI_AUTO_HANDOFF_SMOKE=0.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v pi >/dev/null 2>&1 || { echo "pi not on PATH — skipping smoke test"; exit 0; }

echo "pi: $(pi --version 2>/dev/null | head -1)"

# One tiny prompt through pi in JSON mode with this repo loaded as a package.
OUTPUT="$(mktemp)"
if ! pi --mode json --no-extensions --extension . --no-session -p "Reply with exactly: SMOKE-OK" >"$OUTPUT" 2>&1; then
	echo "--- pi output (failure) ---"
	cat "$OUTPUT"
	echo "---------------------------"
	echo "FAIL: pi exited non-zero while loading the pi-auto-handoff package" >&2
	exit 1
fi

if grep -q "SMOKE-OK" "$OUTPUT"; then
	echo "smoke test OK: extension loaded and session completed"
else
	echo "--- pi output (no SMOKE-OK found) ---"
	cat "$OUTPUT"
	echo "-------------------------------------"
	echo "FAIL: session completed but expected reply was missing" >&2
	exit 1
fi
rm -f "$OUTPUT"

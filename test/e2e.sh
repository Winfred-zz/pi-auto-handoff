#!/usr/bin/env bash
# End-to-end test of the session-switch machinery against a real pi:
#
#   1. write a fake handoff document containing a codeword
#   2. run pi in JSON mode with the package loaded, prompting
#      "/autohandoff-switch <doc>"  (the exact internal command the extension
#      dispatches after an automatic handoff)
#   3. the fresh session must continue from the document and echo the codeword
#   4. no extension errors may appear
#
# Requires a configured pi (model + auth). Skips when pi is absent.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v pi >/dev/null 2>&1 || { echo "pi not on PATH — skipping e2e test"; exit 0; }

CODEWORD="BANANA-PANCAKE-$(date +%s)"
DOC="$(mktemp /tmp/pi-ah-e2e-doc-XXXXXX.md)"
cat >"$DOC" <<EOF
# Handoff (pi-auto-handoff e2e test)

## Task
The previous session established that the secret codeword is "${CODEWORD}".
Reply with exactly: CONTINUED-<codeword>
EOF

OUTPUT="$(mktemp)"
trap 'rm -f "$DOC" "$OUTPUT"' EXIT

if ! timeout 180 pi --mode json --no-extensions --extension . --no-session -p "/autohandoff-switch $DOC" >"$OUTPUT" 2>&1; then
	echo "--- pi output (failure) ---"; cat "$OUTPUT"; echo "---------------------------"
	echo "FAIL: pi exited non-zero during /autohandoff-switch e2e" >&2
	exit 1
fi

if grep -q "Extension error" "$OUTPUT"; then
	echo "--- pi output (extension error) ---"; grep "Extension error" "$OUTPUT"; echo "-----------------------------------"
	echo "FAIL: extension error during /autohandoff-switch e2e" >&2
	exit 1
fi

if grep -q "CONTINUED-${CODEWORD}" "$OUTPUT"; then
	echo "e2e test OK: fresh session continued from the handoff document"
else
	echo "--- pi output (no CONTINUED-<codeword>) ---"; tail -20 "$OUTPUT"; echo "--------------------------------------------"
	echo "FAIL: fresh session did not continue from the handoff document" >&2
	exit 1
fi

#!/usr/bin/env bash
# Run the pi-auto-handoff test suite:
#   1. unit tests (node:test over the pure extension modules)
#   2. package structure checks (skill copy present, manifest valid)
#   3. optional smoke test: load the package in a real pi (test/smoke.sh)
set -euo pipefail
cd "$(dirname "$0")/.."

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
fail() { printf '\033[1;31mFAIL:\033[0m %s\n' "$*" >&2; exit 1; }

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
	fail "node >= 22 required for native TypeScript test execution (found $(node --version))"
fi

bold "== unit tests =="
node --test test/state.test.ts test/config.test.ts test/prompts.test.ts

bold "== package structure =="
[ -f "skills/handoff/SKILL.md" ] || fail "skills/handoff/SKILL.md is missing — the handoff skill must be bundled"
grep -q "name: handoff" skills/handoff/SKILL.md || fail "skills/handoff/SKILL.md does not look like the handoff skill"
node -e '
const pkg = require("./package.json");
if (!pkg.pi || !pkg.pi.extensions || !pkg.pi.skills) process.exit(1);
const fs = require("fs");
for (const ext of pkg.pi.extensions) if (!fs.existsSync(ext)) process.exit(2);
for (const skill of pkg.pi.skills) if (!fs.existsSync(skill)) process.exit(3);
' || fail "package.json pi manifest points at missing resources"
[ -f "extensions/auto-handoff/index.ts" ] || fail "extensions/auto-handoff/index.ts missing"
bold "   structure OK"

if [ "${PI_AUTO_HANDOFF_SMOKE:-1}" = "1" ] && command -v pi >/dev/null 2>&1; then
	bold "== smoke test (package loads in a real pi) =="
	bash test/smoke.sh
	bold "== e2e test (real session switch via /autohandoff-switch) =="
	bash test/e2e.sh
else
	bold "== smoke/e2e tests skipped (need pi on PATH and a configured model; PI_AUTO_HANDOFF_SMOKE=0 to skip) =="
fi

bold "All tests passed ✔"

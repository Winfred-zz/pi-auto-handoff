#!/usr/bin/env bash
# pi-auto-handoff installer
#
#   ./install.sh              install for the current user (~/.pi/agent/...)
#   ./install.sh --project    install into this project (.pi/...)
#   ./install.sh --package    register via `pi install .` (no file copying;
#                             pi loads the package straight from this repo)
#   ./install.sh --force      overwrite a diverging handoff skill
#
# What it installs:
#   - extensions/auto-handoff  -> <extensions-dir>/auto-handoff
#   - skills/handoff           -> <skills-dir>/handoff   (skipped if an
#     identical or user-modified handoff skill already exists, unless --force)
set -euo pipefail

cd "$(dirname "$0")"

BOLD=$'\033[1m'; GREEN=$'\033[1;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[1;31m'; NC=$'\033[0m'
say() { printf '%s\n' "$1"; }
die() { printf '%sFAIL:%s %s\n' "$RED" "$NC" "$1" >&2; exit 1; }

SCOPE="user"
FORCE=0
METHOD="copy"
for arg in "$@"; do
	case "$arg" in
		--project) SCOPE="project" ;;
		--force)   FORCE=1 ;;
		--package) METHOD="package" ;;
		-h|--help)
			sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
			exit 0 ;;
		*) die "unknown option: $arg (see --help)" ;;
	esac
done

# --- sanity checks -----------------------------------------------------------
[ -f "extensions/auto-handoff/index.ts" ] || die "extensions/auto-handoff/index.ts not found — run from a full checkout"
[ -f "skills/handoff/SKILL.md" ] || die "skills/handoff/SKILL.md not found — run from a full checkout"
command -v pi >/dev/null 2>&1 || die "pi is not on PATH — install pi first (https://github.com/earendil-works/pi)"

if [ "$METHOD" = "package" ]; then
	say "${BOLD}Registering this repo as a pi package...${NC}"
	pi install .
	say "${GREEN}✔ Done.${NC} pi loads the extension and skill straight from this directory."
	say "  Run ${BOLD}pi list${NC} to confirm, then start pi and try ${BOLD}/autohandoff${NC}."
	exit 0
fi

# --- resolve target directories ---------------------------------------------
if [ "$SCOPE" = "project" ]; then
	EXT_DIR=".pi/extensions/auto-handoff"
	SKILL_DIR=".pi/skills/handoff"
	SCOPE_LABEL="project (.pi/)"
else
	AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
	EXT_DIR="$AGENT_DIR/extensions/auto-handoff"
	SKILL_DIR="$AGENT_DIR/skills/handoff"
	SCOPE_LABEL="user ($AGENT_DIR)"
fi

backup_existing() {
	local target="$1"
	[ -e "$target" ] || return 0
	# Backups must live OUTSIDE the pi discovery tree: a .bak-* dir inside
	# extensions/ still contains index.ts and would be loaded as a second
	# copy of the extension (flag conflicts).
	local parent="$(dirname "$target")"
	local scope_root
	if [ "$SCOPE" = "project" ]; then scope_root=".pi/backups"; else scope_root="$AGENT_DIR/backups"; fi
	local backup="$scope_root/auto-handoff/$(date +%Y%m%d-%H%M%S)"
	mkdir -p "$(dirname "$backup")"
	mv "$target" "$backup"
	# Keep only the 5 most recent backups.
	ls -1d "$scope_root/auto-handoff"/* 2>/dev/null | sort | head -n -5 | while read -r old; do rm -rf "$old"; done
	say "${YELLOW}↷ backed up existing $(basename "$target") to $backup${NC}"
}

same_file() { # same_file <a> <b> -> 0 if directory contents identical
	diff -rq "$1" "$2" >/dev/null 2>&1
}

# --- install -----------------------------------------------------------------
say "${BOLD}Installing pi-auto-handoff (${SCOPE_LABEL})...${NC}"

mkdir -p "$(dirname "$EXT_DIR")"
backup_existing "$EXT_DIR"
mkdir -p "$EXT_DIR"
cp extensions/auto-handoff/index.ts \
	extensions/auto-handoff/config.ts \
	extensions/auto-handoff/state.ts \
	extensions/auto-handoff/prompts.ts \
	"$EXT_DIR/"
say "${GREEN}✔ extension${NC} -> $EXT_DIR"

if [ -d "$SKILL_DIR" ]; then
	if same_file "skills/handoff" "$SKILL_DIR"; then
		say "${GREEN}✔ skill${NC} -> $SKILL_DIR (already identical)"
	elif [ "$FORCE" = "1" ]; then
		backup_existing "$SKILL_DIR"
		mkdir -p "$SKILL_DIR"
		cp -r skills/handoff/. "$SKILL_DIR/"
		say "${GREEN}✔ skill${NC} -> $SKILL_DIR (forced overwrite)"
	else
		say "${YELLOW}↷ kept your existing handoff skill at $SKILL_DIR (differs from the bundled copy; use --force to overwrite)${NC}"
	fi
else
	mkdir -p "$SKILL_DIR"
	cp -r skills/handoff/. "$SKILL_DIR/"
	say "${GREEN}✔ skill${NC} -> $SKILL_DIR"
fi

# --- verify ------------------------------------------------------------------
say ""
say "${BOLD}Verify:${NC}"
# User scope: the extension now lives in the default discovery path — load pi
# plainly. Project scope: trust may not be granted yet, so pass the extension
# file explicitly (a directory would be loaded twice by -e and clash on flags).
if [ "$SCOPE" = "project" ]; then
	VERIFY=(pi --mode json --extension "$EXT_DIR/index.ts" --no-session -p "Reply with exactly: INSTALL-OK")
else
	VERIFY=(pi --mode json --no-session -p "Reply with exactly: INSTALL-OK")
fi
# Capture first, match with a bash builtin: any `producer | grep -q` under
# pipefail can die of SIGPIPE the moment grep matches, inverting the result.
VERIFY_OUT="$(${VERIFY[@]} 2>&1)" || true
if [[ "$VERIFY_OUT" == *"INSTALL-OK"* ]]; then
	say "${GREEN}✔ pi loads the extension cleanly${NC}"
else
	printf '%s\n' "$VERIFY_OUT" | tail -5 >&2
	die "pi failed to load the installed extension — check the output above. Backups are under $(dirname "$EXT_DIR")/../backups/auto-handoff/."
fi

cat <<EOF

${GREEN}✔ pi-auto-handoff installed.${NC}

Next steps:
  1. Start (or restart) pi.
  2. Run ${BOLD}/autohandoff${NC}            — status (default: hand off at 20% context remaining)
     ${BOLD}/autohandoff 35${NC}           — change the threshold for this session
     ${BOLD}/autohandoff test${NC}         — force a handoff right now
  3. Just work. When the context window runs low, the extension asks the agent
     to write a handoff document (using the handoff skill) and continues in a
     fresh session with: "Continue given this handoff: <path>".

Uninstall:  $(dirname "$0")/uninstall.sh$( [ "$SCOPE" = "project" ] && echo " --project" )
Docs:       $(dirname "$0")/README.md and $(dirname "$0")/docs/
EOF

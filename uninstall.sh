#!/usr/bin/env bash
# pi-auto-handoff uninstaller
#
#   ./uninstall.sh             remove the user-level install (~/.pi/agent/...)
#   ./uninstall.sh --project   remove the project install (.pi/...)
#   ./uninstall.sh --force     also remove a handoff skill that differs from
#                              the bundled copy (default: leave custom skills)
set -euo pipefail

cd "$(dirname "$0")"

GREEN=$'\033[1;32m'; YELLOW=$'\033[1;33m'; NC=$'\033[0m'

SCOPE="user"
FORCE=0
for arg in "$@"; do
	case "$arg" in
		--project) SCOPE="project" ;;
		--force)   FORCE=1 ;;
		-h|--help) sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) echo "unknown option: $arg" >&2; exit 1 ;;
	esac
done

if [ "$SCOPE" = "project" ]; then
	EXT_DIR=".pi/extensions/auto-handoff"
	SKILL_DIR=".pi/skills/handoff"
else
	AGENT_DIR="${PI_AGENT_DIR:-$HOME/.pi/agent}"
	EXT_DIR="$AGENT_DIR/extensions/auto-handoff"
	SKILL_DIR="$AGENT_DIR/skills/handoff"
fi

if [ -d "$EXT_DIR" ]; then
	rm -rf "$EXT_DIR"
	echo "${GREEN}✔ removed${NC} $EXT_DIR"
else
	echo "${YELLOW}↷ no extension at $EXT_DIR${NC}"
fi
# Timestamped backups made by install.sh live outside the discovery tree
# (<agent-dir>/backups/auto-handoff/<timestamp>/) and are never removed automatically.

if [ -d "$SKILL_DIR" ]; then
	if [ "$FORCE" = "1" ]; then
		rm -rf "$SKILL_DIR"
		echo "${GREEN}✔ removed${NC} $SKILL_DIR (--force)"
	elif diff -rq "skills/handoff" "$SKILL_DIR" >/dev/null 2>&1; then
		rm -rf "$SKILL_DIR"
		echo "${GREEN}✔ removed${NC} $SKILL_DIR (identical to the bundled copy)"
	else
		echo "${YELLOW}↷ kept $SKILL_DIR — it differs from the bundled copy (use --force to remove)${NC}"
	fi
else
	echo "${YELLOW}↷ no handoff skill at $SKILL_DIR${NC}"
fi

echo ""
echo "Done. Restart pi if it is running."

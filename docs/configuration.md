# Configuration

## Default behaviour

Auto-handoff triggers when **20% of the context window remains** (i.e. at 80%
used), after an agent run completes, in interactive (`tui`) or `rpc` mode.

## The `/autohandoff` command

| Invocation | Effect |
|---|---|
| `/autohandoff` or `/autohandoff status` | Show enabled state, threshold, current usage, state-machine phase. |
| `/autohandoff <percent>` | Set the threshold for **this session** (clamped to 1–90). Example: `/autohandoff 35`. |
| `/autohandoff on` / `/autohandoff off` | Enable/disable for **this session**. |
| `/autohandoff test` | Force a handoff right now, regardless of usage. Great for trying the flow end-to-end. |
| `/autohandoff reset` | Clear the state machine and this session's overrides. |

There is also an internal `/autohandoff-switch <path>` command. You normally
never call it — the extension dispatches it after the handoff document is
written — but it is a plain extension command, so you *can* use it to switch to
a fresh session from any handoff document:

```
/autohandoff-switch /tmp/pi-handoff-2026-10-21T14-05-11-123Z.md
```

## CLI flags

| Flag | Effect |
|---|---|
| `pi --auto-handoff-threshold 35` | Threshold for this invocation (highest precedence). |
| `pi --no-auto-handoff` | Disable auto-handoff for this invocation. |

## settings.json

Global: `~/.pi/agent/settings.json` · project: `.pi/settings.json` (requires project trust).
All keys are optional; unknown or malformed values are ignored.

```json
{
  "autoHandoff": {
    "enabled": true,
    "thresholdPercent": 20,
    "minMessages": 4,
    "modes": ["tui", "rpc"],
    "continuePrompt": "Continue given this handoff: {path}\n\nRead the handoff document at that path first, then continue the work from where it leaves off."
  }
}
```

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. |
| `thresholdPercent` | `20` | Hand off when this much of the window **remains**. Clamped to 1–90. |
| `minMessages` | `4` | Minimum branch entries before a handoff is allowed (loop guard). |
| `modes` | `["tui", "rpc"]` | Pi run modes in which triggering is allowed. |
| `continuePrompt` | see above | Template for the fresh session's first prompt. `{path}` is replaced with the handoff document path. |

## Precedence

```
CLI flags  >  /autohandoff session overrides  >  settings.json  >  defaults
```

## Where handoff documents go

Always the OS temp directory (`$TMPDIR` / `/tmp`), one timestamped file per
handoff, e.g. `/tmp/pi-handoff-2026-10-21T14-05-11-123Z.md`. Old documents are
never deleted by the extension; your system's tmp-cleaning handles that.

## Sessions

The previous session file is kept and linked as the parent of the fresh one, so
`pi --continue` / the session tree still shows the full history.

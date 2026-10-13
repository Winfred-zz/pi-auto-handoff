# pi-auto-handoff

A [Pi](https://github.com/earendil-works/pi) extension that automatically hands
your session off to a **fresh context** when the context window runs low —
default: at **40% remaining** (i.e. once 60% is used up).

Instead of letting the conversation degrade into compaction summaries, the
extension has the agent write a proper **handoff document** (using the
[handoff skill](skills/handoff/SKILL.md), bundled with this package), then
switches to a brand-new session and continues with:

> Continue given this handoff: /tmp/pi-handoff-2026-10-21T14-05-11-123Z.md

```
 you, working ──► context fills up ──► ⚡ 40% left
                                        │
                       agent writes handoff doc (handoff skill)
                                        │
                        fresh session ◄─┘  "Continue given this handoff: …"
```

## Features

- **Automatic** — one `agent_end` check per run; zero interaction needed.
- **Threshold configurable** — `/autohandoff <percent>`, CLI flag, or
  `settings.json`. Default `40` (% of the window remaining — i.e. hands off
  once 60% is used up).
- **Uses the real handoff skill** — the extension dispatches `/skill:handoff`
  through pi's own skill expansion, so your installed/customised skill wins;
  a bundled copy is inlined only as a fallback.
- **Deterministic switch** — the extension picks the document path up front and
  verifies it on disk; nothing is parsed out of model prose.
- **Safe by design** — never triggers mid-run, with queued user messages, in
  tiny sessions, in `json`/`print` mode, or twice at the same usage level
  (loop guard). If the handoff prompt gets lost before the model sees it
  (queued while idle, user submits first), it is dispatched once more before
  giving up. Old sessions are kept as the parent of the new one.
- **Observable** — every trigger/switch/abort is recorded in the session
  transcript and `/autohandoff status` shows the live state machine.

## Install

Requires [pi](https://github.com/earendil-works/pi) ≥ 1.0 and Node ≥ 22.

It's a **pi package** (`package.json` with a `pi` manifest), so one command is
all it takes:

```bash
pi install git:https://tangled.org/crooy.tngl.sh/pi-auto-handoff
```

(`pi install npm:pi-auto-handoff` and `pi install ./path` work too.)

### Manual install

Prefer not to register a package? Clone and run the installer script instead:

```bash
git clone https://tangled.org/crooy.tngl.sh/pi-auto-handoff
cd pi-auto-handoff
./install.sh                 # user install: ~/.pi/agent/extensions + skills
```

Other installer modes:

```bash
./install.sh --project       # into .pi/ of the current project
./install.sh --package       # register via `pi install .` (loads from this dir, no copying)
./install.sh --force         # also overwrite a diverging handoff skill
./uninstall.sh               # remove again (--project/--force supported)
```

The installer copies the extension and the handoff skill, keeps timestamped
backups of anything it replaces, and verifies that a real `pi` loads the
extension before declaring success.

## Usage

Usually: nothing. When ≤ 40% of the context window remains (i.e. once 60% is
used up), the extension kicks in:

1. The agent is asked to run the **handoff skill** and write the document to a
   known temp path (no new work, no confirmation prompts).
2. Once the document exists, pi switches to a **fresh session** (old session
   kept as parent) and immediately continues from the handoff.

### Commands

| Command | Effect |
|---|---|
| `/autohandoff` | Status: enabled, threshold, usage now, state-machine phase. |
| `/autohandoff 35` | Threshold 35% remaining, this session. |
| `/autohandoff on` / `off` | Enable/disable for this session. |
| `/autohandoff test` | Force a handoff right now — try the whole flow in one step. |
| `/autohandoff reset` | Reset state + session overrides. |
| `/handoff [focus]` | Hand off now: the agent writes a handoff document, then a fresh session continues from it. Optional arg = focus for the next session. |
| `/autohandoff-switch <path>` | Internal; also usable manually to start a fresh session from any handoff doc. |

### Flags & settings

```bash
pi --auto-handoff-threshold 35     # one invocation
pi --no-auto-handoff               # off for one invocation
```

```jsonc
// ~/.pi/agent/settings.json (or .pi/settings.json)
{
  "autoHandoff": {
    "enabled": true,
    "thresholdPercent": 40,
    "minMessages": 4,
    "modes": ["tui", "rpc"],
    "continuePrompt": "Continue given this handoff: {path}\n\nRead the handoff document at that path first, then continue the work from where it leaves off."
  }
}
```

Full details: [docs/configuration.md](docs/configuration.md).

## Repository layout

```
├── install.sh / uninstall.sh      installer & uninstaller
├── package.json                   pi package manifest (extensions + skills)
├── extensions/auto-handoff/
│   ├── index.ts                   ExtensionAPI wiring (events, commands, flags)
│   ├── config.ts                   pure: settings/flag resolution, clamping
│   ├── state.ts                    pure: trigger decision + loop guards
│   └── prompts.ts                  pure: skill args, fallback block, {path} template
├── skills/handoff/                the handoff skill, bundled (copied verbatim)
├── docs/
│   ├── how-it-works.md            lifecycle, guards, state machine, failure modes
│   ├── configuration.md           commands, flags, settings.json reference
│   └── testing.md                 unit + smoke + manual end-to-end recipes
└── test/
    ├── run-tests.sh               one entry point for the whole suite
    ├── state.test.ts               38 unit tests over the pure modules
    ├── config.test.ts
    ├── prompts.test.ts
    ├── smoke.sh                    real-pi load test (JSON mode)
    └── e2e.sh                      real session-switch: fresh session continues from a handoff doc
```

## Testing

```bash
bash test/run-tests.sh          # unit tests + structure checks + smoke test
```

The decision logic is dependency-free and covered by `node --test` unit tests;
`test/smoke.sh` loads the package in a real pi and completes a tiny prompt.
Manual end-to-end recipes (including the forced `/autohandoff test` flow) are
in [docs/testing.md](docs/testing.md).

## Compatibility & notes

- Built and tested against pi 1.0.x. Uses only documented extension APIs:
  `agent_end`, `sendUserMessage(expandPromptTemplates)`, `newSession` from a
  command context, `appendEntry`, `getContextUsage`, `registerCommand/Flag`.
- Auto-handoff is **disabled** in `json`/`print` mode by design; use `tui` or
  `rpc`.
- Pi's own auto-compaction is untouched: if it fires first, usage drops and no
  handoff happens.
- If the `handoff` skill name is already taken by your own skill, yours wins
  (the extension prefers pi's `/skill:handoff` expansion); the bundled copy is
  only a fallback.

## License

[MIT](LICENSE)

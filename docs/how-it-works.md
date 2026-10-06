# How it works

`pi-auto-handoff` is event-driven: it registers no timers and starts no
processes. Everything happens on pi lifecycle events.

## The trigger

After **every agent run** (`agent_end`), the extension asks pi for the current
context usage (`ctx.getContextUsage()`). When

```
100 - usedPercent <= thresholdPercent        (default threshold: 20)
```

and all guard conditions hold, a handoff starts.

Guard conditions (each prevents a wrong-time handoff):

| Guard | Why |
|---|---|
| Mode is `tui` or `rpc` | In `json`/`print` mode a session switch is pointless — the process exits after one prompt. |
| No queued user messages (`ctx.hasPendingMessages()`) | Don't hijack a conversation where the user already queued follow-ups. Re-checked after the next run. |
| Branch has ≥ `minMessages` entries (default 4) | Don't hand off a session that barely started. |
| Usage percent is known | Right after a compaction pi reports `null`; skip and wait. |
| Re-arm guard: `usedPercent` must be strictly above the level of the previous handoff | Loop protection: a fresh session must never instantly hand off again, even with an aggressive threshold. |
| Enabled (config: flag > `/autohandoff` > settings.json > default on) | Obvious. |

## The handoff run

The extension sends one user message via `pi.sendUserMessage(..., { expandPromptTemplates: true })`:

```
/skill:handoff AUTO-HANDOFF (triggered automatically ...): the context window is
nearly full (81.3% used, only 18.7% left, threshold 20).
Write the handoff document to exactly this path: /tmp/pi-handoff-2026-10-21T14-05-11-123Z.md
Do not ask for confirmation and do not start any new work. ...
```

Pi expands `/skill:handoff <args>` natively into a `<skill name="handoff" ...>`
block containing the **handoff skill's own instructions** — the same thing the
user gets from typing `/skill:handoff`. So the document is written by the skill
you know: temp dir, "suggested skills" section, references instead of
duplicated artifacts, secrets redacted.

If no installed handoff skill can be found (`~/.pi/agent/skills`,
`~/.agents/skills`, project `.pi/skills`/`.agents/skills`, or the copy bundled
with this package), the extension inlines the bundled skill body in the same
`<skill>` block format, so the flow works out of the box.

Because the target path is chosen by the extension, the next step is
deterministic — no parsing of the agent's prose required.

## The switch

When the handoff run's `agent_end` fires, the extension checks that the
document now exists on disk. If it does, it dispatches its internal
`/autohandoff-switch <path>` command (again via `expandPromptTemplates: true`).
Command context is the only context in which pi allows session control, and
the command handler then:

1. `await ctx.waitForIdle()` — belt and braces.
2. `ctx.newSession({ parentSession: <current session file>, withSession })` —
   the old session is kept on disk as the parent; nothing is deleted.
3. Inside `withSession` (the fresh, empty session):
   `await freshCtx.sendUserMessage("Continue given this handoff: <path> ...")`
   — which starts the first run of the new session.

Failure handling:

| Situation | Behaviour |
|---|---|
| Handoff run aborted by the user (Esc) | State resets, error notification, no switch. Re-armed at the current usage level. |
| Handoff run errored | Same as abort. |
| Document missing after the run | Same as abort, with the path in the message. |
| `newSession` cancelled (user declined) | Stay in the current session, state reset. |
| Session switched | State resets via `session_start` (reason `new`) in the fresh session. |

## State machine

```
            usage <= threshold, guards pass
   idle ────────────────────────────────────────► handoff
    ▲     send /skill:handoff (doc path pinned)    │
    │                                              │ agent_end:
    │            abort / cancelled                 │ doc exists?
    │◄─────────────────────────────────────────────┤
    │                                              ▼
    │                                     request-switch
    │                                      (dispatch /autohandoff-switch)
    │                                              │
    │            user cancels newSession           │ newSession ok
    └──────────────────────────────────────────────┴──────────► fresh session
      (re-armed at trigger level)                             (state resets)
```

Every transition is also recorded in the session transcript via
`pi.appendEntry("auto-handoff", ...)` (visible in exports, not sent to the
model), which makes post-hoc debugging of "what did the extension do" easy.

## What it deliberately does not do

- **No compaction.** Handoff replaces *compaction as the continuation story*,
  but pi's own auto-compaction stays untouched. If compaction fires first,
  usage drops and no handoff happens.
- **No document parsing.** The extension picks the path; the agent writes it;
  the extension verifies existence. Nothing else is assumed about content.
- **No context trimming.** The fresh session is truly fresh; the handoff
  document is the only bridge.

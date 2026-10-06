# Testing

Three layers, cheapest first.

## 1. Unit tests (no pi required)

The decision logic lives in dependency-free modules
(`extensions/auto-handoff/{config,state,prompts}.ts`) so it can be tested with
plain `node --test` — no pi, no model, no network:

```bash
bash test/run-tests.sh          # everything below except the smoke test
node --test test/state.test.ts  # just the state machine
```

Covered, among others:

- trigger exactly at/above the threshold (default: 80% used ⇒ 20% remaining),
- no trigger when usage is unknown, disabled, wrong mode, queued messages, tiny session,
- handoff phase: switch requested iff the document exists; abort on
  aborted/errored runs and on missing documents (with re-arm),
- loop guard: no re-trigger until usage rises past the previous trigger level,
- config precedence (flags > session overrides > settings > defaults) and
  clamping (1–90),
- prompt building: pinned temp path, `{path}` substitution, native-`<skill>`
  fallback block format.

## 2. Smoke + e2e tests (real pi)

`test/smoke.sh` loads this repo as a package in a real pi and completes a
one-line prompt in JSON mode. Verifies jiti transpiles the extension, the
factory runs, and all events/commands register without errors.

`test/e2e.sh` goes further: it writes a fake handoff document containing a
codeword, runs the exact internal command the extension dispatches after an
automatic handoff (`/autohandoff-switch <doc>`) in a real pi, and asserts that
the **fresh session** continues from the document (echoes the codeword) with no
extension errors. This exercises `waitForIdle` → `newSession(parentSession)` →
`withSession` → `sendUserMessage` for real.

Both require a configured pi (model + auth); they auto-skip when `pi` is
absent:

```bash
bash test/smoke.sh
bash test/e2e.sh
PI_AUTO_HANDOFF_SMOKE=0 bash test/run-tests.sh   # run the suite without them
```

> **Developing while installed?** If the extension is already installed under
> `~/.pi/agent/extensions/auto-handoff`, running the repo copy via `-e .`
> loads it twice and clashes on the registered flags. The test scripts pass
> `--no-extensions` for exactly this reason; use `pi -ne -e .` for manual dev
> runs.

Auto-handoff intentionally never triggers in JSON mode (see
[how-it-works.md](how-it-works.md)), so the smoke test exercises loading plus a
normal run — not the threshold crossing itself.

## 3. Manual end-to-end test (real handoff, interactive)

The whole point is interactive, so verify it interactively:

```bash
bash test/run-tests.sh     # make sure the suite is green first
pi                          # with the extension installed (see README)
```

Then, inside pi:

1. `/autohandoff` — note the current usage and threshold.
2. `/autohandoff test` — forces the flow immediately:
   - the agent should run the handoff skill and write
     `/tmp/pi-handoff-<timestamp>.md`,
   - pi should switch to a fresh session and immediately prompt
     *"Continue given this handoff: /tmp/..."*,
   - the new session reads the document and continues.
3. Check the old session still exists in the session tree (nothing is deleted).
4. `/autohandoff reset` and `/autohandoff 90` then send one message — the
   handoff should trigger again at the (now tiny) threshold, but **only once**;
   the fresh session must not loop (re-arm guard).

Real-threshold test without waiting for 80% usage: `/autohandoff 95` is clamped
to 90, i.e. trigger at 10% used — reachable after one or two messages in a
fresh session with `minMessages: 4`.

### Verifying the skill wiring

```
/skill:handoff test run — write the doc to /tmp/manual-check.md
```

This is exactly the message the extension sends (minus the args). If that works
interactively, the auto path uses the same machinery.

/**
 * pi-auto-handoff — automatic context handoff for Pi.
 *
 * Watches the context window after every agent run. When only
 * `thresholdPercent` (default 40%) of the window remains, it:
 *
 *   1. Sends the agent the `/skill:handoff` skill (the packaged handoff skill,
 *      inlined verbatim if no installed copy is found) with instructions to
 *      write a handoff document to a known temp path.
 *   2. Once the agent finishes and the document exists, dispatches an internal
 *      command that starts a fresh session (keeping the old one as parent)
 *      and immediately prompts it: "Continue given this handoff: <path>".
 *
 * The heavy lifting is in pure sibling modules (config.ts, state.ts,
 * prompts.ts); this file only wires them to the ExtensionAPI.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
	DEFAULT_THRESHOLD_PERCENT,
	resolveConfig,
	type SessionOverrides,
} from "./config.ts";
import {
	renderContinuePrompt,
	renderHandoffArgs,
	renderManualHandoffArgs,
	buildInlineSkillMessage,
	BUNDLED_HANDOFF_SKILL_BODY,
} from "./prompts.ts";
import {
	cancelSwitch,
	completeSwitch,
	decideAfterAgentEnd,
	initialState,
	type AutoHandoffState,
} from "./state.ts";

const SKILL_NAME = "handoff";

/** Candidate locations of an installed handoff skill, in priority order. */
function skillCandidates(cwd: string): string[] {
	const candidates: string[] = [];
	const home = os.homedir();
	const agentDir = process.env.PI_AGENT_DIR ?? path.join(home, ".pi", "agent");
	candidates.push(path.join(agentDir, "skills", SKILL_NAME, "SKILL.md"));
	candidates.push(path.join(home, ".agents", "skills", SKILL_NAME, "SKILL.md"));
	candidates.push(path.join(cwd, ".pi", "skills", SKILL_NAME, "SKILL.md"));
	candidates.push(path.join(cwd, ".agents", "skills", SKILL_NAME, "SKILL.md"));
	// Bundled copy shipped with this package (repo / installed package layout).
	const moduleDir = currentModuleDir();
	if (moduleDir) candidates.push(path.join(moduleDir, "..", "..", "skills", SKILL_NAME, "SKILL.md"));
	return candidates;
}

function currentModuleDir(): string | undefined {
	try {
		return path.dirname(fileURLToPath(import.meta.url));
	} catch {
		return undefined;
	}
}

/** Find an installed handoff skill; null when only the bundled fallback exists. */
function findHandoffSkill(cwd: string): { location: string; body: string } | null {
	for (const candidate of skillCandidates(cwd)) {
		try {
			if (fs.existsSync(candidate)) {
				const raw = fs.readFileSync(candidate, "utf-8");
				// Strip YAML frontmatter, mirroring pi's own /skill: expansion.
				const body = raw.replace(/^---\n[\s\S]*?\n---\n*/, "").trim();
				if (body) return { location: candidate, body };
			}
		} catch {
			// unreadable candidate: try the next one
		}
	}
	return null;
}

function fileExists(p: string | undefined): boolean {
	if (!p) return false;
	try {
		return fs.existsSync(p) && fs.statSync(p).isFile();
	} catch {
		return false;
	}
}

function makeHandoffPath(): string {
	const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
	return path.join(os.tmpdir(), `pi-handoff-${stamp}.md`);
}

function settingsRecord(pi: ExtensionAPI): Record<string, unknown> | undefined {
	try {
		return pi.getSettings() as unknown as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function lastAssistantStopReason(messages: readonly unknown[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i] as { role?: string; stopReason?: string } | undefined;
		if (message && message.role === "assistant") return message.stopReason;
	}
	return undefined;
}

export default function (pi: ExtensionAPI) {
	let state: AutoHandoffState = initialState();
	const sessionOverrides: SessionOverrides = { threshold: null, enabled: null };
	let handoffCount = 0;

	const config = () =>
		resolveConfig({
			settings: settingsRecord(pi),
			flags: {
				threshold: pi.getFlag("auto-handoff-threshold"),
				disable: pi.getFlag("no-auto-handoff"),
			},
			session: sessionOverrides,
		});

	const notify = (ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info") => {
		if (ctx.hasUI) ctx.ui.notify(`auto-handoff: ${message}`, level);
	};

	/**
	 * Wrap handoff-skill args for the agent. Prefers pi's native /skill:handoff
	 * expansion (picks up the user's installed/customised skill); falls back to
	 * the bundled skill body.
	 */
	const wrapSkillArgs = (ctx: ExtensionContext, args: string) => {
		const installed = findHandoffSkill(ctx.cwd);
		return installed
			? `/skill:${SKILL_NAME} ${args}`
			: buildInlineSkillMessage(SKILL_NAME, "(bundled with pi-auto-handoff)", BUNDLED_HANDOFF_SKILL_BODY, args);
	};

	/** Message for an automatic (low-context) handoff run. */
	const buildAutoHandoffMessage = (
		ctx: ExtensionContext,
		thresholdPercent: number,
		usedPercent: number,
		handoffPath: string,
	) =>
		wrapSkillArgs(
			ctx,
			renderHandoffArgs({
				usedPercent,
				remainingPercent: 100 - usedPercent,
				thresholdPercent,
				path: handoffPath,
			}),
		);

	/** Message for a manual handoff run started by /handoff. */
	const buildManualHandoffMessage = (ctx: ExtensionContext, handoffPath: string, focus?: string) =>
		wrapSkillArgs(ctx, renderManualHandoffArgs({ path: handoffPath, focus }));

	/**
	 * Bookkeep the start of a handoff run: advance the state machine to
	 * "handoff" and record the trigger in the transcript. Returns the path the
	 * document must be written to; the caller builds and sends the message.
	 */
	const startHandoffRun = (
		ctx: ExtensionContext,
		opts: { usedPercent: number | null; event: string; path?: string },
	): { path: string; usedPercent: number } => {
		const cfg = config();
		const used = opts.usedPercent ?? 100 - cfg.thresholdPercent;
		const handoffPath = opts.path ?? makeHandoffPath();
		handoffCount += 1;

		state.phase = "handoff";
		state.handoffPath = handoffPath;
		state.triggerPercent = used;
		state.switchRequested = false;

		pi.appendEntry("auto-handoff", {
			event: opts.event,
			usedPercent: used,
			thresholdPercent: cfg.thresholdPercent,
			handoffPath,
			handoffCount,
			mode: ctx.mode,
		});

		return { path: handoffPath, usedPercent: used };
	};

	pi.registerFlag("auto-handoff-threshold", {
		description: "pi-auto-handoff: trigger when this % of the context window remains (default 40)",
		type: "string",
	});
	pi.registerFlag("no-auto-handoff", {
		description: "pi-auto-handoff: disable automatic handoff for this invocation",
		type: "boolean",
	});

	pi.on("session_start", () => {
		state = initialState();
	});

	pi.on("session_shutdown", () => {
		state = initialState();
	});

	pi.on("agent_end", async (event, ctx) => {
		const cfg = config();
		const decision = decideAfterAgentEnd({
			state,
			usage: ctx.getContextUsage(),
			mode: ctx.mode,
			config: cfg,
			pendingMessages: ctx.hasPendingMessages(),
			messageCount: ctx.sessionManager.getBranch().length,
			lastStopReason: lastAssistantStopReason(event.messages),
			handoffFileExists: fileExists(state.handoffPath),
			makePath: makeHandoffPath,
		});

		switch (decision.action) {
			case "start-handoff": {
				// decideAfterAgentEnd already advanced the state; record the
				// trigger and send the skill message.
				startHandoffRun(ctx, { usedPercent: decision.usedPercent, event: "trigger", path: decision.path });
				notify(
					ctx,
					`context at ${decision.usedPercent.toFixed(1)}% used (≤ ${cfg.thresholdPercent}% remaining) — handing off to a fresh session`,
					"warning",
				);
				pi.sendUserMessage(buildAutoHandoffMessage(ctx, cfg.thresholdPercent, decision.usedPercent, decision.path), {
					expandPromptTemplates: true,
				});
				break;
			}
			case "request-switch":
				pi.sendUserMessage(`/autohandoff-switch ${decision.path}`, { expandPromptTemplates: true });
				break;
			case "abort-handoff":
				pi.appendEntry("auto-handoff", { event: "abort", reason: decision.reason });
				notify(ctx, `cancelled (${decision.reason})`, "error");
				break;
			case "none":
				break;
		}
	});

	pi.registerCommand("autohandoff", {
		description: "Show or change auto-handoff settings (usage: /autohandoff [on|off|status|test|reset|<percent>])",
		handler: async (args, ctx) => {
			const sub = args.trim();
			const cfg = config();
			const usage = ctx.getContextUsage();

			if (!sub || sub === "status") {
				const used = usage?.percent;
				const lines = [
					`enabled: ${cfg.enabled}`,
					`threshold: hands off when ≤ ${cfg.thresholdPercent}% of the context window remains (default ${DEFAULT_THRESHOLD_PERCENT}%)`,
					`usage now: ${used === null || used === undefined ? "unknown" : `${used.toFixed(1)}% used, ${(100 - used).toFixed(1)}% remaining`}` +
						(usage ? ` of ${usage.contextWindow.toLocaleString()} tokens` : ""),
					`state: ${state.phase}${state.handoffPath ? ` (${state.handoffPath})` : ""}`,
					`modes: ${cfg.modes.join(", ")}`,
				];
				if (ctx.hasUI) ctx.ui.notify(`auto-handoff —\n  ${lines.join("\n  ")}`, "info");
				return;
			}

			switch (sub) {
				case "on":
					sessionOverrides.enabled = true;
					notify(ctx, `enabled (threshold ${config().thresholdPercent}%)`);
					break;
				case "off":
					sessionOverrides.enabled = false;
					notify(ctx, "disabled for this session");
					break;
				case "reset":
					state = initialState();
					sessionOverrides.threshold = null;
					sessionOverrides.enabled = null;
					notify(ctx, "state and session overrides reset");
					break;
				case "test": {
					if (state.phase !== "idle") {
						notify(ctx, `cannot force: handoff already ${state.phase}`, "warning");
						return;
					}
					const run = startHandoffRun(ctx, { usedPercent: usage?.percent ?? null, event: "forced-trigger" });
					notify(ctx, `manual test — asking the agent to write a handoff document to ${run.path}`, "warning");
					pi.sendUserMessage(buildAutoHandoffMessage(ctx, cfg.thresholdPercent, run.usedPercent, run.path), {
						expandPromptTemplates: true,
					});
					break;
				}
				default: {
					const value = Number(sub);
					if (!Number.isFinite(value)) {
						notify(ctx, `unknown argument "${sub}" — use on | off | status | test | reset | <percent>`, "error");
						return;
					}
					sessionOverrides.threshold = value;
					notify(ctx, `threshold set to ${config().thresholdPercent}% remaining for this session`);
				}
			}
		},
	});

	// Manual handoff: the user asks for the whole flow right now. The agent
	// writes the handoff document; the usual agent_end machinery then dispatches
	// /autohandoff-switch below, which starts a fresh session (cleared context)
	// and immediately continues from the document. Works even when the automatic
	// trigger is disabled — this is explicit user intent.
	pi.registerCommand("handoff", {
		description:
			"Hand off now: write a handoff document, then continue in a fresh session from it (optional arg: focus for the next session)",
		handler: async (args, ctx) => {
			if (state.phase !== "idle") {
				notify(ctx, `cannot hand off: handoff already ${state.phase}`, "warning");
				return;
			}
			const focus = args.trim();
			const run = startHandoffRun(ctx, {
				usedPercent: ctx.getContextUsage()?.percent ?? null,
				event: "manual-trigger",
			});
			notify(ctx, `handoff requested — asking the agent to write a handoff document to ${run.path}`, "warning");
			pi.sendUserMessage(buildManualHandoffMessage(ctx, run.path, focus || undefined), {
				expandPromptTemplates: true,
			});
		},
	});

	// Internal command: dispatched by the extension itself once the handoff
	// document exists. Starts a fresh session (old one kept as parent) and
	// immediately continues from the handoff document.
	pi.registerCommand("autohandoff-switch", {
		description: "Internal: start a fresh session continuing from a handoff document",
		handler: async (args, ctx) => {
			const handoffPath = args.trim();
			if (!handoffPath) {
				notify(ctx, "switch aborted: no handoff path given", "error");
				cancelSwitch(state);
				return;
			}
			if (!fileExists(handoffPath)) {
				notify(ctx, `switch aborted: ${handoffPath} does not exist`, "error");
				cancelSwitch(state);
				return;
			}

			await ctx.waitForIdle();

			const currentSessionFile = ctx.sessionManager.getSessionFile();
			const continuePrompt = renderContinuePrompt(config().continuePrompt, handoffPath);

			// Record the handoff in the OLD session before it is replaced.
			pi.appendEntry("auto-handoff", { event: "handing-off", handoffPath, parentSession: currentSessionFile });

			// After newSession() the captured command ctx is stale: do all
			// session-bound work with the freshCtx passed to withSession, and
			// only touch plain data (state) afterwards.
			const result = await ctx.newSession({
				parentSession: currentSessionFile,
				withSession: async (freshCtx) => {
					if (freshCtx.hasUI) {
						freshCtx.ui.notify(`auto-handoff: fresh session started — continuing from ${handoffPath}`, "info");
					}
					await freshCtx.sendUserMessage(continuePrompt);
				},
			});

			if (result.cancelled) {
				cancelSwitch(state);
				notify(ctx, "new session cancelled — staying in this session", "warning");
			} else {
				completeSwitch(state);
			}
		},
	});
}

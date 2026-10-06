/**
 * State machine for pi-auto-handoff.
 *
 * Pure module: no pi imports, no I/O. `decideAfterAgentEnd()` gets the world as
 * plain data and returns a decision; the extension layer executes it. This keeps
 * the tricky logic fully unit-testable without a running pi.
 *
 * Phases:
 *   idle    - normal operation, watching context usage
 *   handoff - the agent is writing the handoff document (handoff skill run)
 *   switch  - document verified on disk, session switch has been requested
 */

export type Phase = "idle" | "handoff" | "switch";

export interface AutoHandoffState {
	phase: Phase;
	/** Where the in-flight handoff document must be written. */
	handoffPath?: string;
	/** Context used (%) at the moment the handoff was triggered. */
	triggerPercent?: number;
	/**
	 * Loop guard: after a handoff, do not trigger again until usedPercent rises
	 * strictly above this value. -Infinity means armed.
	 */
	rearmPercent: number;
	/** Set while a switch command is in flight, to ignore further agent_end events. */
	switchRequested?: boolean;
}

export function initialState(): AutoHandoffState {
	return { phase: "idle", rearmPercent: -Infinity };
}

/** Shape-compatible subset of pi's ContextUsage (kept structural for tests). */
export interface UsageSnapshot {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
}

export type HandoffAction =
	| { action: "none" }
	/** Ask the agent to run the handoff skill and write the doc to `path`. */
	| { action: "start-handoff"; path: string; usedPercent: number; remainingPercent: number }
	/** Handoff doc verified; dispatch the session-switch command. */
	| { action: "request-switch"; path: string }
	/** Give up on an in-flight handoff; state returns to idle (re-armed at `usedPercent`). */
	| { action: "abort-handoff"; reason: string };

export interface DecideInput {
	state: AutoHandoffState;
	usage: UsageSnapshot | undefined;
	mode: string;
	config: {
		enabled: boolean;
		thresholdPercent: number;
		minMessages: number;
		modes: readonly string[];
	};
	pendingMessages: boolean;
	/** Number of entries on the current branch. */
	messageCount: number;
	/** stopReason of the final assistant message of the run that just ended, if any. */
	lastStopReason?: string;
	/** Whether the expected handoff document exists on disk (phase "handoff" only). */
	handoffFileExists: boolean;
	/** Impure path factory, invoked only when a new handoff actually starts. */
	makePath: () => string;
}

const FAILED_STOP_REASONS = new Set(["aborted", "error"]);

/**
 * Decide what to do after an agent run ended. Returns "none" in every case
 * where doing nothing is correct; the extension layer only executes actions.
 */
export function decideAfterAgentEnd(input: DecideInput): HandoffAction {
	const { state, config } = input;

	if (state.switchRequested) return { action: "none" };
	if (!config.modes.includes(input.mode)) return { action: "none" };

	if (state.phase === "handoff") {
		// The run that was writing the handoff document just ended.
		if (input.lastStopReason && FAILED_STOP_REASONS.has(input.lastStopReason)) {
			return fail(input, `handoff run ended with stopReason "${input.lastStopReason}"`);
		}
		const path = state.handoffPath ?? "";
		if (!path || !input.handoffFileExists) {
			return fail(input, `handoff document not found at ${path || "<no path>"}`);
		}
		state.phase = "switch";
		state.switchRequested = true;
		return { action: "request-switch", path };
	}

	if (state.phase !== "idle") return { action: "none" };
	if (!config.enabled) return { action: "none" };

	const usage = input.usage;
	if (!usage || usage.percent === null || usage.percent === undefined) return { action: "none" };
	const usedPercent = usage.percent;
	if (usedPercent <= state.rearmPercent) return { action: "none" };
	if (input.pendingMessages) return { action: "none" };
	if (input.messageCount < config.minMessages) return { action: "none" };
	if (100 - usedPercent > config.thresholdPercent) return { action: "none" };

	// Trigger: hand the conversation over.
	const path = input.makePath();
	state.phase = "handoff";
	state.handoffPath = path;
	state.triggerPercent = usedPercent;
	return {
		action: "start-handoff",
		path,
		usedPercent,
		remainingPercent: 100 - usedPercent,
	};
}

/** Reset an in-flight handoff back to idle and re-arm the trigger at the current level. */
function fail(input: DecideInput, reason: string): HandoffAction {
	const usedPercent = input.usage?.percent ?? input.state.triggerPercent;
	input.state.phase = "idle";
	input.state.handoffPath = undefined;
	if (typeof usedPercent === "number") input.state.rearmPercent = usedPercent;
	return { action: "abort-handoff", reason };
}

/**
 * Mark the state as handed off (fresh session started) or back to idle after a
 * cancelled switch. Used by the switch command handler.
 */
export function completeSwitch(state: AutoHandoffState): void {
	state.phase = "idle";
	state.handoffPath = undefined;
	state.switchRequested = false;
	if (typeof state.triggerPercent === "number") state.rearmPercent = state.triggerPercent;
}

export function cancelSwitch(state: AutoHandoffState): void {
	state.phase = "idle";
	state.handoffPath = undefined;
	state.switchRequested = false;
	if (typeof state.triggerPercent === "number") state.rearmPercent = state.triggerPercent;
}

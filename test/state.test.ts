import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	cancelSwitch,
	completeSwitch,
	decideAfterAgentEnd,
	initialState,
	type AutoHandoffState,
	type DecideInput,
	type UsageSnapshot,
} from "../extensions/auto-handoff/state.ts";
import { DEFAULT_CONFIG } from "../extensions/auto-handoff/config.ts";

const usage = (percent: number): UsageSnapshot => ({
	tokens: Math.round((percent / 100) * 200_000),
	contextWindow: 200_000,
	percent,
});

let pathCounter = 0;
const makePath = () => `/tmp/fake-handoff-${++pathCounter}.md`;

const baseInput = (overrides: Partial<DecideInput> & { state?: AutoHandoffState }): DecideInput => ({
	state: overrides.state ?? initialState(),
	usage: usage(50),
	mode: "tui",
	config: {
		enabled: true,
		thresholdPercent: DEFAULT_CONFIG.thresholdPercent,
		minMessages: DEFAULT_CONFIG.minMessages,
		modes: [...DEFAULT_CONFIG.modes],
	},
	pendingMessages: false,
	messageCount: 20,
	handoffFileExists: false,
	makePath,
	...overrides,
});

describe("decideAfterAgentEnd — idle phase", () => {
	it("does nothing while plenty of context remains", () => {
		const state = initialState();
		const action = decideAfterAgentEnd(baseInput({ state, usage: usage(50) }));
		assert.equal(action.action, "none");
		assert.equal(state.phase, "idle");
	});

	it("triggers exactly at the threshold (40% remaining => used 60)", () => {
		const state = initialState();
		const action = decideAfterAgentEnd(baseInput({ state, usage: usage(60) }));
		assert.equal(action.action, "start-handoff");
		assert.equal(action.action === "start-handoff" && action.remainingPercent, 40);
		assert.equal(state.phase, "handoff");
		assert.ok(state.handoffPath?.startsWith("/tmp/fake-handoff-"));
	});

	it("triggers past the threshold (61% used)", () => {
		const action = decideAfterAgentEnd(baseInput({ usage: usage(61) }));
		assert.equal(action.action, "start-handoff");
	});

	it("does nothing when usage percent is unknown (null right after compaction)", () => {
		const action = decideAfterAgentEnd(
			baseInput({ usage: { tokens: null, contextWindow: 200_000, percent: null } }),
		);
		assert.equal(action.action, "none");
	});

	it("does nothing when there is no usage snapshot at all", () => {
		const action = decideAfterAgentEnd(baseInput({ usage: undefined }));
		assert.equal(action.action, "none");
	});

	it("does nothing when the model is disabled", () => {
		const action = decideAfterAgentEnd(
			baseInput({ config: { enabled: false, thresholdPercent: 20, minMessages: 4, modes: ["tui", "rpc"] } }),
		);
		assert.equal(action.action, "none");
	});

	it("does nothing in modes outside config.modes (e.g. print/json)", () => {
		for (const mode of ["print", "json"]) {
			const action = decideAfterAgentEnd(baseInput({ mode, usage: usage(99) }));
			assert.equal(action.action, "none", `mode ${mode} must not trigger`);
		}
	});

	it("waits when user messages are queued (pendingMessages)", () => {
		const action = decideAfterAgentEnd(baseInput({ pendingMessages: true, usage: usage(95) }));
		assert.equal(action.action, "none");
	});

	it("refuses to hand off tiny sessions (below minMessages)", () => {
		const action = decideAfterAgentEnd(baseInput({ messageCount: 2, usage: usage(95) }));
		assert.equal(action.action, "none");
	});
});

describe("decideAfterAgentEnd — handoff phase", () => {
	it("requests a session switch once the handoff document exists", () => {
		const state = initialState();
		state.phase = "handoff";
		state.handoffPath = "/tmp/handoff-doc.md";
		const action = decideAfterAgentEnd(baseInput({ state, handoffFileExists: true }));
		assert.equal(action.action, "request-switch");
		assert.ok(action.action === "request-switch" && action.path === "/tmp/handoff-doc.md");
		assert.equal(state.phase, "switch");
		assert.equal(state.switchRequested, true);
	});

	it("aborts when the agent finished but never wrote the document", () => {
		const state = initialState();
		state.phase = "handoff";
		state.handoffPath = "/tmp/missing.md";
		const action = decideAfterAgentEnd(baseInput({ state, handoffFileExists: false, usage: usage(82) }));
		assert.equal(action.action, "abort-handoff");
		assert.match(action.action === "abort-handoff" ? action.reason : "", /not found/);
		assert.equal(state.phase, "idle");
		// Re-armed at the current level so it does not retry in a tight loop.
		assert.equal(state.rearmPercent, 82);
	});

	it("aborts when the handoff run was aborted by the user", () => {
		const state = initialState();
		state.phase = "handoff";
		state.handoffPath = "/tmp/x.md";
		const action = decideAfterAgentEnd(
			baseInput({ state, handoffFileExists: true, lastStopReason: "aborted" }),
		);
		assert.equal(action.action, "abort-handoff");
		assert.match(action.action === "abort-handoff" ? action.reason : "", /aborted/);
	});

	it("aborts when the handoff run errored", () => {
		const state = initialState();
		state.phase = "handoff";
		state.handoffPath = "/tmp/x.md";
		const action = decideAfterAgentEnd(baseInput({ state, handoffFileExists: true, lastStopReason: "error" }));
		assert.equal(action.action, "abort-handoff");
	});
});

describe("loop guards", () => {
	it("re-arms only above the level that triggered the previous handoff", () => {
		const state = initialState();
		// First handoff triggered at 80% used.
		decideAfterAgentEnd(baseInput({ state, usage: usage(80) }));
		state.phase = "idle";
		state.handoffPath = undefined;
		state.rearmPercent = 80;

		// Fresh session at 5% used: even a "tiny session" aside, below rearm level -> none.
		assert.equal(decideAfterAgentEnd(baseInput({ state, usage: usage(75), messageCount: 50 })).action, "none");
		// Strictly above the rearm level -> can trigger again.
		const action = decideAfterAgentEnd(baseInput({ state, usage: usage(80.5), messageCount: 50 }));
		assert.equal(action.action, "start-handoff");
	});

	it("ignores everything while a switch is in flight", () => {
		const state = initialState();
		state.switchRequested = true;
		const action = decideAfterAgentEnd(baseInput({ state, usage: usage(99) }));
		assert.equal(action.action, "none");
	});
});

describe("switch completion", () => {
	it("completeSwitch re-arms at the trigger level and resets phase", () => {
		const state = initialState();
		state.phase = "switch";
		state.handoffPath = "/tmp/x.md";
		state.switchRequested = true;
		state.triggerPercent = 80;
		completeSwitch(state);
		assert.equal(state.phase, "idle");
		assert.equal(state.handoffPath, undefined);
		assert.equal(state.switchRequested, false);
		assert.equal(state.rearmPercent, 80);
	});

	it("cancelSwitch also clears an in-flight switch", () => {
		const state = initialState();
		state.phase = "switch";
		state.switchRequested = true;
		state.triggerPercent = 81;
		cancelSwitch(state);
		assert.equal(state.phase, "idle");
		assert.equal(state.rearmPercent, 81);
	});
});

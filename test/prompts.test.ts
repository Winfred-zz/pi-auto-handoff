import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	buildInlineSkillMessage,
	renderContinuePrompt,
	renderHandoffArgs,
	renderManualHandoffArgs,
	BUNDLED_HANDOFF_SKILL_BODY,
} from "../extensions/auto-handoff/prompts.ts";
import { DEFAULT_CONTINUE_PROMPT } from "../extensions/auto-handoff/config.ts";

describe("renderHandoffArgs", () => {
	const args = renderHandoffArgs({
		usedPercent: 82.34,
		remainingPercent: 17.66,
		thresholdPercent: 20,
		path: "/tmp/pi-handoff-2026.md",
	});

	it("states the trigger percentages and threshold", () => {
		assert.match(args, /82\.3% used/);
		assert.match(args, /17\.7% left/);
		assert.match(args, /threshold 20%/);
		assert.match(args, /threshold is reached/);
	});

	it("pins the exact target path", () => {
		assert.match(args, /exactly this path: \/tmp\/pi-handoff-2026\.md/);
	});

	it("tells the agent not to start new work and not to ask", () => {
		assert.match(args, /Do not ask for confirmation/);
		assert.match(args, /do not start any new work/);
	});
});

describe("renderManualHandoffArgs", () => {
	it("frames the trigger as user-requested and pins the exact path", () => {
		const args = renderManualHandoffArgs({ path: "/tmp/pi-handoff-now.md" });
		assert.match(args, /requested by the user via the \/handoff command/);
		assert.match(args, /exactly this path: \/tmp\/pi-handoff-now\.md/);
		assert.match(args, /Do not ask for confirmation/);
		assert.ok(!args.includes("triggered automatically"), "must not claim an automatic trigger");
	});

	it("passes the focus through verbatim when given", () => {
		const args = renderManualHandoffArgs({ path: "/tmp/h.md", focus: "ship the parser rewrite" });
		assert.match(args, /Focus of the handoff and of the next session: ship the parser rewrite/);
	});

	it("omits the focus line when no focus is given", () => {
		const args = renderManualHandoffArgs({ path: "/tmp/h.md" });
		assert.ok(!args.includes("Focus of the handoff"));
	});
});

describe("buildInlineSkillMessage", () => {
	const message = buildInlineSkillMessage("handoff", "/some/SKILL.md", "BODY TEXT", "ARGS HERE");

	it("wraps the skill body in the same <skill> block format pi uses for /skill: expansion", () => {
		assert.match(message, /^<skill name="handoff" location="\/some\/SKILL\.md">/);
		assert.match(message, /BODY TEXT/);
		assert.match(message, /<\/skill>/);
	});

	it("appends the args after the skill block", () => {
		assert.match(message, /<\/skill>\n\nARGS HERE$/);
	});

	it("bundles a real handoff skill body", () => {
		assert.match(BUNDLED_HANDOFF_SKILL_BODY, /Write a handoff document summarising/);
		assert.match(BUNDLED_HANDOFF_SKILL_BODY, /suggested skills/);
		assert.match(BUNDLED_HANDOFF_SKILL_BODY, /Redact any sensitive information/);
	});
});

describe("renderContinuePrompt", () => {
	it("default template says 'Continue given this handoff' and substitutes {path}", () => {
		const prompt = renderContinuePrompt(DEFAULT_CONTINUE_PROMPT, "/tmp/h.md");
		assert.match(prompt, /^Continue given this handoff: \/tmp\/h\.md/);
		assert.ok(!prompt.includes("{path}"));
	});

	it("supports custom templates and leaves unknown placeholders alone", () => {
		const prompt = renderContinuePrompt("Go on: {path} ({keep})", "/tmp/h.md");
		assert.equal(prompt, "Go on: /tmp/h.md ({keep})");
	});
});

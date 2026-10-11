/**
 * Prompt/message builders for pi-auto-handoff.
 *
 * Pure module: no pi imports, no side effects.
 */

/**
 * The body of the handoff skill (SKILL.md minus frontmatter), embedded as a
 * last-resort fallback for when no installed handoff skill can be located.
 * Keep in sync with ../../skills/handoff/SKILL.md (the packaged copy).
 */
export const BUNDLED_HANDOFF_SKILL_BODY = `Write a handoff document summarising the current conversation so a fresh agent can continue the work. Save to the temporary directory of the user's OS - not the current workspace.

Include a "suggested skills" section in the document, naming which skills the next agent should call the Skill tool for.

Do not duplicate content already captured in other artifacts (specs, plans, ADRs, issues, commits, diffs). Reference them by path or URL instead.

Redact any sensitive information, such as API keys, passwords, or personally identifiable information.

If the user passed arguments, treat them as a description of what the next session will focus on and tailor the doc accordingly.`;

export interface HandoffArgsInput {
	usedPercent: number;
	remainingPercent: number;
	thresholdPercent: number;
	path: string;
}

/**
 * Arguments appended after `/skill:handoff` (or after the inlined skill block).
 * The skill's own instructions do the heavy lifting; these arguments pin down
 * the target path and stop the agent from starting new work.
 */
export function renderHandoffArgs(input: HandoffArgsInput): string {
	return [
		`AUTO-HANDOFF (triggered automatically by the pi-auto-handoff extension, not by the user): ` +
			`the auto-handoff threshold is reached (${input.usedPercent.toFixed(1)}% used, ` +
			`${input.remainingPercent.toFixed(1)}% left, threshold ${input.thresholdPercent}%).`,
		`Write the handoff document to exactly this path: ${input.path}`,
		`Do not ask for confirmation and do not start any new work. Finish the document promptly; ` +
			`once the file exists, this session will automatically switch to a fresh one that continues from the handoff.`,
	].join("\n");
}

export interface ManualHandoffArgsInput {
	/** Exact path the handoff document must be written to. */
	path: string;
	/** Optional focus for the next session, verbatim from the user. */
	focus?: string;
}

/**
 * Arguments appended after `/skill:handoff` when the USER requested the handoff
 * (via the /handoff command), as opposed to the automatic low-context trigger.
 */
export function renderManualHandoffArgs(input: ManualHandoffArgsInput): string {
	const lines = [
		"MANUAL HANDOFF (requested by the user via the /handoff command): write a handoff document now.",
		`Write the handoff document to exactly this path: ${input.path}`,
	];
	if (input.focus) lines.push(`Focus of the handoff and of the next session: ${input.focus}`);
	lines.push(
		"Do not ask for confirmation and do not start any new work. Finish the document promptly; " +
			"once the file exists, this session will switch to a fresh one that continues from the handoff.",
	);
	return lines.join("\n");
}

/**
 * Build the full user message when the handoff skill must be inlined (i.e. the
 * extension could not find an installed handoff skill for pi to expand).
 * Mirrors the format pi itself uses for `/skill:<name>` expansion, so the
 * model-visible result is identical.
 */
export function buildInlineSkillMessage(skillName: string, skillLocation: string, skillBody: string, args: string): string {
	const block =
		`<skill name="${skillName}" location="${skillLocation}">\n` +
		`References are relative to the skill directory.\n\n${skillBody}\n</skill>`;
	return args ? `${block}\n\n${args}` : block;
}

/**
 * Render the prompt for the fresh session from a template.
 * `{path}` is the only placeholder; unknown placeholders are left untouched.
 */
export function renderContinuePrompt(template: string, handoffPath: string): string {
	return template.replaceAll("{path}", handoffPath);
}

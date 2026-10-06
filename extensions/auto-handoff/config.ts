/**
 * Configuration resolution for pi-auto-handoff.
 *
 * Pure module: no pi imports, no side effects. Everything here is unit-testable
 * with plain `node --test`.
 *
 * Precedence (highest wins):
 *   1. CLI flags            (--auto-handoff-threshold, --no-auto-handoff)
 *   2. Session overrides    (/autohandoff 20, /autohandoff off)
 *   3. settings.json        ("autoHandoff": { ... })
 *   4. Defaults
 */

export const DEFAULT_THRESHOLD_PERCENT = 20;
export const MIN_THRESHOLD_PERCENT = 1;
export const MAX_THRESHOLD_PERCENT = 90;
export const DEFAULT_MIN_MESSAGES = 4;
export const DEFAULT_MODES = ["tui", "rpc"] as const;

export const DEFAULT_CONTINUE_PROMPT =
	"Continue given this handoff: {path}\n\n" +
	"Read the handoff document at that path first, then continue the work from where it leaves off.";

export interface AutoHandoffConfig {
	/** Master switch. Default: true. */
	enabled: boolean;
	/**
	 * Auto-handoff triggers when this much of the context window REMAINS.
	 * Default 20 means: hand off once 80% of the window has been used.
	 */
	thresholdPercent: number;
	/** Minimum branch entries required before a handoff is allowed. Default: 4. */
	minMessages: number;
	/** Pi run modes in which auto-handoff may trigger. Default: ["tui", "rpc"]. */
	modes: string[];
	/** Prompt sent to the fresh session. `{path}` is replaced with the handoff doc path. */
	continuePrompt: string;
}

export const DEFAULT_CONFIG: Readonly<AutoHandoffConfig> = Object.freeze({
	enabled: true,
	thresholdPercent: DEFAULT_THRESHOLD_PERCENT,
	minMessages: DEFAULT_MIN_MESSAGES,
	modes: DEFAULT_MODES as unknown as string[],
	continuePrompt: DEFAULT_CONTINUE_PROMPT,
});

export interface SessionOverrides {
	threshold?: number | null;
	enabled?: boolean | null;
}

export interface ResolveInput {
	/** Raw effective settings object as returned by `pi.getSettings()`, or undefined. */
	settings?: unknown;
	/** CLI flag values as returned by `pi.getFlag()`. */
	flags?: { threshold?: boolean | string; disable?: boolean | string };
	/** Overrides set via the /autohandoff command for this session. */
	session?: SessionOverrides;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Clamp a threshold into the sane range, or undefined when not a finite number. */
export function clampThreshold(value: unknown): number | undefined {
	const n = typeof value === "string" ? Number(value) : value;
	if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
	return Math.min(MAX_THRESHOLD_PERCENT, Math.max(MIN_THRESHOLD_PERCENT, Math.round(n)));
}

function coerceBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (value === "true" || value === "1" || value === "on") return true;
	if (value === "false" || value === "0" || value === "off") return false;
	return undefined;
}

/**
 * Resolve the effective config. Never throws: bad values in settings are
 * ignored in favour of the next-lower precedence layer.
 */
export function resolveConfig(input: ResolveInput = {}): AutoHandoffConfig {
	const config: AutoHandoffConfig = { ...DEFAULT_CONFIG };

	// Layer 4 -> 3: settings.json "autoHandoff" key.
	if (isPlainObject(input.settings)) {
		const raw = isPlainObject(input.settings.autoHandoff) ? input.settings.autoHandoff : {};
		const enabled = coerceBoolean(raw.enabled);
		if (enabled !== undefined) config.enabled = enabled;
		const threshold = clampThreshold(raw.thresholdPercent);
		if (threshold !== undefined) config.thresholdPercent = threshold;
		if (typeof raw.minMessages === "number" && Number.isFinite(raw.minMessages) && raw.minMessages >= 1) {
			config.minMessages = Math.round(raw.minMessages);
		}
		if (Array.isArray(raw.modes)) {
			const modes = raw.modes.filter((m): m is string => typeof m === "string");
			if (modes.length > 0) config.modes = modes;
		}
		if (typeof raw.continuePrompt === "string" && raw.continuePrompt.trim().length > 0) {
			config.continuePrompt = raw.continuePrompt;
		}
	}

	// Layer 2: session overrides from /autohandoff.
	if (input.session) {
		if (input.session.enabled !== undefined && input.session.enabled !== null) {
			config.enabled = input.session.enabled;
		}
		if (input.session.threshold !== undefined && input.session.threshold !== null) {
			const threshold = clampThreshold(input.session.threshold);
			if (threshold !== undefined) config.thresholdPercent = threshold;
		}
	}

	// Layer 1: CLI flags.
	if (input.flags) {
		if (coerceBoolean(input.flags.disable) === true) config.enabled = false;
		const threshold = clampThreshold(input.flags.threshold);
		if (threshold !== undefined) config.thresholdPercent = threshold;
	}

	return config;
}

/** Percentage of the context window still free, given the used percentage. */
export function remainingPercent(usedPercent: number): number {
	return 100 - usedPercent;
}

/** True when `usedPercent` has eaten enough of the window to trigger a handoff. */
export function isThresholdReached(usedPercent: number, thresholdPercent: number): boolean {
	return remainingPercent(usedPercent) <= thresholdPercent;
}

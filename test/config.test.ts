import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	clampThreshold,
	isThresholdReached,
	remainingPercent,
	resolveConfig,
	DEFAULT_CONFIG,
	DEFAULT_THRESHOLD_PERCENT,
} from "../extensions/auto-handoff/config.ts";

describe("defaults", () => {
	it("hands off at 40% remaining by default", () => {
		assert.equal(DEFAULT_CONFIG.thresholdPercent, DEFAULT_THRESHOLD_PERCENT);
		assert.equal(DEFAULT_THRESHOLD_PERCENT, 40);
		assert.equal(DEFAULT_CONFIG.enabled, true);
		assert.deepEqual([...DEFAULT_CONFIG.modes], ["tui", "rpc"]);
	});
});

describe("clampThreshold", () => {
	it("accepts numbers and numeric strings", () => {
		assert.equal(clampThreshold(35), 35);
		assert.equal(clampThreshold("35"), 35);
		assert.equal(clampThreshold("12.6"), 13);
	});
	it("clamps into the sane range 1..90", () => {
		assert.equal(clampThreshold(0), 1);
		assert.equal(clampThreshold(-10), 1);
		assert.equal(clampThreshold(95), 90);
		assert.equal(clampThreshold(100), 90);
	});
	it("returns undefined for garbage", () => {
		assert.equal(clampThreshold("banana"), undefined);
		assert.equal(clampThreshold(NaN), undefined);
		assert.equal(clampThreshold(undefined), undefined);
		assert.equal(clampThreshold(null), undefined);
	});
});

describe("resolveConfig precedence", () => {
	it("uses defaults with no input", () => {
		const config = resolveConfig();
		assert.equal(config.thresholdPercent, 40);
		assert.equal(config.enabled, true);
	});

	it("applies settings.json values", () => {
		const config = resolveConfig({
			settings: {
				autoHandoff: { thresholdPercent: 30, enabled: false, minMessages: 8, modes: ["tui"] },
			},
		});
		assert.equal(config.thresholdPercent, 30);
		assert.equal(config.enabled, false);
		assert.equal(config.minMessages, 8);
		assert.deepEqual(config.modes, ["tui"]);
	});

	it("ignores malformed settings instead of throwing", () => {
		const config = resolveConfig({
			settings: { autoHandoff: { thresholdPercent: "banana", enabled: "sometimes", minMessages: -3 } },
		});
		assert.equal(config.thresholdPercent, 40);
		assert.equal(config.enabled, true);
		assert.equal(config.minMessages, 4);
	});

	it("session overrides beat settings", () => {
		const config = resolveConfig({
			settings: { autoHandoff: { thresholdPercent: 30 } },
			session: { threshold: 10 },
		});
		assert.equal(config.thresholdPercent, 10);
	});

	it("CLI flags beat everything, including /autohandoff off", () => {
		const config = resolveConfig({
			settings: { autoHandoff: { thresholdPercent: 30, enabled: true } },
			session: { enabled: true, threshold: 5 },
			flags: { threshold: "40", disable: true },
		});
		assert.equal(config.thresholdPercent, 40);
		assert.equal(config.enabled, false);
	});

	it("accepts a custom continuePrompt from settings", () => {
		const config = resolveConfig({
			settings: { autoHandoff: { continuePrompt: "Pick up from {path} please" } },
		});
		assert.equal(config.continuePrompt, "Pick up from {path} please");
	});

	it("ignores an empty/broken continuePrompt", () => {
		const config = resolveConfig({ settings: { autoHandoff: { continuePrompt: "   " } } });
		assert.equal(config.continuePrompt, DEFAULT_CONFIG.continuePrompt);
	});
});

describe("threshold math", () => {
	it("remaining is the complement of used", () => {
		assert.equal(remainingPercent(80), 20);
		assert.equal(remainingPercent(99.5), 0.5);
	});

	it("triggers at or below the threshold, not above", () => {
		assert.equal(isThresholdReached(80, 20), true);
		assert.equal(isThresholdReached(80.0001, 20), true);
		assert.equal(isThresholdReached(79.9, 20), false);
	});
});

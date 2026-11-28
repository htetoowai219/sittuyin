import { describe, expect, it } from "vitest";
import {
	calculateGlicko2MatchUpdate,
	calculateGlicko2PeriodUpdate,
	GLICKO2_DEFAULTS,
	isProvisionalRating,
} from "./glicko2.js";

describe("Glicko-2 rating engine", () => {
	it("reproduces Mark Glickman's 2013 worked 3-opponent example", () => {
		const updated = calculateGlicko2PeriodUpdate(
			{ rating: 1500, ratingDeviation: 200, volatility: 0.06 },
			[
				{ rating: 1400, ratingDeviation: 30, score: 1 },
				{ rating: 1550, ratingDeviation: 100, score: 0 },
				{ rating: 1700, ratingDeviation: 300, score: 0 },
			],
			{ tau: 0.5 },
		);

		expect(Math.abs(updated.rating - 1464.06)).toBeLessThan(0.05);
		expect(Math.abs(updated.ratingDeviation - 151.52)).toBeLessThan(0.05);
		expect(Math.abs(updated.volatility - 0.05999)).toBeLessThan(0.0005);
	});

	it("applies daily inactivity RD growth up to rdCap and respects rdFloor", () => {
		const inactive = calculateGlicko2PeriodUpdate(
			{ rating: 1500, ratingDeviation: 100, volatility: 0.06 },
			[],
			{ inactivePeriods: 365 },
		);
		expect(inactive.rating).toBe(1500);
		expect(inactive.ratingDeviation).toBeGreaterThan(100);
		expect(inactive.ratingDeviation).toBeLessThanOrEqual(GLICKO2_DEFAULTS.rdCap);

		const capped = calculateGlicko2PeriodUpdate(
			{ rating: 1500, ratingDeviation: 340, volatility: 0.06 },
			[],
			{ inactivePeriods: 10_000 },
		);
		expect(capped.ratingDeviation).toBe(GLICKO2_DEFAULTS.rdCap);

		const floored = calculateGlicko2PeriodUpdate(
			{ rating: 1500, ratingDeviation: 45, volatility: 0.06 },
			[{ rating: 1500, ratingDeviation: 45, score: 0.5 }],
		);
		expect(floored.ratingDeviation).toBeGreaterThanOrEqual(
			GLICKO2_DEFAULTS.rdFloor,
		);
	});

	it("computes symmetric match updates for equal starting players", () => {
		const endedAt = new Date("2026-11-24T12:00:00Z");
		const result = calculateGlicko2MatchUpdate(
			{ rating: 1500, ratingDeviation: 350, volatility: 0.06, lastRatedAt: null },
			{ rating: 1500, ratingDeviation: 350, volatility: 0.06, lastRatedAt: null },
			1,
			endedAt,
		);

		expect(result.red.rating).toBeGreaterThan(1500);
		expect(result.black.rating).toBeLessThan(1500);
		expect(result.red.rating - 1500).toBeCloseTo(1500 - result.black.rating, 6);
		expect(result.red.ratingDeviation).toBeLessThan(350);
		expect(result.black.ratingDeviation).toBeLessThan(350);
	});

	it("evaluates provisional status from RD > 110 or gamesPlayed < 10", () => {
		expect(isProvisionalRating(350, 0)).toBe(true);
		expect(isProvisionalRating(111, 20)).toBe(true);
		expect(isProvisionalRating(80, 9)).toBe(true);
		expect(isProvisionalRating(110, 10)).toBe(false);
		expect(isProvisionalRating(75, 25)).toBe(false);
	});
});

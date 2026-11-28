import { describe, expect, it } from "vitest";
import {
	decodeLeaderboardCursor,
	decodeMatchHistoryCursor,
	encodeLeaderboardCursor,
	encodeMatchHistoryCursor,
	GetLeaderboardInputSchema,
	GetMatchReplayInputSchema,
	GetPublicPlayerProfileInputSchema,
	MatchIdSchema,
	PageLimitSchema,
	PlayerHandleSchema,
} from "./public-reads.js";

describe("public read cursor codecs & input contracts", () => {
	it("round-trips leaderboard cursors", () => {
		const cursor = encodeLeaderboardCursor({
			rating: 1724.5,
			userId: "user_abc_123",
		});
		expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeLeaderboardCursor(cursor)).toEqual({
			rating: 1724.5,
			userId: "user_abc_123",
		});
	});

	it("round-trips match history cursors", () => {
		const cursor = encodeMatchHistoryCursor({
			endedAt: "2026-11-28T08:15:30.123Z",
			id: "550e8400-e29b-41d4-a716-446655440000",
		});
		expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(decodeMatchHistoryCursor(cursor)).toEqual({
			endedAt: "2026-11-28T08:15:30.123Z",
			id: "550e8400-e29b-41d4-a716-446655440000",
		});
	});

	it("rejects malformed or tampered cursors", () => {
		expect(() => decodeLeaderboardCursor("")).toThrow(/INVALID_CURSOR/);
		expect(() => decodeLeaderboardCursor("not!valid!base64")).toThrow(
			/INVALID_CURSOR/,
		);
		// {"rating":"nan"} in base64url
		expect(() => decodeLeaderboardCursor("eyJyYXRpbmciOiJuYW4ifQ")).toThrow(
			/INVALID_CURSOR/,
		);
		// {"endedAt":"not-a-date","id":"1"} in base64url
		expect(() =>
			decodeMatchHistoryCursor("eyJlbmRlZEF0Ijoibm90LWEtZGF0ZSIsImlkIjoiMSJ9"),
		).toThrow(/INVALID_CURSOR/);
	});

	it("enforces handle, UUID, and page limit bounds", () => {
		expect(PlayerHandleSchema.safeParse("mg_mg_01").success).toBe(true);
		expect(PlayerHandleSchema.safeParse("ab").success).toBe(false);
		expect(PlayerHandleSchema.safeParse("UpperCase").success).toBe(false);
		expect(PlayerHandleSchema.safeParse("bad-dash").success).toBe(false);

		expect(
			MatchIdSchema.safeParse("550e8400-e29b-41d4-a716-446655440000").success,
		).toBe(true);
		expect(MatchIdSchema.safeParse("not-a-uuid").success).toBe(false);

		expect(PageLimitSchema.parse(undefined)).toBe(25);
		expect(PageLimitSchema.safeParse(0).success).toBe(false);
		expect(PageLimitSchema.safeParse(26).success).toBe(false);

		expect(GetLeaderboardInputSchema.safeParse({ limit: 25 }).success).toBe(
			true,
		);
		expect(
			GetPublicPlayerProfileInputSchema.safeParse({ handle: "sittuyin_pro" })
				.success,
		).toBe(true);
		expect(
			GetMatchReplayInputSchema.safeParse({
				matchId: "550e8400-e29b-41d4-a716-446655440000",
			}).success,
		).toBe(true);
	});
});

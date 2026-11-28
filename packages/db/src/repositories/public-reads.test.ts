import {
	decodeLeaderboardCursor,
	decodeMatchHistoryCursor,
} from "@sittuyin/shared";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import type { ServerDb } from "../client.js";
import { matches } from "../schema/matches.js";
import { playerProfiles } from "../schema/player-profiles.js";
import {
	getLeaderboardPage,
	getMatchReplayById,
	getPlayerMatchHistoryPage,
	getPublicPlayerProfileByHandle,
	getViewerLeaderboardStanding,
} from "./public-reads.js";

describe("public read repositories (Spec 0003)", () => {
	it("registers the partial leaderboard index and descending match keyset indexes", () => {
		const profileConfig = getTableConfig(playerProfiles);
		expect(profileConfig.indexes.map((i) => i.config.name)).toContain(
			"player_profiles_leaderboard_idx",
		);

		const matchConfig = getTableConfig(matches);
		const matchIndexNames = matchConfig.indexes.map((i) => i.config.name);
		expect(matchIndexNames).toContain("matches_red_user_ended_id_idx");
		expect(matchIndexNames).toContain("matches_black_user_ended_id_idx");
		expect(matchIndexNames).not.toContain("matches_red_user_ended_idx");
		expect(matchIndexNames).not.toContain("matches_black_user_ended_idx");
	});

	it("returns a paginated leaderboard slice and encodes nextCursor from limit+1 rows", async () => {
		const mockRows = [
			{
				userId: "u1",
				handle: "alpha_01",
				displayName: "Alpha",
				isAnonymous: false,
				rating: 1850,
				ratingDeviation: 65,
				gamesPlayed: 22,
				wins: 16,
				losses: 5,
				draws: 1,
				lastRatedAt: new Date("2026-11-28T05:00:00Z"),
			},
			{
				userId: "u2",
				handle: "beta_02",
				displayName: "Beta",
				isAnonymous: true,
				rating: 1740,
				ratingDeviation: 90,
				gamesPlayed: 12,
				wins: 7,
				losses: 4,
				draws: 1,
				lastRatedAt: new Date("2026-11-28T04:00:00Z"),
			},
			{
				userId: "u3",
				handle: "gamma_03",
				displayName: "Gamma",
				isAnonymous: false,
				rating: 1700,
				ratingDeviation: 95,
				gamesPlayed: 10,
				wins: 5,
				losses: 5,
				draws: 0,
				lastRatedAt: null,
			},
		];

		let capturedSelectKeys: string[] = [];
		const db = {
			select: vi.fn().mockImplementation((fields: Record<string, unknown>) => {
				capturedSelectKeys = Object.keys(fields);
				return {
					from: () => ({
						innerJoin: () => ({
							where: () => ({
								orderBy: () => ({
									limit: async () => mockRows,
								}),
							}),
						}),
					}),
				};
			}),
		} as unknown as ServerDb;

		const page = await getLeaderboardPage(db, { limit: 2 });
		expect(capturedSelectKeys).not.toContain("email");
		expect(page.entries).toHaveLength(2);
		expect(page.entries[0]?.handle).toBe("alpha_01");
		expect(page.entries[1]?.isAnonymous).toBe(true);
		expect(page.nextCursor).not.toBeNull();
		expect(decodeLeaderboardCursor(page.nextCursor ?? "")).toEqual({
			rating: 1740,
			userId: "u2",
		});
	});

	it("computes exact rank for established viewer and gamesRemaining for provisional viewer", async () => {
		let call = 0;
		const establishedDb = {
			select: vi.fn().mockImplementation(() => {
				call += 1;
				if (call === 1) {
					return {
						from: () => ({
							innerJoin: () => ({
								where: () => ({
									limit: async () => [
										{
											userId: "u_est",
											handle: "grandmaster",
											displayName: "Grandmaster",
											isAnonymous: false,
											rating: 1900,
											ratingDeviation: 70,
											gamesPlayed: 15,
											wins: 11,
											losses: 3,
											draws: 1,
										},
									],
								}),
							}),
						}),
					};
				}
				return {
					from: () => ({
						where: async () => [{ higherCount: 4 }],
					}),
				};
			}),
		} as unknown as ServerDb;

		const estStanding = await getViewerLeaderboardStanding(
			establishedDb,
			"u_est",
		);
		expect(estStanding?.qualified).toBe(true);
		expect(estStanding?.rank).toBe(5);
		expect(estStanding?.gamesRemaining).toBe(0);
		expect(estStanding?.rdThresholdMet).toBe(true);

		const provisionalDb = {
			select: vi.fn().mockImplementation(() => ({
				from: () => ({
					innerJoin: () => ({
						where: () => ({
							limit: async () => [
								{
									userId: "u_prov",
									handle: "newcomer_1",
									displayName: "Newcomer",
									isAnonymous: true,
									rating: 1520,
									ratingDeviation: 240,
									gamesPlayed: 3,
									wins: 2,
									losses: 1,
									draws: 0,
								},
							],
						}),
					}),
				}),
			})),
		} as unknown as ServerDb;

		const provStanding = await getViewerLeaderboardStanding(
			provisionalDb,
			"u_prov",
		);
		expect(provStanding?.qualified).toBe(false);
		expect(provStanding?.rank).toBeNull();
		expect(provStanding?.gamesRemaining).toBe(7);
		expect(provStanding?.rdThresholdMet).toBe(false);
	});

	it("returns public player profile without email and flags provisional status", async () => {
		let capturedKeys: string[] = [];
		const db = {
			select: vi.fn().mockImplementation((fields: Record<string, unknown>) => {
				capturedKeys = Object.keys(fields);
				return {
					from: () => ({
						innerJoin: () => ({
							where: () => ({
								limit: async () => [
									{
										userId: "u_1",
										handle: "sittuyin_fan",
										displayName: "Sittuyin Fan",
										isAnonymous: false,
										rating: 1580,
										ratingDeviation: 145,
										gamesPlayed: 6,
										wins: 4,
										losses: 2,
										draws: 0,
										lastRatedAt: new Date("2026-11-27T10:00:00Z"),
										createdAt: new Date("2026-11-01T10:00:00Z"),
									},
								],
							}),
						}),
					}),
				};
			}),
		} as unknown as ServerDb;

		const profile = await getPublicPlayerProfileByHandle(db, "Sittuyin_Fan");
		expect(capturedKeys).not.toContain("email");
		expect(profile?.handle).toBe("sittuyin_fan");
		expect(profile?.isProvisional).toBe(true);
		expect(profile?.wins).toBe(4);
	});

	it("maps UNION ALL match history with deleted opponent fallback and nextCursor", async () => {
		const db = {
			execute: vi.fn().mockResolvedValue({
				rows: [
					{
						id: "550e8400-e29b-41d4-a716-446655440001",
						mode: "public_lobby",
						time_control: "rapid_10_5",
						player_side: "red",
						winner_side: "red",
						termination_reason: "checkmate",
						is_rated: true,
						total_plies: 42,
						player_rating_before: 1500,
						player_rating_after: 1518,
						opponent_user_id: null,
						opponent_display_name: "Deleted Opponent",
						opponent_handle: null,
						opponent_rating_before: 1500,
						opponent_rating_after: 1482,
						ended_at: new Date("2026-11-28T08:00:00Z"),
					},
					{
						id: "550e8400-e29b-41d4-a716-446655440002",
						mode: "private_room",
						time_control: "rapid_15_10",
						player_side: "black",
						winner_side: null,
						termination_reason: "draw_agreement",
						is_rated: false,
						total_plies: 30,
						player_rating_before: null,
						player_rating_after: null,
						opponent_user_id: "u_friend",
						opponent_display_name: "Friend Live",
						opponent_handle: "friend_01",
						opponent_rating_before: null,
						opponent_rating_after: null,
						ended_at: new Date("2026-11-27T08:00:00Z"),
					},
				],
			}),
		} as unknown as ServerDb;

		const page = await getPlayerMatchHistoryPage(db, {
			userId: "u_owner",
			includePrivate: true,
			limit: 1,
		});

		expect(page.matches).toHaveLength(1);
		expect(page.matches[0]?.outcome).toBe("win");
		expect(page.matches[0]?.playerRatingDelta).toBe(18);
		expect(page.matches[0]?.opponent.handle).toBeNull();
		expect(page.matches[0]?.opponent.displayName).toBe("Deleted Opponent");
		expect(page.nextCursor).not.toBeNull();
		expect(decodeMatchHistoryCursor(page.nextCursor ?? "")).toEqual({
			endedAt: "2026-11-28T08:00:00.000Z",
			id: "550e8400-e29b-41d4-a716-446655440001",
		});
	});

	it("loads match replay with live seat handles and historical fallback when user_id is null", async () => {
		const db = {
			select: vi.fn().mockImplementation(() => ({
				from: () => ({
					leftJoin: () => ({
						leftJoin: () => ({
							where: () => ({
								limit: async () => [
									{
										id: "550e8400-e29b-41d4-a716-446655440010",
										mode: "public_lobby",
										timeControl: "rapid_10_5",
										redUserId: "u_red",
										blackUserId: null,
										redDisplayName: "Old Red Name",
										blackDisplayName: "Historical Black",
										redProfileDisplayName: "Live Red Name",
										redProfileHandle: "live_red",
										blackProfileDisplayName: null,
										blackProfileHandle: null,
										winnerSide: "red",
										terminationReason: "resign",
										initialSetupFen: "fen_str",
										movesUciJson: ["e3e4", "d6d5"],
										totalPlies: 2,
										isRated: true,
										redRatingBefore: 1600,
										redRatingAfter: 1612,
										blackRatingBefore: 1590,
										blackRatingAfter: 1578,
										startedAt: new Date("2026-11-28T06:00:00Z"),
										endedAt: new Date("2026-11-28T06:10:00Z"),
									},
								],
							}),
						}),
					}),
				}),
			})),
		} as unknown as ServerDb;

		const replay = await getMatchReplayById(
			db,
			"550e8400-e29b-41d4-a716-446655440010",
		);
		expect(replay?.red.displayName).toBe("Live Red Name");
		expect(replay?.red.handle).toBe("live_red");
		expect(replay?.red.ratingDelta).toBe(12);
		expect(replay?.black.displayName).toBe("Historical Black");
		expect(replay?.black.handle).toBeNull();
		expect(replay?.black.ratingDelta).toBe(-12);
	});
});

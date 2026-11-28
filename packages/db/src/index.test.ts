import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
	createServerDb,
	DB_PACKAGE_METADATA,
	HandleTakenError,
	insertCompletedMatch,
	linkAnonymousProfileAndMatches,
	matches,
	type NewMatchRow,
	normalizeDisplayName,
	persistAndRateCompletedMatch,
	playerProfiles,
	type ServerDb,
	updatePlayerProfile,
	user,
} from "./index.js";

describe("@sittuyin/db schema, clients, and repositories", () => {
	it("defines matches, user, and player_profiles tables with expected columns and indexes", () => {
		expect(DB_PACKAGE_METADATA.name).toBe("@sittuyin/db");

		const matchConfig = getTableConfig(matches);
		expect(matchConfig.name).toBe("matches");
		const matchColumns = matchConfig.columns.map((c) => c.name);
		expect(matchColumns).toEqual([
			"id",
			"room_id",
			"mode",
			"time_control",
			"red_user_id",
			"black_user_id",
			"red_display_name",
			"black_display_name",
			"winner_side",
			"termination_reason",
			"initial_setup_fen",
			"moves_uci_json",
			"total_plies",
			"is_rated",
			"rating_applied_at",
			"red_rating_before",
			"red_rating_after",
			"black_rating_before",
			"black_rating_after",
			"started_at",
			"ended_at",
		]);

		const userConfig = getTableConfig(user);
		expect(userConfig.columns.map((c) => c.name)).toContain("is_anonymous");

		const profileConfig = getTableConfig(playerProfiles);
		expect(profileConfig.name).toBe("player_profiles");
		expect(profileConfig.indexes.map((i) => i.config.name)).toContain(
			"player_profiles_handle_uidx",
		);
		expect(profileConfig.indexes.map((i) => i.config.name)).toContain(
			"player_profiles_rating_idx",
		);
	});

	it("configures pg.Pool with pool.on('error') listener in createServerDb", async () => {
		const onPoolError = vi.fn();
		const { pool, db } = createServerDb(
			"postgresql://postgres:postgres@localhost:5432/sittuyin_test",
			{ onPoolError },
		);

		expect(db).toBeDefined();
		expect(pool.options.max).toBe(10);
		expect(pool.options.idleTimeoutMillis).toBe(30_000);
		expect(pool.options.connectionTimeoutMillis).toBe(10_000);

		const simulatedIdleErr = new Error(
			"terminating connection due to administrator command",
		);
		pool.emit("error", simulatedIdleErr, undefined as never);
		expect(onPoolError).toHaveBeenCalledWith(simulatedIdleErr);

		await pool.end();
	});

	it("normalizes display names to 32 Unicode chars with Guest fallback", () => {
		expect(normalizeDisplayName("  Mg Ba  ")).toBe("Mg Ba");
		expect(normalizeDisplayName("   ")).toMatch(/^Guest_[0-9a-f]{4}$/);
		expect(normalizeDisplayName("က".repeat(40)).length).toBe(32);
	});

	it("maps PostgreSQL unique violation 23505 to HandleTakenError in updatePlayerProfile", async () => {
		const returning = vi
			.fn()
			.mockRejectedValue({ code: "23505", detail: "Key (handle) exists" });
		const where = vi.fn().mockReturnValue({ returning });
		const set = vi.fn().mockReturnValue({ where });
		const update = vi.fn().mockReturnValue({ set });
		const mockDb = { update } as unknown as ServerDb;

		await expect(
			updatePlayerProfile(mockDb, "user-1", { handle: "taken_handle" }),
		).rejects.toBeInstanceOf(HandleTakenError);
	});

	it("links anonymous profile onto a brand new Google account while renaming customized handle first", async () => {
		const anonProfile = {
			userId: "anon-1",
			handle: "my_custom_handle",
			displayName: "Aung Kyaw",
			rating: 1620,
			ratingDeviation: 180,
			volatility: 0.059,
			gamesPlayed: 3,
			wins: 2,
			losses: 1,
			draws: 0,
			lastRatedAt: new Date("2026-11-24T00:00:00Z"),
			locale: "en" as const,
			createdAt: new Date(),
			updatedAt: new Date(),
		};
		const newProfile = {
			userId: "google-1",
			handle: "guest_12345678",
			displayName: "Google Name",
			rating: 1500,
			ratingDeviation: 350,
			volatility: 0.06,
			gamesPlayed: 0,
			wins: 0,
			losses: 0,
			draws: 0,
			lastRatedAt: null,
			locale: "my" as const,
			createdAt: new Date(),
			updatedAt: new Date(),
		};

		let selectCall = 0;
		const select = vi.fn().mockImplementation(() => ({
			from: () => ({
				where: () => ({
					limit: async () => {
						selectCall += 1;
						if (selectCall === 1) return [anonProfile];
						if (selectCall === 2) return [newProfile];
						return [];
					},
				}),
			}),
		}));

		const updateSets: Array<Record<string, unknown>> = [];
		const update = vi.fn().mockImplementation(() => ({
			set: (values: Record<string, unknown>) => {
				updateSets.push(values);
				return { where: vi.fn().mockResolvedValue(undefined) };
			},
		}));

		const mockTx = { select, update } as unknown as ServerDb;
		const result = await linkAnonymousProfileAndMatches(mockTx, {
			anonymousUserId: "anon-1",
			newUserId: "google-1",
		});

		expect(result.isBrandNew).toBe(true);
		expect(updateSets.some((s) => String(s.handle ?? "").startsWith("migrating_"))).toBe(
			true,
		);
		const finalProfileUpdate = updateSets[updateSets.length - 1];
		expect(finalProfileUpdate?.rating).toBe(1620);
		expect(finalProfileUpdate?.handle).toBe("my_custom_handle");
		expect(finalProfileUpdate?.displayName).toBe("Aung Kyaw");
	});

	it("executes idempotent insertCompletedMatch with onConflictDoNothing on id", async () => {
		const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
		const values = vi.fn().mockReturnValue({ onConflictDoNothing });
		const insert = vi.fn().mockReturnValue({ values });

		const mockDb = { insert } as unknown as ServerDb;
		const row: NewMatchRow = {
			id: "550e8400-e29b-41d4-a716-446655440099",
			roomId: "room_abc",
			mode: "public_lobby",
			timeControl: "rapid_10_5",
			redUserId: "user_1",
			blackUserId: "user_2",
			redDisplayName: "RedPlayer",
			blackDisplayName: "BlackPlayer",
			winnerSide: "red",
			terminationReason: "checkmate",
			initialSetupFen: "2r2r2/8/4pppp/pppp4/4PPPP/PPPP4/8/2R2R2[] r - 0 1",
			movesUciJson: ["e3e4", "d6d5"],
			totalPlies: 2,
			isRated: true,
			startedAt: new Date("2026-11-23T12:00:00Z"),
			endedAt: new Date("2026-11-23T12:05:00Z"),
		};

		await insertCompletedMatch(mockDb, row);

		expect(insert).toHaveBeenCalledWith(matches);
		expect(values).toHaveBeenCalledWith(row);
		expect(onConflictDoNothing).toHaveBeenCalledWith({
			target: matches.id,
		});
	});

	it("skips Glicko-2 cleanly when a seated user was deleted mid-match", async () => {
		const warn = vi.fn();
		const insertedRows: NewMatchRow[] = [];

		let selectStep = 0;
		const tx = {
			select: vi.fn().mockImplementation(() => ({
				from: () => ({
					where: () => ({
						orderBy: () => ({
							for: async () => {
								selectStep += 1;
								// Only black user exists; red user was deleted mid-match
								return [{ id: "user_black" }];
							},
						}),
						for: async () => [
							{
								isRated: true,
								ratingAppliedAt: null,
								redUserId: null,
								blackUserId: "user_black",
							},
						],
					}),
				}),
			})),
			insert: vi.fn().mockImplementation(() => ({
				values: (row: NewMatchRow) => {
					insertedRows.push(row);
					return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) };
				},
			})),
		};

		const mockDb = {
			transaction: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx),
		} as unknown as ServerDb;

		const result = await persistAndRateCompletedMatch(
			mockDb,
			{
				id: "match-deleted-user",
				roomId: "room-1",
				mode: "public_lobby",
				timeControl: "rapid_10_5",
				redUserId: "user_red_deleted",
				blackUserId: "user_black",
				redDisplayName: "Red",
				blackDisplayName: "Black",
				winnerSide: "red",
				terminationReason: "checkmate",
				initialSetupFen: "fen",
				movesUciJson: ["e3e4"],
				totalPlies: 1,
				isRated: true,
				startedAt: new Date("2026-11-24T10:00:00Z"),
				endedAt: new Date("2026-11-24T10:05:00Z"),
			},
			{ logger: { warn } },
		);

		expect(selectStep).toBe(1);
		expect(insertedRows[0]?.redUserId).toBeNull();
		expect(insertedRows[0]?.blackUserId).toBe("user_black");
		expect(result.persisted).toBe(true);
		expect(result.ratingUpdated).toBeNull();
		expect(result.ratingSkippedReason).toBe("deleted_user");
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

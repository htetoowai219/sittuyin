import {
	encodeLeaderboardCursor,
	encodeMatchHistoryCursor,
	isProvisionalRating,
	type LeaderboardCursorPayload,
	type LeaderboardEntry,
	type MatchHistoryCursorPayload,
	type MatchReplayPayload,
	type MatchSeatSummary,
	type PlayerMatchHistoryItem,
	type PlayerMatchHistoryPage,
	type PlayerMatchOutcome,
	PROVISIONAL_GAMES_THRESHOLD,
	PROVISIONAL_RD_THRESHOLD,
	PUBLIC_PAGE_SIZE_DEFAULT,
	PUBLIC_PAGE_SIZE_MAX,
	type PublicPlayerProfile,
	type ViewerLeaderboardStanding,
} from "@sittuyin/shared";
import { and, asc, desc, eq, gt, gte, lt, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { user } from "../schema/auth-schema.js";
import { matches } from "../schema/matches.js";
import { playerProfiles } from "../schema/player-profiles.js";
import type { AnyDb } from "./player-profiles.js";

function clampPageLimit(limit?: number): number {
	if (limit === undefined || !Number.isFinite(limit)) {
		return PUBLIC_PAGE_SIZE_DEFAULT;
	}
	return Math.min(PUBLIC_PAGE_SIZE_MAX, Math.max(1, Math.trunc(limit)));
}

function toIsoString(value: Date | string): string {
	if (value instanceof Date) {
		return value.toISOString();
	}
	const parsed = new Date(value);
	if (!Number.isNaN(parsed.getTime())) {
		return parsed.toISOString();
	}
	return String(value);
}

function toNullableIsoString(
	value: Date | string | null | undefined,
): string | null {
	if (value === null || value === undefined) {
		return null;
	}
	return toIsoString(value);
}

function toNullableInt(value: unknown): number | null {
	if (value === null || value === undefined) {
		return null;
	}
	const num = Number(value);
	return Number.isFinite(num) ? Math.trunc(num) : null;
}

function computeRatingDelta(
	isRated: boolean,
	before: number | null,
	after: number | null,
): number | null {
	if (!isRated || before === null || after === null) {
		return null;
	}
	return after - before;
}

function derivePlayerOutcome(
	winnerSide: "red" | "black" | null,
	playerSide: "red" | "black",
): PlayerMatchOutcome {
	if (winnerSide === null) {
		return "draw";
	}
	return winnerSide === playerSide ? "win" : "loss";
}

function extractExecuteRows(result: unknown): Record<string, unknown>[] {
	if (Array.isArray(result)) {
		return result as Record<string, unknown>[];
	}
	if (
		result &&
		typeof result === "object" &&
		"rows" in result &&
		Array.isArray((result as { rows?: unknown }).rows)
	) {
		return (result as { rows: Record<string, unknown>[] }).rows;
	}
	return [];
}

export interface GetLeaderboardPageOptions {
	readonly cursor?: LeaderboardCursorPayload | null;
	readonly limit?: number;
}

export interface LeaderboardPageSlice {
	readonly entries: LeaderboardEntry[];
	readonly nextCursor: string | null;
}

export async function getLeaderboardPage(
	db: AnyDb,
	options: GetLeaderboardPageOptions = {},
): Promise<LeaderboardPageSlice> {
	const limit = clampPageLimit(options.limit);
	const fetchLimit = limit + 1;

	const conditions = [
		lte(playerProfiles.ratingDeviation, PROVISIONAL_RD_THRESHOLD),
		gte(playerProfiles.gamesPlayed, PROVISIONAL_GAMES_THRESHOLD),
	];

	if (options.cursor) {
		const keysetCondition = or(
			lt(playerProfiles.rating, options.cursor.rating),
			and(
				eq(playerProfiles.rating, options.cursor.rating),
				gt(playerProfiles.userId, options.cursor.userId),
			),
		);
		if (keysetCondition) {
			conditions.push(keysetCondition);
		}
	}

	const rows = await db
		.select({
			userId: playerProfiles.userId,
			handle: playerProfiles.handle,
			displayName: playerProfiles.displayName,
			isAnonymous: user.isAnonymous,
			rating: playerProfiles.rating,
			ratingDeviation: playerProfiles.ratingDeviation,
			gamesPlayed: playerProfiles.gamesPlayed,
			wins: playerProfiles.wins,
			losses: playerProfiles.losses,
			draws: playerProfiles.draws,
			lastRatedAt: playerProfiles.lastRatedAt,
		})
		.from(playerProfiles)
		.innerJoin(user, eq(user.id, playerProfiles.userId))
		.where(and(...conditions))
		.orderBy(desc(playerProfiles.rating), asc(playerProfiles.userId))
		.limit(fetchLimit);

	const hasMore = rows.length > limit;
	const pageRows = hasMore ? rows.slice(0, limit) : rows;
	const entries: LeaderboardEntry[] = pageRows.map((row) => ({
		userId: row.userId,
		handle: row.handle,
		displayName: row.displayName,
		isAnonymous: Boolean(row.isAnonymous),
		rating: Number(row.rating),
		ratingDeviation: Number(row.ratingDeviation),
		gamesPlayed: row.gamesPlayed,
		wins: row.wins,
		losses: row.losses,
		draws: row.draws,
		lastRatedAt: toNullableIsoString(row.lastRatedAt),
	}));

	const last = entries[entries.length - 1];
	const nextCursor =
		hasMore && last
			? encodeLeaderboardCursor({
					rating: last.rating,
					userId: last.userId,
				})
			: null;

	return { entries, nextCursor };
}

export async function getViewerLeaderboardStanding(
	db: AnyDb,
	viewerUserId: string,
): Promise<ViewerLeaderboardStanding | null> {
	const rows = await db
		.select({
			userId: playerProfiles.userId,
			handle: playerProfiles.handle,
			displayName: playerProfiles.displayName,
			isAnonymous: user.isAnonymous,
			rating: playerProfiles.rating,
			ratingDeviation: playerProfiles.ratingDeviation,
			gamesPlayed: playerProfiles.gamesPlayed,
			wins: playerProfiles.wins,
			losses: playerProfiles.losses,
			draws: playerProfiles.draws,
		})
		.from(playerProfiles)
		.innerJoin(user, eq(user.id, playerProfiles.userId))
		.where(eq(playerProfiles.userId, viewerUserId))
		.limit(1);

	const viewer = rows[0];
	if (!viewer) {
		return null;
	}

	const rating = Number(viewer.rating);
	const ratingDeviation = Number(viewer.ratingDeviation);
	const gamesPlayed = viewer.gamesPlayed;
	const qualified = !isProvisionalRating(ratingDeviation, gamesPlayed);
	const gamesRemaining = Math.max(0, PROVISIONAL_GAMES_THRESHOLD - gamesPlayed);
	const rdThresholdMet = ratingDeviation <= PROVISIONAL_RD_THRESHOLD;

	let rank: number | null = null;
	if (qualified) {
		const higherCountRows = await db
			.select({
				higherCount: sql<number>`count(*)::int`,
			})
			.from(playerProfiles)
			.where(
				and(
					lte(playerProfiles.ratingDeviation, PROVISIONAL_RD_THRESHOLD),
					gte(playerProfiles.gamesPlayed, PROVISIONAL_GAMES_THRESHOLD),
					or(
						gt(playerProfiles.rating, rating),
						and(
							eq(playerProfiles.rating, rating),
							lt(playerProfiles.userId, viewer.userId),
						),
					),
				),
			);
		const higherCount = Number(higherCountRows[0]?.higherCount ?? 0);
		rank = 1 + (Number.isFinite(higherCount) ? higherCount : 0);
	}

	return {
		userId: viewer.userId,
		handle: viewer.handle,
		displayName: viewer.displayName,
		isAnonymous: Boolean(viewer.isAnonymous),
		rating,
		ratingDeviation,
		gamesPlayed,
		wins: viewer.wins,
		losses: viewer.losses,
		draws: viewer.draws,
		qualified,
		rank,
		gamesRemaining,
		rdThresholdMet,
	};
}

export async function getPublicPlayerProfileByHandle(
	db: AnyDb,
	handle: string,
): Promise<PublicPlayerProfile | null> {
	const normalizedHandle = handle.toLowerCase();
	const rows = await db
		.select({
			userId: playerProfiles.userId,
			handle: playerProfiles.handle,
			displayName: playerProfiles.displayName,
			isAnonymous: user.isAnonymous,
			rating: playerProfiles.rating,
			ratingDeviation: playerProfiles.ratingDeviation,
			gamesPlayed: playerProfiles.gamesPlayed,
			wins: playerProfiles.wins,
			losses: playerProfiles.losses,
			draws: playerProfiles.draws,
			lastRatedAt: playerProfiles.lastRatedAt,
			createdAt: playerProfiles.createdAt,
		})
		.from(playerProfiles)
		.innerJoin(user, eq(user.id, playerProfiles.userId))
		.where(eq(playerProfiles.handle, normalizedHandle))
		.limit(1);

	const row = rows[0];
	if (!row) {
		return null;
	}

	const rating = Number(row.rating);
	const ratingDeviation = Number(row.ratingDeviation);

	return {
		userId: row.userId,
		handle: row.handle,
		displayName: row.displayName,
		isAnonymous: Boolean(row.isAnonymous),
		rating,
		ratingDeviation,
		isProvisional: isProvisionalRating(ratingDeviation, row.gamesPlayed),
		gamesPlayed: row.gamesPlayed,
		wins: row.wins,
		losses: row.losses,
		draws: row.draws,
		lastRatedAt: toNullableIsoString(row.lastRatedAt),
		createdAt: toIsoString(row.createdAt),
	};
}

export interface GetPlayerMatchHistoryPageInput {
	readonly userId: string;
	readonly includePrivate: boolean;
	readonly cursor?: MatchHistoryCursorPayload | null;
	readonly limit?: number;
}

export async function getPlayerMatchHistoryPage(
	db: AnyDb,
	input: GetPlayerMatchHistoryPageInput,
): Promise<PlayerMatchHistoryPage> {
	const limit = clampPageLimit(input.limit);
	const fetchLimit = limit + 1;
	const cursorDate = input.cursor ? new Date(input.cursor.endedAt) : null;
	const modeFilter = input.includePrivate
		? sql``
		: sql`AND m.mode = 'public_lobby'`;
	const cursorFilter =
		input.cursor && cursorDate
			? sql`AND (m.ended_at < ${cursorDate} OR (m.ended_at = ${cursorDate} AND m.id < ${input.cursor.id}))`
			: sql``;

	const result = await db.execute(sql`
		WITH player_matches AS (
			(
				SELECT
					m.id,
					m.mode,
					m.time_control,
					'red'::text AS player_side,
					m.winner_side,
					m.termination_reason,
					m.is_rated,
					m.total_plies,
					m.red_rating_before AS player_rating_before,
					m.red_rating_after AS player_rating_after,
					m.black_user_id AS opponent_user_id,
					m.black_display_name AS opponent_fallback_display_name,
					m.black_rating_before AS opponent_rating_before,
					m.black_rating_after AS opponent_rating_after,
					m.ended_at
				FROM matches m
				WHERE m.red_user_id = ${input.userId}
					${modeFilter}
					${cursorFilter}
				ORDER BY m.ended_at DESC, m.id DESC
				LIMIT ${fetchLimit}
			)
			UNION ALL
			(
				SELECT
					m.id,
					m.mode,
					m.time_control,
					'black'::text AS player_side,
					m.winner_side,
					m.termination_reason,
					m.is_rated,
					m.total_plies,
					m.black_rating_before AS player_rating_before,
					m.black_rating_after AS player_rating_after,
					m.red_user_id AS opponent_user_id,
					m.red_display_name AS opponent_fallback_display_name,
					m.red_rating_before AS opponent_rating_before,
					m.red_rating_after AS opponent_rating_after,
					m.ended_at
				FROM matches m
				WHERE m.black_user_id = ${input.userId}
					${modeFilter}
					${cursorFilter}
				ORDER BY m.ended_at DESC, m.id DESC
				LIMIT ${fetchLimit}
			)
		)
		SELECT
			pm.id,
			pm.mode,
			pm.time_control,
			pm.player_side,
			pm.winner_side,
			pm.termination_reason,
			pm.is_rated,
			pm.total_plies,
			pm.player_rating_before,
			pm.player_rating_after,
			pm.opponent_user_id,
			COALESCE(opp.display_name, pm.opponent_fallback_display_name) AS opponent_display_name,
			opp.handle AS opponent_handle,
			pm.opponent_rating_before,
			pm.opponent_rating_after,
			pm.ended_at
		FROM player_matches pm
		LEFT JOIN player_profiles opp ON opp.user_id = pm.opponent_user_id
		ORDER BY pm.ended_at DESC, pm.id DESC
		LIMIT ${fetchLimit}
	`);

	const rawRows = extractExecuteRows(result);
	const hasMore = rawRows.length > limit;
	const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;

	const historyItems: PlayerMatchHistoryItem[] = pageRows.map((row) => {
		const isRated = Boolean(row.is_rated);
		const playerSide = row.player_side === "black" ? "black" : "red";
		const winnerSide =
			row.winner_side === "red" || row.winner_side === "black"
				? row.winner_side
				: null;
		const playerRatingBefore = toNullableInt(row.player_rating_before);
		const playerRatingAfter = toNullableInt(row.player_rating_after);
		const opponentRatingBefore = toNullableInt(row.opponent_rating_before);
		const opponentRatingAfter = toNullableInt(row.opponent_rating_after);
		const opponentUserId =
			typeof row.opponent_user_id === "string" ? row.opponent_user_id : null;
		const opponentHandle =
			typeof row.opponent_handle === "string" ? row.opponent_handle : null;

		const opponent: MatchSeatSummary = {
			userId: opponentUserId,
			handle: opponentUserId ? opponentHandle : null,
			displayName: String(row.opponent_display_name ?? ""),
			ratingBefore: opponentRatingBefore,
			ratingAfter: opponentRatingAfter,
			ratingDelta: computeRatingDelta(
				isRated,
				opponentRatingBefore,
				opponentRatingAfter,
			),
		};

		return {
			id: String(row.id),
			mode: row.mode === "private_room" ? "private_room" : "public_lobby",
			timeControl: row.time_control as PlayerMatchHistoryItem["timeControl"],
			playerSide,
			outcome: derivePlayerOutcome(winnerSide, playerSide),
			winnerSide,
			terminationReason: String(row.termination_reason),
			isRated,
			totalPlies: Number(row.total_plies ?? 0),
			playerRatingBefore,
			playerRatingAfter,
			playerRatingDelta: computeRatingDelta(
				isRated,
				playerRatingBefore,
				playerRatingAfter,
			),
			opponent,
			endedAt: toIsoString(row.ended_at as Date | string),
		};
	});

	const last = historyItems[historyItems.length - 1];
	const nextCursor =
		hasMore && last
			? encodeMatchHistoryCursor({
					endedAt: last.endedAt,
					id: last.id,
				})
			: null;

	return {
		matches: historyItems,
		nextCursor,
	};
}

export async function getMatchReplayById(
	db: AnyDb,
	matchId: string,
): Promise<MatchReplayPayload | null> {
	const redProfile = alias(playerProfiles, "red_profile");
	const blackProfile = alias(playerProfiles, "black_profile");

	const rows = await db
		.select({
			id: matches.id,
			mode: matches.mode,
			timeControl: matches.timeControl,
			redUserId: matches.redUserId,
			blackUserId: matches.blackUserId,
			redDisplayName: matches.redDisplayName,
			blackDisplayName: matches.blackDisplayName,
			redProfileDisplayName: redProfile.displayName,
			redProfileHandle: redProfile.handle,
			blackProfileDisplayName: blackProfile.displayName,
			blackProfileHandle: blackProfile.handle,
			winnerSide: matches.winnerSide,
			terminationReason: matches.terminationReason,
			initialSetupFen: matches.initialSetupFen,
			movesUciJson: matches.movesUciJson,
			totalPlies: matches.totalPlies,
			isRated: matches.isRated,
			redRatingBefore: matches.redRatingBefore,
			redRatingAfter: matches.redRatingAfter,
			blackRatingBefore: matches.blackRatingBefore,
			blackRatingAfter: matches.blackRatingAfter,
			startedAt: matches.startedAt,
			endedAt: matches.endedAt,
		})
		.from(matches)
		.leftJoin(redProfile, eq(redProfile.userId, matches.redUserId))
		.leftJoin(blackProfile, eq(blackProfile.userId, matches.blackUserId))
		.where(eq(matches.id, matchId))
		.limit(1);

	const row = rows[0];
	if (!row) {
		return null;
	}

	const isRated = Boolean(row.isRated);
	const red: MatchSeatSummary = {
		userId: row.redUserId,
		handle: row.redUserId ? (row.redProfileHandle ?? null) : null,
		displayName: row.redProfileDisplayName ?? row.redDisplayName,
		ratingBefore: row.redRatingBefore,
		ratingAfter: row.redRatingAfter,
		ratingDelta: computeRatingDelta(
			isRated,
			row.redRatingBefore,
			row.redRatingAfter,
		),
	};

	const black: MatchSeatSummary = {
		userId: row.blackUserId,
		handle: row.blackUserId ? (row.blackProfileHandle ?? null) : null,
		displayName: row.blackProfileDisplayName ?? row.blackDisplayName,
		ratingBefore: row.blackRatingBefore,
		ratingAfter: row.blackRatingAfter,
		ratingDelta: computeRatingDelta(
			isRated,
			row.blackRatingBefore,
			row.blackRatingAfter,
		),
	};

	return {
		id: row.id,
		mode: row.mode,
		timeControl: row.timeControl,
		red,
		black,
		winnerSide: row.winnerSide,
		terminationReason: row.terminationReason,
		initialSetupFen: row.initialSetupFen,
		movesUci: Array.isArray(row.movesUciJson) ? row.movesUciJson : [],
		totalPlies: row.totalPlies,
		isRated,
		startedAt: toIsoString(row.startedAt),
		endedAt: toIsoString(row.endedAt),
	};
}

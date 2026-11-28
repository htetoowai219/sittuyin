import {
	calculateGlicko2MatchUpdate,
	isProvisionalRating,
	type RatingUpdatedEvent,
} from "@sittuyin/shared";
import { asc, eq, inArray } from "drizzle-orm";
import type { ServerDb } from "../client.js";
import { user } from "../schema/auth-schema.js";
import { matches, type NewMatchRow } from "../schema/matches.js";
import { playerProfiles } from "../schema/player-profiles.js";

export interface PersistAndRateMatchResult {
	readonly persisted: boolean;
	readonly ratingUpdated: RatingUpdatedEvent | null;
	readonly ratingSkippedReason?: string;
}

export interface PersistMatchLogger {
	warn(message: string, meta?: Record<string, unknown>): void;
}

export interface InsertMatchRepositoryLike {
	insertCompletedMatch?(row: NewMatchRow): Promise<void>;
	persistAndRateCompletedMatch?(
		row: NewMatchRow,
	): Promise<PersistAndRateMatchResult>;
}

export async function insertCompletedMatch(
	db: ServerDb,
	row: NewMatchRow,
): Promise<void> {
	await db
		.insert(matches)
		.values(row)
		.onConflictDoNothing({ target: matches.id });
}

export async function persistAndRateCompletedMatch(
	db: ServerDb,
	row: NewMatchRow,
	options: { readonly logger?: PersistMatchLogger } = {},
): Promise<PersistAndRateMatchResult> {
	return db.transaction(async (tx) => {
		const candidateUserIds = Array.from(
			new Set(
				[row.redUserId, row.blackUserId].filter(
					(id): id is string => typeof id === "string" && id.length > 0,
				),
			),
		).sort();

		const existingUserIds = new Set<string>();
		if (candidateUserIds.length > 0) {
			const lockedUsers = await tx
				.select({ id: user.id })
				.from(user)
				.where(inArray(user.id, candidateUserIds))
				.orderBy(asc(user.id))
				.for("key share");
			for (const u of lockedUsers) {
				existingUserIds.add(u.id);
			}
		}

		let effectiveRedUserId = row.redUserId ?? null;
		let effectiveBlackUserId = row.blackUserId ?? null;
		let missingUser = false;

		if (effectiveRedUserId && !existingUserIds.has(effectiveRedUserId)) {
			missingUser = true;
			effectiveRedUserId = null;
		}
		if (effectiveBlackUserId && !existingUserIds.has(effectiveBlackUserId)) {
			missingUser = true;
			effectiveBlackUserId = null;
		}

		if (missingUser) {
			options.logger?.warn(
				"Skipping Glicko-2 update because a seated user was deleted mid-match",
				{
					matchId: row.id,
					redUserId: row.redUserId ?? null,
					blackUserId: row.blackUserId ?? null,
				},
			);
		}

		const effectiveRow: NewMatchRow = {
			...row,
			redUserId: effectiveRedUserId,
			blackUserId: effectiveBlackUserId,
		};

		await tx
			.insert(matches)
			.values(effectiveRow)
			.onConflictDoNothing({ target: matches.id });

		const lockedMatchRows = await tx
			.select({
				isRated: matches.isRated,
				ratingAppliedAt: matches.ratingAppliedAt,
				redUserId: matches.redUserId,
				blackUserId: matches.blackUserId,
			})
			.from(matches)
			.where(eq(matches.id, row.id))
			.for("update");

		const matchRecord = lockedMatchRows[0];
		if (!matchRecord) {
			return {
				persisted: false,
				ratingUpdated: null,
				ratingSkippedReason: "match_not_found",
			};
		}

		if (!matchRecord.isRated) {
			return {
				persisted: true,
				ratingUpdated: null,
				ratingSkippedReason: "unrated",
			};
		}

		if (matchRecord.ratingAppliedAt !== null) {
			return {
				persisted: true,
				ratingUpdated: null,
				ratingSkippedReason: "already_applied",
			};
		}

		if (
			!matchRecord.redUserId ||
			!matchRecord.blackUserId ||
			matchRecord.redUserId === matchRecord.blackUserId
		) {
			return {
				persisted: true,
				ratingUpdated: null,
				ratingSkippedReason: missingUser
					? "deleted_user"
					: "invalid_seated_users",
			};
		}

		const sortedProfileIds = [
			matchRecord.redUserId,
			matchRecord.blackUserId,
		].sort();

		const lockedProfiles = await tx
			.select()
			.from(playerProfiles)
			.where(inArray(playerProfiles.userId, sortedProfileIds))
			.orderBy(asc(playerProfiles.userId))
			.for("update");

		const redProfile = lockedProfiles.find(
			(p) => p.userId === matchRecord.redUserId,
		);
		const blackProfile = lockedProfiles.find(
			(p) => p.userId === matchRecord.blackUserId,
		);

		if (!redProfile || !blackProfile) {
			options.logger?.warn(
				"Skipping Glicko-2 update because player_profiles row is missing",
				{
					matchId: row.id,
					redUserId: matchRecord.redUserId,
					blackUserId: matchRecord.blackUserId,
				},
			);
			return {
				persisted: true,
				ratingUpdated: null,
				ratingSkippedReason: "missing_profile",
			};
		}

		const scoreRed: 0 | 0.5 | 1 =
			row.winnerSide === "red" ? 1 : row.winnerSide === "black" ? 0 : 0.5;

		const nextRatings = calculateGlicko2MatchUpdate(
			{
				rating: redProfile.rating,
				ratingDeviation: redProfile.ratingDeviation,
				volatility: redProfile.volatility,
				lastRatedAt: redProfile.lastRatedAt,
			},
			{
				rating: blackProfile.rating,
				ratingDeviation: blackProfile.ratingDeviation,
				volatility: blackProfile.volatility,
				lastRatedAt: blackProfile.lastRatedAt,
			},
			scoreRed,
			row.endedAt,
		);

		const now = new Date();
		const redGamesAfter = redProfile.gamesPlayed + 1;
		const blackGamesAfter = blackProfile.gamesPlayed + 1;

		await tx
			.update(playerProfiles)
			.set({
				rating: nextRatings.red.rating,
				ratingDeviation: nextRatings.red.ratingDeviation,
				volatility: nextRatings.red.volatility,
				gamesPlayed: redGamesAfter,
				wins: redProfile.wins + (scoreRed === 1 ? 1 : 0),
				losses: redProfile.losses + (scoreRed === 0 ? 1 : 0),
				draws: redProfile.draws + (scoreRed === 0.5 ? 1 : 0),
				lastRatedAt: row.endedAt,
				updatedAt: now,
			})
			.where(eq(playerProfiles.userId, redProfile.userId));

		await tx
			.update(playerProfiles)
			.set({
				rating: nextRatings.black.rating,
				ratingDeviation: nextRatings.black.ratingDeviation,
				volatility: nextRatings.black.volatility,
				gamesPlayed: blackGamesAfter,
				wins: blackProfile.wins + (scoreRed === 0 ? 1 : 0),
				losses: blackProfile.losses + (scoreRed === 1 ? 1 : 0),
				draws: blackProfile.draws + (scoreRed === 0.5 ? 1 : 0),
				lastRatedAt: row.endedAt,
				updatedAt: now,
			})
			.where(eq(playerProfiles.userId, blackProfile.userId));

		const redBefore = Math.round(redProfile.rating);
		const redAfter = Math.round(nextRatings.red.rating);
		const blackBefore = Math.round(blackProfile.rating);
		const blackAfter = Math.round(nextRatings.black.rating);

		await tx
			.update(matches)
			.set({
				ratingAppliedAt: row.endedAt,
				redRatingBefore: redBefore,
				redRatingAfter: redAfter,
				blackRatingBefore: blackBefore,
				blackRatingAfter: blackAfter,
			})
			.where(eq(matches.id, row.id));

		return {
			persisted: true,
			ratingUpdated: {
				matchId: row.id,
				isRated: true,
				red: {
					userId: redProfile.userId,
					ratingBefore: redBefore,
					ratingAfter: redAfter,
					delta: redAfter - redBefore,
					ratingDeviationAfter: nextRatings.red.ratingDeviation,
					isProvisional: isProvisionalRating(
						nextRatings.red.ratingDeviation,
						redGamesAfter,
					),
				},
				black: {
					userId: blackProfile.userId,
					ratingBefore: blackBefore,
					ratingAfter: blackAfter,
					delta: blackAfter - blackBefore,
					ratingDeviationAfter: nextRatings.black.ratingDeviation,
					isProvisional: isProvisionalRating(
						nextRatings.black.ratingDeviation,
						blackGamesAfter,
					),
				},
			},
		};
	});
}

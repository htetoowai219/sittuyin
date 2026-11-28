import * as Sentry from "@sentry/node";
import {
	createServerDb,
	insertCompletedMatch,
	type NewMatchRow,
	type PersistAndRateMatchResult,
	persistAndRateCompletedMatch,
	type ServerDbConnection,
} from "@sittuyin/db";
import type { TerminationReason } from "@sittuyin/shared";
import pino from "pino";

export const serverLogger = pino({
	name: "sittuyin-server",
	level:
		process.env.LOG_LEVEL ??
		(process.env.NODE_ENV === "test" ? "silent" : "info"),
});

const COMPETITIVE_REASONS = new Set<TerminationReason>([
	"checkmate",
	"stalemate",
	"unavoidable_stalemate",
	"threefold_repetition",
	"fifty_move_rule",
	"bare_king_fifty_move",
	"insufficient_material",
	"resignation",
	"timeout",
	"abandonment",
	"agreed_draw",
]);

export function shouldPersistCompletedMatch(
	initialSetupFen: string | null | undefined,
	reason: TerminationReason,
): boolean {
	if (!initialSetupFen || initialSetupFen.trim().length === 0) {
		return false;
	}
	return COMPETITIVE_REASONS.has(reason);
}

let sharedConnection: ServerDbConnection | null = null;
let persistenceOverride: ((row: NewMatchRow) => Promise<void>) | null = null;
let persistAndRateOverride:
	| ((row: NewMatchRow) => Promise<PersistAndRateMatchResult>)
	| null = null;

export function setMatchPersistenceOverride(
	fn: ((row: NewMatchRow) => Promise<void>) | null,
): void {
	persistenceOverride = fn;
}

export function setMatchRatingPersistenceOverride(
	fn: ((row: NewMatchRow) => Promise<PersistAndRateMatchResult>) | null,
): void {
	persistAndRateOverride = fn;
}

export function getOrCreateSharedServerDb(): ServerDbConnection | null {
	if (sharedConnection) {
		return sharedConnection;
	}
	const databaseUrl = process.env.DATABASE_URL?.trim();
	if (!databaseUrl) {
		return null;
	}
	sharedConnection = createServerDb(databaseUrl, {
		onPoolError: (err) => {
			serverLogger.error({ err }, "Idle PostgreSQL pool client error");
		},
	});
	return sharedConnection;
}

export async function closeSharedServerDb(): Promise<void> {
	if (!sharedConnection) return;
	const conn = sharedConnection;
	sharedConnection = null;
	try {
		await conn.pool.end();
	} catch (err) {
		serverLogger.warn({ err }, "Error while closing shared PostgreSQL pool");
	}
}

export interface PersistMatchLogger {
	warn(obj: unknown, msg?: string): void;
	error(obj: unknown, msg?: string): void;
}

export interface PersistCompletedMatchOptions {
	readonly insertFn?: (row: NewMatchRow) => Promise<void>;
	readonly retryDelaysMs?: readonly number[];
	readonly logger?: PersistMatchLogger;
	readonly captureException?: (err: unknown) => void;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function persistCompletedMatchWithRetry(
	row: NewMatchRow,
	options: PersistCompletedMatchOptions = {},
): Promise<boolean> {
	const logger = options.logger ?? serverLogger;
	const retryDelays = options.retryDelaysMs ?? [500, 1500];
	const captureException =
		options.captureException ??
		((err: unknown) => {
			if (process.env.SENTRY_DSN) {
				Sentry.captureException(err);
			}
		});

	const resolvedInsert =
		options.insertFn ??
		persistenceOverride ??
		(() => {
			const conn = getOrCreateSharedServerDb();
			if (!conn) {
				return null;
			}
			return (matchRow: NewMatchRow) => insertCompletedMatch(conn.db, matchRow);
		})();

	if (!resolvedInsert) {
		logger.warn(
			{ matchId: row.id, roomId: row.roomId },
			"Skipping completed match DB persistence because DATABASE_URL is not configured",
		);
		return false;
	}

	const totalAttempts = 1 + retryDelays.length;
	let lastError: unknown = null;

	for (let attempt = 0; attempt < totalAttempts; attempt++) {
		try {
			await resolvedInsert(row);
			return true;
		} catch (err) {
			lastError = err;
			const delayMs = retryDelays[attempt];
			if (delayMs !== undefined) {
				logger.warn(
					{
						err,
						matchId: row.id,
						attempt: attempt + 1,
						nextDelayMs: delayMs,
					},
					"Transient error persisting completed match; retrying with backoff",
				);
				await sleep(delayMs);
			}
		}
	}

	logger.error(
		{
			err: lastError,
			matchId: row.id,
			roomId: row.roomId,
			attempts: totalAttempts,
		},
		"Exhausted all retries persisting completed match to PostgreSQL",
	);
	captureException(lastError);
	return false;
}

export interface PersistAndRateCompletedMatchOptions {
	readonly persistAndRateFn?: (
		row: NewMatchRow,
	) => Promise<PersistAndRateMatchResult>;
	readonly retryDelaysMs?: readonly number[];
	readonly logger?: PersistMatchLogger;
	readonly captureException?: (err: unknown) => void;
}

export async function persistAndRateCompletedMatchWithRetry(
	row: NewMatchRow,
	options: PersistAndRateCompletedMatchOptions = {},
): Promise<PersistAndRateMatchResult> {
	const logger = options.logger ?? serverLogger;
	const retryDelays = options.retryDelaysMs ?? [500, 1500];
	const captureException =
		options.captureException ??
		((err: unknown) => {
			if (process.env.SENTRY_DSN) {
				Sentry.captureException(err);
			}
		});

	const resolvedFn:
		| ((matchRow: NewMatchRow) => Promise<PersistAndRateMatchResult>)
		| null =
		options.persistAndRateFn ??
		persistAndRateOverride ??
		(persistenceOverride
			? async (matchRow: NewMatchRow) => {
					await persistenceOverride!(matchRow);
					return { persisted: true, ratingUpdated: null };
				}
			: (() => {
					const conn = getOrCreateSharedServerDb();
					if (!conn) {
						return null;
					}
					return (matchRow: NewMatchRow) =>
						persistAndRateCompletedMatch(conn.db, matchRow, {
							logger: {
								warn: (message, meta) => logger.warn(meta ?? {}, message),
							},
						});
				})());

	if (!resolvedFn) {
		logger.warn(
			{ matchId: row.id, roomId: row.roomId },
			"Skipping completed match DB persistence because DATABASE_URL is not configured",
		);
		return {
			persisted: false,
			ratingUpdated: null,
			ratingSkippedReason: "db_not_configured",
		};
	}

	const totalAttempts = 1 + retryDelays.length;
	let lastError: unknown = null;

	for (let attempt = 0; attempt < totalAttempts; attempt++) {
		try {
			return await resolvedFn(row);
		} catch (err) {
			lastError = err;
			const delayMs = retryDelays[attempt];
			if (delayMs !== undefined) {
				logger.warn(
					{
						err,
						matchId: row.id,
						attempt: attempt + 1,
						nextDelayMs: delayMs,
					},
					"Transient error persisting/rating completed match; retrying with backoff",
				);
				await sleep(delayMs);
			}
		}
	}

	logger.error(
		{
			err: lastError,
			matchId: row.id,
			roomId: row.roomId,
			attempts: totalAttempts,
		},
		"Exhausted all retries persisting/rating completed match to PostgreSQL",
	);
	captureException(lastError);
	return {
		persisted: false,
		ratingUpdated: null,
		ratingSkippedReason: "retries_exhausted",
	};
}

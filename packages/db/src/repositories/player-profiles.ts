import { eq, or } from "drizzle-orm";
import type { EdgeDb, EdgeTxDb, ServerDb } from "../client.js";
import { matches } from "../schema/matches.js";
import {
	type PlayerProfileRow,
	playerProfiles,
} from "../schema/player-profiles.js";

export type AnyDb = EdgeDb | EdgeTxDb | ServerDb;

export const DEFAULT_GUEST_DISPLAY_NAME_REGEX = /^Guest_[0-9a-fA-F]{4}$/;
export const DEFAULT_GUEST_HANDLE_REGEX = /^guest_[0-9a-f]{8}$/;
export const HANDLE_REGEX = /^[a-z0-9_]{3,24}$/;

export class HandleTakenError extends Error {
	readonly code = "HANDLE_TAKEN" as const;

	constructor(handle: string) {
		super(`Handle "${handle}" is already taken`);
		this.name = "HandleTakenError";
	}
}

export function isPgUniqueViolation(err: unknown): boolean {
	if (!err || typeof err !== "object") {
		return false;
	}
	const record = err as { code?: unknown; cause?: { code?: unknown } };
	return record.code === "23505" || record.cause?.code === "23505";
}

function randomHex(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateGuestHandle(): string {
	return `guest_${randomHex(4)}`;
}

export function normalizeDisplayName(name: string | null | undefined): string {
	const trimmed = (name ?? "").trim();
	if (trimmed.length === 0) {
		return `Guest_${randomHex(2)}`;
	}
	const chars = Array.from(trimmed);
	return chars.slice(0, 32).join("");
}

export async function getPlayerProfileByUserId(
	db: AnyDb,
	userId: string,
): Promise<PlayerProfileRow | null> {
	const rows = await db
		.select()
		.from(playerProfiles)
		.where(eq(playerProfiles.userId, userId))
		.limit(1);
	return rows[0] ?? null;
}

export interface CreatePlayerProfileInput {
	readonly userId: string;
	readonly name?: string | null;
	readonly locale?: "my" | "en";
	readonly handle?: string;
}

export async function createPlayerProfileForUser(
	db: AnyDb,
	input: CreatePlayerProfileInput,
): Promise<PlayerProfileRow> {
	const displayName = normalizeDisplayName(input.name);
	const locale = input.locale ?? "my";

	for (let attempt = 0; attempt < 5; attempt += 1) {
		const handle =
			attempt === 0 && input.handle ? input.handle : generateGuestHandle();
		try {
			const inserted = await db
				.insert(playerProfiles)
				.values({
					userId: input.userId,
					handle,
					displayName,
					rating: 1500,
					ratingDeviation: 350,
					volatility: 0.06,
					gamesPlayed: 0,
					wins: 0,
					losses: 0,
					draws: 0,
					lastRatedAt: null,
					locale,
				})
				.onConflictDoNothing({ target: playerProfiles.userId })
				.returning();

			if (inserted[0]) {
				return inserted[0];
			}

			const existing = await getPlayerProfileByUserId(db, input.userId);
			if (existing) {
				return existing;
			}
		} catch (err) {
			if (isPgUniqueViolation(err) && attempt < 4) {
				continue;
			}
			throw err;
		}
	}

	throw new Error("Failed to allocate unique player profile handle");
}

export interface UpdatePlayerProfileInput {
	readonly displayName?: string;
	readonly handle?: string;
	readonly locale?: "my" | "en";
}

export async function updatePlayerProfile(
	db: AnyDb,
	userId: string,
	patch: UpdatePlayerProfileInput,
): Promise<PlayerProfileRow | null> {
	const updates: Partial<typeof playerProfiles.$inferInsert> = {
		updatedAt: new Date(),
	};

	if (patch.displayName !== undefined) {
		updates.displayName = patch.displayName;
	}
	if (patch.handle !== undefined) {
		updates.handle = patch.handle.toLowerCase();
	}
	if (patch.locale !== undefined) {
		updates.locale = patch.locale;
	}

	try {
		const updated = await db
			.update(playerProfiles)
			.set(updates)
			.where(eq(playerProfiles.userId, userId))
			.returning();
		return updated[0] ?? null;
	} catch (err) {
		if (isPgUniqueViolation(err) && patch.handle) {
			throw new HandleTakenError(patch.handle.toLowerCase());
		}
		throw err;
	}
}

export interface LinkAnonymousProfileInput {
	readonly anonymousUserId: string;
	readonly newUserId: string;
}

export interface LinkAnonymousProfileResult {
	readonly isBrandNew: boolean;
}

export async function linkAnonymousProfileAndMatches(
	tx: AnyDb,
	input: LinkAnonymousProfileInput,
): Promise<LinkAnonymousProfileResult> {
	const { anonymousUserId, newUserId } = input;

	const [anonProfile, newProfile, existingMatches] = await Promise.all([
		getPlayerProfileByUserId(tx, anonymousUserId),
		getPlayerProfileByUserId(tx, newUserId),
		tx
			.select({ id: matches.id })
			.from(matches)
			.where(
				or(
					eq(matches.redUserId, newUserId),
					eq(matches.blackUserId, newUserId),
				),
			)
			.limit(1),
	]);

	const isBrandNew =
		(newProfile?.gamesPlayed ?? 0) === 0 && existingMatches.length === 0;

	await tx
		.update(matches)
		.set({ redUserId: newUserId })
		.where(eq(matches.redUserId, anonymousUserId));

	await tx
		.update(matches)
		.set({ blackUserId: newUserId })
		.where(eq(matches.blackUserId, anonymousUserId));

	if (isBrandNew && anonProfile && newProfile) {
		const hasCustomDisplayName = !DEFAULT_GUEST_DISPLAY_NAME_REGEX.test(
			anonProfile.displayName,
		);
		const hasCustomHandle = !DEFAULT_GUEST_HANDLE_REGEX.test(
			anonProfile.handle,
		);

		if (hasCustomHandle) {
			await tx
				.update(playerProfiles)
				.set({
					handle: `migrating_${crypto.randomUUID()}`,
					updatedAt: new Date(),
				})
				.where(eq(playerProfiles.userId, anonymousUserId));
		}

		const nextProfileValues: Partial<typeof playerProfiles.$inferInsert> = {
			rating: anonProfile.rating,
			ratingDeviation: anonProfile.ratingDeviation,
			volatility: anonProfile.volatility,
			gamesPlayed: anonProfile.gamesPlayed,
			wins: anonProfile.wins,
			losses: anonProfile.losses,
			draws: anonProfile.draws,
			lastRatedAt: anonProfile.lastRatedAt,
			locale: anonProfile.locale,
			updatedAt: new Date(),
		};

		if (hasCustomDisplayName) {
			nextProfileValues.displayName = anonProfile.displayName;
		}
		if (hasCustomHandle) {
			nextProfileValues.handle = anonProfile.handle;
		}

		await tx
			.update(playerProfiles)
			.set(nextProfileValues)
			.where(eq(playerProfiles.userId, newUserId));
	}

	return { isBrandNew };
}

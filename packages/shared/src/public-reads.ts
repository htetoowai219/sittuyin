import { z } from "zod";
import { SideSchema } from "./messages.js";
import { CanonicalRoomModeSchema, TimeControlSchema } from "./tickets.js";

export const PUBLIC_PAGE_SIZE_DEFAULT = 25;
export const PUBLIC_PAGE_SIZE_MAX = 25;
export const PLAYER_HANDLE_REGEX = /^[a-z0-9_]{3,24}$/;
export const MATCH_UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const PlayerHandleSchema = z
	.string()
	.regex(PLAYER_HANDLE_REGEX, "Invalid player handle");

export const MatchIdSchema = z
	.string()
	.regex(MATCH_UUID_REGEX, "Invalid match ID");

export const PageLimitSchema = z
	.number()
	.int()
	.min(1)
	.max(PUBLIC_PAGE_SIZE_MAX)
	.default(PUBLIC_PAGE_SIZE_DEFAULT);

export const OpaqueCursorSchema = z.string().min(1).max(512);

export const LeaderboardCursorPayloadSchema = z.object({
	rating: z.number().finite(),
	userId: z.string().min(1),
});

export type LeaderboardCursorPayload = z.infer<
	typeof LeaderboardCursorPayloadSchema
>;

export const MatchHistoryCursorPayloadSchema = z.object({
	endedAt: z.iso.datetime({ offset: true }),
	id: z.string().min(1),
});

export type MatchHistoryCursorPayload = z.infer<
	typeof MatchHistoryCursorPayloadSchema
>;

const BASE64URL_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const BASE64URL_LOOKUP = new Uint8Array(128).fill(255);
for (let i = 0; i < BASE64URL_ALPHABET.length; i += 1) {
	BASE64URL_LOOKUP[BASE64URL_ALPHABET.charCodeAt(i)] = i;
}

function encodeUtf8(input: string): Uint8Array {
	const out: number[] = [];
	for (let i = 0; i < input.length; i += 1) {
		const code = input.codePointAt(i);
		if (code === undefined) break;
		if (code > 0xffff) i += 1;
		if (code < 0x80) {
			out.push(code);
		} else if (code < 0x800) {
			out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
		} else if (code < 0x10000) {
			out.push(
				0xe0 | (code >> 12),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f),
			);
		} else {
			out.push(
				0xf0 | (code >> 18),
				0x80 | ((code >> 12) & 0x3f),
				0x80 | ((code >> 6) & 0x3f),
				0x80 | (code & 0x3f),
			);
		}
	}
	return new Uint8Array(out);
}

function decodeUtf8(bytes: Uint8Array): string {
	let result = "";
	let i = 0;
	while (i < bytes.length) {
		const b0 = bytes[i] ?? 0;
		if (b0 < 0x80) {
			result += String.fromCharCode(b0);
			i += 1;
		} else if ((b0 & 0xe0) === 0xc0 && i + 1 < bytes.length) {
			const b1 = bytes[i + 1] ?? 0;
			result += String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f));
			i += 2;
		} else if ((b0 & 0xf0) === 0xe0 && i + 2 < bytes.length) {
			const b1 = bytes[i + 1] ?? 0;
			const b2 = bytes[i + 2] ?? 0;
			result += String.fromCharCode(
				((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f),
			);
			i += 3;
		} else if ((b0 & 0xf8) === 0xf0 && i + 3 < bytes.length) {
			const b1 = bytes[i + 1] ?? 0;
			const b2 = bytes[i + 2] ?? 0;
			const b3 = bytes[i + 3] ?? 0;
			const cp =
				((b0 & 0x07) << 18) |
				((b1 & 0x3f) << 12) |
				((b2 & 0x3f) << 6) |
				(b3 & 0x3f);
			result += String.fromCodePoint(cp);
			i += 4;
		} else {
			throw new Error("INVALID_CURSOR: invalid UTF-8 sequence");
		}
	}
	return result;
}

function encodeBase64UrlUtf8(input: string): string {
	const bytes = encodeUtf8(input);
	let output = "";
	for (let i = 0; i < bytes.length; i += 3) {
		const b0 = bytes[i] ?? 0;
		const b1 = bytes[i + 1];
		const b2 = bytes[i + 2];
		output += BASE64URL_ALPHABET[b0 >> 2];
		output += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
		if (b1 !== undefined) {
			output += BASE64URL_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
		}
		if (b2 !== undefined) {
			output += BASE64URL_ALPHABET[b2 & 0x3f];
		}
	}
	return output;
}

function decodeBase64UrlUtf8(input: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(input) || input.length % 4 === 1) {
		throw new Error("INVALID_CURSOR: malformed base64url characters");
	}
	const outLen = Math.floor((input.length * 3) / 4);
	const bytes = new Uint8Array(outLen);
	let byteIndex = 0;
	for (let i = 0; i < input.length; i += 4) {
		const c0 = BASE64URL_LOOKUP[input.charCodeAt(i)] ?? 255;
		const c1 = BASE64URL_LOOKUP[input.charCodeAt(i + 1)] ?? 255;
		const c2 =
			i + 2 < input.length
				? (BASE64URL_LOOKUP[input.charCodeAt(i + 2)] ?? 255)
				: 0;
		const c3 =
			i + 3 < input.length
				? (BASE64URL_LOOKUP[input.charCodeAt(i + 3)] ?? 255)
				: 0;
		if (c0 === 255 || c1 === 255 || c2 === 255 || c3 === 255) {
			throw new Error("INVALID_CURSOR: invalid base64url byte");
		}
		bytes[byteIndex++] = (c0 << 2) | (c1 >> 4);
		if (i + 2 < input.length) {
			bytes[byteIndex++] = ((c1 & 0x0f) << 4) | (c2 >> 2);
		}
		if (i + 3 < input.length) {
			bytes[byteIndex++] = ((c2 & 0x03) << 6) | c3;
		}
	}
	return decodeUtf8(bytes);
}

export function encodeLeaderboardCursor(
	payload: LeaderboardCursorPayload,
): string {
	const parsed = LeaderboardCursorPayloadSchema.parse(payload);
	return encodeBase64UrlUtf8(JSON.stringify(parsed));
}

export function decodeLeaderboardCursor(
	cursor: string,
): LeaderboardCursorPayload {
	const validatedCursor = OpaqueCursorSchema.safeParse(cursor);
	if (!validatedCursor.success) {
		throw new Error("INVALID_CURSOR: cursor must be a non-empty string");
	}
	let raw: unknown;
	try {
		raw = JSON.parse(decodeBase64UrlUtf8(validatedCursor.data));
	} catch (err) {
		if (err instanceof Error && err.message.startsWith("INVALID_CURSOR")) {
			throw err;
		}
		throw new Error("INVALID_CURSOR: cursor payload is not valid JSON");
	}
	const parsed = LeaderboardCursorPayloadSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error("INVALID_CURSOR: leaderboard cursor schema mismatch");
	}
	return parsed.data;
}

export function encodeMatchHistoryCursor(
	payload: MatchHistoryCursorPayload,
): string {
	const parsed = MatchHistoryCursorPayloadSchema.parse(payload);
	return encodeBase64UrlUtf8(JSON.stringify(parsed));
}

export function decodeMatchHistoryCursor(
	cursor: string,
): MatchHistoryCursorPayload {
	const validatedCursor = OpaqueCursorSchema.safeParse(cursor);
	if (!validatedCursor.success) {
		throw new Error("INVALID_CURSOR: cursor must be a non-empty string");
	}
	let raw: unknown;
	try {
		raw = JSON.parse(decodeBase64UrlUtf8(validatedCursor.data));
	} catch (err) {
		if (err instanceof Error && err.message.startsWith("INVALID_CURSOR")) {
			throw err;
		}
		throw new Error("INVALID_CURSOR: cursor payload is not valid JSON");
	}
	const parsed = MatchHistoryCursorPayloadSchema.safeParse(raw);
	if (!parsed.success) {
		throw new Error("INVALID_CURSOR: match history cursor schema mismatch");
	}
	return parsed.data;
}

export const LeaderboardEntrySchema = z.object({
	userId: z.string().min(1),
	handle: PlayerHandleSchema,
	displayName: z.string().min(1),
	isAnonymous: z.boolean(),
	rating: z.number().finite(),
	ratingDeviation: z.number().finite(),
	gamesPlayed: z.number().int().min(0),
	wins: z.number().int().min(0),
	losses: z.number().int().min(0),
	draws: z.number().int().min(0),
	lastRatedAt: z.string().nullable(),
});

export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const ViewerLeaderboardStandingSchema = z.object({
	userId: z.string().min(1),
	handle: PlayerHandleSchema,
	displayName: z.string().min(1),
	isAnonymous: z.boolean(),
	rating: z.number().finite(),
	ratingDeviation: z.number().finite(),
	gamesPlayed: z.number().int().min(0),
	wins: z.number().int().min(0),
	losses: z.number().int().min(0),
	draws: z.number().int().min(0),
	qualified: z.boolean(),
	rank: z.number().int().min(1).nullable(),
	gamesRemaining: z.number().int().min(0),
	rdThresholdMet: z.boolean(),
});

export type ViewerLeaderboardStanding = z.infer<
	typeof ViewerLeaderboardStandingSchema
>;

export const LeaderboardPageSchema = z.object({
	entries: z.array(LeaderboardEntrySchema),
	nextCursor: z.string().nullable(),
	viewerStanding: ViewerLeaderboardStandingSchema.nullable(),
});

export type LeaderboardPage = z.infer<typeof LeaderboardPageSchema>;

export const PublicPlayerProfileSchema = z.object({
	userId: z.string().min(1),
	handle: PlayerHandleSchema,
	displayName: z.string().min(1),
	isAnonymous: z.boolean(),
	rating: z.number().finite(),
	ratingDeviation: z.number().finite(),
	isProvisional: z.boolean(),
	gamesPlayed: z.number().int().min(0),
	wins: z.number().int().min(0),
	losses: z.number().int().min(0),
	draws: z.number().int().min(0),
	lastRatedAt: z.string().nullable(),
	createdAt: z.string(),
});

export type PublicPlayerProfile = z.infer<typeof PublicPlayerProfileSchema>;

export const MatchSeatSummarySchema = z.object({
	userId: z.string().nullable(),
	handle: PlayerHandleSchema.nullable(),
	displayName: z.string().min(1),
	ratingBefore: z.number().int().nullable(),
	ratingAfter: z.number().int().nullable(),
	ratingDelta: z.number().int().nullable(),
});

export type MatchSeatSummary = z.infer<typeof MatchSeatSummarySchema>;

export const PlayerMatchOutcomeSchema = z.enum(["win", "loss", "draw"]);
export type PlayerMatchOutcome = z.infer<typeof PlayerMatchOutcomeSchema>;

export const PlayerMatchHistoryItemSchema = z.object({
	id: MatchIdSchema,
	mode: CanonicalRoomModeSchema,
	timeControl: TimeControlSchema,
	playerSide: SideSchema,
	outcome: PlayerMatchOutcomeSchema,
	winnerSide: SideSchema.nullable(),
	terminationReason: z.string().min(1),
	isRated: z.boolean(),
	totalPlies: z.number().int().min(0),
	playerRatingBefore: z.number().int().nullable(),
	playerRatingAfter: z.number().int().nullable(),
	playerRatingDelta: z.number().int().nullable(),
	opponent: MatchSeatSummarySchema,
	endedAt: z.string(),
});

export type PlayerMatchHistoryItem = z.infer<
	typeof PlayerMatchHistoryItemSchema
>;

export const PlayerMatchHistoryPageSchema = z.object({
	matches: z.array(PlayerMatchHistoryItemSchema),
	nextCursor: z.string().nullable(),
});

export type PlayerMatchHistoryPage = z.infer<
	typeof PlayerMatchHistoryPageSchema
>;

export const PublicPlayerProfilePageSchema = z.object({
	profile: PublicPlayerProfileSchema,
	isOwner: z.boolean(),
	matches: z.array(PlayerMatchHistoryItemSchema),
	nextCursor: z.string().nullable(),
});

export type PublicPlayerProfilePage = z.infer<
	typeof PublicPlayerProfilePageSchema
>;

export const MatchReplayPayloadSchema = z.object({
	id: MatchIdSchema,
	mode: CanonicalRoomModeSchema,
	timeControl: TimeControlSchema,
	red: MatchSeatSummarySchema,
	black: MatchSeatSummarySchema,
	winnerSide: SideSchema.nullable(),
	terminationReason: z.string().min(1),
	initialSetupFen: z.string().min(1),
	movesUci: z.array(z.string()),
	totalPlies: z.number().int().min(0),
	isRated: z.boolean(),
	startedAt: z.string(),
	endedAt: z.string(),
});

export type MatchReplayPayload = z.infer<typeof MatchReplayPayloadSchema>;

export const GetLeaderboardInputSchema = z.object({
	cursor: OpaqueCursorSchema.optional(),
	limit: PageLimitSchema.optional(),
});

export type GetLeaderboardInput = z.infer<typeof GetLeaderboardInputSchema>;

export const GetPublicPlayerProfileInputSchema = z.object({
	handle: PlayerHandleSchema,
	limit: PageLimitSchema.optional(),
});

export type GetPublicPlayerProfileInput = z.infer<
	typeof GetPublicPlayerProfileInputSchema
>;

export const GetPlayerMatchHistoryInputSchema = z.object({
	handle: PlayerHandleSchema,
	cursor: OpaqueCursorSchema.optional(),
	limit: PageLimitSchema.optional(),
});

export type GetPlayerMatchHistoryInput = z.infer<
	typeof GetPlayerMatchHistoryInputSchema
>;

export const GetMatchReplayInputSchema = z.object({
	matchId: MatchIdSchema,
});

export type GetMatchReplayInput = z.infer<typeof GetMatchReplayInputSchema>;

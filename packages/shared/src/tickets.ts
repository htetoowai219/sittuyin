import { z } from "zod";

export const CanonicalRoomModeSchema = z.enum(["public_lobby", "private_room"]);
export type CanonicalRoomMode = z.infer<typeof CanonicalRoomModeSchema>;

export const RoomModeInputSchema = z.enum([
	"public_lobby",
	"private_room",
	"quick_match",
]);
export type RoomModeInput = z.infer<typeof RoomModeInputSchema>;

export function normalizeRoomMode(mode: RoomModeInput): CanonicalRoomMode {
	return mode === "quick_match" ? "public_lobby" : mode;
}

export const RoomModeSchema = RoomModeInputSchema.transform(normalizeRoomMode);
export type RoomMode = z.output<typeof RoomModeSchema>;

export const PreferredSideSchema = z.enum(["red", "black", "random"]);
export type PreferredSide = z.infer<typeof PreferredSideSchema>;

export const RoleIntentSchema = z.enum(["player", "spectator"]);
export type RoleIntent = z.infer<typeof RoleIntentSchema>;

export const TimeControlSchema = z.enum([
	"rapid_10_5",
	"rapid_15_10",
	"classical_30_0",
]);
export type TimeControl = z.infer<typeof TimeControlSchema>;

export const RoomPhaseSchema = z.enum([
	"waiting",
	"setup",
	"playing",
	"finished",
]);
export type RoomPhase = z.infer<typeof RoomPhaseSchema>;

export const MatchJoinTicketClaimsSchema = z
	.object({
		sub: z.string().min(1),
		displayName: z.string().min(1).max(64),
		isAnonymous: z.boolean(),
		rating: z.number().finite(),
		isProvisional: z.boolean().optional().default(true),
		roomMode: RoomModeSchema,
		isRated: z.boolean().optional(),
		timeControl: TimeControlSchema,
		preferredSide: PreferredSideSchema.optional().default("random"),
		roomTitle: z.string().trim().min(1).max(48).optional(),
		roleIntent: RoleIntentSchema.optional().default("player"),
		iss: z.string().min(1),
		aud: z.string().min(1),
		iat: z.number().int(),
		exp: z.number().int(),
		jti: z.string().uuid(),
	})
	.transform((claims) => ({
		...claims,
		isRated: claims.roomMode === "private_room" ? false : (claims.isRated ?? true),
		roomTitle: claims.roomTitle ?? `${claims.displayName}'s Room`.slice(0, 48),
	}));

export type MatchJoinTicketClaimsInput = z.input<
	typeof MatchJoinTicketClaimsSchema
>;
export type MatchJoinTicketClaims = z.output<
	typeof MatchJoinTicketClaimsSchema
>;

export const LobbyRoomMetadataSchema = z.object({
	roomTitle: z.string().min(1).max(48),
	roomMode: CanonicalRoomModeSchema,
	isRated: z.boolean().default(false),
	timeControl: TimeControlSchema,
	phase: RoomPhaseSchema,
	hostDisplayName: z.string().min(1).max(64),
	hostRating: z.number().finite(),
	hostIsProvisional: z.boolean().default(true),
	hostPreferredSide: PreferredSideSchema,
	hostAssignedSide: z.enum(["red", "black"]),
	playerCount: z.number().int().min(0).max(2),
	spectatorCount: z.number().int().min(0).max(16),
});
export type LobbyRoomMetadata = z.infer<typeof LobbyRoomMetadataSchema>;

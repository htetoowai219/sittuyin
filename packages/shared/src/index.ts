import { z } from "zod";

export const SITTUYIN_ROOM_NAME = "sittuyin" as const;

export const RoomModeSchema = z.enum(["quick_match", "private_room"]);
export type RoomMode = z.infer<typeof RoomModeSchema>;

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

export const MatchJoinTicketClaimsSchema = z.object({
	sub: z.string().min(1),
	displayName: z.string().min(1).max(64),
	isAnonymous: z.boolean(),
	rating: z.number().finite(),
	roomMode: RoomModeSchema,
	timeControl: TimeControlSchema,
	iss: z.string().min(1),
	aud: z.string().min(1),
	iat: z.number().int(),
	exp: z.number().int(),
	jti: z.string().uuid(),
});
export type MatchJoinTicketClaims = z.infer<typeof MatchJoinTicketClaimsSchema>;

export const PingMessageSchema = z.object({
	sentAt: z.number().int().nonnegative(),
});
export type PingMessage = z.infer<typeof PingMessageSchema>;

export interface SittuyinPlayerSnapshot {
	readonly sessionId: string;
	readonly displayName: string;
	readonly side: "red" | "black" | "spectator";
	readonly connected: boolean;
}

export interface SittuyinRoomSnapshot {
	readonly phase: RoomPhase;
	readonly roomMode: RoomMode;
	readonly timeControl: TimeControl;
	readonly players: Readonly<Record<string, SittuyinPlayerSnapshot>>;
}

import type { Result, Square } from "@sittuyin/engine";
import { z } from "zod";

export const SideSchema = z.enum(["red", "black"]);

export const OfficerRoleSchema = z.enum([
	"king",
	"general",
	"rook",
	"elephant",
	"knight",
]);

export const SquareSchema = z.custom<Square>(
	(val): val is Square => typeof val === "string" && /^[a-h][1-8]$/.test(val),
	{ message: "Invalid algebraic square (expected a1..h8)" },
);

export const OpeningPresetIdSchema = z.enum([
	"myin_cha",
	"sin_cha",
	"yahhta_cha",
	"khan_tat",
	"sit_ke_cha",
]);

export const SetupActionSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("place"),
		role: OfficerRoleSchema,
		to: SquareSchema,
	}),
	z.object({
		kind: z.literal("move"),
		from: SquareSchema,
		to: SquareSchema,
	}),
	z.object({
		kind: z.literal("remove"),
		from: SquareSchema,
	}),
	z.object({
		kind: z.literal("apply_preset"),
		presetId: OpeningPresetIdSchema,
	}),
	z.object({
		kind: z.literal("clear"),
	}),
	z.object({
		kind: z.literal("lock"),
	}),
	z.object({
		kind: z.literal("unlock"),
	}),
]);

export const NormalMoveSchema = z.object({
	kind: z.literal("normal"),
	from: SquareSchema,
	to: SquareSchema,
});

export const PromoteMoveSchema = z.object({
	kind: z.literal("promote"),
	from: SquareSchema,
	to: SquareSchema,
	promoteTo: z.literal("general"),
});

export const DropMoveSchema = z.object({
	kind: z.literal("drop"),
	role: OfficerRoleSchema,
	to: SquareSchema,
});

export const MoveObjectSchema = z.discriminatedUnion("kind", [
	NormalMoveSchema,
	PromoteMoveSchema,
	DropMoveSchema,
]);

export const SetupActionMessageSchema = z.object({
	action: SetupActionSchema,
});
export type SetupActionMessage = z.infer<typeof SetupActionMessageSchema>;

export const RandomSetupMessageSchema = z.object({});
export type RandomSetupMessage = z.infer<typeof RandomSetupMessageSchema>;

export const MoveMessageSchema = z.union([
	z.object({
		move: MoveObjectSchema,
		uci: z.undefined().optional(),
	}),
	z.object({
		uci: z.string().min(3).max(8),
		move: z.undefined().optional(),
	}),
]);
export type MoveMessage = z.infer<typeof MoveMessageSchema>;

export const ResignMessageSchema = z.object({});
export type ResignMessage = z.infer<typeof ResignMessageSchema>;

export const OfferDrawMessageSchema = z.object({});
export type OfferDrawMessage = z.infer<typeof OfferDrawMessageSchema>;

export const RespondDrawMessageSchema = z.object({
	accept: z.boolean(),
});
export type RespondDrawMessage = z.infer<typeof RespondDrawMessageSchema>;

export const AbortMessageSchema = z.object({});
export type AbortMessage = z.infer<typeof AbortMessageSchema>;

export const OfferRematchMessageSchema = z.object({});
export type OfferRematchMessage = z.infer<typeof OfferRematchMessageSchema>;

export const RespondRematchMessageSchema = z.object({
	accept: z.boolean(),
});
export type RespondRematchMessage = z.infer<typeof RespondRematchMessageSchema>;

export const PingMessageSchema = z.object({
	sentAt: z.number().int().nonnegative(),
});
export type PingMessage = z.infer<typeof PingMessageSchema>;

export const TerminationReasonSchema = z.enum([
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
	"aborted_pre_move",
	"aborted_maintenance",
]);
export type TerminationReason = z.infer<typeof TerminationReasonSchema>;

export const RoomActionErrorCodeSchema = z.enum([
	"FORBIDDEN_SPECTATOR",
	"INVALID_PHASE",
	"INVALID_SETUP_MODE",
	"SIDE_ALREADY_LOCKED",
	"INVALID_SQUARE",
	"SQUARE_OCCUPIED",
	"SQUARE_EMPTY",
	"ROOK_MUST_BE_BACK_RANK",
	"OUTSIDE_SETUP_ZONE",
	"PIECE_NOT_IN_HAND",
	"SETUP_INCOMPLETE",
	"UNKNOWN_PRESET",
	"WRONG_TURN",
	"PROMOTION_NOT_ALLOWED",
	"ILLEGAL_STALEMATE",
	"ILLEGAL_MOVE",
	"INVALID_UCI",
	"INVALID_FEN",
	"INVALID_PIECE_COUNT",
	"OPPONENT_IN_CHECK",
	"REPLAY_MOVE_FAILED",
	"DRAW_ALREADY_PENDING",
	"DRAW_COOLDOWN_ACTIVE",
	"NO_DRAW_OFFER_PENDING",
	"ABORT_WINDOW_CLOSED",
	"OPPONENT_DISCONNECTED",
	"NO_REMATCH_PENDING",
	"SERVER_MAINTENANCE",
]);
export type RoomActionErrorCode = z.infer<typeof RoomActionErrorCodeSchema>;

export const RoomActionErrorSchema = z.object({
	code: RoomActionErrorCodeSchema,
	message: z.string(),
	details: z.record(z.string(), z.unknown()).optional(),
});
export type RoomActionError = z.infer<typeof RoomActionErrorSchema>;

export type RoomActionResult<T = void> = Result<T, RoomActionError>;

export const ActionErrorEventSchema = z.object({
	action: z.string(),
	code: RoomActionErrorCodeSchema,
	message: z.string(),
	details: z.record(z.string(), z.unknown()).optional(),
});
export type ActionErrorEvent = z.infer<typeof ActionErrorEventSchema>;

export const MatchStartedEventSchema = z.object({
	matchId: z.string().min(1),
	initialSetupFen: z.string().min(1),
	redRemainingMs: z.number().int().nonnegative(),
	blackRemainingMs: z.number().int().nonnegative(),
	syncedAtMs: z.number(),
});
export type MatchStartedEvent = z.infer<typeof MatchStartedEventSchema>;

export const MatchEndedEventSchema = z.object({
	matchId: z.string().min(1),
	status: z.enum(["win", "draw", "aborted"]),
	winner: SideSchema.nullable(),
	reason: TerminationReasonSchema,
	initialSetupFen: z.string().nullable(),
	movesUci: z.array(z.string()),
	persisted: z.boolean(),
});
export type MatchEndedEvent = z.infer<typeof MatchEndedEventSchema>;

export const DrawOfferedEventSchema = z.object({
	offeredBy: SideSchema,
	ply: z.number().int().nonnegative(),
});
export type DrawOfferedEvent = z.infer<typeof DrawOfferedEventSchema>;

export const DrawDeclinedEventSchema = z.object({
	declinedBy: SideSchema,
});
export type DrawDeclinedEvent = z.infer<typeof DrawDeclinedEventSchema>;

export const RematchOfferedEventSchema = z.object({
	offeredBy: SideSchema,
});
export type RematchOfferedEvent = z.infer<typeof RematchOfferedEventSchema>;

export const RematchStartedEventSchema = z.object({
	matchId: z.string().min(1),
	redSessionId: z.string().min(1),
	blackSessionId: z.string().min(1),
	setupRemainingMs: z.number().int().nonnegative(),
	syncedAtMs: z.number(),
});
export type RematchStartedEvent = z.infer<typeof RematchStartedEventSchema>;

export const ServerMaintenanceEventSchema = z.object({
	reason: z.string().min(1),
	timestamp: z.number(),
});
export type ServerMaintenanceEvent = z.infer<
	typeof ServerMaintenanceEventSchema
>;

export const PongEventSchema = z.object({
	sentAt: z.number().int().nonnegative(),
	serverTime: z.number(),
});
export type PongEvent = z.infer<typeof PongEventSchema>;

export const RatingDeltaSummarySchema = z.object({
	userId: z.string().min(1),
	ratingBefore: z.number().int(),
	ratingAfter: z.number().int(),
	delta: z.number().int(),
	ratingDeviationAfter: z.number().finite(),
	isProvisional: z.boolean(),
});
export type RatingDeltaSummary = z.infer<typeof RatingDeltaSummarySchema>;

export const RatingUpdatedEventSchema = z.object({
	matchId: z.string().min(1),
	isRated: z.boolean(),
	red: RatingDeltaSummarySchema,
	black: RatingDeltaSummarySchema,
});
export type RatingUpdatedEvent = z.infer<typeof RatingUpdatedEventSchema>;

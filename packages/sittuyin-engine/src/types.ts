export type Side = "red" | "black";

export type Viewer = Side | "spectator";

export type PieceRole =
	| "king"
	| "general"
	| "rook"
	| "elephant"
	| "knight"
	| "pawn";

export type OfficerRole = Exclude<PieceRole, "pawn">;

export type FileChar = "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";

export type RankChar = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8";

export type Square = `${FileChar}${RankChar}`;

export interface PieceNameEntry {
	readonly myanmar: string;
	readonly romanized: string;
	readonly english: string;
}

export interface Piece {
	readonly side: Side;
	readonly role: PieceRole;
}

export type Board = readonly (Piece | null)[];

export interface OfficerHand {
	readonly king: number;
	readonly general: number;
	readonly rook: number;
	readonly elephant: number;
	readonly knight: number;
}

export type SetupPlacements = Readonly<Partial<Record<Square, OfficerRole>>>;

export type SetupMode = "hidden_simultaneous" | "alternating_drops";

export type StalemateRule = "illegal" | "draw";

export interface RulesConfig {
	readonly setupMode: SetupMode;
	readonly stalemateRule: StalemateRule;
	readonly allowLastPawnPromoteAnywhere: boolean;
	readonly allowPromotionCheck: boolean;
	readonly enableBareKingFiftyMove: boolean;
}

export type GamePhase = "setup" | "playing" | "finished";

export interface DropMove {
	readonly kind: "drop";
	readonly role: OfficerRole;
	readonly to: Square;
}

export interface NormalMove {
	readonly kind: "normal";
	readonly from: Square;
	readonly to: Square;
}

export interface PromoteMove {
	readonly kind: "promote";
	readonly from: Square;
	readonly to: Square;
	readonly promoteTo: "general";
}

export type Move = DropMove | NormalMove | PromoteMove;

export type OpeningPresetId =
	| "myin_cha"
	| "sin_cha"
	| "yahhta_cha"
	| "khan_tat"
	| "sit_ke_cha";

export type SetupAction =
	| { readonly kind: "place"; readonly role: OfficerRole; readonly to: Square }
	| { readonly kind: "move"; readonly from: Square; readonly to: Square }
	| { readonly kind: "remove"; readonly from: Square }
	| { readonly kind: "apply_preset"; readonly presetId: OpeningPresetId }
	| { readonly kind: "clear" }
	| { readonly kind: "lock" }
	| { readonly kind: "unlock" };

export interface MoveRecord {
	readonly ply: number;
	readonly side: Side;
	readonly move: Move;
	readonly uci: string;
	readonly piece: PieceRole;
	readonly captured: PieceRole | null;
	readonly gaveCheck: boolean;
	readonly gaveCheckmate: boolean;
	readonly positionKey: string;
}

export type OutcomeReason =
	| "checkmate"
	| "stalemate"
	| "unavoidable_stalemate"
	| "threefold_repetition"
	| "fifty_move_rule"
	| "bare_king_fifty_move"
	| "insufficient_material";

export type GameOutcome =
	| {
			readonly status: "win";
			readonly winner: Side;
			readonly reason: "checkmate";
	  }
	| {
			readonly status: "draw";
			readonly winner: null;
			readonly reason: Exclude<OutcomeReason, "checkmate">;
	  };

export interface GameState {
	readonly phase: GamePhase;
	readonly rules: RulesConfig;
	readonly board: Board;
	readonly hands: Readonly<Record<Side, OfficerHand>>;
	readonly setupDrafts: Readonly<Record<Side, SetupPlacements>>;
	readonly setupReady: Readonly<Record<Side, boolean>>;
	readonly turn: Side;
	readonly halfmoveClock: number;
	readonly bareKingClock: number | null;
	readonly fullmoveNumber: number;
	readonly initialSetupFen: string | null;
	readonly positionCounts: Readonly<Record<string, number>>;
	readonly captured: Readonly<Record<Side, readonly PieceRole[]>>;
	readonly moveHistory: readonly MoveRecord[];
	readonly outcome: GameOutcome | null;
}

export interface PlayerGameView extends Omit<GameState, "setupDrafts"> {
	readonly viewer: Viewer;
	readonly myDraft: SetupPlacements;
	readonly placedCounts: Readonly<Record<Side, number>>;
}

export interface OpeningPreset {
	readonly id: OpeningPresetId;
	readonly name: {
		readonly myanmar: string;
		readonly romanized: string;
		readonly english: string;
	};
	readonly description: {
		readonly myanmar: string;
		readonly english: string;
	};
	readonly redPlacements: SetupPlacements;
}

export type EngineErrorCode =
	| "INVALID_PHASE"
	| "INVALID_SETUP_MODE"
	| "SIDE_ALREADY_LOCKED"
	| "INVALID_SQUARE"
	| "SQUARE_OCCUPIED"
	| "SQUARE_EMPTY"
	| "ROOK_MUST_BE_BACK_RANK"
	| "OUTSIDE_SETUP_ZONE"
	| "PIECE_NOT_IN_HAND"
	| "SETUP_INCOMPLETE"
	| "UNKNOWN_PRESET"
	| "WRONG_TURN"
	| "PROMOTION_NOT_ALLOWED"
	| "ILLEGAL_STALEMATE"
	| "ILLEGAL_MOVE"
	| "INVALID_UCI"
	| "INVALID_FEN"
	| "INVALID_PIECE_COUNT"
	| "OPPONENT_IN_CHECK"
	| "REPLAY_MOVE_FAILED";

export interface EngineError {
	readonly code: EngineErrorCode;
	readonly message: string;
	readonly details?: Readonly<Record<string, unknown>>;
}

export type Result<T, E = EngineError> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly error: E };

export interface FromFenOptions {
	readonly rules?: Partial<RulesConfig>;
	readonly bareKingClock?: number;
}

export type DisplayLocale = "my" | "en";

export function ok<T>(value: T): Result<T, never> {
	return { ok: true, value };
}

export function err(
	code: EngineErrorCode,
	message: string,
	details?: Readonly<Record<string, unknown>>,
): Result<never, EngineError> {
	return details !== undefined
		? { ok: false, error: { code, message, details } }
		: { ok: false, error: { code, message } };
}

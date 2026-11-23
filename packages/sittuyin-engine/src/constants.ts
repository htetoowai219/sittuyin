import type {
	OfficerHand,
	OfficerRole,
	PieceNameEntry,
	PieceRole,
	RulesConfig,
	Side,
	Square,
} from "./types.js";

export const BOARD_SIZE = 8;

export const SITTUYIN_PIECE_NAMES: Readonly<Record<PieceRole, PieceNameEntry>> =
	{
		king: { myanmar: "မင်းကြီး", romanized: "Min gyi", english: "King" },
		general: { myanmar: "စစ်ကဲ", romanized: "Sit ke", english: "General" },
		rook: { myanmar: "ရထား", romanized: "Yahhta", english: "Chariot" },
		elephant: { myanmar: "ဆင်", romanized: "Sin", english: "Elephant" },
		knight: { myanmar: "မြင်း", romanized: "Myin", english: "Knight" },
		pawn: { myanmar: "နယ်", romanized: "Ne", english: "Pawn" },
	};

export const ENGINE_METADATA = {
	name: "sittuyin-engine",
	boardSize: BOARD_SIZE,
	notation: "sittuyin-fen-uci",
} as const;

export const OFFICER_ROLES: readonly OfficerRole[] = [
	"king",
	"general",
	"rook",
	"elephant",
	"knight",
];

export const INITIAL_PAWN_SQUARES: Readonly<Record<Side, readonly Square[]>> = {
	red: ["a3", "b3", "c3", "d3", "e4", "f4", "g4", "h4"],
	black: ["a5", "b5", "c5", "d5", "e6", "f6", "g6", "h6"],
};

export const INITIAL_OFFICER_HAND: OfficerHand = {
	king: 1,
	general: 1,
	rook: 2,
	elephant: 2,
	knight: 2,
};

export const EMPTY_OFFICER_HAND: OfficerHand = {
	king: 0,
	general: 0,
	rook: 0,
	elephant: 0,
	knight: 0,
};

export const MAX_PIECE_COUNTS: Readonly<Record<PieceRole, number>> = {
	king: 1,
	general: 1,
	rook: 2,
	elephant: 2,
	knight: 2,
	pawn: 8,
};

export const ROOK_SETUP_SQUARES: Readonly<Record<Side, readonly Square[]>> = {
	red: ["a1", "b1", "c1", "d1", "e1", "f1", "g1", "h1"],
	black: ["a8", "b8", "c8", "d8", "e8", "f8", "g8", "h8"],
};

export const OFFICER_SETUP_SQUARES: Readonly<Record<Side, readonly Square[]>> =
	{
		red: [
			"a1",
			"b1",
			"c1",
			"d1",
			"e1",
			"f1",
			"g1",
			"h1",
			"a2",
			"b2",
			"c2",
			"d2",
			"e2",
			"f2",
			"g2",
			"h2",
			"e3",
			"f3",
			"g3",
			"h3",
		],
		black: [
			"a8",
			"b8",
			"c8",
			"d8",
			"e8",
			"f8",
			"g8",
			"h8",
			"a7",
			"b7",
			"c7",
			"d7",
			"e7",
			"f7",
			"g7",
			"h7",
			"a6",
			"b6",
			"c6",
			"d6",
		],
	};

export const SIT_KE_MYIN_SQUARES: Readonly<Record<Side, readonly Square[]>> = {
	red: ["a8", "b7", "c6", "d5", "e5", "f6", "g7", "h8"],
	black: ["a1", "b2", "c3", "d4", "e4", "f3", "g2", "h1"],
};

export const DEFAULT_RULES: RulesConfig = {
	setupMode: "hidden_simultaneous",
	stalemateRule: "illegal",
	allowLastPawnPromoteAnywhere: true,
	allowPromotionCheck: true,
	enableBareKingFiftyMove: true,
};

export const STARTING_SETUP_FEN =
	"8/8/4pppp/pppp4/4PPPP/PPPP4/8/8[KFRRSSNNkfrrssnn] w - - 0 1";

const ROOK_SETUP_SET: Readonly<Record<Side, ReadonlySet<Square>>> = {
	red: new Set(ROOK_SETUP_SQUARES.red),
	black: new Set(ROOK_SETUP_SQUARES.black),
};

const OFFICER_SETUP_SET: Readonly<Record<Side, ReadonlySet<Square>>> = {
	red: new Set(OFFICER_SETUP_SQUARES.red),
	black: new Set(OFFICER_SETUP_SQUARES.black),
};

const SIT_KE_MYIN_SET: Readonly<Record<Side, ReadonlySet<Square>>> = {
	red: new Set(SIT_KE_MYIN_SQUARES.red),
	black: new Set(SIT_KE_MYIN_SQUARES.black),
};

export function oppositeSide(side: Side): Side {
	return side === "red" ? "black" : "red";
}

export function remainingHandTotal(hand: OfficerHand): number {
	return hand.king + hand.general + hand.rook + hand.elephant + hand.knight;
}

export function isOfficerRole(role: unknown): role is OfficerRole {
	return (
		role === "king" ||
		role === "general" ||
		role === "rook" ||
		role === "elephant" ||
		role === "knight"
	);
}

export function isSquareOnBackRank(side: Side, square: Square): boolean {
	return ROOK_SETUP_SET[side].has(square);
}

export function isSquareInOfficerZone(side: Side, square: Square): boolean {
	return OFFICER_SETUP_SET[side].has(square);
}

export function isSquareInSetupZone(
	side: Side,
	role: OfficerRole,
	square: Square,
): boolean {
	return role === "rook"
		? isSquareOnBackRank(side, square)
		: isSquareInOfficerZone(side, square);
}

export function isSitKeMyinSquare(square: Square, side: Side): boolean {
	return SIT_KE_MYIN_SET[side].has(square);
}

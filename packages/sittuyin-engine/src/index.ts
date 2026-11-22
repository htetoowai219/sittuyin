export const BOARD_SIZE = 8;

export type Side = "red" | "black";

export type PieceRole =
	| "king"
	| "general"
	| "rook"
	| "elephant"
	| "knight"
	| "pawn";

export interface PieceNameEntry {
	readonly myanmar: string;
	readonly romanized: string;
	readonly english: string;
}

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

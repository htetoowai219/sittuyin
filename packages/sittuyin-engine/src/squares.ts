import type { FileChar, RankChar, Square } from "./types.js";

export const FILES: readonly FileChar[] = [
	"a",
	"b",
	"c",
	"d",
	"e",
	"f",
	"g",
	"h",
];

export const RANKS: readonly RankChar[] = [
	"1",
	"2",
	"3",
	"4",
	"5",
	"6",
	"7",
	"8",
];

const SQUARES_LIST: Square[] = [];
const SQUARE_TO_INDEX = new Map<string, number>();

for (let rank = 0; rank < 8; rank++) {
	const rankChar = RANKS[rank];
	if (rankChar === undefined) {
		continue;
	}
	for (let file = 0; file < 8; file++) {
		const fileChar = FILES[file];
		if (fileChar === undefined) {
			continue;
		}
		const square = `${fileChar}${rankChar}` as Square;
		const index = rank * 8 + file;
		SQUARES_LIST.push(square);
		SQUARE_TO_INDEX.set(square, index);
	}
}

export const ALL_SQUARES: readonly Square[] = SQUARES_LIST;

export function isValidSquare(value: unknown): value is Square {
	return typeof value === "string" && SQUARE_TO_INDEX.has(value);
}

export function squareToIndex(square: Square): number {
	const index = SQUARE_TO_INDEX.get(square);
	if (index === undefined) {
		throw new RangeError(`Invalid square: ${String(square)}`);
	}
	return index;
}

export function indexToSquare(index: number): Square {
	const square = ALL_SQUARES[index];
	if (square === undefined) {
		throw new RangeError(`Invalid board index: ${String(index)}`);
	}
	return square;
}

export function squareToCoords(square: Square): {
	readonly file: number;
	readonly rank: number;
} {
	const index = squareToIndex(square);
	return {
		file: index % 8,
		rank: Math.floor(index / 8),
	};
}

export function coordsToSquare(file: number, rank: number): Square | null {
	if (file < 0 || file > 7 || rank < 0 || rank > 7) {
		return null;
	}
	return ALL_SQUARES[rank * 8 + file] ?? null;
}

export function rotateSquare180(square: Square): Square {
	const index = squareToIndex(square);
	return indexToSquare(63 - index);
}

import { describe, expect, it } from "vitest";
import {
	applyMove,
	applySetupAction,
	BOARD_SIZE,
	coordsToSquare,
	createGame,
	ENGINE_METADATA,
	INITIAL_OFFICER_HAND,
	INITIAL_PAWN_SQUARES,
	indexToSquare,
	isSitKeMyinSquare,
	isValidSquare,
	type PieceNameEntry,
	rotateSquare180,
	SIT_KE_MYIN_SQUARES,
	SITTUYIN_PIECE_NAMES,
	squareToCoords,
	squareToIndex,
} from "./index.js";

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object") {
		Object.freeze(value);
		for (const prop of Object.values(value as Record<string, unknown>)) {
			deepFreeze(prop);
		}
	}
	return value;
}

describe("@sittuyin/engine foundation (AC-1, AC-13)", () => {
	it("preserves backwards compatible scaffold exports and metadata", () => {
		expect(BOARD_SIZE).toBe(8);
		expect(ENGINE_METADATA).toEqual({
			name: "sittuyin-engine",
			boardSize: 8,
			notation: "sittuyin-fen-uci",
		});
		expect(Object.keys(SITTUYIN_PIECE_NAMES)).toEqual([
			"king",
			"general",
			"rook",
			"elephant",
			"knight",
			"pawn",
		]);
		const entry: PieceNameEntry = SITTUYIN_PIECE_NAMES.general;
		expect(entry).toEqual({
			myanmar: "စစ်ကဲ",
			romanized: "Sit ke",
			english: "General",
		});
	});

	it("initializes the traditional staggered 16 pawn wall and 8 officer hands per side", () => {
		const game = createGame();
		expect(game.phase).toBe("setup");
		expect(game.turn).toBe("red");
		expect(game.board).toHaveLength(64);
		expect(game.hands.red).toEqual(INITIAL_OFFICER_HAND);
		expect(game.hands.black).toEqual(INITIAL_OFFICER_HAND);
		expect(game.initialSetupFen).toBeNull();
		expect(game.fullmoveNumber).toBe(1);
		expect(game.halfmoveClock).toBe(0);
		expect(game.bareKingClock).toBeNull();
		expect(game.outcome).toBeNull();

		let pieceCount = 0;
		for (let i = 0; i < 64; i++) {
			const sq = indexToSquare(i);
			const piece = game.board[i];
			if (INITIAL_PAWN_SQUARES.red.includes(sq)) {
				expect(piece).toEqual({ side: "red", role: "pawn" });
				pieceCount++;
			} else if (INITIAL_PAWN_SQUARES.black.includes(sq)) {
				expect(piece).toEqual({ side: "black", role: "pawn" });
				pieceCount++;
			} else {
				expect(piece).toBeNull();
			}
		}
		expect(pieceCount).toBe(16);
	});

	it("handles square coordinate math, validation, 180 degree rotation, and sit ke myin squares", () => {
		expect(squareToIndex("a1")).toBe(0);
		expect(squareToIndex("h1")).toBe(7);
		expect(squareToIndex("a8")).toBe(56);
		expect(squareToIndex("h8")).toBe(63);
		expect(squareToCoords("e4")).toEqual({ file: 4, rank: 3 });
		expect(coordsToSquare(4, 3)).toBe("e4");
		expect(coordsToSquare(-1, 0)).toBeNull();
		expect(coordsToSquare(8, 0)).toBeNull();
		expect(isValidSquare("a1")).toBe(true);
		expect(isValidSquare("h8")).toBe(true);
		expect(isValidSquare("i1")).toBe(false);
		expect(isValidSquare("a9")).toBe(false);
		expect(isValidSquare("__proto__")).toBe(false);

		// 180 degree rotation maps Red starting pawns cleanly to Black starting pawns
		const mirroredRedPawns = INITIAL_PAWN_SQUARES.red
			.map(rotateSquare180)
			.sort();
		expect(mirroredRedPawns).toEqual([...INITIAL_PAWN_SQUARES.black].sort());

		// 180 degree rotation maps Red sit ke myin squares cleanly to Black sit ke myin squares
		const mirroredRedDiag = SIT_KE_MYIN_SQUARES.red.map(rotateSquare180).sort();
		expect(mirroredRedDiag).toEqual([...SIT_KE_MYIN_SQUARES.black].sort());
		expect(isSitKeMyinSquare("c6", "red")).toBe(true);
		expect(isSitKeMyinSquare("c6", "black")).toBe(false);
		expect(isSitKeMyinSquare("f3", "black")).toBe(true);
	});

	it("never mutates frozen input GameState during setup or playing transitions", () => {
		const initial = deepFreeze(createGame());
		const placed = applySetupAction(initial, "red", {
			kind: "place",
			role: "rook",
			to: "a1",
		});
		expect(placed.ok).toBe(true);
		if (!placed.ok) return;

		const presetRed = applySetupAction(deepFreeze(placed.value), "red", {
			kind: "apply_preset",
			presetId: "myin_cha",
		});
		expect(presetRed.ok).toBe(true);
		if (!presetRed.ok) return;

		const lockRed = applySetupAction(deepFreeze(presetRed.value), "red", {
			kind: "lock",
		});
		expect(lockRed.ok).toBe(true);
		if (!lockRed.ok) return;

		const presetBlack = applySetupAction(deepFreeze(lockRed.value), "black", {
			kind: "apply_preset",
			presetId: "sin_cha",
		});
		expect(presetBlack.ok).toBe(true);
		if (!presetBlack.ok) return;

		const playing = applySetupAction(deepFreeze(presetBlack.value), "black", {
			kind: "lock",
		});
		expect(playing.ok).toBe(true);
		if (!playing.ok) return;

		const moved = applyMove(deepFreeze(playing.value), {
			kind: "normal",
			from: "e4",
			to: "e5",
		});
		expect(moved.ok).toBe(true);
		expect(initial.setupDrafts.red).toEqual({});
		expect(initial.hands.red.rook).toBe(2);
	});
});

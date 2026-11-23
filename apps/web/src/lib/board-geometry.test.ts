import { describe, expect, it } from "vitest";
import {
	BOARD_VIEWBOX_SIZE,
	clientPointToSquare,
	computeMaterialAdvantage,
	getDisplayFiles,
	getDisplayRanks,
	isBoardFlipped,
	sortCapturedPieces,
	squareToSvgRect,
	stepSquareByVisualDelta,
} from "./board-geometry";

describe("board-geometry", () => {
	it("maps squares to SVG coordinates in normal and flipped orientation", () => {
		const a1Normal = squareToSvgRect("a1", false);
		expect(a1Normal).toMatchObject({ col: 0, row: 7, x: 40, y: 740 });
		const h8Normal = squareToSvgRect("h8", false);
		expect(h8Normal).toMatchObject({ col: 7, row: 0, x: 740, y: 40 });

		const a1Flipped = squareToSvgRect("a1", true);
		expect(a1Flipped).toMatchObject({ col: 7, row: 0, x: 740, y: 40 });
		const h8Flipped = squareToSvgRect("h8", true);
		expect(h8Flipped).toMatchObject({ col: 0, row: 7, x: 40, y: 740 });
	});

	it("maps client coordinates back to squares and returns null outside playfield", () => {
		const rect = {
			left: 100,
			top: 200,
			width: BOARD_VIEWBOX_SIZE,
			height: BOARD_VIEWBOX_SIZE,
		};
		expect(clientPointToSquare(rect, 100 + 90, 200 + 790, false)).toBe("a1");
		expect(clientPointToSquare(rect, 100 + 90, 200 + 790, true)).toBe("h8");
		expect(clientPointToSquare(rect, 100 + 10, 200 + 10, false)).toBeNull();
		expect(clientPointToSquare(rect, 100 + 860, 200 + 400, false)).toBeNull();
	});

	it("steps squares respecting visual orientation for roving keyboard focus", () => {
		expect(stepSquareByVisualDelta("e4", 0, -1, false)).toBe("e5");
		expect(stepSquareByVisualDelta("e4", 0, -1, true)).toBe("e3");
		expect(stepSquareByVisualDelta("a1", -1, 1, false)).toBe("a1");
		expect(stepSquareByVisualDelta("h8", 1, -1, false)).toBe("h8");
	});

	it("computes display coordinates and flip XOR logic", () => {
		expect(getDisplayFiles(false)[0]).toBe("a");
		expect(getDisplayFiles(true)[0]).toBe("h");
		expect(getDisplayRanks(false)[0]).toBe("8");
		expect(getDisplayRanks(true)[0]).toBe("1");

		expect(isBoardFlipped("red", false)).toBe(false);
		expect(isBoardFlipped("red", true)).toBe(true);
		expect(isBoardFlipped("black", false)).toBe(true);
		expect(isBoardFlipped("black", true)).toBe(false);
		expect(isBoardFlipped("spectator", false)).toBe(false);
		expect(isBoardFlipped("spectator", true)).toBe(true);
	});

	it("sorts captured pieces in traditional order and calculates material delta", () => {
		const sorted = sortCapturedPieces([
			"pawn",
			"general",
			"rook",
			"knight",
			"elephant",
		]);
		expect(sorted).toEqual(["rook", "elephant", "knight", "general", "pawn"]);

		const diff = computeMaterialAdvantage({
			red: ["rook", "pawn"],
			black: ["pawn"],
		});
		expect(diff).toEqual({ red: 5, black: 0 });
	});
});

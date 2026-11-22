import { describe, expect, it } from "vitest";
import { BOARD_SIZE, ENGINE_METADATA, SITTUYIN_PIECE_NAMES } from "./index.js";

describe("@sittuyin/engine scaffold", () => {
	it("exposes standard 8x8 board metadata and all six Sittuyin piece roles", () => {
		expect(BOARD_SIZE).toBe(8);
		expect(ENGINE_METADATA.notation).toBe("sittuyin-fen-uci");
		expect(Object.keys(SITTUYIN_PIECE_NAMES)).toEqual([
			"king",
			"general",
			"rook",
			"elephant",
			"knight",
			"pawn",
		]);
	});
});

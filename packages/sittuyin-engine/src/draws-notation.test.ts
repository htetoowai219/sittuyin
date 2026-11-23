import { describe, expect, it } from "vitest";
import {
	applyMove,
	applySetupAction,
	applyUci,
	createGame,
	formatMoveDisplay,
	fromFen,
	parseUci,
	replayMatch,
	STARTING_SETUP_FEN,
	toFen,
	toUci,
} from "./index.js";

function mustFen(fen: string, options?: Parameters<typeof fromFen>[1]) {
	const res = fromFen(fen, options);
	if (!res.ok) {
		throw new Error(
			`Expected valid FEN "${fen}", got ${res.error.code}: ${res.error.message}`,
		);
	}
	return res.value;
}

describe("draw rules and checkmate terminal priority (AC-7, AC-9)", () => {
	it("triggers automatic threefold repetition draw (including perpetual check)", () => {
		let state = mustFen("7k/8/8/8/8/8/R7/7K w - - 0 1");
		// Repeat a2->b2, h8->g8, b2->a2, g8->h8 twice -> 3rd occurrence of start position
		const cycle = [
			"a2b2",
			"h8g8",
			"b2a2",
			"g8h8",
			"a2b2",
			"h8g8",
			"b2a2",
			"g8h8",
		];
		for (const uci of cycle) {
			const next = applyUci(state, uci);
			expect(next.ok).toBe(true);
			if (!next.ok) return;
			state = next.value;
		}
		expect(state.phase).toBe("finished");
		expect(state.outcome).toEqual({
			status: "draw",
			winner: null,
			reason: "threefold_repetition",
		});
	});

	it("draws bare King dead positions immediately while allowing K+S vs K corner checkmate", () => {
		for (const fen of [
			"7k/8/8/8/8/8/8/7K w - - 0 1", // K vs K
			"7k/8/8/8/8/8/4N3/7K w - - 0 1", // K+N vs K
			"7k/8/8/8/8/8/4F3/7K w - - 0 1", // K+F vs K
			"7k/8/8/8/8/8/4P3/7K w - - 0 1", // K+P vs K
		]) {
			const s = mustFen(fen);
			expect(s.phase).toBe("finished");
			expect(s.outcome).toEqual({
				status: "draw",
				winner: null,
				reason: "insufficient_material",
			});
		}

		// K+F vs K+F does NOT auto draw as insufficient_material
		const genVsGen = mustFen("7k/4f3/8/8/8/8/4F3/7K w - - 0 1");
		expect(genVsGen.phase).toBe("playing");

		// K+S vs K continues AND delivers legal corner checkmate (Black K a8, Red K a6, Red S c6 -> b7#)
		const elephantMate = mustFen("k7/8/K1S5/8/8/8/8/8 w - - 0 1");
		expect(elephantMate.phase).toBe("playing");
		const mated = applyUci(elephantMate, "c6b7");
		expect(mated.ok).toBe(true);
		if (!mated.ok) return;
		expect(mated.value.phase).toBe("finished");
		expect(mated.value.outcome).toEqual({
			status: "win",
			winner: "red",
			reason: "checkmate",
		});
	});

	it("enforces standard 50 move draw, bare King 50 move countdown, and checkmate priority", () => {
		// Standard 50 move rule triggers at halfmoveClock === 100
		const near50 = mustFen("7k/r7/8/8/8/8/R7/7K w - - 99 50");
		const drawn50 = applyUci(near50, "a2b2");
		expect(drawn50.ok).toBe(true);
		if (!drawn50.ok) return;
		expect(drawn50.value.phase).toBe("finished");
		expect(drawn50.value.outcome).toEqual({
			status: "draw",
			winner: null,
			reason: "fifty_move_rule",
		});

		// Checkmate on the 100th halfmove ALWAYS wins over 50 move draw!
		// Black King a8, Red King c7 (covers b8 and b7), Red Rook b1 -> a1#
		const mateOn100 = mustFen("k7/2K5/8/8/8/8/8/1R6 w - - 99 50");
		const won = applyUci(mateOn100, "b1a1");
		expect(won.ok).toBe(true);
		if (!won.ok) return;
		expect(won.value.phase).toBe("finished");
		expect(won.value.outcome).toEqual({
			status: "win",
			winner: "red",
			reason: "checkmate",
		});

		// Bare King 50 move rule initializes to 0 on capture reducing to bare King,
		// increments even on pawn moves, resets on capture, and draws at 100 plies
		const preBare = mustFen("7k/8/8/8/3p4/2P5/4R3/7K w - - 0 20");
		expect(preBare.bareKingClock).toBeNull();
		const reducedToBare = applyUci(preBare, "c3d4"); // captures Black's last non-king piece!
		expect(reducedToBare.ok).toBe(true);
		if (!reducedToBare.ok) return;
		expect(reducedToBare.value.bareKingClock).toBe(0);

		// Black King moves -> bareKingClock increments to 1
		const afterBlack = applyUci(reducedToBare.value, "h8g8");
		expect(afterBlack.ok).toBe(true);
		if (!afterBlack.ok) return;
		expect(afterBlack.value.bareKingClock).toBe(1);

		// Red Pawn pushes -> halfmoveClock resets to 0, yet bareKingClock increments to 2!
		const afterPawnPush = applyUci(afterBlack.value, "d4d5");
		expect(afterPawnPush.ok).toBe(true);
		if (!afterPawnPush.ok) return;
		expect(afterPawnPush.value.halfmoveClock).toBe(0);
		expect(afterPawnPush.value.bareKingClock).toBe(2);

		// Bare King 50 move triggers at 100 even when halfmoveClock is 0 (pawn push!)
		const nearBareDraw = mustFen("7k/8/8/8/3P4/8/4R3/7K w - - 0 60", {
			bareKingClock: 99,
		});
		const bareDraw = applyUci(nearBareDraw, "d4d5");
		expect(bareDraw.ok).toBe(true);
		if (!bareDraw.ok) return;
		expect(bareDraw.value.phase).toBe("finished");
		expect(bareDraw.value.outcome).toEqual({
			status: "draw",
			winner: null,
			reason: "bare_king_fifty_move",
		});

		// Bare King clock resets to 0 when bare King captures a piece
		const bareCapture = mustFen("7k/6P1/8/8/8/8/4R3/7K b - - 0 40", {
			bareKingClock: 55,
		});
		const resetCap = applyUci(bareCapture, "h8g7");
		expect(resetCap.ok).toBe(true);
		if (!resetCap.ok) return;
		expect(resetCap.value.bareKingClock).toBe(0);

		// When enableBareKingFiftyMove is false, bareKingClock stays null
		const disabledBare = mustFen("7k/8/8/8/3P4/8/4R3/7K w - - 0 60", {
			rules: { enableBareKingFiftyMove: false },
			bareKingClock: 99,
		});
		expect(disabledBare.bareKingClock).toBeNull();
		expect(disabledBare.phase).toBe("playing");
	});
});

describe("Sittuyin FEN, UCI, bilingual display, and replayMatch (AC-10, AC-11, AC-12)", () => {
	it("emits valid uncommitted FEN during hidden setup and strictly validates fromFen", () => {
		let hidden = createGame();
		const p = applySetupAction(hidden, "red", {
			kind: "place",
			role: "king",
			to: "b1",
		});
		expect(p.ok).toBe(true);
		if (!p.ok) return;
		hidden = p.value;

		// Even after drafting King, toFen emits full valid starting pool with zero draft leak
		expect(toFen(hidden)).toBe(STARTING_SETUP_FEN);

		// Round trip Fairy Stockfish starting FEN with arbitrary hand letter order
		const shuffledHand = fromFen(
			"8/8/4pppp/pppp4/4PPPP/PPPP4/8/8[kfrrssnnKFRRSSNN] w - - 0 1",
		);
		expect(shuffledHand.ok).toBe(true);
		if (!shuffledHand.ok) return;
		expect(shuffledHand.value.phase).toBe("setup");
		expect(shuffledHand.value.rules.setupMode).toBe("alternating_drops");
		expect(toFen(shuffledHand.value)).toBe(STARTING_SETUP_FEN);

		// Can immediately apply a drop after importing non-empty hand FEN
		const dropped = applyUci(shuffledHand.value, "R@a1");
		expect(dropped.ok).toBe(true);

		// Rejections
		expect(fromFen("invalid fen").ok).toBe(false);
		expect(fromFen("8/8/8/8/8/8/8/8 w K - 0 1").ok).toBe(false); // bad castling
		expect(fromFen("8/8/8/8/8/8/8/8[P] w - - 0 1").ok).toBe(false); // pawn in hand

		const noKing = fromFen("8/8/8/8/8/8/8/7K w - - 0 1");
		expect(noKing.ok).toBe(false);
		if (!noKing.ok) expect(noKing.error.code).toBe("INVALID_PIECE_COUNT");

		const twoGenerals = fromFen("7k/8/8/8/8/8/2FF4/7K w - - 0 1");
		expect(twoGenerals.ok).toBe(false);
		if (!twoGenerals.ok)
			expect(twoGenerals.error.code).toBe("INVALID_PIECE_COUNT");

		const threeRooks = fromFen("7k/8/8/8/8/8/RRR5/7K w - - 0 1");
		expect(threeRooks.ok).toBe(false);
		if (!threeRooks.ok)
			expect(threeRooks.error.code).toBe("INVALID_PIECE_COUNT");

		// Uneven drop hand parity (Red 0 in hand, Black 1 in hand, Red to move -> would soft lock)
		const badParity = fromFen("7k/8/4pppp/pppp4/4PPPP/PPPP4/8/7K[r] w - - 0 1");
		expect(badParity.ok).toBe(false);
		if (!badParity.ok) expect(badParity.error.code).toBe("INVALID_PIECE_COUNT");

		// Opponent already in check
		const oppCheck = fromFen("4k3/8/8/8/8/8/4R3/7K w - - 0 1");
		expect(oppCheck.ok).toBe(false);
		if (!oppCheck.ok) expect(oppCheck.error.code).toBe("OPPONENT_IN_CHECK");

		// Invalid bareKingClock option
		const badBareOpt = fromFen("7k/8/8/8/8/8/4R3/7K w - - 0 1", {
			bareKingClock: -1,
		});
		expect(badBareOpt.ok).toBe(false);
		if (!badBareOpt.ok) expect(badBareOpt.error.code).toBe("INVALID_FEN");

		// Importing bareKingClock >= 100 auto-detects bare_king_fifty_move finished state
		const bareDone = mustFen("7k/8/8/8/8/8/4R3/7K w - - 0 60", {
			bareKingClock: 100,
		});
		expect(bareDone.phase).toBe("finished");
		expect(bareDone.outcome).toEqual({
			status: "draw",
			winner: null,
			reason: "bare_king_fifty_move",
		});
	});

	it("parses strict Sittuyin UCI and replays both hidden setup and alternating drop matches", () => {
		expect(parseUci("e4e5")).toEqual({
			ok: true,
			value: { kind: "normal", from: "e4", to: "e5" },
		});
		expect(parseUci("R@a1")).toEqual({
			ok: true,
			value: { kind: "drop", role: "rook", to: "a1" },
		});
		expect(parseUci("c6c6f")).toEqual({
			ok: true,
			value: { kind: "promote", from: "c6", to: "c6", promoteTo: "general" },
		});
		expect(parseUci("c6b5f")).toEqual({
			ok: true,
			value: { kind: "promote", from: "c6", to: "b5", promoteTo: "general" },
		});
		expect(toUci({ kind: "drop", role: "elephant", to: "c2" })).toBe("S@c2");

		for (const bad of ["P@a1", "r@a1", "c6b5F", "e4e4", "a0a1", "", " e4e5"]) {
			const res = parseUci(bad);
			expect(res.ok).toBe(false);
			if (!res.ok) expect(res.error.code).toBe("INVALID_UCI");
		}

		// Replay hidden setup match
		let hidden = createGame();
		const r1 = applySetupAction(hidden, "red", {
			kind: "apply_preset",
			presetId: "myin_cha",
		});
		if (!r1.ok) throw new Error(r1.error.message);
		const r2 = applySetupAction(r1.value, "red", { kind: "lock" });
		if (!r2.ok) throw new Error(r2.error.message);
		const b1 = applySetupAction(r2.value, "black", {
			kind: "apply_preset",
			presetId: "sin_cha",
		});
		if (!b1.ok) throw new Error(b1.error.message);
		const b2 = applySetupAction(b1.value, "black", { kind: "lock" });
		if (!b2.ok) throw new Error(b2.error.message);
		hidden = b2.value;

		const initFen = hidden.initialSetupFen;
		expect(initFen).not.toBeNull();
		if (initFen === null) return;

		const uciSeq = ["e4e5", "d5d4", "e3d5"];
		const replayed = replayMatch(initFen, uciSeq);
		expect(replayed.ok).toBe(true);
		if (!replayed.ok) return;
		expect(replayed.value).toHaveLength(uciSeq.length + 1);
		expect(replayed.value[0]?.moveHistory).toHaveLength(0);
		expect(replayed.value[3]?.moveHistory).toHaveLength(3);

		// Failing move reports exact 1 indexed ply and causeCode
		const badReplay = replayMatch(initFen, ["e4e5", "e8e1"]);
		expect(badReplay.ok).toBe(false);
		if (!badReplay.ok) {
			expect(badReplay.error.code).toBe("REPLAY_MOVE_FAILED");
			expect(badReplay.error.details?.ply).toBe(2);
			expect(badReplay.error.details?.causeCode).toBe("ILLEGAL_MOVE");
		}

		// Invalid initialSetupFen propagates fromFen code verbatim
		const badFenReplay = replayMatch("8/8/8/8/8/8/8/7K w - - 0 1", []);
		expect(badFenReplay.ok).toBe(false);
		if (!badFenReplay.ok) {
			expect(badFenReplay.error.code).toBe("INVALID_PIECE_COUNT");
		}

		// Replay alternating drop match from STARTING_SETUP_FEN
		const dropReplay = replayMatch(STARTING_SETUP_FEN, ["R@a1", "R@h8"]);
		expect(dropReplay.ok).toBe(true);
		if (!dropReplay.ok) return;
		expect(dropReplay.value).toHaveLength(3);
		expect(dropReplay.value[2]?.fullmoveNumber).toBe(2);
	});

	it("formats English and Myanmar display labels for drops, quiet moves, captures, promotions, checks, and checkmate", () => {
		// Drop
		const dropState = createGame({ setupMode: "alternating_drops" });
		const afterDrop = applyMove(dropState, {
			kind: "drop",
			role: "rook",
			to: "a1",
		});
		expect(afterDrop.ok).toBe(true);
		if (!afterDrop.ok) return;
		const dropRec = afterDrop.value.moveHistory[0];
		expect(dropRec).toBeDefined();
		if (!dropRec) return;
		expect(formatMoveDisplay(dropRec, "en")).toBe("R@a1");
		expect(formatMoveDisplay(dropRec, "my")).toBe("ရထား a1");

		// Quiet move & capture
		const quietState = mustFen("7k/8/8/3p4/4P3/8/8/4R2K w - - 0 1");
		const quietMove = applyUci(quietState, "e1e3");
		expect(quietMove.ok).toBe(true);
		if (!quietMove.ok) return;
		const quietRec = quietMove.value.moveHistory[0];
		if (!quietRec) return;
		expect(formatMoveDisplay(quietRec, "en")).toBe("Re1e3");
		expect(formatMoveDisplay(quietRec, "my")).toBe("ရထား e1 e3");

		const capMove = applyUci(quietState, "e4d5");
		expect(capMove.ok).toBe(true);
		if (!capMove.ok) return;
		const capRec = capMove.value.moveHistory[0];
		if (!capRec) return;
		expect(formatMoveDisplay(capRec, "en")).toBe("e4xd5");
		expect(formatMoveDisplay(capRec, "my")).toBe("နယ် e4xd5");

		// In place promotion giving check (Black King d5 diagonally behind Red Pawn c6)
		const promoCheckState = mustFen("8/8/2P5/3k4/8/P7/8/7K w - - 0 1");
		const promoCheckRes = applyUci(promoCheckState, "c6c6f");
		expect(promoCheckRes.ok).toBe(true);
		if (!promoCheckRes.ok) return;
		const promoRec = promoCheckRes.value.moveHistory[0];
		if (!promoRec) return;
		expect(formatMoveDisplay(promoRec, "en")).toBe("c6=G+");
		expect(formatMoveDisplay(promoRec, "my")).toBe("စစ်ကဲ c6 ခွေ");

		// Diagonal promotion quiet
		const promoDiagRes = applyUci(promoCheckState, "c6b5f");
		expect(promoDiagRes.ok).toBe(true);
		if (!promoDiagRes.ok) return;
		const promoDiagRec = promoDiagRes.value.moveHistory[0];
		if (!promoDiagRec) return;
		expect(formatMoveDisplay(promoDiagRec, "en")).toBe("c6b5=G");
		expect(formatMoveDisplay(promoDiagRec, "my")).toBe("စစ်ကဲ c6 b5");

		// Checkmate suppresses ခွေ and appends ချုပ် while setting gaveCheck: true
		const mateState = mustFen("k7/2K5/8/8/8/8/8/1R6 w - - 0 1");
		const mateRes = applyUci(mateState, "b1a1");
		expect(mateRes.ok).toBe(true);
		if (!mateRes.ok) return;
		const mateRec = mateRes.value.moveHistory[0];
		if (!mateRec) return;
		expect(mateRec.gaveCheck).toBe(true);
		expect(mateRec.gaveCheckmate).toBe(true);
		expect(formatMoveDisplay(mateRec, "en")).toBe("Rb1a1#");
		expect(formatMoveDisplay(mateRec, "my")).toBe("ရထား b1 a1 ချုပ်");
	});
});

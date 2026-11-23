import { describe, expect, it } from "vitest";
import {
	applyUci,
	createGame,
	fromFen,
	getCheckingSquares,
	getLegalMoves,
	getLegalMovesFrom,
	getPromotionCandidates,
	isInCheck,
	toUci,
} from "./index.js";

function mustFen(fen: string, rules?: Parameters<typeof fromFen>[1]) {
	const res = fromFen(fen, rules);
	if (!res.ok) {
		throw new Error(
			`Expected valid FEN "${fen}", got ${res.error.code}: ${res.error.message}`,
		);
	}
	return res.value;
}

describe("piece movement geometry and king safety (AC-5, AC-7)", () => {
	it("enforces exact movement for all six piece roles including Elephant forward asymmetry and Pawn rules", () => {
		// Red Elephant on d4, Black Elephant on f6, Red General on b4, Red Pawn on a3, Black Pawn on b4?
		// Keep pieces clear to inspect exact targets (include Red General on h2 so last-pawn rule doesn't trigger on a3)
		const state = mustFen("7k/8/5s2/1p6/3S4/P7/7F/7K w - - 0 1");

		// Red Elephant on d4: 4 diagonals (c3, e3, c5, e5) + 1 north forward (d5); NO south (d3)
		const redElephantTargets = getLegalMovesFrom(state, "d4")
			.map((m) => (m.kind === "normal" ? m.to : ""))
			.sort();
		expect(redElephantTargets).toEqual(["c3", "c5", "d5", "e3", "e5"]);

		// Red Pawn on a3: push a4 only (no a5 double step!)
		const redPawnTargets = getLegalMovesFrom(state, "a3").map(toUci);
		expect(redPawnTargets).toEqual(["a3a4"]);

		// Black Elephant on f6: 4 diagonals (e5, g5, e7, g7) + 1 south forward (f5); NO north (f7)
		const blackTurn = mustFen("7k/8/5s2/1p6/3S4/P7/7F/7K b - - 0 1");
		const blackElephantTargets = getLegalMovesFrom(blackTurn, "f6")
			.map((m) => (m.kind === "normal" ? m.to : ""))
			.sort();
		expect(blackElephantTargets).toEqual(["e5", "e7", "f5", "g5", "g7"]);

		// General moves strictly 1 square diagonally
		const genState = mustFen("r6k/8/8/8/3F4/8/8/7K w - - 0 1");
		const genTargets = getLegalMovesFrom(genState, "d4")
			.map((m) => (m.kind === "normal" ? m.to : ""))
			.sort();
		expect(genTargets).toEqual(["c3", "c5", "e3", "e5"]);

		// Knight leaps over pieces
		const knightState = mustFen("7k/8/8/8/3PPP2/3PNP2/3PPP2/7K w - - 0 1");
		const knightTargets = getLegalMovesFrom(knightState, "e3")
			.map((m) => (m.kind === "normal" ? m.to : ""))
			.sort();
		expect(knightTargets).toEqual([
			"c2",
			"c4",
			"d1",
			"d5",
			"f1",
			"f5",
			"g2",
			"g4",
		]);

		// Rook slides orthogonally, stops before friendly and captures enemy
		const rookState = mustFen("7k/8/4p3/8/2P1R1p1/8/4P3/7K w - - 0 1");
		const rookTargets = getLegalMovesFrom(rookState, "e4")
			.map((m) => (m.kind === "normal" ? m.to : ""))
			.sort();
		expect(rookTargets).toEqual(["d4", "e3", "e5", "e6", "f4", "g4"]);

		// Pawn captures diagonally forward only (no sideways or backward); include Red General on h2 so last-pawn promo is inactive
		const pawnCapState = mustFen("7k/8/8/3p1p2/4P3/3p1p2/7F/7K w - - 0 1");
		const pawnCapUcis = getLegalMovesFrom(pawnCapState, "e4").map(toUci).sort();
		expect(pawnCapUcis).toEqual(["e4d5", "e4e5", "e4f5"]);
	});

	it("filters out moves leaving own King in check and reports single and double checkers", () => {
		// Red King e1, Red Rook e2 pinned by Black Rook e8
		const pinned = mustFen("4r2k/8/8/8/8/8/4R3/4K3 w - - 0 1");
		const rookMoves = getLegalMovesFrom(pinned, "e2").map(toUci);
		expect(rookMoves).not.toContain("e2a2");
		expect(rookMoves).toContain("e2e8");

		const illegalPinMove = applyUci(pinned, "e2a2");
		expect(illegalPinMove.ok).toBe(false);
		if (!illegalPinMove.ok) {
			expect(illegalPinMove.error.code).toBe("ILLEGAL_MOVE");
		}

		// Double check on Red King e1 by Black Rook e8 and Black Knight f3
		const doubleCheck = mustFen("4r2k/8/8/8/8/5n2/8/4K3 w - - 0 1");
		expect(isInCheck(doubleCheck, "red")).toBe(true);
		expect([...getCheckingSquares(doubleCheck, "red")].sort()).toEqual([
			"e8",
			"f3",
		]);

		// During setup before Kings are placed, isInCheck is false and getCheckingSquares is empty
		const setupState = createGame();
		expect(isInCheck(setupState, "red")).toBe(false);
		expect(getCheckingSquares(setupState, "red")).toEqual([]);
	});

	it("rejects moving opponent's piece with WRONG_TURN", () => {
		const state = mustFen("r6k/8/8/8/4p3/8/8/7K w - - 0 1");
		const res = applyUci(state, "e4e3");
		expect(res.ok).toBe(false);
		if (!res.ok) {
			expect(res.error.code).toBe("WRONG_TURN");
		}
	});
});

describe("General (Sit ke) promotion edge cases (AC-6)", () => {
	it("allows separate turn in place and empty diagonal step promotion on sit ke myin only when General is gone", () => {
		// Red has NO General, Red Pawn on c6 (sit ke myin), Black Pawn on d7 (occupied!)
		// Also Red has a second Pawn on a3 so last-pawn rule is NOT active
		const canPromo = mustFen("7k/3p4/2P5/8/8/P7/8/7K w - - 0 1");
		expect(getPromotionCandidates(canPromo, "red")).toEqual(["c6"]);
		expect(getPromotionCandidates(canPromo, "black")).toEqual([]);

		const c6Moves = getLegalMovesFrom(canPromo, "c6").map(toUci).sort();
		// Normal push c6c7, normal capture c6d7, in place promo c6c6f, empty diagonal promos c6b5f, c6d5f, c6b7f
		// Note c6d7f MUST NOT exist because d7 is occupied by Black Pawn!
		expect(c6Moves).toEqual([
			"c6b5f",
			"c6b7f",
			"c6c6f",
			"c6c7",
			"c6d5f",
			"c6d7",
		]);

		// Attempting diagonal capture promotion returns PROMOTION_NOT_ALLOWED
		const badCapPromo = applyUci(canPromo, "c6d7f");
		expect(badCapPromo.ok).toBe(false);
		if (!badCapPromo.ok) {
			expect(badCapPromo.error.code).toBe("PROMOTION_NOT_ALLOWED");
		}

		// In place promotion transforms c6 into Red General and resets halfmoveClock
		const promotedInPlace = applyUci(canPromo, "c6c6f");
		expect(promotedInPlace.ok).toBe(true);
		if (!promotedInPlace.ok) return;
		expect(promotedInPlace.value.board[5 * 8 + 2]).toEqual({
			side: "red",
			role: "general",
		});
		expect(promotedInPlace.value.halfmoveClock).toBe(0);

		// Diagonal empty step promotion moves c6 -> b5 as Red General
		const promotedDiag = applyUci(canPromo, "c6b5f");
		expect(promotedDiag.ok).toBe(true);
		if (!promotedDiag.ok) return;
		expect(promotedDiag.value.board[5 * 8 + 2]).toBeNull();
		expect(promotedDiag.value.board[4 * 8 + 1]).toEqual({
			side: "red",
			role: "general",
		});

		// When Red already has a General on board, promotion is completely disallowed
		const hasGeneral = mustFen("7k/3p4/2P5/8/8/P7/1F6/7K w - - 0 1");
		expect(getPromotionCandidates(hasGeneral, "red")).toEqual([]);
		const blockedPromo = applyUci(hasGeneral, "c6c6f");
		expect(blockedPromo.ok).toBe(false);
		if (!blockedPromo.ok) {
			expect(blockedPromo.error.code).toBe("PROMOTION_NOT_ALLOWED");
		}
	});

	it("enforces last surviving pawn promotion anywhere and passed pawn rules", () => {
		// Two Red pawns: one passed sit ke myin on c7, one on a3 -> neither is on sit ke myin
		const twoPawns = mustFen("7k/2P5/8/8/8/P7/8/7K w - - 0 1");
		expect(getPromotionCandidates(twoPawns, "red")).toEqual([]);

		// Single last surviving Red pawn on c7 (off sit ke myin) -> CAN promote anywhere!
		// Include a Black Rook so K+P vs K insufficient material does not auto-draw on import
		const lastPawn = mustFen("r6k/2P5/8/8/8/8/8/7K w - - 0 1");
		expect(getPromotionCandidates(lastPawn, "red")).toEqual(["c7"]);
		const promoRes = applyUci(lastPawn, "c7c7f");
		expect(promoRes.ok).toBe(true);

		// With allowLastPawnPromoteAnywhere: false -> cannot promote off sit ke myin
		const strictLastPawn = mustFen("r6k/2P5/8/8/8/8/8/7K w - - 0 1", {
			rules: { allowLastPawnPromoteAnywhere: false },
		});
		expect(getPromotionCandidates(strictLastPawn, "red")).toEqual([]);
		const strictRes = applyUci(strictLastPawn, "c7c7f");
		expect(strictRes.ok).toBe(false);
		if (!strictRes.ok) {
			expect(strictRes.error.code).toBe("PROMOTION_NOT_ALLOWED");
		}
	});

	it("handles in check promotion blocking and allowPromotionCheck without soft lock", () => {
		// Red King e1 in check from Black Rook e8; Red Pawn d5 (sit ke myin)
		// In place promo d5d5f leaves e1 in check (illegal); diagonal promo d5e6f or d5e4f blocks the check!
		const checkBlock = mustFen("4r2k/8/8/3P4/8/8/P7/4K3 w - - 0 1");
		const d5Moves = getLegalMovesFrom(checkBlock, "d5").map(toUci).sort();
		expect(d5Moves).toEqual(["d5e4f", "d5e6f"]);
		expect(getPromotionCandidates(checkBlock, "red")).toEqual(["d5"]);

		const badInPlace = applyUci(checkBlock, "d5d5f");
		expect(badInPlace.ok).toBe(false);
		if (!badInPlace.ok) {
			expect(badInPlace.error.code).toBe("ILLEGAL_MOVE");
		}

		// Promotion giving check allowed by default, forbidden when allowPromotionCheck: false
		// Black King d5 (diagonally behind Red Pawn c6, so NOT in check before promotion):
		// promoting c6c6f immediately gives backward-diagonal check to d5!
		const promoCheck = mustFen("8/8/2P5/3k4/8/P7/8/7K w - - 0 1");
		const allowed = applyUci(promoCheck, "c6c6f");
		expect(allowed.ok).toBe(true);
		if (allowed.ok) {
			expect(allowed.value.moveHistory[0]?.gaveCheck).toBe(true);
		}

		const noCheckPromo = mustFen("8/8/2P5/3k4/8/P7/8/7K w - - 0 1", {
			rules: { allowPromotionCheck: false },
		});
		const blocked = applyUci(noCheckPromo, "c6c6f");
		expect(blocked.ok).toBe(false);
		if (!blocked.ok) {
			expect(blocked.error.code).toBe("PROMOTION_NOT_ALLOWED");
		}

		// Verify NO soft lock when allowPromotionCheck: false and the ONLY King-safe reply to check
		// is a checking promotion: Red King a1 checked by Black Rook h1 (a2/b1/b2 blocked/attacked),
		// Black King c3, Red Pawn b2? Better: Red King a1 checked by Black Rook e1, a2 occupied by
		// Red Pawn (pinned/immobile), b2 occupied by Black Pawn (guarded by Black King c3),
		// Red Pawn c2 (last pawn) can only block on b1 via c2b1f? Wait: b1 does NOT check c3.
		// Construct exact test: Red King a1 checked by Black Rook d1, Black King b3,
		// Red Pawn c3 (last pawn), Red Pawn a2 (blocked by Black Pawn a3), Black Rook on h2 covers rank 2!
		// Wait: on c1, Red Pawn c2? Put Red Pawn b2 (only pawn, sits on b2); check from Black Rook e1!
		//Wait: c2 -> b1f doesn't check c3, whereas b2 -> c1f? To check Black King, put Black King on d2!
		// Red King a1, Black Rook e1 checks a1; Black Rook a8 covers a2? No, Black Rook h2 covers a2/b2;
		// Red Pawn d2? No, put Black King on e2? No, Black Rook on e1 checks a1, Black King on c2 covers b1/b2;
		// Red Pawn c1? Even simpler: Red King a1 checked by Black Rook a8; Black Pawn b2 guarded by Black King c3;
		// Red Pawn b3 (only pawn!) -> b3a2f blocks a-file check AND checks Black King on c3? No, a2 doesn't attack c3.
		// b3a4f blocks a-file check AND checks Black King on b5!
		// Verify: Black King b5, Black Rook a8 (checks Red King a1), Black Rook b1 (covers b1, b2, b3? no, b2 is covered by b1; put Black Rook h2 covering rank 2 so King a1 can't go to a2/b2, Black Rook b8 covering b-file so King a1 can't go to b1!).
		// Red Pawn b3 is blocked by Black Pawn b4; ONLY King-safe reply to Black Rook a8 check is b3a4f,
		// which blocks a-file AND directly checks Black King b5!
		// Red King a1 checked by Black Rook h1 (covering b1); Black Knight b4 covers a2;
		// Red Pawn b2 (only pawn) is blocked by Black Pawn b3; ONLY King-safe reply is b2c1f,
		// which blocks rank 1 AND directly checks Black King d2!
		const exactCheck = mustFen("8/8/8/8/1n6/1p6/1P1k4/K6r w - - 0 1", {
			rules: { allowPromotionCheck: true },
		});
		expect(exactCheck.phase).toBe("playing");
		expect(getLegalMoves(exactCheck).map(toUci)).toEqual(["b2c1f"]);

		// Now with allowPromotionCheck: false -> b2c1f is illegal, so 0 baseLegalMoves while in check -> immediate CHECKMATE, zero soft lock!
		const exactMate = mustFen("8/8/8/8/1n6/1p6/1P1k4/K6r w - - 0 1", {
			rules: { allowPromotionCheck: false },
		});
		expect(exactMate.phase).toBe("finished");
		expect(exactMate.outcome).toEqual({
			status: "win",
			winner: "black",
			reason: "checkmate",
		});
	});
});

describe("illegal stalemate enforcement and unavoidable stalemate (AC-8)", () => {
	it("filters stalemating moves under default illegal stalemate and allows them under draw rule", () => {
		// Black King a8, Red King c7, Red Rook b1:
		// Moving Red Rook b1 -> b6 stalemates Black King a8 (b8, b7 covered by Red K c7 + R b6; a7? Wait: a7 is NOT covered!
		// Better: Red King c6, Red Rook b1 -> b7 covers a7/b8/c7! Wait: Red K c6 covers b7, b6, c7, d7.
		// Black King a8 escapes: a7 (covered by Rb7), b8 (covered by Rb7), b7 (defended by Kc6)!
		// Wait: Rb7 checks a7? No, Rb7 is on rank 7 and file b -> attacks b8 and a7, NOT a8!
		// So Rb1->b7 stalemates Black King on a8!
		const state = mustFen("k7/8/2K5/8/8/8/8/1R6 w - - 0 1");
		const legal = getLegalMoves(state).map(toUci);
		expect(legal).not.toContain("b1b7");
		expect(legal).toContain("b1a1"); // checkmate!

		const attemptStale = applyUci(state, "b1b7");
		expect(attemptStale.ok).toBe(false);
		if (!attemptStale.ok) {
			expect(attemptStale.error.code).toBe("ILLEGAL_STALEMATE");
		}

		// Under stalemateRule: "draw", b1b7 is legal and draws as stalemate
		const drawMode = mustFen("k7/8/2K5/8/8/8/8/1R6 w - - 0 1", {
			rules: { stalemateRule: "draw" },
		});
		const drawn = applyUci(drawMode, "b1b7");
		expect(drawn.ok).toBe(true);
		if (!drawn.ok) return;
		expect(drawn.value.phase).toBe("finished");
		expect(drawn.value.outcome).toEqual({
			status: "draw",
			winner: null,
			reason: "stalemate",
		});
	});

	it("does NOT treat a position as stalemate when the opponent has a legal promotion move", () => {
		// Same Black King a8, Red King c6, Red Rook b1 -> b7, EXCEPT Black has a lone pawn on h5 (blocked by Red Pawn h4)
		// Because Black has NO General and h5 is Black's last surviving pawn, Black can promote h5h5f!
		// Therefore b1b7 does NOT stalemate Black and MUST be legal!
		const state = mustFen("k7/8/2K5/7p/7P/8/8/1R6 w - - 0 1");
		const res = applyUci(state, "b1b7");
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.value.phase).toBe("playing");
		expect(getLegalMoves(res.value).map(toUci)).toContain("h5h5f");
	});

	it("ends in unavoidable_stalemate cleanly with zero infinite recursion when every base move stalemates opponent", () => {
		// Black King b8 moves to a8; Red General on h1 is boxed by Red Pawn g2 (blocked by Black Pawn g3),
		// preventing any promotion escapes; Red Pawns a6/d7/e7/e8 are immobilized; Red King d8 has ONLY
		// two base legal moves (d8c8 and d8c7), BOTH of which stalemate Black King a8!
		const before = mustFen("1k1KP3/p2PP3/P7/8/8/6p1/6P1/7F b - - 0 1");
		expect(before.phase).toBe("playing");
		const res = applyUci(before, "b8a8");
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.value.phase).toBe("finished");
		expect(res.value.outcome).toEqual({
			status: "draw",
			winner: null,
			reason: "unavoidable_stalemate",
		});
		expect(getLegalMoves(res.value)).toEqual([]);
	});
});

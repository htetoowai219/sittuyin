import { describe, expect, it } from "vitest";
import {
	applyMove,
	applySetupAction,
	autoCompleteSetup,
	createGame,
	generateRandomSetup,
	getLegalMoves,
	getLegalMovesFrom,
	getLegalSetupSquares,
	getPresetPlacements,
	INITIAL_OFFICER_HAND,
	isInCheck,
	type OfficerRole,
	OPENING_PRESETS,
	remainingHandTotal,
	rotateSquare180,
	type Square,
	STARTING_SETUP_FEN,
	toFen,
	toPlayerView,
} from "./index.js";

describe("hidden simultaneous setup, presets, autoCompleteSetup, and privacy view (AC-2, AC-4, AC-14)", () => {
	it("supports full hidden simultaneous draft editing, swapping, unlocking, and atomic commit", () => {
		let state = createGame();

		// Invalid rook off rank 1 rejected before outside setup zone
		const badRookRank2 = applySetupAction(state, "red", {
			kind: "place",
			role: "rook",
			to: "a2",
		});
		expect(badRookRank2.ok).toBe(false);
		if (!badRookRank2.ok) {
			expect(badRookRank2.error.code).toBe("ROOK_MUST_BE_BACK_RANK");
		}

		const badRookRank5 = applySetupAction(state, "red", {
			kind: "place",
			role: "rook",
			to: "a5",
		});
		expect(badRookRank5.ok).toBe(false);
		if (!badRookRank5.ok) {
			expect(badRookRank5.error.code).toBe("ROOK_MUST_BE_BACK_RANK");
		}

		// Non rook outside behind-pawns zone (a3 has pawn, d4 is ahead)
		const outsideZone = applySetupAction(state, "red", {
			kind: "place",
			role: "knight",
			to: "a3",
		});
		expect(outsideZone.ok).toBe(false);
		if (!outsideZone.ok) {
			expect(outsideZone.error.code).toBe("OUTSIDE_SETUP_ZONE");
		}

		// Place Rook on a1 and Knight on b2
		const p1 = applySetupAction(state, "red", {
			kind: "place",
			role: "rook",
			to: "a1",
		});
		expect(p1.ok).toBe(true);
		if (!p1.ok) return;
		state = p1.value;

		// Placing on already occupied square returns SQUARE_OCCUPIED
		const occupied = applySetupAction(state, "red", {
			kind: "place",
			role: "king",
			to: "a1",
		});
		expect(occupied.ok).toBe(false);
		if (!occupied.ok) {
			expect(occupied.error.code).toBe("SQUARE_OCCUPIED");
		}

		const p2 = applySetupAction(state, "red", {
			kind: "place",
			role: "knight",
			to: "b2",
		});
		expect(p2.ok).toBe(true);
		if (!p2.ok) return;
		state = p2.value;

		// Swapping Rook (a1) with Knight (b2) fails because Rook cannot go to rank 2
		const badSwap = applySetupAction(state, "red", {
			kind: "move",
			from: "a1",
			to: "b2",
		});
		expect(badSwap.ok).toBe(false);
		if (!badSwap.ok) {
			expect(badSwap.error.code).toBe("ROOK_MUST_BE_BACK_RANK");
		}

		// Move Knight to b1, then swap Rook (a1) with Knight (b1) on rank 1 -> legal!
		const m1 = applySetupAction(state, "red", {
			kind: "move",
			from: "b2",
			to: "b1",
		});
		expect(m1.ok).toBe(true);
		if (!m1.ok) return;
		state = m1.value;

		// Same square move is a clean no op
		const noopMove = applySetupAction(state, "red", {
			kind: "move",
			from: "b1",
			to: "b1",
		});
		expect(noopMove.ok).toBe(true);
		if (noopMove.ok) {
			expect(noopMove.value).toBe(state);
		}

		const goodSwap = applySetupAction(state, "red", {
			kind: "move",
			from: "a1",
			to: "b1",
		});
		expect(goodSwap.ok).toBe(true);
		if (!goodSwap.ok) return;
		state = goodSwap.value;
		expect(state.setupDrafts.red.b1).toBe("rook");
		expect(state.setupDrafts.red.a1).toBe("knight");

		// Remove returns piece to hand; empty remove returns SQUARE_EMPTY
		const rem = applySetupAction(state, "red", { kind: "remove", from: "a1" });
		expect(rem.ok).toBe(true);
		if (!rem.ok) return;
		state = rem.value;
		expect(state.setupDrafts.red.a1).toBeUndefined();
		expect(state.hands.red.knight).toBe(2);

		const remEmpty = applySetupAction(state, "red", {
			kind: "remove",
			from: "a1",
		});
		expect(remEmpty.ok).toBe(false);
		if (!remEmpty.ok) {
			expect(remEmpty.error.code).toBe("SQUARE_EMPTY");
		}

		// Cannot lock with incomplete setup
		const badLock = applySetupAction(state, "red", { kind: "lock" });
		expect(badLock.ok).toBe(false);
		if (!badLock.ok) {
			expect(badLock.error.code).toBe("SETUP_INCOMPLETE");
		}

		// Unlock when unlocked is a no op
		const noopUnlock = applySetupAction(state, "red", { kind: "unlock" });
		expect(noopUnlock.ok).toBe(true);
		if (noopUnlock.ok) {
			expect(noopUnlock.value).toBe(state);
		}

		// Apply preset overwrites partial draft and zeroes hand
		const presetRed = applySetupAction(state, "red", {
			kind: "apply_preset",
			presetId: "myin_cha",
		});
		expect(presetRed.ok).toBe(true);
		if (!presetRed.ok) return;
		state = presetRed.value;
		expect(remainingHandTotal(state.hands.red)).toBe(0);

		// getLegalSetupSquares still returns valid destinations when dragging placed officer (hand count 0)
		const knightTargets = getLegalSetupSquares(state, "red", "knight", "e3");
		expect(knightTargets).toContain("g3");
		expect(knightTargets).toContain("f3"); // swap with other knight
		expect(knightTargets).not.toContain("a1"); // cannot swap e3 knight with rank 1 rook
		expect(knightTargets).not.toContain("e3");

		// Lock Red, verify edits blocked, unlock Red, then re-lock
		const lockRed = applySetupAction(state, "red", { kind: "lock" });
		expect(lockRed.ok).toBe(true);
		if (!lockRed.ok) return;
		state = lockRed.value;
		expect(state.phase).toBe("setup");
		expect(state.setupReady.red).toBe(true);
		expect(getLegalSetupSquares(state, "red", "knight")).toEqual([]);

		const editWhileLocked = applySetupAction(state, "red", { kind: "clear" });
		expect(editWhileLocked.ok).toBe(false);
		if (!editWhileLocked.ok) {
			expect(editWhileLocked.error.code).toBe("SIDE_ALREADY_LOCKED");
		}

		const unlockRed = applySetupAction(state, "red", { kind: "unlock" });
		expect(unlockRed.ok).toBe(true);
		if (!unlockRed.ok) return;
		state = unlockRed.value;
		expect(state.setupReady.red).toBe(false);

		// Re-lock Red, apply Black preset and lock Black -> commits atomically to playing!
		const relockRed = applySetupAction(state, "red", { kind: "lock" });
		expect(relockRed.ok).toBe(true);
		if (!relockRed.ok) return;
		state = relockRed.value;

		const presetBlack = applySetupAction(state, "black", {
			kind: "apply_preset",
			presetId: "khan_tat",
		});
		expect(presetBlack.ok).toBe(true);
		if (!presetBlack.ok) return;
		state = presetBlack.value;

		// Calling applyMove during hidden_simultaneous setup returns INVALID_SETUP_MODE
		const badMoveInHidden = applyMove(state, {
			kind: "drop",
			role: "rook",
			to: "a1",
		});
		expect(badMoveInHidden.ok).toBe(false);
		if (!badMoveInHidden.ok) {
			expect(badMoveInHidden.error.code).toBe("INVALID_SETUP_MODE");
		}
		expect(getLegalMoves(state)).toEqual([]);
		expect(getLegalMovesFrom(state, "e4")).toEqual([]);

		const committed = applySetupAction(state, "black", { kind: "lock" });
		expect(committed.ok).toBe(true);
		if (!committed.ok) return;
		const playing = committed.value;
		expect(playing.phase).toBe("playing");
		expect(playing.turn).toBe("red");
		expect(playing.fullmoveNumber).toBe(1);
		expect(playing.setupDrafts.red).toEqual({});
		expect(playing.setupDrafts.black).toEqual({});
		expect(playing.initialSetupFen).toBe(toFen(playing));
		expect(isInCheck(playing, "red")).toBe(false);
		expect(isInCheck(playing, "black")).toBe(false);
		expect(Object.keys(playing.positionCounts)).toHaveLength(1);
	});

	it("validates all 5 OPENING_PRESETS for Red and mirrored Black plus deterministic random & autoCompleteSetup", () => {
		expect(OPENING_PRESETS).toHaveLength(5);

		for (const preset of OPENING_PRESETS) {
			const redRes = getPresetPlacements(preset.id, "red");
			const blackRes = getPresetPlacements(preset.id, "black");
			expect(redRes.ok).toBe(true);
			expect(blackRes.ok).toBe(true);
			if (!redRes.ok || !blackRes.ok) continue;

			expect(Object.keys(redRes.value)).toHaveLength(8);
			expect(Object.keys(blackRes.value)).toHaveLength(8);

			// Verify exact 180 degree mirror
			for (const [sq, role] of Object.entries(redRes.value) as [
				Square,
				OfficerRole,
			][]) {
				expect(blackRes.value[rotateSquare180(sq)]).toBe(role);
			}

			// Applying both presets and locking commits cleanly to playing
			let s = createGame();
			const r1 = applySetupAction(s, "red", {
				kind: "apply_preset",
				presetId: preset.id,
			});
			expect(r1.ok).toBe(true);
			if (!r1.ok) continue;
			const r2 = applySetupAction(r1.value, "red", { kind: "lock" });
			expect(r2.ok).toBe(true);
			if (!r2.ok) continue;
			const b1 = applySetupAction(r2.value, "black", {
				kind: "apply_preset",
				presetId: preset.id,
			});
			expect(b1.ok).toBe(true);
			if (!b1.ok) continue;
			const b2 = applySetupAction(b1.value, "black", { kind: "lock" });
			expect(b2.ok).toBe(true);
			if (!b2.ok) continue;
			s = b2.value;
			expect(s.phase).toBe("playing");
			expect(isInCheck(s, "red")).toBe(false);
			expect(isInCheck(s, "black")).toBe(false);
		}

		// Deterministic random setup
		const rA = generateRandomSetup("match-42", "red");
		const rB = generateRandomSetup("match-42", "red");
		const rC = generateRandomSetup("match-99", "red");
		expect(rA).toEqual(rB);
		expect(rA).not.toEqual(rC);
		expect(Object.keys(rA)).toHaveLength(8);

		// Worst case autoCompleteSetup: all 6 non-rook officers placed on rank 1 (a1..f1),
		// leaving only g1 and h1 for the 2 unplaced Rooks!
		let state = createGame();
		const sixNonRooks: readonly [OfficerRole, Square][] = [
			["king", "a1"],
			["general", "b1"],
			["elephant", "c1"],
			["elephant", "d1"],
			["knight", "e1"],
			["knight", "f1"],
		];
		for (const [role, to] of sixNonRooks) {
			const res = applySetupAction(state, "red", { kind: "place", role, to });
			expect(res.ok).toBe(true);
			if (!res.ok) return;
			state = res.value;
		}
		const autoRed = autoCompleteSetup(state, "red", "timeout-seed");
		expect(autoRed.ok).toBe(true);
		if (!autoRed.ok) return;
		expect(autoRed.value.setupReady.red).toBe(true);
		expect(autoRed.value.setupDrafts.red.g1).toBe("rook");
		expect(autoRed.value.setupDrafts.red.h1).toBe("rook");
		expect(autoRed.value.setupDrafts.red.a1).toBe("king");

		// autoCompleteSetup for Black when Red is already locked commits atomically to playing
		const autoBlack = autoCompleteSetup(autoRed.value, "black", "black-seed");
		expect(autoBlack.ok).toBe(true);
		if (!autoBlack.ok) return;
		expect(autoBlack.value.phase).toBe("playing");
		expect(autoBlack.value.initialSetupFen).not.toBeNull();
	});

	it("masks opponent drafts and hand role counts in toPlayerView during hidden setup", () => {
		let state = createGame();
		const r1 = applySetupAction(state, "red", {
			kind: "place",
			role: "king",
			to: "b1",
		});
		expect(r1.ok).toBe(true);
		if (!r1.ok) return;
		state = r1.value;

		const b1 = applySetupAction(state, "black", {
			kind: "place",
			role: "rook",
			to: "h8",
		});
		expect(b1.ok).toBe(true);
		if (!b1.ok) return;
		state = b1.value;

		const b2 = applySetupAction(state, "black", {
			kind: "place",
			role: "king",
			to: "g8",
		});
		expect(b2.ok).toBe(true);
		if (!b2.ok) return;
		state = b2.value;

		const redView = toPlayerView(state, "red");
		expect(redView.viewer).toBe("red");
		expect(redView.myDraft).toEqual({ b1: "king" });
		expect(redView.hands.red.king).toBe(0);
		// Black's hand is masked back to INITIAL_OFFICER_HAND (no role leak!)
		expect(redView.hands.black).toEqual(INITIAL_OFFICER_HAND);
		// Yet placedCounts accurately reports 1 for Red and 2 for Black
		expect(redView.placedCounts).toEqual({ red: 1, black: 2 });
		expect("setupDrafts" in redView).toBe(false);

		const specView = toPlayerView(state, "spectator");
		expect(specView.myDraft).toEqual({});
		expect(specView.hands.red).toEqual(INITIAL_OFFICER_HAND);
		expect(specView.hands.black).toEqual(INITIAL_OFFICER_HAND);
		expect(specView.placedCounts).toEqual({ red: 1, black: 2 });
	});
});

describe("alternating visible drops setup (AC-3)", () => {
	it("alternates 16 drops across legal zones, increments fullmove to 9, and enters playing", () => {
		let state = createGame({ setupMode: "alternating_drops" });
		expect(state.initialSetupFen).toBe(STARTING_SETUP_FEN);

		// Board moves rejected while officers remain in hand
		const prematureMove = applyMove(state, {
			kind: "normal",
			from: "e4",
			to: "e5",
		});
		expect(prematureMove.ok).toBe(false);
		if (!prematureMove.ok) {
			expect(prematureMove.error.code).toBe("INVALID_PHASE");
		}

		// getLegalMoves returns deduplicated drop moves during alternating_drops
		const legalDrops = getLegalMoves(state);
		expect(legalDrops.every((m) => m.kind === "drop")).toBe(true);
		// 1 rook role (8 sq) + 4 non-rook roles (20 sq each) = 88 legal drops on ply 1
		expect(legalDrops).toHaveLength(88);

		// getLegalSetupSquares respects turn and hand counts
		expect(getLegalSetupSquares(state, "black", "rook")).toEqual([]);
		expect(getLegalSetupSquares(state, "red", "rook")).toHaveLength(8);

		const redPreset = getPresetPlacements("myin_cha", "red");
		const blackPreset = getPresetPlacements("sin_cha", "black");
		expect(redPreset.ok && blackPreset.ok).toBe(true);
		if (!redPreset.ok || !blackPreset.ok) return;

		const redDrops = Object.entries(redPreset.value) as [Square, OfficerRole][];
		const blackDrops = Object.entries(blackPreset.value) as [
			Square,
			OfficerRole,
		][];

		for (let i = 0; i < 8; i++) {
			const rd = redDrops[i];
			const bd = blackDrops[i];
			if (rd === undefined || bd === undefined) break;

			const resR = applyMove(state, { kind: "drop", role: rd[1], to: rd[0] });
			expect(resR.ok).toBe(true);
			if (!resR.ok) return;
			state = resR.value;
			expect(toPlayerView(state, "red").placedCounts.red).toBe(i + 1);

			const resB = applyMove(state, { kind: "drop", role: bd[1], to: bd[0] });
			expect(resB.ok).toBe(true);
			if (!resB.ok) return;
			state = resB.value;
		}

		expect(state.phase).toBe("playing");
		expect(state.turn).toBe("red");
		expect(state.fullmoveNumber).toBe(9);
		expect(state.moveHistory).toHaveLength(16);
		expect(state.moveHistory[0]?.uci).toMatch(/^[KFRSN]@[a-h][1-3]$/);

		// Drop rejected after entering playing
		const lateDrop = applyMove(state, {
			kind: "drop",
			role: "rook",
			to: "h1",
		});
		expect(lateDrop.ok).toBe(false);
		if (!lateDrop.ok) {
			expect(lateDrop.error.code).toBe("INVALID_PHASE");
		}
	});
});

import { createGame, getLegalMoves, toUci } from "@sittuyin/engine";
import { describe, expect, it } from "vitest";
import { applyRandomSetupToState } from "./local-match-adapter";
import {
	createReplayAdapter,
	parseReplaySession,
	SAMPLE_REPLAY_FEN,
	SAMPLE_REPLAY_UCI_MOVES,
} from "./replay-adapter";

describe("adapters", () => {
	it("generates a valid 8-officer random setup for Red and Black", () => {
		const initial = createGame();
		const resRed = applyRandomSetupToState(initial, "red", 42);
		expect(resRed.ok).toBe(true);
		if (!resRed.ok) return;
		expect(Object.keys(resRed.value.setupDrafts.red)).toHaveLength(8);

		const resBlack = applyRandomSetupToState(resRed.value, "black", 99);
		expect(resBlack.ok).toBe(true);
		if (!resBlack.ok) return;
		expect(Object.keys(resBlack.value.setupDrafts.black)).toHaveLength(8);
	});

	it("parses the built-in sample replay cleanly", () => {
		const session = parseReplaySession(
			SAMPLE_REPLAY_FEN,
			SAMPLE_REPLAY_UCI_MOVES.join(" "),
		);
		if (session.parseError) {
			// Print diagnostic if sample moves need adjustment
			console.error("Sample replay error:", session.parseError);
		}
		expect(session.parseError).toBeNull();
		expect(session.snapshots).toHaveLength(SAMPLE_REPLAY_UCI_MOVES.length + 1);

		const adapter = createReplayAdapter(session, "en");
		expect(adapter.mode).toBe("replay");
		expect(adapter.isInteractive).toBe(false);
		expect(adapter.historyStates).toHaveLength(
			SAMPLE_REPLAY_UCI_MOVES.length + 1,
		);
	});

	it("reports the exact 1-indexed failing ply on a corrupt UCI sequence", () => {
		const base = parseReplaySession(SAMPLE_REPLAY_FEN, "");
		expect(base.parseError).toBeNull();
		const initialState = base.snapshots[0];
		expect(initialState).toBeDefined();
		if (!initialState) return;

		// Build 3 legal moves dynamically then inject an illegal 4th move
		const validUcis: string[] = [];
		let curr = initialState;
		for (let i = 0; i < 3; i++) {
			const moves = getLegalMoves(curr);
			const chosen = moves[0];
			expect(chosen).toBeDefined();
			if (!chosen) return;
			validUcis.push(toUci(chosen));
			const step = parseReplaySession(SAMPLE_REPLAY_FEN, validUcis.join(" "));
			expect(step.parseError).toBeNull();
			curr = step.snapshots[step.snapshots.length - 1] ?? curr;
		}

		const corrupt = parseReplaySession(
			SAMPLE_REPLAY_FEN,
			[...validUcis, "a1h8"].join(" "),
		);
		expect(corrupt.parseError).not.toBeNull();
		expect(corrupt.parseError?.code).toBe("REPLAY_MOVE_FAILED");
		expect(corrupt.parseError?.ply).toBe(4);
	});
});

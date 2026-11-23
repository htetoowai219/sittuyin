import {
	applySetupAction,
	createGame,
	type EngineError,
	type RulesConfig,
	replayMatch,
	type Side,
	toFen,
	toPlayerView,
} from "@sittuyin/engine";
import { type AppLocale, formatSideName } from "@/i18n/locale";
import type { MatchAdapter, MatchPlayerHud, ReplaySessionState } from "./types";

export const MAX_REPLAY_FEN_LENGTH = 1024;
export const MAX_REPLAY_UCI_MOVES = 1000;

function buildDefaultSampleFen(): string {
	let state = createGame();
	const r1 = applySetupAction(state, "red", {
		kind: "apply_preset",
		presetId: "myin_cha",
	});
	if (r1.ok) state = r1.value;
	const r2 = applySetupAction(state, "red", { kind: "lock" });
	if (r2.ok) state = r2.value;
	const b1 = applySetupAction(state, "black", {
		kind: "apply_preset",
		presetId: "sin_cha",
	});
	if (b1.ok) state = b1.value;
	const b2 = applySetupAction(state, "black", { kind: "lock" });
	if (b2.ok) state = b2.value;
	return state.initialSetupFen ?? toFen(state);
}

export const SAMPLE_REPLAY_FEN = buildDefaultSampleFen();

/**
 * Valid opening exchange between Myin cha (Red) and Sin cha (Black) demonstrating
 * pawn captures, Elephant/Knight development, and Chariot activation.
 */
export const SAMPLE_REPLAY_UCI_MOVES: readonly string[] = [
	"e4d5",
	"c6d5",
	"f3d4",
	"d5d4",
	"c3d4",
	"e6e5",
	"e3f5",
	"b7d6",
	"f4e5",
	"d6e4",
];

export function tokenizeUciInput(uciText: string): readonly string[] {
	return uciText
		.trim()
		.split(/[\s,]+/)
		.map((token) => token.trim())
		.filter((token) => token.length > 0);
}

export function parseReplaySession(
	initialSetupFen: string,
	uciText: string,
	rules?: Partial<RulesConfig>,
): ReplaySessionState {
	const fen = initialSetupFen.trim();
	if (fen.length === 0 || fen.length > MAX_REPLAY_FEN_LENGTH) {
		return {
			initialSetupFen: fen,
			uciMoves: [],
			snapshots: [],
			parseError: {
				code: "INVALID_FEN",
				message:
					fen.length === 0
						? "Initial setup FEN is required."
						: `FEN exceeds maximum length of ${MAX_REPLAY_FEN_LENGTH} characters.`,
			},
		};
	}

	const uciMoves = tokenizeUciInput(uciText);
	if (uciMoves.length > MAX_REPLAY_UCI_MOVES) {
		return {
			initialSetupFen: fen,
			uciMoves: uciMoves.slice(0, MAX_REPLAY_UCI_MOVES),
			snapshots: [],
			parseError: {
				code: "INVALID_UCI",
				message: `Replay exceeds maximum of ${MAX_REPLAY_UCI_MOVES} UCI moves.`,
			},
		};
	}

	const result = replayMatch(fen, uciMoves, rules);
	if (!result.ok) {
		const ply =
			typeof result.error.details?.ply === "number"
				? result.error.details.ply
				: undefined;
		return {
			initialSetupFen: fen,
			uciMoves,
			snapshots: [],
			parseError: {
				code: result.error.code,
				ply,
				message: result.error.message,
			},
		};
	}

	return {
		initialSetupFen: fen,
		uciMoves,
		snapshots: result.value,
		parseError: null,
	};
}

const READONLY_ERROR: EngineError = {
	code: "INVALID_PHASE",
	message: "Replay viewer is read-only.",
};

export function createReplayAdapter(
	session: ReplaySessionState,
	locale: AppLocale,
): MatchAdapter {
	const fallbackState = createGame();
	const snapshots =
		session.snapshots.length > 0 ? session.snapshots : [fallbackState];
	const headState = snapshots[snapshots.length - 1] ?? fallbackState;
	const view = toPlayerView(headState, "spectator");

	const players: Readonly<Record<Side, MatchPlayerHud>> = {
		red: {
			side: "red",
			displayName: formatSideName("red", locale),
			rating: null,
			connected: true,
			isLocal: false,
		},
		black: {
			side: "black",
			displayName: formatSideName("black", locale),
			rating: null,
			connected: true,
			isLocal: false,
		},
	};

	return {
		mode: "replay",
		view,
		players,
		clock: null,
		historyStates: snapshots,
		pendingRevealHandoff: null,
		connectionStatus: "local",
		isInteractive: false,
		outcome: headState.outcome,
		dispatchSetup: () => ({ ok: false, error: READONLY_ERROR }),
		dispatchMove: () => ({ ok: false, error: READONLY_ERROR }),
		applyRandomSetup: () => ({ ok: false, error: READONLY_ERROR }),
		requestResign: () => {},
		requestDraw: () => {},
		confirmHandoff: () => {},
	};
}

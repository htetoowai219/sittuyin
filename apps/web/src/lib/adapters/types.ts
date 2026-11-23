import type {
	EngineError,
	GameOutcome,
	GameState,
	Move,
	PlayerGameView,
	Result,
	SetupAction,
	Side,
} from "@sittuyin/engine";
import type { TimeControl } from "@sittuyin/shared";

export type MatchAdapterMode =
	| "local_pass_and_play"
	| "local_sandbox"
	| "replay"
	| "online";

export type MatchConnectionStatus =
	| "local"
	| "connected"
	| "reconnecting"
	| "disconnected";

export type ExtendedOutcome =
	| GameOutcome
	| {
			readonly status: "win";
			readonly winner: Side;
			readonly reason: "resignation" | "timeout";
	  }
	| {
			readonly status: "draw";
			readonly winner: null;
			readonly reason: "agreed";
	  };

export interface MatchClockState {
	readonly enabled: boolean;
	readonly timeControl: TimeControl | null;
	readonly remainingMs: Readonly<Record<Side, number>>;
	readonly activeSide: Side | null;
	readonly lowTimeThresholdMs: number;
	readonly criticalTimeThresholdMs: number;
	readonly syncedAtMs: number;
}

export interface MatchPlayerHud {
	readonly side: Side;
	readonly displayName: string;
	readonly rating: number | null;
	readonly connected: boolean;
	readonly isLocal: boolean;
}

export interface MatchAdapter {
	readonly mode: MatchAdapterMode;
	readonly view: PlayerGameView;
	readonly players: Readonly<Record<Side, MatchPlayerHud>>;
	readonly clock: MatchClockState | null;
	readonly historyStates: readonly GameState[];
	readonly pendingRevealHandoff: Side | null;
	readonly connectionStatus: MatchConnectionStatus;
	readonly isInteractive: boolean;
	readonly outcome: ExtendedOutcome | null;
	readonly dispatchSetup: (
		action: SetupAction,
	) => Result<void, EngineError> | Promise<Result<void, EngineError>>;
	readonly dispatchMove: (
		move: Move,
	) => Result<void, EngineError> | Promise<Result<void, EngineError>>;
	readonly applyRandomSetup: () =>
		| Result<void, EngineError>
		| Promise<Result<void, EngineError>>;
	readonly requestResign: () => void;
	readonly requestDraw: () => void;
	readonly confirmHandoff: () => void;
	readonly switchSandboxViewer?: (side: Side) => void;
}

export interface TimeControlConfig {
	readonly id: TimeControl;
	readonly initialMs: number;
	readonly incrementMs: number;
}

export const TIME_CONTROL_CONFIGS: Readonly<
	Record<TimeControl, TimeControlConfig>
> = {
	rapid_10_5: {
		id: "rapid_10_5",
		initialMs: 10 * 60 * 1000,
		incrementMs: 5 * 1000,
	},
	rapid_15_10: {
		id: "rapid_15_10",
		initialMs: 15 * 60 * 1000,
		incrementMs: 10 * 1000,
	},
	classical_30_0: {
		id: "classical_30_0",
		initialMs: 30 * 60 * 1000,
		incrementMs: 0,
	},
};

export interface ReplayParseError {
	readonly code: EngineError["code"];
	readonly ply?: number;
	readonly message: string;
}

export interface ReplaySessionState {
	readonly initialSetupFen: string;
	readonly uciMoves: readonly string[];
	readonly snapshots: readonly GameState[];
	readonly parseError: ReplayParseError | null;
}

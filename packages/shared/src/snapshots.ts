import {
	createGame,
	fromFen,
	type GameState,
	INITIAL_OFFICER_HAND,
	type OfficerHand,
	type OfficerRole,
	type PlayerGameView,
	replayMatch,
	type SetupPlacements,
	type Side,
	type Square,
	toPlayerView,
	type Viewer,
} from "@sittuyin/engine";
import type {
	PreferredSide,
	RoomMode,
	RoomPhase,
	TimeControl,
} from "./tickets.js";

export type SittuyinHandCountsSnapshot = OfficerHand;

export interface SittuyinPrivateSetupSnapshot {
	readonly myDraft: Readonly<Partial<Record<Square, OfficerRole>>>;
	readonly hand: SittuyinHandCountsSnapshot;
}

export interface SittuyinClockSnapshot {
	readonly redRemainingMs: number;
	readonly blackRemainingMs: number;
	readonly incrementMs: number;
	readonly setupRemainingMs: number;
	readonly activeSide: "" | Side;
	readonly running: boolean;
	readonly syncedAtMs: number;
}

export interface SittuyinPlayerSnapshot {
	readonly sessionId: string;
	readonly userId?: string;
	readonly displayName: string;
	readonly rating?: number;
	readonly isProvisional?: boolean;
	readonly isAnonymous?: boolean;
	readonly side: "red" | "black" | "spectator";
	readonly connected: boolean;
	readonly rematchAccepted?: boolean;
}

export interface SittuyinRoomSnapshot {
	readonly matchId?: string;
	readonly phase: RoomPhase;
	readonly roomMode: RoomMode;
	readonly isRated?: boolean;
	readonly roomTitle?: string;
	readonly inviteCode?: string;
	readonly hostSessionId?: string;
	readonly hostPreferredSide?: PreferredSide;
	readonly timeControl: TimeControl;
	readonly turn?: Side;
	readonly currentFen?: string;
	readonly initialSetupFen?: string;
	readonly redPlacedCount?: number;
	readonly blackPlacedCount?: number;
	readonly redSetupReady?: boolean;
	readonly blackSetupReady?: boolean;
	readonly halfmoveClock?: number;
	readonly bareKingClock?: number;
	readonly fullmoveNumber?: number;
	readonly movesUci?: readonly string[];
	readonly drawOfferedBy?: "" | Side;
	readonly rematchOfferedBy?: "" | Side;
	readonly outcomeStatus?: "" | "win" | "draw" | "aborted";
	readonly outcomeWinner?: "" | Side;
	readonly outcomeReason?: string;
	readonly players: Readonly<Record<string, SittuyinPlayerSnapshot>>;
	readonly clock?: SittuyinClockSnapshot;
	readonly redPrivate?: SittuyinPrivateSetupSnapshot;
	readonly blackPrivate?: SittuyinPrivateSetupSnapshot;
}

export interface ReconstructedRoomView {
	readonly view: PlayerGameView;
	readonly historyStates: readonly GameState[];
}

export function roomSnapshotToPlayerGameView(
	snapshot: SittuyinRoomSnapshot,
	viewer: Viewer,
): ReconstructedRoomView {
	if (
		(snapshot.phase === "playing" || snapshot.phase === "finished") &&
		snapshot.initialSetupFen
	) {
		const replayResult = replayMatch(
			snapshot.initialSetupFen,
			snapshot.movesUci ?? [],
		);
		if (replayResult.ok && replayResult.value.length > 0) {
			const latestState =
				replayResult.value[replayResult.value.length - 1] ?? createGame();
			const stateWithPhase: GameState =
				snapshot.phase === "finished" && latestState.phase !== "finished"
					? { ...latestState, phase: "finished" }
					: latestState;
			return {
				view: toPlayerView(stateWithPhase, viewer),
				historyStates: replayResult.value,
			};
		}
	}

	if (
		(snapshot.phase === "playing" || snapshot.phase === "finished") &&
		snapshot.currentFen
	) {
		const fenResult = fromFen(snapshot.currentFen, {
			bareKingClock:
				snapshot.bareKingClock !== undefined && snapshot.bareKingClock >= 0
					? snapshot.bareKingClock
					: undefined,
		});
		if (fenResult.ok) {
			const stateWithPhase: GameState =
				snapshot.phase === "finished" && fenResult.value.phase !== "finished"
					? { ...fenResult.value, phase: "finished" }
					: fenResult.value;
			return {
				view: toPlayerView(stateWithPhase, viewer),
				historyStates: [stateWithPhase],
			};
		}
	}

	const baseGame = createGame();
	const privateSlice =
		viewer === "red"
			? snapshot.redPrivate
			: viewer === "black"
				? snapshot.blackPrivate
				: undefined;

	const myDraft: SetupPlacements = privateSlice
		? { ...privateSlice.myDraft }
		: {};
	const myHand: OfficerHand = privateSlice
		? { ...privateSlice.hand }
		: { ...INITIAL_OFFICER_HAND };

	const hands: Readonly<Record<Side, OfficerHand>> =
		viewer === "red"
			? { red: myHand, black: { ...INITIAL_OFFICER_HAND } }
			: viewer === "black"
				? { red: { ...INITIAL_OFFICER_HAND }, black: myHand }
				: {
						red: { ...INITIAL_OFFICER_HAND },
						black: { ...INITIAL_OFFICER_HAND },
					};

	const view: PlayerGameView = {
		...toPlayerView(baseGame, viewer),
		hands,
		myDraft,
		setupReady: {
			red: snapshot.redSetupReady ?? false,
			black: snapshot.blackSetupReady ?? false,
		},
		placedCounts: {
			red: snapshot.redPlacedCount ?? 0,
			black: snapshot.blackPlacedCount ?? 0,
		},
	};

	return {
		view,
		historyStates: [baseGame],
	};
}

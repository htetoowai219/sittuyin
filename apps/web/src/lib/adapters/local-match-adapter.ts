import {
	applyMove,
	applySetupAction,
	createGame,
	type EngineError,
	type GameState,
	generateRandomSetup,
	type Move,
	type OfficerRole,
	oppositeSide,
	type Result,
	type SetupAction,
	type Side,
	type Square,
	toPlayerView,
} from "@sittuyin/engine";
import type { TimeControl } from "@sittuyin/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AppLocale, formatSideName } from "@/i18n/locale";
import {
	type ExtendedOutcome,
	type MatchAdapter,
	type MatchClockState,
	type MatchPlayerHud,
	TIME_CONTROL_CONFIGS,
} from "./types";

export type LocalPlayMode = "local_pass_and_play" | "local_sandbox";

export interface LocalMatchOptions {
	readonly mode: LocalPlayMode;
	readonly timeControl: TimeControl | null;
	readonly locale: AppLocale;
	readonly initialState?: GameState;
}

interface InternalLocalMatch {
	readonly gameState: GameState;
	readonly historyStates: readonly GameState[];
	readonly setupViewer: Side;
	readonly pendingRevealHandoff: Side | null;
	readonly extraOutcome: ExtendedOutcome | null;
}

function createInitialClock(
	timeControl: TimeControl | null,
): MatchClockState | null {
	if (timeControl === null) {
		return null;
	}
	const cfg = TIME_CONTROL_CONFIGS[timeControl];
	return {
		enabled: true,
		timeControl,
		remainingMs: {
			red: cfg.initialMs,
			black: cfg.initialMs,
		},
		activeSide: null,
		lowTimeThresholdMs: 30_000,
		criticalTimeThresholdMs: 10_000,
		syncedAtMs: Date.now(),
	};
}

function generateCryptoSeed(): number {
	if (
		typeof globalThis.crypto !== "undefined" &&
		typeof globalThis.crypto.getRandomValues === "function"
	) {
		const buf = new Uint32Array(1);
		globalThis.crypto.getRandomValues(buf);
		return buf[0] ?? 1;
	}
	return Date.now() >>> 0 || 1;
}

export function applyRandomSetupToState(
	state: GameState,
	side: Side,
	seed: number,
): Result<GameState, EngineError> {
	const cleared = applySetupAction(state, side, { kind: "clear" });
	if (!cleared.ok) {
		return cleared;
	}
	const placements = generateRandomSetup(seed, side);
	let current = cleared.value;
	const entries = Object.entries(placements) as [
		Square,
		OfficerRole | undefined,
	][];
	for (const [sq, role] of entries) {
		if (role === undefined) {
			continue;
		}
		const placed = applySetupAction(current, side, {
			kind: "place",
			role,
			to: sq,
		});
		if (!placed.ok) {
			return placed;
		}
		current = placed.value;
	}
	return { ok: true, value: current };
}

function createInitialInternal(initialState?: GameState): InternalLocalMatch {
	const gameState = initialState ?? createGame();
	return {
		gameState,
		historyStates: [gameState],
		setupViewer: "red",
		pendingRevealHandoff: null,
		extraOutcome: null,
	};
}

export function useLocalMatchAdapter(options: LocalMatchOptions): {
	adapter: MatchAdapter;
	resetMatch: (nextOptions?: {
		mode?: LocalPlayMode;
		timeControl?: TimeControl | null;
	}) => void;
} {
	const { mode, timeControl, locale, initialState } = options;

	const [internal, setInternal] = useState<InternalLocalMatch>(() =>
		createInitialInternal(initialState),
	);
	const [clock, setClock] = useState<MatchClockState | null>(() =>
		createInitialClock(timeControl),
	);

	// Keep a ref to latest internal state so dispatchers return synchronous Result<void, EngineError>
	const internalRef = useRef(internal);
	internalRef.current = internal;

	const clockRef = useRef(clock);
	clockRef.current = clock;

	// Sync clock when timeControl changes on a fresh match before moves are played
	const prevTimeControlRef = useRef<TimeControl | null>(timeControl);
	useEffect(() => {
		if (prevTimeControlRef.current !== timeControl) {
			prevTimeControlRef.current = timeControl;
			setClock(createInitialClock(timeControl));
		}
	}, [timeControl]);

	// Clear handoff curtain immediately if user switches into sandbox mode
	useEffect(() => {
		if (mode === "local_sandbox" && internalRef.current.pendingRevealHandoff) {
			setInternal((prev) => ({ ...prev, pendingRevealHandoff: null }));
		}
	}, [mode]);

	const activeOutcome: ExtendedOutcome | null =
		internal.extraOutcome ?? internal.gameState.outcome;

	// Tick countdown clock smoothly during active play
	useEffect(() => {
		if (
			timeControl === null ||
			internal.gameState.phase !== "playing" ||
			activeOutcome !== null
		) {
			return;
		}

		const activeSide = internal.gameState.turn;
		setClock((prev) =>
			prev === null
				? null
				: {
						...prev,
						activeSide,
						syncedAtMs: Date.now(),
					},
		);

		const intervalId = window.setInterval(() => {
			setClock((prev) => {
				if (prev === null || prev.activeSide === null) {
					return prev;
				}
				const now = Date.now();
				const elapsed = Math.max(0, now - prev.syncedAtMs);
				const side = prev.activeSide;
				const nextMs = Math.max(0, prev.remainingMs[side] - elapsed);
				if (nextMs === 0) {
					setInternal((curr) => {
						if (curr.extraOutcome !== null || curr.gameState.outcome !== null) {
							return curr;
						}
						return {
							...curr,
							extraOutcome: {
								status: "win",
								winner: oppositeSide(side),
								reason: "timeout",
							},
						};
					});
					return {
						...prev,
						remainingMs: { ...prev.remainingMs, [side]: 0 },
						activeSide: null,
						syncedAtMs: now,
					};
				}
				return {
					...prev,
					remainingMs: { ...prev.remainingMs, [side]: nextMs },
					syncedAtMs: now,
				};
			});
		}, 100);

		return () => window.clearInterval(intervalId);
	}, [
		timeControl,
		internal.gameState.phase,
		internal.gameState.turn,
		activeOutcome,
	]);

	const resetMatch = useCallback(
		(nextOptions?: {
			mode?: LocalPlayMode;
			timeControl?: TimeControl | null;
		}) => {
			const tc =
				nextOptions && "timeControl" in nextOptions
					? (nextOptions.timeControl ?? null)
					: timeControl;
			const fresh = createInitialInternal();
			internalRef.current = fresh;
			setInternal(fresh);
			setClock(createInitialClock(tc));
		},
		[timeControl],
	);

	const dispatchSetup = useCallback(
		(action: SetupAction): Result<void, EngineError> => {
			const curr = internalRef.current;
			const side = curr.setupViewer;
			const res = applySetupAction(curr.gameState, side, action);
			if (!res.ok) {
				return res;
			}
			const nextState = res.value;
			const transitionedToPlay =
				curr.gameState.phase === "setup" && nextState.phase === "playing";

			let nextViewer = curr.setupViewer;
			let nextHandoff = curr.pendingRevealHandoff;

			if (transitionedToPlay) {
				nextViewer = "red";
				nextHandoff = null;
			} else if (
				action.kind === "lock" &&
				nextState.phase === "setup" &&
				mode === "local_pass_and_play"
			) {
				const other = oppositeSide(side);
				if (!nextState.setupReady[other]) {
					nextHandoff = other;
				}
			}

			const updated: InternalLocalMatch = {
				...curr,
				gameState: nextState,
				historyStates: transitionedToPlay ? [nextState] : [nextState],
				setupViewer: nextViewer,
				pendingRevealHandoff: nextHandoff,
			};
			internalRef.current = updated;
			setInternal(updated);

			if (transitionedToPlay && clockRef.current !== null) {
				setClock((prev) =>
					prev === null
						? null
						: {
								...prev,
								activeSide: nextState.turn,
								syncedAtMs: Date.now(),
							},
				);
			}
			return { ok: true, value: undefined };
		},
		[mode],
	);

	const applyRandomSetup = useCallback((): Result<void, EngineError> => {
		const curr = internalRef.current;
		const res = applyRandomSetupToState(
			curr.gameState,
			curr.setupViewer,
			generateCryptoSeed(),
		);
		if (!res.ok) {
			return res;
		}
		const updated: InternalLocalMatch = {
			...curr,
			gameState: res.value,
			historyStates: [res.value],
		};
		internalRef.current = updated;
		setInternal(updated);
		return { ok: true, value: undefined };
	}, []);

	const dispatchMove = useCallback(
		(move: Move): Result<void, EngineError> => {
			const curr = internalRef.current;
			if (curr.extraOutcome !== null) {
				return {
					ok: false,
					error: {
						code: "INVALID_PHASE",
						message: "The match has already finished.",
					},
				};
			}
			const movingSide = curr.gameState.turn;
			const res = applyMove(curr.gameState, move);
			if (!res.ok) {
				return res;
			}
			const nextState = res.value;
			const updated: InternalLocalMatch = {
				...curr,
				gameState: nextState,
				historyStates: [...curr.historyStates, nextState],
			};
			internalRef.current = updated;
			setInternal(updated);

			if (timeControl !== null) {
				const cfg = TIME_CONTROL_CONFIGS[timeControl];
				setClock((prev) => {
					if (prev === null) {
						return null;
					}
					const now = Date.now();
					const elapsed =
						prev.activeSide === movingSide
							? Math.max(0, now - prev.syncedAtMs)
							: 0;
					const remainingAfterMove = Math.max(
						0,
						prev.remainingMs[movingSide] - elapsed + cfg.incrementMs,
					);
					const finished = nextState.phase === "finished";
					return {
						...prev,
						remainingMs: {
							...prev.remainingMs,
							[movingSide]: remainingAfterMove,
						},
						activeSide: finished ? null : nextState.turn,
						syncedAtMs: now,
					};
				});
			}

			return { ok: true, value: undefined };
		},
		[timeControl],
	);

	const confirmHandoff = useCallback(() => {
		setInternal((curr) => {
			if (curr.pendingRevealHandoff === null) {
				return curr;
			}
			const next: InternalLocalMatch = {
				...curr,
				setupViewer: curr.pendingRevealHandoff,
				pendingRevealHandoff: null,
			};
			internalRef.current = next;
			return next;
		});
	}, []);

	const switchSandboxViewer = useCallback((side: Side) => {
		setInternal((curr) => {
			const next: InternalLocalMatch = {
				...curr,
				setupViewer: side,
				pendingRevealHandoff: null,
			};
			internalRef.current = next;
			return next;
		});
	}, []);

	const requestResign = useCallback(() => {
		setInternal((curr) => {
			if (
				curr.gameState.phase !== "playing" ||
				curr.extraOutcome !== null ||
				curr.gameState.outcome !== null
			) {
				return curr;
			}
			const next: InternalLocalMatch = {
				...curr,
				extraOutcome: {
					status: "win",
					winner: oppositeSide(curr.gameState.turn),
					reason: "resignation",
				},
			};
			internalRef.current = next;
			return next;
		});
	}, []);

	const requestDraw = useCallback(() => {
		setInternal((curr) => {
			if (
				curr.gameState.phase !== "playing" ||
				curr.extraOutcome !== null ||
				curr.gameState.outcome !== null
			) {
				return curr;
			}
			const next: InternalLocalMatch = {
				...curr,
				extraOutcome: {
					status: "draw",
					winner: null,
					reason: "agreed",
				},
			};
			internalRef.current = next;
			return next;
		});
	}, []);

	const activeViewer =
		internal.gameState.phase === "setup" ? internal.setupViewer : "red";

	const view = useMemo(
		() => toPlayerView(internal.gameState, activeViewer),
		[internal.gameState, activeViewer],
	);

	const players: Readonly<Record<Side, MatchPlayerHud>> = useMemo(
		() => ({
			red: {
				side: "red",
				displayName: formatSideName("red", locale),
				rating: null,
				connected: true,
				isLocal: true,
			},
			black: {
				side: "black",
				displayName: formatSideName("black", locale),
				rating: null,
				connected: true,
				isLocal: true,
			},
		}),
		[locale],
	);

	const adapter: MatchAdapter = useMemo(
		() => ({
			mode,
			view,
			players,
			clock,
			historyStates: internal.historyStates,
			pendingRevealHandoff: internal.pendingRevealHandoff,
			connectionStatus: "local",
			isInteractive: activeOutcome === null,
			outcome: activeOutcome,
			dispatchSetup,
			dispatchMove,
			applyRandomSetup,
			requestResign,
			requestDraw,
			confirmHandoff,
			switchSandboxViewer:
				mode === "local_sandbox" ? switchSandboxViewer : undefined,
		}),
		[
			mode,
			view,
			players,
			clock,
			internal.historyStates,
			internal.pendingRevealHandoff,
			activeOutcome,
			dispatchSetup,
			dispatchMove,
			applyRandomSetup,
			requestResign,
			requestDraw,
			confirmHandoff,
			switchSandboxViewer,
		],
	);

	return { adapter, resetMatch };
}

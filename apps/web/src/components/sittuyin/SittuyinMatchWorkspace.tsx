import {
	type EngineError,
	getCheckingSquares,
	getLegalMovesFrom,
	getLegalSetupSquares,
	getPromotionCandidates,
	isInCheck,
	type Move,
	type OfficerRole,
	type Piece,
	type PlayerGameView,
	type PromoteMove,
	type Result,
	type SetupAction,
	type Side,
	type Square,
	toFen,
	toPlayerView,
} from "@sittuyin/engine";
import {
	Copy,
	ExternalLink,
	Flag,
	Handshake,
	Moon,
	RefreshCw,
	RotateCw,
	Share2,
	Sun,
	Trophy,
	Volume2,
	VolumeX,
} from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
	type AppLocale,
	formatEngineError,
	formatSideName,
	m,
} from "@/i18n/locale";
import type { ExtendedOutcome, MatchAdapter } from "@/lib/adapters/types";
import { getAudioEngine, type SoundCue } from "@/lib/audio-engine";
import {
	computeMaterialAdvantage,
	getVisiblePieceAt,
	isBoardFlipped,
	viewToEngineQueryState,
} from "@/lib/board-geometry";
import { useBoardPreferencesStore } from "@/stores/board-preferences";
import { BoardPreferencesDialog } from "./BoardPreferencesDialog";
import { MoveHistoryPanel } from "./MoveHistoryPanel";
import {
	OnlineMatchActionBar,
	OnlineStatusHeader,
} from "./OnlineMatchControls";
import { PlayerHudBar } from "./PlayerHudBar";
import type { PendingPromotionState } from "./PromotionOverlay";
import { type AutoPlaySpeed, ReplayScrubberBar } from "./ReplayScrubberBar";
import { SetupHandoffCurtain, SetupTray } from "./SetupTray";
import { type BoardDragGhost, SittuyinBoard } from "./SittuyinBoard";
import { WaitingRoomOverlay } from "./WaitingRoomOverlay";

export interface SittuyinMatchWorkspaceProps {
	readonly adapter: MatchAdapter;
	readonly locale: AppLocale;
	readonly initialReplayPly?: number;
	readonly onReplayPlyChange?: (ply: number) => void;
	readonly onNewMatch?: () => void;
	readonly onLeaveOnlineRoom?: () => void;
	readonly topToolbar?: ReactNode;
	readonly railHeaderExtra?: ReactNode;
}

function formatOutcomeBanner(
	outcome: ExtendedOutcome,
	locale: AppLocale,
): string {
	if (outcome.status === "win") {
		const winner = formatSideName(outcome.winner, locale);
		switch (outcome.reason) {
			case "checkmate":
				return m.outcome_win_checkmate({ winner }, { locale });
			case "resignation":
				return m.outcome_win_resign({ winner }, { locale });
			case "timeout":
				return m.outcome_win_timeout({ winner }, { locale });
			case "abandonment":
				return m.outcome_win_abandonment({ winner }, { locale });
		}
	}
	if (outcome.status === "aborted") {
		switch (outcome.reason) {
			case "aborted_maintenance":
				return m.outcome_aborted_maintenance({}, { locale });
			case "aborted_pre_move":
				return m.outcome_aborted_pre_move({}, { locale });
		}
	}
	switch (outcome.reason) {
		case "agreed":
		case "agreed_draw":
			return m.outcome_draw_agreed({}, { locale });
		case "stalemate":
			return m.outcome_draw_stalemate({}, { locale });
		case "unavoidable_stalemate":
			return m.outcome_draw_unavoidable_stalemate({}, { locale });
		case "threefold_repetition":
			return m.outcome_draw_threefold({}, { locale });
		case "fifty_move_rule":
			return m.outcome_draw_fifty({}, { locale });
		case "bare_king_fifty_move":
			return m.outcome_draw_bare_king({}, { locale });
		case "insufficient_material":
			return m.outcome_draw_insufficient({}, { locale });
	}
}

function findKingSquare(view: PlayerGameView, side: Side): Square | null {
	for (let i = 0; i < 64; i++) {
		const piece = view.board[i];
		if (piece !== null && piece.side === side && piece.role === "king") {
			const file = "abcdefgh"[i % 8];
			const rank = String(Math.floor(i / 8) + 1);
			return `${file}${rank}` as Square;
		}
	}
	return null;
}

export function SittuyinMatchWorkspace({
	adapter,
	locale,
	initialReplayPly,
	onReplayPlyChange,
	onNewMatch,
	onLeaveOnlineRoom,
	topToolbar,
	railHeaderExtra,
}: SittuyinMatchWorkspaceProps) {
	// Persisted user preferences
	const theme = useBoardPreferencesStore((s) => s.theme);
	const toggleTheme = useBoardPreferencesStore((s) => s.toggleTheme);
	const soundEnabled = useBoardPreferencesStore((s) => s.soundEnabled);
	const toggleSound = useBoardPreferencesStore((s) => s.toggleSound);
	const soundVolume = useBoardPreferencesStore((s) => s.soundVolume);
	const pieceScriptOverlay = useBoardPreferencesStore(
		(s) => s.pieceScriptOverlay,
	);
	const showLegalHints = useBoardPreferencesStore((s) => s.showLegalHints);
	const showCoordinates = useBoardPreferencesStore((s) => s.showCoordinates);
	const highlightSitKeMyin = useBoardPreferencesStore(
		(s) => s.highlightSitKeMyin,
	);
	const confirmPromotion = useBoardPreferencesStore((s) => s.confirmPromotion);
	const animationSpeed = useBoardPreferencesStore((s) => s.animationSpeed);

	// Ephemeral interaction state
	const [manualFlip, setManualFlip] = useState(false);
	const [focusedSquare, setFocusedSquare] = useState<Square>("e4");
	const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
	const [selectedHandRole, setSelectedHandRole] = useState<OfficerRole | null>(
		null,
	);
	const [externalDragGhost, setExternalDragGhost] =
		useState<BoardDragGhost | null>(null);
	const [externalHoverSquare, setExternalHoverSquare] = useState<Square | null>(
		null,
	);
	const [draggingHandRole, setDraggingHandRole] = useState<OfficerRole | null>(
		null,
	);
	const [draggingBoardSquare, setDraggingBoardSquare] = useState<Square | null>(
		null,
	);
	const [pendingPromotion, setPendingPromotion] =
		useState<PendingPromotionState | null>(null);
	const [shakeSquare, setShakeSquare] = useState<{
		readonly square: Square;
		readonly nonce: number;
	} | null>(null);

	// Replay scrubber state (null = live head for live matches; numeric for replay mode or scrubbed live)
	const totalPlies = Math.max(0, adapter.historyStates.length - 1);
	const [replayCursor, setReplayCursor] = useState<number | null>(() =>
		adapter.mode === "replay"
			? Math.min(initialReplayPly ?? 0, totalPlies)
			: null,
	);
	const [unseenPlies, setUnseenPlies] = useState(0);
	const [isAutoPlaying, setIsAutoPlaying] = useState(false);
	const [autoPlaySpeed, setAutoPlaySpeed] = useState<AutoPlaySpeed>(1);

	const boardContainerRef = useRef<HTMLDivElement | null>(null);
	const prevHistoryLenRef = useRef(adapter.historyStates.length);
	const prevOutcomeRef = useRef(adapter.outcome);
	const lowTimeWarnedRef = useRef<{ red: boolean; black: boolean }>({
		red: false,
		black: false,
	});
	const lastTickSecondRef = useRef<{
		red: number | null;
		black: number | null;
	}>({
		red: null,
		black: null,
	});

	const playCue = useCallback(
		(cue: SoundCue) => {
			getAudioEngine().play(cue, {
				enabled: soundEnabled,
				volume: soundVolume,
			});
		},
		[soundEnabled, soundVolume],
	);

	// Unlock Web Audio cleanly on first user interaction
	useEffect(() => {
		const unlock = () => {
			getAudioEngine().unlock();
		};
		window.addEventListener("pointerdown", unlock, { once: true });
		window.addEventListener("keydown", unlock, { once: true });
		return () => {
			window.removeEventListener("pointerdown", unlock);
			window.removeEventListener("keydown", unlock);
		};
	}, []);

	// Sync replay cursor when historyStates resets (e.g. new match or new replay loaded)
	useEffect(() => {
		const prevLen = prevHistoryLenRef.current;
		const nextLen = adapter.historyStates.length;
		prevHistoryLenRef.current = nextLen;

		if (adapter.mode === "replay") {
			setReplayCursor((curr) => {
				if (curr === null) return 0;
				return Math.min(curr, Math.max(0, nextLen - 1));
			});
			setUnseenPlies(0);
			return;
		}

		if (nextLen <= 1 && prevLen > 1) {
			// Match reset
			setReplayCursor(null);
			setUnseenPlies(0);
			setSelectedSquare(null);
			setSelectedHandRole(null);
			setPendingPromotion(null);
			setIsAutoPlaying(false);
			lowTimeWarnedRef.current = { red: false, black: false };
			lastTickSecondRef.current = { red: null, black: null };
			return;
		}

		if (nextLen > prevLen) {
			if (replayCursor !== null) {
				setUnseenPlies((u) => u + (nextLen - prevLen));
			}
			// Play acoustic cue for latest move
			const latestState = adapter.historyStates[nextLen - 1];
			const lastRecord =
				latestState?.moveHistory[latestState.moveHistory.length - 1];
			if (lastRecord !== undefined) {
				if (lastRecord.gaveCheckmate) {
					playCue("game_over");
				} else if (lastRecord.gaveCheck) {
					playCue("check");
				} else if (lastRecord.move.kind === "promote") {
					playCue("promote");
				} else if (lastRecord.captured !== null) {
					playCue("capture");
				} else {
					playCue("move");
				}
			}
		}
	}, [adapter.historyStates, adapter.mode, playCue, replayCursor]);

	// Play game over cadence when match finishes via resign/draw/timeout
	useEffect(() => {
		if (prevOutcomeRef.current === null && adapter.outcome !== null) {
			playCue("game_over");
			setSelectedSquare(null);
			setPendingPromotion(null);
		}
		prevOutcomeRef.current = adapter.outcome;
	}, [adapter.outcome, playCue]);

	// Clock low-time (30s) warning & critical 10s per-second wooden ticks
	useEffect(() => {
		const clock = adapter.clock;
		if (
			clock === null ||
			!clock.enabled ||
			clock.activeSide === null ||
			adapter.outcome !== null
		) {
			return;
		}
		const side = clock.activeSide;
		const rem = clock.remainingMs[side];
		if (rem <= clock.lowTimeThresholdMs && !lowTimeWarnedRef.current[side]) {
			lowTimeWarnedRef.current[side] = true;
			playCue("clock_low");
		}
		if (rem > 0 && rem <= clock.criticalTimeThresholdMs) {
			const wholeSec = Math.ceil(rem / 1000);
			if (lastTickSecondRef.current[side] !== wholeSec) {
				lastTickSecondRef.current[side] = wholeSec;
				playCue("clock_tick");
			}
		}
	}, [adapter.clock, adapter.outcome, playCue]);

	// Reset selection on phase, turn, or viewer change
	const selectionResetKey = `${adapter.view.phase}:${adapter.view.turn}:${adapter.view.viewer}`;
	useEffect(() => {
		if (selectionResetKey.length > 0) {
			setSelectedSquare(null);
			setPendingPromotion(null);
		}
	}, [selectionResetKey]);

	const activePly =
		replayCursor === null
			? totalPlies
			: Math.max(0, Math.min(replayCursor, totalPlies));

	useEffect(() => {
		if (adapter.mode === "replay") {
			onReplayPlyChange?.(activePly);
		}
	}, [adapter.mode, activePly, onReplayPlyChange]);

	const isScrubbingLiveMatch =
		adapter.mode !== "replay" && replayCursor !== null;

	// Auto-play timer for replay scrubber
	useEffect(() => {
		if (!isAutoPlaying) return;
		if (activePly >= totalPlies) {
			setIsAutoPlaying(false);
			return;
		}
		const intervalMs =
			autoPlaySpeed === 2 ? 450 : autoPlaySpeed === 0.5 ? 1600 : 900;
		const id = window.setInterval(() => {
			setReplayCursor((curr) => {
				const base = curr ?? totalPlies;
				if (base >= totalPlies) {
					setIsAutoPlaying(false);
					return adapter.mode === "replay" ? totalPlies : null;
				}
				const next = base + 1;
				if (next >= totalPlies && adapter.mode !== "replay") {
					setUnseenPlies(0);
					setIsAutoPlaying(false);
					return null;
				}
				return next;
			});
		}, intervalMs);
		return () => window.clearInterval(id);
	}, [isAutoPlaying, activePly, totalPlies, autoPlaySpeed, adapter.mode]);

	const handleSelectPly = useCallback(
		(ply: number) => {
			setIsAutoPlaying(false);
			const clamped = Math.max(0, Math.min(ply, totalPlies));
			if (adapter.mode !== "replay" && clamped >= totalPlies) {
				setReplayCursor(null);
				setUnseenPlies(0);
			} else {
				setReplayCursor(clamped);
				if (clamped >= totalPlies) {
					setUnseenPlies(0);
				}
			}
		},
		[adapter.mode, totalPlies],
	);

	const handleBackToLive = useCallback(() => {
		setIsAutoPlaying(false);
		setReplayCursor(null);
		setUnseenPlies(0);
	}, []);

	// Keyboard replay shortcuts (ArrowLeft, ArrowRight, Home, End) when outside inputs/board grid
	useEffect(() => {
		if (totalPlies === 0) return;
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target !== null &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.closest('[role="grid"]') !== null ||
					target.closest('[role="dialog"]') !== null)
			) {
				return;
			}
			if (event.key === "ArrowLeft") {
				event.preventDefault();
				handleSelectPly(activePly - 1);
			} else if (event.key === "ArrowRight") {
				event.preventDefault();
				handleSelectPly(activePly + 1);
			} else if (event.key === "Home") {
				event.preventDefault();
				handleSelectPly(0);
			} else if (event.key === "End") {
				event.preventDefault();
				handleSelectPly(totalPlies);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [activePly, handleSelectPly, totalPlies]);

	// Determine the masked PlayerGameView currently displayed on the board
	const displayedView: PlayerGameView = useMemo(() => {
		if (
			adapter.view.phase === "setup" &&
			adapter.mode !== "replay" &&
			replayCursor === null
		) {
			return adapter.view;
		}
		if (replayCursor !== null) {
			const snapshot = adapter.historyStates[activePly];
			if (snapshot !== undefined) {
				return toPlayerView(snapshot, adapter.view.viewer);
			}
		}
		return adapter.view;
	}, [
		adapter.historyStates,
		adapter.mode,
		adapter.view,
		activePly,
		replayCursor,
	]);

	const flipped = isBoardFlipped(adapter.view.viewer, manualFlip);
	const boardInteractive =
		adapter.isInteractive &&
		!isScrubbingLiveMatch &&
		adapter.pendingRevealHandoff === null;

	const queryState = useMemo(
		() => viewToEngineQueryState(displayedView),
		[displayedView],
	);

	// Legal moves (including PromoteMove options) for current selection during play
	const legalMovesForSelection: readonly Move[] = useMemo(() => {
		if (
			!boardInteractive ||
			displayedView.phase !== "playing" ||
			selectedSquare === null
		) {
			return [];
		}
		return getLegalMovesFrom(queryState, selectedSquare);
	}, [boardInteractive, displayedView.phase, queryState, selectedSquare]);

	// Track promotable pawn squares from the engine so players can spot them easily
	const promotablePawnSquares = useMemo(() => {
		if (!boardInteractive || displayedView.phase !== "playing") {
			return new Set<Square>();
		}
		return new Set<Square>(
			getPromotionCandidates(queryState, displayedView.turn),
		);
	}, [boardInteractive, displayedView.phase, displayedView.turn, queryState]);

	// Legal setup squares for selected/dragged officer during setup
	const legalSetupSquares: readonly Square[] = useMemo(() => {
		if (
			!boardInteractive ||
			displayedView.phase !== "setup" ||
			displayedView.viewer === "spectator"
		) {
			return [];
		}
		const viewer = displayedView.viewer;
		if (draggingHandRole !== null) {
			return getLegalSetupSquares(queryState, viewer, draggingHandRole);
		}
		if (selectedHandRole !== null) {
			return getLegalSetupSquares(queryState, viewer, selectedHandRole);
		}
		const activeBoardSq = draggingBoardSquare ?? selectedSquare;
		if (activeBoardSq !== null) {
			const role = displayedView.myDraft[activeBoardSq];
			if (role !== undefined) {
				return getLegalSetupSquares(queryState, viewer, role, activeBoardSq);
			}
		}
		return [];
	}, [
		boardInteractive,
		displayedView.myDraft,
		displayedView.phase,
		displayedView.viewer,
		draggingBoardSquare,
		draggingHandRole,
		queryState,
		selectedHandRole,
		selectedSquare,
	]);

	// Check halo & checker attacker squares
	const redInCheck = useMemo(
		() => displayedView.phase !== "setup" && isInCheck(queryState, "red"),
		[displayedView.phase, queryState],
	);
	const blackInCheck = useMemo(
		() => displayedView.phase !== "setup" && isInCheck(queryState, "black"),
		[displayedView.phase, queryState],
	);

	const checkedKingSquare: Square | null = useMemo(() => {
		if (redInCheck) return findKingSquare(displayedView, "red");
		if (blackInCheck) return findKingSquare(displayedView, "black");
		return null;
	}, [blackInCheck, displayedView, redInCheck]);

	const checkingSquares: readonly Square[] = useMemo(() => {
		if (redInCheck) return getCheckingSquares(queryState, "red");
		if (blackInCheck) return getCheckingSquares(queryState, "black");
		return [];
	}, [blackInCheck, queryState, redInCheck]);

	// Last move highlight
	const lastMoveSquares: readonly [Square, Square] | null = useMemo(() => {
		const last =
			displayedView.moveHistory[displayedView.moveHistory.length - 1];
		if (last === undefined) return null;
		if (last.move.kind === "drop") {
			return [last.move.to, last.move.to];
		}
		return [last.move.from, last.move.to];
	}, [displayedView.moveHistory]);

	const triggerRejection = useCallback(
		(error: EngineError, square?: Square) => {
			toast.error(formatEngineError(error.code, locale));
			if (square !== undefined) {
				setShakeSquare((prev) => ({
					square,
					nonce: (prev?.nonce ?? 0) + 1,
				}));
			}
		},
		[locale],
	);

	const runSetupAction = useCallback(
		async (action: SetupAction, feedbackSquare?: Square) => {
			const res: Result<void, EngineError> =
				await adapter.dispatchSetup(action);
			if (!res.ok) {
				triggerRejection(res.error, feedbackSquare);
				return;
			}
			if (
				action.kind === "place" ||
				action.kind === "move" ||
				action.kind === "apply_preset"
			) {
				playCue("setup_drop");
			}
		},
		[adapter, playCue, triggerRejection],
	);

	const runMove = useCallback(
		async (move: Move, feedbackSquare?: Square) => {
			const res: Result<void, EngineError> = await adapter.dispatchMove(move);
			if (!res.ok) {
				triggerRejection(res.error, feedbackSquare);
				return;
			}
			setSelectedSquare(null);
			setPendingPromotion(null);
		},
		[adapter, triggerRejection],
	);

	const handleApplyRandomSetup = useCallback(async () => {
		setSelectedHandRole(null);
		setSelectedSquare(null);
		const res = await adapter.applyRandomSetup();
		if (!res.ok) {
			triggerRejection(res.error);
			return;
		}
		playCue("setup_drop");
	}, [adapter, playCue, triggerRejection]);

	const handleCancelInteraction = useCallback(() => {
		setSelectedSquare(null);
		setSelectedHandRole(null);
		setPendingPromotion(null);
		setDraggingBoardSquare(null);
		setDraggingHandRole(null);
		setExternalDragGhost(null);
		setExternalHoverSquare(null);
	}, []);

	// Unified square activation (click / keyboard Enter)
	const handleSquareActivate = useCallback(
		(square: Square) => {
			if (!boardInteractive) return;

			// 1. Setup Phase
			if (displayedView.phase === "setup") {
				if (
					displayedView.viewer === "spectator" ||
					displayedView.setupReady[displayedView.viewer]
				) {
					return;
				}
				// Place from selected hand officer
				if (selectedHandRole !== null) {
					const role = selectedHandRole;
					const existingCount = displayedView.hands[displayedView.viewer][role];
					if (existingCount <= 1) {
						setSelectedHandRole(null);
					}
					void runSetupAction({ kind: "place", role, to: square }, square);
					return;
				}

				const draftedRole = displayedView.myDraft[square];

				// Move/swap already selected drafted officer
				if (selectedSquare !== null) {
					if (selectedSquare === square) {
						setSelectedSquare(null);
						return;
					}
					const from = selectedSquare;
					setSelectedSquare(null);
					void runSetupAction({ kind: "move", from, to: square }, square);
					return;
				}

				// Select drafted officer on board
				if (draftedRole !== undefined) {
					setSelectedSquare(square);
				}
				return;
			}

			// 2. Playing Phase
			if (displayedView.phase !== "playing") {
				return;
			}

			const pieceAtSquare = getVisiblePieceAt(displayedView, square);

			if (selectedSquare !== null) {
				const matchingPromo = legalMovesForSelection.find(
					(mv): mv is PromoteMove =>
						mv.kind === "promote" &&
						mv.from === selectedSquare &&
						mv.to === square,
				);
				if (matchingPromo !== undefined) {
					if (confirmPromotion) {
						const allPromos = legalMovesForSelection.filter(
							(mv): mv is PromoteMove =>
								mv.kind === "promote" && mv.from === selectedSquare,
						);
						setPendingPromotion({
							from: selectedSquare,
							preferredTarget: square,
							side: displayedView.turn,
							options: allPromos,
						});
					} else {
						void runMove(matchingPromo, square);
					}
					return;
				}

				const matchingNormal = legalMovesForSelection.find(
					(mv) =>
						mv.kind === "normal" &&
						mv.from === selectedSquare &&
						mv.to === square,
				);
				if (matchingNormal !== undefined) {
					void runMove(matchingNormal, square);
					return;
				}

				if (selectedSquare === square) {
					setSelectedSquare(null);
					return;
				}

				// Switch selection to another own piece
				if (
					pieceAtSquare !== null &&
					pieceAtSquare.side === displayedView.turn
				) {
					setSelectedSquare(square);
					return;
				}

				// Attempted illegal destination click -> deselect cleanly
				setSelectedSquare(null);
				return;
			}

			// Select own piece
			if (pieceAtSquare !== null && pieceAtSquare.side === displayedView.turn) {
				setSelectedSquare(square);
			}
		},
		[
			boardInteractive,
			confirmPromotion,
			displayedView,
			legalMovesForSelection,
			runMove,
			runSetupAction,
			selectedHandRole,
			selectedSquare,
		],
	);

	// Board pointer drag drop handler
	const handleBoardPieceDrop = useCallback(
		(from: Square, to: Square | null) => {
			if (!boardInteractive) return;
			setDraggingBoardSquare(null);

			if (displayedView.phase === "setup") {
				if (to === null) {
					// Dragged off board -> remove drafted officer back to hand
					setSelectedSquare(null);
					void runSetupAction({ kind: "remove", from }, from);
					return;
				}
				setSelectedSquare(null);
				void runSetupAction({ kind: "move", from, to }, to);
				return;
			}

			if (displayedView.phase !== "playing" || to === null) {
				return;
			}

			const movesFrom = getLegalMovesFrom(queryState, from);
			const promosFrom = movesFrom.filter(
				(mv): mv is PromoteMove => mv.kind === "promote",
			);

			const promoMatch = promosFrom.find((p) => p.to === to);
			if (promoMatch !== undefined) {
				if (confirmPromotion) {
					setPendingPromotion({
						from,
						preferredTarget: to,
						side: displayedView.turn,
						options: promosFrom,
					});
				} else {
					void runMove(promoMatch, to);
				}
				return;
			}

			const normalMatch = movesFrom.find(
				(mv) => mv.kind === "normal" && mv.to === to,
			);
			if (normalMatch !== undefined) {
				void runMove(normalMatch, to);
				return;
			}

			// Dispatch via engine so specific EngineErrorCode (e.g. ILLEGAL_STALEMATE) triggers localized toast + shake!
			void runMove({ kind: "normal", from, to }, to);
		},
		[
			boardInteractive,
			confirmPromotion,
			displayedView.phase,
			displayedView.turn,
			queryState,
			runMove,
			runSetupAction,
		],
	);

	const handleBoardPieceDoubleTap = useCallback(
		(square: Square) => {
			if (
				!boardInteractive ||
				displayedView.phase !== "setup" ||
				displayedView.myDraft[square] === undefined
			) {
				return;
			}
			setSelectedSquare(null);
			void runSetupAction({ kind: "remove", from: square }, square);
		},
		[
			boardInteractive,
			displayedView.myDraft,
			displayedView.phase,
			runSetupAction,
		],
	);

	const handleHandDropOnBoard = useCallback(
		(role: OfficerRole, square: Square) => {
			if (!boardInteractive || displayedView.phase !== "setup") return;
			setSelectedHandRole(null);
			void runSetupAction({ kind: "place", role, to: square }, square);
		},
		[boardInteractive, displayedView.phase, runSetupAction],
	);

	const handleBoardDragStart = useCallback((square: Square, _piece: Piece) => {
		setDraggingBoardSquare(square);
		setSelectedSquare(square);
	}, []);

	const handleBoardDragEnd = useCallback(() => {
		setDraggingBoardSquare(null);
	}, []);

	const handleCopyFen = useCallback(async () => {
		const fen = toFen(queryState);
		try {
			await navigator.clipboard.writeText(fen);
			toast.success(m.copied_fen_toast({}, { locale }));
		} catch {
			toast.info(fen);
		}
	}, [locale, queryState]);

	const handleCopyUci = useCallback(async () => {
		const uci = adapter.view.moveHistory.map((r) => r.uci).join(" ");
		try {
			await navigator.clipboard.writeText(uci);
			toast.success(m.copied_uci_toast({}, { locale }));
		} catch {
			toast.info(uci);
		}
	}, [adapter.view.moveHistory, locale]);

	const materialAdv = useMemo(
		() => computeMaterialAdvantage(displayedView.captured),
		[displayedView.captured],
	);

	const topSide: Side = flipped ? "red" : "black";
	const bottomSide: Side = flipped ? "black" : "red";

	// Full move history from latest head state so clicking any ply works even while scrubbed back
	const fullMoveHistory = adapter.view.moveHistory;

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-3 py-4 sm:px-5 lg:py-6">
			{topToolbar ? (
				<div className="flex flex-wrap items-center justify-between gap-2">
					{topToolbar}
				</div>
			) : null}

			<div className="flex flex-col items-start gap-5 lg:flex-row lg:items-start lg:justify-center lg:gap-6">
				{/* Left Play Column: Top HUD -> Square SVG Board -> Bottom HUD -> Action Strip */}
				<section
					aria-label={m.aria_board_label({}, { locale })}
					className="flex w-full flex-col gap-2.5 lg:max-w-[min(74vh,680px)] lg:flex-1"
				>
					<PlayerHudBar
						player={adapter.players[topSide]}
						locale={locale}
						isActiveTurn={
							displayedView.phase === "playing" &&
							displayedView.turn === topSide &&
							adapter.outcome === null
						}
						inCheck={topSide === "red" ? redInCheck : blackInCheck}
						capturedPieces={displayedView.captured[topSide]}
						materialAdvantage={materialAdv[topSide]}
						clock={adapter.clock}
						showScript={pieceScriptOverlay}
					/>

					{/* Square Board Frame + Optional Local Privacy Handoff Curtain */}
					<div className="relative w-full">
						<SittuyinBoard
							view={displayedView}
							flipped={flipped}
							locale={locale}
							interactive={boardInteractive}
							showCoordinates={showCoordinates}
							showLegalHints={showLegalHints}
							highlightSitKeMyin={highlightSitKeMyin}
							pieceScriptOverlay={pieceScriptOverlay}
							animationSpeed={animationSpeed}
							selectedSquare={selectedSquare}
							focusedSquare={focusedSquare}
							legalMovesForSelection={legalMovesForSelection}
							promotablePawnSquares={promotablePawnSquares}
							legalSetupSquares={legalSetupSquares}
							checkingSquares={checkingSquares}
							checkedKingSquare={checkedKingSquare}
							lastMoveSquares={lastMoveSquares}
							shakeSquare={shakeSquare}
							pendingPromotion={pendingPromotion}
							externalDragGhost={externalDragGhost}
							externalHoverSquare={externalHoverSquare}
							boardContainerRef={boardContainerRef}
							onFocusSquare={setFocusedSquare}
							onSquareActivate={handleSquareActivate}
							onBoardPieceDrop={handleBoardPieceDrop}
							onBoardPieceDoubleTap={handleBoardPieceDoubleTap}
							onBoardDragStart={handleBoardDragStart}
							onBoardDragEnd={handleBoardDragEnd}
							onCancelInteraction={handleCancelInteraction}
							onCommitPromotion={(move) => {
								void runMove(move, move.to);
							}}
							onCancelPromotion={() => setPendingPromotion(null)}
						/>

						{adapter.pendingRevealHandoff !== null ? (
							<SetupHandoffCurtain
								toSide={adapter.pendingRevealHandoff}
								locale={locale}
								onReveal={() => {
									handleCancelInteraction();
									adapter.confirmHandoff();
								}}
							/>
						) : null}

						{adapter.online?.roomPhase === "waiting" ? (
							<WaitingRoomOverlay
								online={adapter.online}
								locale={locale}
								onAbortRoom={() => {
									adapter.abortMatch?.();
									onLeaveOnlineRoom?.();
								}}
							/>
						) : null}
					</div>

					<PlayerHudBar
						player={adapter.players[bottomSide]}
						locale={locale}
						isActiveTurn={
							displayedView.phase === "playing" &&
							displayedView.turn === bottomSide &&
							adapter.outcome === null
						}
						inCheck={bottomSide === "red" ? redInCheck : blackInCheck}
						capturedPieces={displayedView.captured[bottomSide]}
						materialAdvantage={materialAdv[bottomSide]}
						clock={adapter.clock}
						showScript={pieceScriptOverlay}
					/>

					{/* Compact board utility strip */}
					<div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-card/85 px-3 py-2">
						<div className="flex flex-wrap items-center gap-1.5">
							<Button
								type="button"
								variant="outline"
								size="sm"
								data-testid="flip-board-btn"
								onClick={() => setManualFlip((f) => !f)}
							>
								<RotateCw data-icon="inline-start" />
								{m.action_flip({}, { locale })}
							</Button>
							<Button
								type="button"
								variant="outline"
								size="icon-sm"
								data-testid="toggle-sound-btn"
								aria-label={
									soundEnabled
										? m.action_sound_on({}, { locale })
										: m.action_sound_off({}, { locale })
								}
								onClick={toggleSound}
							>
								{soundEnabled ? <Volume2 /> : <VolumeX />}
							</Button>
							<Button
								type="button"
								variant="outline"
								size="icon-sm"
								data-testid="toggle-theme-btn"
								aria-label={
									theme === "dark"
										? m.action_theme_light({}, { locale })
										: m.action_theme_dark({}, { locale })
								}
								onClick={toggleTheme}
							>
								{theme === "dark" ? <Sun /> : <Moon />}
							</Button>
						</div>

						<div className="flex items-center gap-1.5">
							<BoardPreferencesDialog locale={locale} />
						</div>
					</div>
				</section>

				{/* Right Control Rail (360px on desktop, stacked cleanly below on mobile) */}
				<aside className="flex w-full flex-col gap-3 lg:w-[360px] lg:shrink-0">
					{railHeaderExtra}

					{adapter.online ? (
						<OnlineStatusHeader
							adapter={adapter}
							online={adapter.online}
							locale={locale}
						/>
					) : null}

					{/* Match Outcome Banner */}
					{adapter.outcome !== null ? (
						<Alert
							data-testid="match-outcome-banner"
							className="border-sit-ke-myin/70 bg-surface-elevated"
						>
							<Trophy className="size-4 text-sit-ke-myin" />
							<AlertTitle className="text-sm font-semibold">
								{m.phase_finished({}, { locale })}
							</AlertTitle>
							<AlertDescription className="flex flex-col gap-2.5 text-xs text-foreground">
								<span>{formatOutcomeBanner(adapter.outcome, locale)}</span>
								{adapter.mode === "online" &&
								adapter.online?.matchId &&
								adapter.online.matchId.trim().length > 0 &&
								adapter.outcome.reason !== "aborted_pre_move" &&
								adapter.outcome.reason !== "aborted_maintenance" ? (
									<div className="flex flex-wrap items-center gap-2 pt-0.5">
										<Button
											type="button"
											variant="secondary"
											size="xs"
											data-testid="share-replay-btn"
											onClick={() => {
												const matchId = adapter.online?.matchId;
												if (!matchId) return;
												const path = `/${locale}/match/${matchId}`;
												const fullUrl =
													typeof window !== "undefined"
														? `${window.location.origin}${path}`
														: path;
												void navigator.clipboard
													?.writeText(fullUrl)
													.then(() => {
														toast.success(
															m.match_replay_link_copied({}, { locale }),
														);
													})
													.catch(() => {
														toast.info(fullUrl);
													});
											}}
										>
											<Share2 data-icon="inline-start" />
											{m.match_replay_share_btn({}, { locale })}
										</Button>
										<Button
											asChild
											variant="outline"
											size="xs"
											data-testid="open-replay-link"
										>
											<a href={`/${locale}/match/${adapter.online.matchId}`}>
												<ExternalLink data-icon="inline-start" />
												{m.match_replay_open_btn({}, { locale })}
											</a>
										</Button>
									</div>
								) : null}
							</AlertDescription>
						</Alert>
					) : null}

					{/* Context-sensitive rail: Setup Tray during setup vs History & Scrubber during play/replay */}
					{adapter.view.phase === "setup" &&
					adapter.mode !== "replay" &&
					adapter.online?.roomPhase !== "waiting" ? (
						<div className="flex flex-col gap-3">
							<SetupTray
								view={adapter.view}
								locale={locale}
								flipped={flipped}
								showScript={pieceScriptOverlay}
								selectedHandRole={selectedHandRole}
								isSandbox={adapter.mode === "local_sandbox"}
								setupRemainingMs={adapter.online?.setupRemainingMs}
								boardContainerRef={boardContainerRef}
								onSelectHandRole={(role) => {
									setSelectedSquare(null);
									setSelectedHandRole(role);
								}}
								onDispatchSetup={(action) => {
									void runSetupAction(action);
								}}
								onApplyRandomSetup={() => {
									void handleApplyRandomSetup();
								}}
								onSwitchSandboxViewer={adapter.switchSandboxViewer}
								onHandDragChange={(ghost, hover, role) => {
									setExternalDragGhost(ghost);
									setExternalHoverSquare(hover);
									setDraggingHandRole(role);
								}}
								onHandDropOnBoard={handleHandDropOnBoard}
							/>
							{adapter.online ? (
								<OnlineMatchActionBar
									adapter={adapter}
									online={adapter.online}
									locale={locale}
									onLeaveToLobby={onLeaveOnlineRoom}
								/>
							) : null}
						</div>
					) : (
						<Card className="border-border-subtle bg-card">
							<CardHeader className="gap-2 pb-3">
								<div className="flex items-center justify-between gap-2">
									<CardTitle className="text-base font-semibold">
										{m.history_title({}, { locale })}
									</CardTitle>
									<Badge variant="secondary" data-testid="match-phase-badge">
										{adapter.outcome !== null
											? m.phase_finished({}, { locale })
											: m.turn_indicator(
													{ side: formatSideName(adapter.view.turn, locale) },
													{ locale },
												)}
									</Badge>
								</div>
							</CardHeader>

							<CardContent className="flex flex-col gap-3">
								<ReplayScrubberBar
									currentPly={activePly}
									totalPlies={totalPlies}
									isScrubbingLiveMatch={isScrubbingLiveMatch}
									unseenPlies={unseenPlies}
									isAutoPlaying={isAutoPlaying}
									autoPlaySpeed={autoPlaySpeed}
									locale={locale}
									onFirst={() => handleSelectPly(0)}
									onPrev={() => handleSelectPly(activePly - 1)}
									onNext={() => handleSelectPly(activePly + 1)}
									onLast={() => handleSelectPly(totalPlies)}
									onToggleAutoPlay={() => {
										if (activePly >= totalPlies) {
											setReplayCursor(0);
											setIsAutoPlaying(true);
										} else {
											setIsAutoPlaying((p) => !p);
										}
									}}
									onChangeSpeed={setAutoPlaySpeed}
									onBackToLive={handleBackToLive}
								/>

								<MoveHistoryPanel
									moveHistory={fullMoveHistory}
									activePly={activePly}
									locale={locale}
									onSelectPly={handleSelectPly}
								/>

								<Separator />

								{/* Match controls & copy buttons */}
								<div className="flex flex-wrap items-center gap-2">
									{adapter.online ? (
										<OnlineMatchActionBar
											adapter={adapter}
											online={adapter.online}
											locale={locale}
											onLeaveToLobby={onLeaveOnlineRoom}
										/>
									) : adapter.mode !== "replay" &&
										adapter.view.phase === "playing" &&
										adapter.outcome === null ? (
										<>
											<Button
												type="button"
												variant="outline"
												size="sm"
												data-testid="resign-btn"
												onClick={adapter.requestResign}
												className="flex-1"
											>
												<Flag data-icon="inline-start" />
												{m.action_resign({}, { locale })}
											</Button>
											<Button
												type="button"
												variant="outline"
												size="sm"
												data-testid="draw-btn"
												onClick={adapter.requestDraw}
												className="flex-1"
											>
												<Handshake data-icon="inline-start" />
												{m.action_draw({}, { locale })}
											</Button>
										</>
									) : null}

									{onNewMatch ? (
										<Button
											type="button"
											variant={
												adapter.outcome !== null ? "default" : "secondary"
											}
											size="sm"
											data-testid="new-match-btn"
											onClick={() => {
												handleCancelInteraction();
												setReplayCursor(null);
												setUnseenPlies(0);
												onNewMatch();
											}}
											className="w-full"
										>
											<RefreshCw data-icon="inline-start" />
											{m.new_match({}, { locale })}
										</Button>
									) : null}

									<div className="flex w-full items-center gap-2">
										<Button
											type="button"
											variant="ghost"
											size="xs"
											data-testid="copy-fen-btn"
											onClick={() => {
												void handleCopyFen();
											}}
											className="flex-1"
										>
											<Copy data-icon="inline-start" />
											{m.action_copy_fen({}, { locale })}
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="xs"
											data-testid="copy-uci-btn"
											disabled={fullMoveHistory.length === 0}
											onClick={() => {
												void handleCopyUci();
											}}
											className="flex-1"
										>
											<Copy data-icon="inline-start" />
											{m.action_copy_uci({}, { locale })}
										</Button>
									</div>
								</div>
							</CardContent>
						</Card>
					)}
				</aside>
			</div>
		</div>
	);
}

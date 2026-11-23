import {
	ALL_SQUARES,
	type Move,
	type Piece,
	type PieceRole,
	type PlayerGameView,
	type PromoteMove,
	SIT_KE_MYIN_SQUARES,
	type Side,
	type Square,
} from "@sittuyin/engine";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type AppLocale,
	formatPieceName,
	formatSideName,
	m,
} from "@/i18n/locale";
import {
	BOARD_FRAME_INSET,
	BOARD_PLAYFIELD_SIZE,
	BOARD_VIEWBOX_SIZE,
	clientPointToSquare,
	getDisplayFiles,
	getDisplayRanks,
	getVisiblePieceAt,
	hasGeneralOnBoard,
	SQUARE_SIZE,
	squareToSvgRect,
	stepSquareByVisualDelta,
} from "@/lib/board-geometry";
import { cn } from "@/lib/utils";
import {
	type AnimationSpeed,
	getAnimationDurationMs,
} from "@/stores/board-preferences";
import {
	type PendingPromotionState,
	PromotionOverlay,
} from "./PromotionOverlay";
import { SittuyinPieceSvg } from "./SittuyinPieceSvg";

export interface BoardDragGhost {
	readonly role: PieceRole;
	readonly side: Side;
	readonly clientX: number;
	readonly clientY: number;
	readonly isTouch: boolean;
	readonly fromSquare: Square | null;
}

export interface SittuyinBoardProps {
	readonly view: PlayerGameView;
	readonly flipped: boolean;
	readonly locale: AppLocale;
	readonly interactive: boolean;
	readonly showCoordinates: boolean;
	readonly showLegalHints: boolean;
	readonly highlightSitKeMyin: boolean;
	readonly pieceScriptOverlay: boolean;
	readonly animationSpeed: AnimationSpeed;
	readonly selectedSquare: Square | null;
	readonly focusedSquare: Square;
	readonly legalMovesForSelection: readonly Move[];
	readonly promotablePawnSquares?: ReadonlySet<Square>;
	readonly legalSetupSquares: readonly Square[];
	readonly checkingSquares: readonly Square[];
	readonly checkedKingSquare: Square | null;
	readonly lastMoveSquares: readonly [Square, Square] | null;
	readonly shakeSquare: {
		readonly square: Square;
		readonly nonce: number;
	} | null;
	readonly pendingPromotion: PendingPromotionState | null;
	readonly externalDragGhost: BoardDragGhost | null;
	readonly externalHoverSquare: Square | null;
	readonly boardContainerRef: RefObject<HTMLDivElement | null>;
	readonly onFocusSquare: (square: Square) => void;
	readonly onSquareActivate: (square: Square) => void;
	readonly onBoardPieceDrop: (from: Square, to: Square | null) => void;
	readonly onBoardPieceDoubleTap?: (square: Square) => void;
	readonly onBoardDragStart?: (square: Square, piece: Piece) => void;
	readonly onBoardDragEnd?: () => void;
	readonly onCancelInteraction: () => void;
	readonly onCommitPromotion: (move: PromoteMove) => void;
	readonly onCancelPromotion: () => void;
}

const DRAG_THRESHOLD_PX = 6;
const TOUCH_VERTICAL_LIFT_PX = 44;
const GRID_LINE_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

interface ActiveBoardPointerDrag {
	readonly pointerId: number;
	readonly fromSquare: Square;
	readonly piece: Piece;
	readonly startX: number;
	readonly startY: number;
	readonly currentX: number;
	readonly currentY: number;
	readonly isTouch: boolean;
	readonly isDragging: boolean;
	readonly hoverSquare: Square | null;
}

export function SittuyinBoard({
	view,
	flipped,
	locale,
	interactive,
	showCoordinates,
	showLegalHints,
	highlightSitKeMyin,
	pieceScriptOverlay,
	animationSpeed,
	selectedSquare,
	focusedSquare,
	legalMovesForSelection,
	promotablePawnSquares,
	legalSetupSquares,
	checkingSquares,
	checkedKingSquare,
	lastMoveSquares,
	shakeSquare,
	pendingPromotion,
	externalDragGhost,
	externalHoverSquare,
	boardContainerRef,
	onFocusSquare,
	onSquareActivate,
	onBoardPieceDrop,
	onBoardPieceDoubleTap,
	onBoardDragStart,
	onBoardDragEnd,
	onCancelInteraction,
	onCommitPromotion,
	onCancelPromotion,
}: SittuyinBoardProps) {
	const [dragState, setDragState] = useState<ActiveBoardPointerDrag | null>(
		null,
	);
	const dragRef = useRef<ActiveBoardPointerDrag | null>(null);
	dragRef.current = dragState;

	const lastTapRef = useRef<{ square: Square; time: number } | null>(null);
	const squareButtonRefs = useRef<Partial<Record<Square, HTMLButtonElement>>>(
		{},
	);

	// Cancel board drag on Escape key
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				if (dragRef.current !== null) {
					setDragState(null);
					onBoardDragEnd?.();
				}
				onCancelInteraction();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onBoardDragEnd, onCancelInteraction]);

	const activeSideForSitKeMyin: Side =
		view.phase === "setup"
			? view.viewer === "black"
				? "black"
				: "red"
			: view.turn;

	const showSitKeMyinShimmer =
		highlightSitKeMyin &&
		view.phase === "playing" &&
		!hasGeneralOnBoard(view, activeSideForSitKeMyin);

	const sitKeMyinHighlightSet = useMemo(() => {
		if (!showSitKeMyinShimmer) {
			return new Set<Square>();
		}
		return new Set<Square>(SIT_KE_MYIN_SQUARES[activeSideForSitKeMyin]);
	}, [showSitKeMyinShimmer, activeSideForSitKeMyin]);

	const checkingSet = useMemo(
		() => new Set<Square>(checkingSquares),
		[checkingSquares],
	);
	const setupLegalSet = useMemo(
		() => new Set<Square>(legalSetupSquares),
		[legalSetupSquares],
	);

	const { quietTargets, captureTargets, promotionTargets } = useMemo(() => {
		const quiet = new Set<Square>();
		const capture = new Set<Square>();
		const promote = new Set<Square>();
		for (const move of legalMovesForSelection) {
			if (move.kind === "promote") {
				promote.add(move.to);
			} else if (move.kind === "normal") {
				const targetPiece = getVisiblePieceAt(view, move.to);
				if (targetPiece !== null) {
					capture.add(move.to);
				} else {
					quiet.add(move.to);
				}
			}
		}
		return {
			quietTargets: quiet,
			captureTargets: capture,
			promotionTargets: promote,
		};
	}, [legalMovesForSelection, view]);

	const displayFiles = useMemo(() => getDisplayFiles(flipped), [flipped]);
	const displayRanks = useMemo(() => getDisplayRanks(flipped), [flipped]);

	const canInitiateDragFrom = useCallback(
		(square: Square): Piece | null => {
			if (!interactive) return null;
			const piece = getVisiblePieceAt(view, square);
			if (piece === null) return null;
			if (view.phase === "setup") {
				if (view.viewer === "spectator" || view.setupReady[view.viewer]) {
					return null;
				}
				return view.myDraft[square] !== undefined ? piece : null;
			}
			if (view.phase === "playing") {
				return piece.side === view.turn ? piece : null;
			}
			return null;
		},
		[interactive, view],
	);

	const resolveSquareFromClient = useCallback(
		(clientX: number, clientY: number, isTouch: boolean): Square | null => {
			const el = boardContainerRef.current;
			if (el === null) return null;
			const rect = el.getBoundingClientRect();
			const effectiveY = isTouch ? clientY - TOUCH_VERTICAL_LIFT_PX : clientY;
			return clientPointToSquare(rect, clientX, effectiveY, flipped);
		},
		[boardContainerRef, flipped],
	);

	const handleSquarePointerDown = useCallback(
		(square: Square, event: ReactPointerEvent<HTMLButtonElement>) => {
			if (event.button === 2) {
				event.preventDefault();
				setDragState(null);
				onBoardDragEnd?.();
				onCancelInteraction();
				return;
			}
			if (!interactive) {
				return;
			}

			// If clicking a legal destination while something is already selected, let tap handle it immediately
			const isTargetOfSelection =
				selectedSquare !== null &&
				(quietTargets.has(square) ||
					captureTargets.has(square) ||
					promotionTargets.has(square) ||
					setupLegalSet.has(square));
			if (isTargetOfSelection && square !== selectedSquare) {
				return;
			}

			const draggable = canInitiateDragFrom(square);
			if (draggable === null) {
				return;
			}

			try {
				event.currentTarget.setPointerCapture(event.pointerId);
			} catch {
				// Ignore in synthetic test environments
			}

			const isTouch = event.pointerType === "touch";
			setDragState({
				pointerId: event.pointerId,
				fromSquare: square,
				piece: draggable,
				startX: event.clientX,
				startY: event.clientY,
				currentX: event.clientX,
				currentY: event.clientY,
				isTouch,
				isDragging: false,
				hoverSquare: square,
			});
		},
		[
			interactive,
			selectedSquare,
			quietTargets,
			captureTargets,
			promotionTargets,
			setupLegalSet,
			canInitiateDragFrom,
			onBoardDragEnd,
			onCancelInteraction,
		],
	);

	const handleSquarePointerMove = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>) => {
			const curr = dragRef.current;
			if (curr === null || curr.pointerId !== event.pointerId) {
				return;
			}
			const dx = event.clientX - curr.startX;
			const dy = event.clientY - curr.startY;
			const movedEnough =
				curr.isDragging || Math.hypot(dx, dy) > DRAG_THRESHOLD_PX;
			if (!movedEnough) {
				return;
			}
			if (!curr.isDragging) {
				onBoardDragStart?.(curr.fromSquare, curr.piece);
			}
			const hoverSquare = resolveSquareFromClient(
				event.clientX,
				event.clientY,
				curr.isTouch,
			);
			setDragState({
				...curr,
				isDragging: true,
				currentX: event.clientX,
				currentY: event.clientY,
				hoverSquare,
			});
		},
		[onBoardDragStart, resolveSquareFromClient],
	);

	const handleSquarePointerUp = useCallback(
		(square: Square, event: ReactPointerEvent<HTMLButtonElement>) => {
			const curr = dragRef.current;
			if (curr === null || curr.pointerId !== event.pointerId) {
				return;
			}
			try {
				if (event.currentTarget.hasPointerCapture(event.pointerId)) {
					event.currentTarget.releasePointerCapture(event.pointerId);
				}
			} catch {
				// Ignore
			}
			setDragState(null);
			onBoardDragEnd?.();

			if (curr.isDragging) {
				const dropSquare = resolveSquareFromClient(
					event.clientX,
					event.clientY,
					curr.isTouch,
				);
				if (dropSquare !== curr.fromSquare) {
					onBoardPieceDrop(curr.fromSquare, dropSquare);
				}
				return;
			}

			// Tap/click on a placed officer in setup supports double-tap removal
			if (view.phase === "setup" && onBoardPieceDoubleTap) {
				const now = Date.now();
				const prevTap = lastTapRef.current;
				if (prevTap && prevTap.square === square && now - prevTap.time < 320) {
					lastTapRef.current = null;
					onBoardPieceDoubleTap(square);
					return;
				}
				lastTapRef.current = { square, time: now };
			}
		},
		[
			onBoardDragEnd,
			onBoardPieceDrop,
			onBoardPieceDoubleTap,
			resolveSquareFromClient,
			view.phase,
		],
	);

	const handleSquarePointerCancel = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>) => {
			const curr = dragRef.current;
			if (curr !== null && curr.pointerId === event.pointerId) {
				setDragState(null);
				onBoardDragEnd?.();
			}
		},
		[onBoardDragEnd],
	);

	const handleSquareClick = useCallback(
		(square: Square) => {
			onFocusSquare(square);
			onSquareActivate(square);
		},
		[onFocusSquare, onSquareActivate],
	);

	const handleSquareKeyDown = useCallback(
		(square: Square, event: ReactKeyboardEvent<HTMLButtonElement>) => {
			let next: Square | null = null;
			switch (event.key) {
				case "ArrowLeft":
					next = stepSquareByVisualDelta(square, -1, 0, flipped);
					break;
				case "ArrowRight":
					next = stepSquareByVisualDelta(square, 1, 0, flipped);
					break;
				case "ArrowUp":
					next = stepSquareByVisualDelta(square, 0, -1, flipped);
					break;
				case "ArrowDown":
					next = stepSquareByVisualDelta(square, 0, 1, flipped);
					break;
				case "Escape":
					event.preventDefault();
					onCancelInteraction();
					return;
				case "Enter":
				case " ":
					event.preventDefault();
					onSquareActivate(square);
					return;
				default:
					return;
			}
			if (next !== null) {
				event.preventDefault();
				onFocusSquare(next);
				squareButtonRefs.current[next]?.focus();
			}
		},
		[flipped, onCancelInteraction, onFocusSquare, onSquareActivate],
	);

	const activeHoverSquare = dragState?.isDragging
		? dragState.hoverSquare
		: externalHoverSquare;
	const hiddenDraggedSquare = dragState?.isDragging
		? dragState.fromSquare
		: null;
	const activeGhost: BoardDragGhost | null = dragState?.isDragging
		? {
				role: dragState.piece.role,
				side: dragState.piece.side,
				clientX: dragState.currentX,
				clientY: dragState.currentY,
				isTouch: dragState.isTouch,
				fromSquare: dragState.fromSquare,
			}
		: externalDragGhost;

	const transitionMs = getAnimationDurationMs(animationSpeed);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: context menu cancels active piece drag/selection anywhere on the board surface
		<div
			ref={boardContainerRef}
			data-testid="sittuyin-board"
			data-flipped={flipped ? "true" : "false"}
			onContextMenu={(event) => {
				event.preventDefault();
				setDragState(null);
				onBoardDragEnd?.();
				onCancelInteraction();
			}}
			className="relative aspect-square w-full select-none touch-none rounded-2xl shadow-[0_18px_48px_rgba(0,0,0,0.45)] ring-1 ring-border-subtle/80"
		>
			{/* Pure inline SVG uncheckered warm Myanmar teak board */}
			<svg
				viewBox={`0 0 ${BOARD_VIEWBOX_SIZE} ${BOARD_VIEWBOX_SIZE}`}
				className="block size-full rounded-2xl"
				aria-hidden="true"
			>
				<defs>
					<linearGradient
						id="teak-surface-grad"
						x1="0%"
						y1="0%"
						x2="100%"
						y2="100%"
					>
						<stop offset="0%" stopColor="var(--board-teak-light)" />
						<stop offset="52%" stopColor="var(--board-teak-base)" />
						<stop
							offset="100%"
							stopColor="var(--board-teak-light)"
							stopOpacity="0.92"
						/>
					</linearGradient>
					<linearGradient
						id="teak-frame-grad"
						x1="0%"
						y1="0%"
						x2="0%"
						y2="100%"
					>
						<stop offset="0%" stopColor="var(--board-teak-frame)" />
						<stop offset="100%" stopColor="#351F10" />
					</linearGradient>
					<radialGradient id="king-check-halo" cx="50%" cy="50%" r="50%">
						<stop
							offset="0%"
							stopColor="var(--highlight-check)"
							stopOpacity="0.88"
						/>
						<stop
							offset="68%"
							stopColor="var(--highlight-check)"
							stopOpacity="0.32"
						/>
						<stop
							offset="100%"
							stopColor="var(--highlight-check)"
							stopOpacity="0"
						/>
					</radialGradient>
					<pattern
						id="teak-grain-lines"
						width="800"
						height="64"
						patternUnits="userSpaceOnUse"
					>
						<path
							d="M0 10 Q200 4 400 12 T800 10"
							fill="none"
							stroke="#5A3519"
							strokeOpacity="0.11"
							strokeWidth="2.2"
						/>
						<path
							d="M0 32 Q240 39 480 29 T800 33"
							fill="none"
							stroke="#F5D3A1"
							strokeOpacity="0.1"
							strokeWidth="1.6"
						/>
						<path
							d="M0 54 Q180 48 420 56 T800 52"
							fill="none"
							stroke="#4E2D15"
							strokeOpacity="0.09"
							strokeWidth="1.8"
						/>
					</pattern>
				</defs>

				{/* Outer beveled teak frame */}
				<rect
					x="0"
					y="0"
					width={BOARD_VIEWBOX_SIZE}
					height={BOARD_VIEWBOX_SIZE}
					rx="22"
					fill="url(#teak-frame-grad)"
				/>
				<rect
					x="10"
					y="10"
					width={BOARD_VIEWBOX_SIZE - 20}
					height={BOARD_VIEWBOX_SIZE - 20}
					rx="16"
					fill="none"
					stroke="var(--board-sit-ke-myin)"
					strokeOpacity="0.28"
					strokeWidth="1.5"
				/>

				{/* Inner uncheckered 8x8 teak playfield */}
				<rect
					x={BOARD_FRAME_INSET}
					y={BOARD_FRAME_INSET}
					width={BOARD_PLAYFIELD_SIZE}
					height={BOARD_PLAYFIELD_SIZE}
					fill="url(#teak-surface-grad)"
				/>
				<rect
					x={BOARD_FRAME_INSET}
					y={BOARD_FRAME_INSET}
					width={BOARD_PLAYFIELD_SIZE}
					height={BOARD_PLAYFIELD_SIZE}
					fill="url(#teak-grain-lines)"
				/>

				{/* Active sit ke myin enemy half shimmer when moving side has 0 Generals */}
				{Array.from(sitKeMyinHighlightSet).map((sq) => {
					const r = squareToSvgRect(sq, flipped);
					return (
						<g key={`skm-${sq}`}>
							<rect
								x={r.x + 2}
								y={r.y + 2}
								width={SQUARE_SIZE - 4}
								height={SQUARE_SIZE - 4}
								fill="var(--board-sit-ke-myin)"
								fillOpacity="0.22"
							/>
							<polygon
								points={`${r.cx},${r.y + 12} ${r.x + SQUARE_SIZE - 12},${r.cy} ${r.cx},${r.y + SQUARE_SIZE - 12} ${r.x + 12},${r.cy}`}
								fill="none"
								stroke="var(--board-sit-ke-myin)"
								strokeWidth="1.8"
								strokeOpacity="0.72"
							/>
						</g>
					);
				})}

				{/* Last move warm gold wash */}
				{lastMoveSquares !== null
					? (
							[
								{ label: "from", sq: lastMoveSquares[0] },
								{ label: "to", sq: lastMoveSquares[1] },
							] as const
						).map(({ label, sq }) => {
							const r = squareToSvgRect(sq, flipped);
							return (
								<rect
									key={`last-${label}-${sq}`}
									x={r.x}
									y={r.y}
									width={SQUARE_SIZE}
									height={SQUARE_SIZE}
									fill="var(--highlight-last-move)"
								/>
							);
						})
					: null}

				{/* Legal setup zone glow during hidden setup */}
				{view.phase === "setup" &&
					legalSetupSquares.map((sq) => {
						const r = squareToSvgRect(sq, flipped);
						return (
							<rect
								key={`setup-zone-${sq}`}
								x={r.x + 3}
								y={r.y + 3}
								width={SQUARE_SIZE - 6}
								height={SQUARE_SIZE - 6}
								rx="8"
								fill="var(--board-sit-ke-myin)"
								fillOpacity="0.24"
								stroke="var(--board-sit-ke-myin)"
								strokeWidth="2.4"
								strokeOpacity="0.82"
							/>
						);
					})}

				{/* Selected square highlight */}
				{selectedSquare !== null
					? (() => {
							const r = squareToSvgRect(selectedSquare, flipped);
							return (
								<rect
									x={r.x + 2}
									y={r.y + 2}
									width={SQUARE_SIZE - 4}
									height={SQUARE_SIZE - 4}
									rx="6"
									fill="var(--board-sit-ke-myin)"
									fillOpacity="0.28"
									stroke="var(--board-sit-ke-myin)"
									strokeWidth="3.5"
								/>
							);
						})()
					: null}

				{/* Drag hover target ring */}
				{activeHoverSquare !== null
					? (() => {
							const r = squareToSvgRect(activeHoverSquare, flipped);
							return (
								<rect
									x={r.x + 3}
									y={r.y + 3}
									width={SQUARE_SIZE - 6}
									height={SQUARE_SIZE - 6}
									rx="8"
									fill="rgba(255, 255, 255, 0.16)"
									stroke="var(--board-sit-ke-myin)"
									strokeWidth="4"
								/>
							);
						})()
					: null}

				{/* Carved 8x8 uncheckered grid strokes */}
				{GRID_LINE_INDICES.map((lineIndex) => {
					const pos = BOARD_FRAME_INSET + lineIndex * SQUARE_SIZE;
					return (
						<g key={`grid-${lineIndex}`}>
							<line
								x1={pos}
								y1={BOARD_FRAME_INSET}
								x2={pos}
								y2={BOARD_FRAME_INSET + BOARD_PLAYFIELD_SIZE}
								stroke="var(--board-grid-line)"
								strokeWidth={lineIndex === 0 || lineIndex === 8 ? 3.2 : 1.7}
							/>
							<line
								x1={BOARD_FRAME_INSET}
								y1={pos}
								x2={BOARD_FRAME_INSET + BOARD_PLAYFIELD_SIZE}
								y2={pos}
								stroke="var(--board-grid-line)"
								strokeWidth={lineIndex === 0 || lineIndex === 8 ? 3.2 : 1.7}
							/>
						</g>
					);
				})}

				{/* Full X sit ke myin inlaid diagonal promotion lines */}
				<g data-testid="sit-ke-myin-diagonals" opacity="0.88">
					{/* Subtle dark carved groove behind gold inlay */}
					<line
						x1={BOARD_FRAME_INSET}
						y1={BOARD_FRAME_INSET}
						x2={BOARD_FRAME_INSET + BOARD_PLAYFIELD_SIZE}
						y2={BOARD_FRAME_INSET + BOARD_PLAYFIELD_SIZE}
						stroke="var(--board-grid-line)"
						strokeWidth="5.5"
						strokeOpacity="0.55"
					/>
					<line
						x1={BOARD_FRAME_INSET + BOARD_PLAYFIELD_SIZE}
						y1={BOARD_FRAME_INSET}
						x2={BOARD_FRAME_INSET}
						y2={BOARD_FRAME_INSET + BOARD_PLAYFIELD_SIZE}
						stroke="var(--board-grid-line)"
						strokeWidth="5.5"
						strokeOpacity="0.55"
					/>
					{/* Burnished gold / vermilion inlaid center line */}
					<line
						x1={BOARD_FRAME_INSET}
						y1={BOARD_FRAME_INSET}
						x2={BOARD_FRAME_INSET + BOARD_PLAYFIELD_SIZE}
						y2={BOARD_FRAME_INSET + BOARD_PLAYFIELD_SIZE}
						stroke="var(--board-sit-ke-myin)"
						strokeWidth="2.4"
					/>
					<line
						x1={BOARD_FRAME_INSET + BOARD_PLAYFIELD_SIZE}
						y1={BOARD_FRAME_INSET}
						x2={BOARD_FRAME_INSET}
						y2={BOARD_FRAME_INSET + BOARD_PLAYFIELD_SIZE}
						stroke="var(--board-sit-ke-myin)"
						strokeWidth="2.4"
					/>
				</g>

				{/* Crimson King check halo & attacker square ring */}
				{checkedKingSquare !== null
					? (() => {
							const r = squareToSvgRect(checkedKingSquare, flipped);
							return (
								<circle
									cx={r.cx}
									cy={r.cy}
									r="47"
									fill="url(#king-check-halo)"
									className="sittuyin-check-pulse"
									data-testid="check-king-halo"
								/>
							);
						})()
					: null}

				{Array.from(checkingSet).map((sq) => {
					const r = squareToSvgRect(sq, flipped);
					return (
						<rect
							key={`checker-${sq}`}
							x={r.x + 4}
							y={r.y + 4}
							width={SQUARE_SIZE - 8}
							height={SQUARE_SIZE - 8}
							rx="10"
							fill="none"
							stroke="var(--highlight-check)"
							strokeWidth="4"
							strokeDasharray="10 6"
							data-testid={`checker-square-${sq}`}
						/>
					);
				})}

				{/* Bevel frame coordinates (a-h, 1-8) */}
				{showCoordinates ? (
					<g
						data-testid="board-coordinates"
						fill="#E8D6BC"
						fontSize="18"
						fontWeight="600"
						fontFamily="var(--font-sans)"
					>
						{displayFiles.map((file, col) => {
							const cx =
								BOARD_FRAME_INSET + col * SQUARE_SIZE + SQUARE_SIZE / 2;
							return (
								<g key={`file-${file}`}>
									<text
										x={cx}
										y="25"
										textAnchor="middle"
										dominantBaseline="central"
										opacity="0.72"
									>
										{file}
									</text>
									<text
										x={cx}
										y={BOARD_VIEWBOX_SIZE - 18}
										textAnchor="middle"
										dominantBaseline="central"
									>
										{file}
									</text>
								</g>
							);
						})}
						{displayRanks.map((rank, row) => {
							const cy =
								BOARD_FRAME_INSET + row * SQUARE_SIZE + SQUARE_SIZE / 2;
							return (
								<g key={`rank-${rank}`}>
									<text
										x="20"
										y={cy}
										textAnchor="middle"
										dominantBaseline="central"
									>
										{rank}
									</text>
									<text
										x={BOARD_VIEWBOX_SIZE - 20}
										y={cy}
										textAnchor="middle"
										dominantBaseline="central"
										opacity="0.72"
									>
										{rank}
									</text>
								</g>
							);
						})}
					</g>
				) : null}

				{/* Legal move hints (color-blind safe dots, capture corner brackets, gold promotion badges) */}
				{showLegalHints ? (
					<g data-testid="legal-move-hints">
						{Array.from(quietTargets).map((sq) => {
							if (promotionTargets.has(sq)) return null;
							const r = squareToSvgRect(sq, flipped);
							return (
								<circle
									key={`quiet-${sq}`}
									cx={r.cx}
									cy={r.cy}
									r="14"
									fill="var(--highlight-legal)"
									stroke="rgba(255,248,236,0.48)"
									strokeWidth="2"
								/>
							);
						})}

						{Array.from(captureTargets).map((sq) => {
							const r = squareToSvgRect(sq, flipped);
							const pad = 8;
							const len = 20;
							const x1 = r.x + pad;
							const y1 = r.y + pad;
							const x2 = r.x + SQUARE_SIZE - pad;
							const y2 = r.y + SQUARE_SIZE - pad;
							return (
								<g
									key={`cap-${sq}`}
									stroke="var(--highlight-legal)"
									strokeWidth="6"
									strokeLinecap="round"
									fill="none"
								>
									<path
										d={`M${x1} ${y1 + len} L${x1} ${y1} L${x1 + len} ${y1}`}
									/>
									<path
										d={`M${x2 - len} ${y1} L${x2} ${y1} L${x2} ${y1 + len}`}
									/>
									<path
										d={`M${x1} ${y2 - len} L${x1} ${y2} L${x1 + len} ${y2}`}
									/>
									<path
										d={`M${x2 - len} ${y2} L${x2} ${y2} L${x2} ${y2 - len}`}
									/>
								</g>
							);
						})}
					</g>
				) : null}
			</svg>

			{/* Interactive 64-square playfield overlay (pieces, promotion badges, roving keyboard focus) */}
			{/* biome-ignore lint/a11y/useSemanticElements: interactive 8x8 chess board uses WAI-ARIA grid pattern with roving focus over SVG */}
			<div
				role="grid"
				aria-label={m.aria_board_label({}, { locale })}
				style={{
					left: `${(BOARD_FRAME_INSET / BOARD_VIEWBOX_SIZE) * 100}%`,
					top: `${(BOARD_FRAME_INSET / BOARD_VIEWBOX_SIZE) * 100}%`,
					width: `${(BOARD_PLAYFIELD_SIZE / BOARD_VIEWBOX_SIZE) * 100}%`,
					height: `${(BOARD_PLAYFIELD_SIZE / BOARD_VIEWBOX_SIZE) * 100}%`,
				}}
				className="absolute"
			>
				{ALL_SQUARES.map((square) => {
					const rect = squareToSvgRect(square, flipped);
					const piece = getVisiblePieceAt(view, square);
					const isDraggedOut = hiddenDraggedSquare === square;
					const isFocused = focusedSquare === square;
					const isShaking = shakeSquare?.square === square;
					const isPromoTarget = promotionTargets.has(square);
					const isPromotablePawn = promotablePawnSquares?.has(square) ?? false;
					const isQuietTarget = quietTargets.has(square);
					const isCaptureTarget = captureTargets.has(square);

					const pieceText =
						piece !== null
							? m.aria_square_piece(
									{
										square,
										side: formatSideName(piece.side, locale),
										piece: formatPieceName(piece.role, locale),
									},
									{ locale },
								)
							: m.aria_square_empty({ square }, { locale });

					const hintSuffix = isPromoTarget
						? `, ${m.aria_square_hint_promote({}, { locale })}`
						: isCaptureTarget
							? `, ${m.aria_square_hint_capture({}, { locale })}`
							: isQuietTarget
								? `, ${m.aria_square_hint_move({}, { locale })}`
								: "";

					return (
						// biome-ignore lint/a11y/useSemanticElements: interactive board square uses WAI-ARIA gridcell button inside grid
						<button
							key={square}
							ref={(el) => {
								if (el !== null) {
									squareButtonRefs.current[square] = el;
								}
							}}
							type="button"
							role="gridcell"
							data-square={square}
							data-piece={piece ? `${piece.side}-${piece.role}` : undefined}
							data-hint={
								isPromoTarget
									? "promote"
									: isCaptureTarget
										? "capture"
										: isQuietTarget
											? "move"
											: setupLegalSet.has(square)
												? "setup"
												: undefined
							}
							aria-label={`${pieceText}${hintSuffix}`}
							aria-selected={selectedSquare === square}
							tabIndex={isFocused ? 0 : -1}
							onClick={() => handleSquareClick(square)}
							onPointerDown={(e) => handleSquarePointerDown(square, e)}
							onPointerMove={handleSquarePointerMove}
							onPointerUp={(e) => handleSquarePointerUp(square, e)}
							onPointerCancel={handleSquarePointerCancel}
							onKeyDown={(e) => handleSquareKeyDown(square, e)}
							style={{
								left: `${rect.col * 12.5}%`,
								top: `${rect.row * 12.5}%`,
								width: "12.5%",
								height: "12.5%",
								transitionDuration: `${transitionMs}ms`,
							}}
							className={cn(
								"absolute flex items-center justify-center p-0.5 outline-none transition-transform focus-visible:z-20 focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset sm:p-1",
								interactive && piece !== null
									? "cursor-grab active:cursor-grabbing"
									: "cursor-pointer",
								isShaking && "sittuyin-shake",
							)}
						>
							{piece !== null && !isDraggedOut ? (
								<span className="pointer-events-none block size-full">
									<SittuyinPieceSvg
										pieceRole={piece.role}
										side={piece.side}
										showScript={pieceScriptOverlay}
										className="size-full"
									/>
								</span>
							) : null}

							{/* Subtle gold indicator on pawns eligible to promote to Sit ke */}
							{showLegalHints && isPromotablePawn && !isPromoTarget ? (
								<span
									aria-hidden="true"
									data-testid={`promotable-pawn-${square}`}
									className="pointer-events-none absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-[var(--highlight-promote)] text-[9px] font-bold text-[#1A120A] shadow"
								>
									စ
								</span>
							) : null}

							{/* Burnished gold General promotion target badge */}
							{showLegalHints && isPromoTarget ? (
								<span
									aria-hidden="true"
									className="pointer-events-none absolute inset-1 flex items-center justify-center rounded-full border-2 border-[var(--highlight-promote)] bg-[var(--highlight-promote)]/20 shadow-[0_0_12px_rgba(234,179,8,0.45)]"
								>
									<span className="flex size-5 items-center justify-center rounded-full bg-[var(--highlight-promote)] text-[11px] font-bold text-[#1A120A] shadow sm:size-6 sm:text-xs">
										စ
									</span>
								</span>
							) : null}
						</button>
					);
				})}
			</div>

			{/* Anchored General (Sit ke) promotion picker overlay */}
			{pendingPromotion !== null ? (
				<PromotionOverlay
					pending={pendingPromotion}
					flipped={flipped}
					locale={locale}
					showScript={pieceScriptOverlay}
					onCommit={onCommitPromotion}
					onCancel={onCancelPromotion}
				/>
			) : null}

			{/* GPU translate3d drag ghost with 44px upward touch vertical lift */}
			{activeGhost !== null ? (
				<div
					data-testid="board-drag-ghost"
					data-touch-lifted={activeGhost.isTouch ? "true" : "false"}
					style={{
						transform: `translate3d(${activeGhost.clientX}px, ${
							activeGhost.clientY -
							(activeGhost.isTouch ? TOUCH_VERTICAL_LIFT_PX : 0)
						}px, 0) translate(-50%, -50%)`,
					}}
					className="pointer-events-none fixed top-0 left-0 z-50 size-16 drop-shadow-[0_14px_20px_rgba(0,0,0,0.55)] will-change-transform sm:size-20"
				>
					<SittuyinPieceSvg
						pieceRole={activeGhost.role}
						side={activeGhost.side}
						showScript={pieceScriptOverlay}
						className="size-full"
					/>
				</div>
			) : null}
		</div>
	);
}

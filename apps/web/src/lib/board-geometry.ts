import {
	FILES,
	type GameState,
	type Piece,
	type PieceRole,
	type PlayerGameView,
	RANKS,
	type Side,
	type Square,
	squareToCoords,
	squareToIndex,
} from "@sittuyin/engine";

export const BOARD_VIEWBOX_SIZE = 880;
export const BOARD_FRAME_INSET = 40;
export const BOARD_PLAYFIELD_SIZE = 800;
export const SQUARE_SIZE = 100;

export const PIECE_SCRIPT_BADGES: Readonly<Record<PieceRole, string>> = {
	king: "မ",
	general: "စ",
	rook: "ရ",
	elephant: "ဆ",
	knight: "မြ",
	pawn: "န",
};

export const CAPTURED_ROLE_ORDER: readonly PieceRole[] = [
	"rook",
	"elephant",
	"knight",
	"general",
	"pawn",
];

export const MATERIAL_WEIGHTS: Readonly<Record<PieceRole, number>> = {
	king: 0,
	rook: 5,
	elephant: 3,
	knight: 3,
	general: 2,
	pawn: 1,
};

export interface SquareSvgRect {
	readonly x: number;
	readonly y: number;
	readonly cx: number;
	readonly cy: number;
	readonly col: number;
	readonly row: number;
}

/**
 * Converts a board square into SVG coordinates inside the 880x880 board viewBox.
 * When flipped is false (Red at bottom): a1 is bottom-left (col 0, row 7), h8 is top-right (col 7, row 0).
 * When flipped is true (Black at bottom): a1 is top-right (col 7, row 0), h8 is bottom-left (col 0, row 7).
 */
export function squareToSvgRect(
	square: Square,
	flipped: boolean,
): SquareSvgRect {
	const { file, rank } = squareToCoords(square);
	const col = flipped ? 7 - file : file;
	const row = flipped ? rank : 7 - rank;
	const x = BOARD_FRAME_INSET + col * SQUARE_SIZE;
	const y = BOARD_FRAME_INSET + row * SQUARE_SIZE;
	return {
		x,
		y,
		cx: x + SQUARE_SIZE / 2,
		cy: y + SQUARE_SIZE / 2,
		col,
		row,
	};
}

/**
 * Converts a visual grid column (0..7 left-to-right) and row (0..7 top-to-bottom)
 * back into a Sittuyin square.
 */
export function gridCellToSquare(
	col: number,
	row: number,
	flipped: boolean,
): Square | null {
	if (col < 0 || col > 7 || row < 0 || row > 7) {
		return null;
	}
	const fileIndex = flipped ? 7 - col : col;
	const rankIndex = flipped ? row : 7 - row;
	const file = FILES[fileIndex];
	const rank = RANKS[rankIndex];
	if (file === undefined || rank === undefined) {
		return null;
	}
	return `${file}${rank}`;
}

/**
 * Maps a client viewport coordinate (e.g. pointer event clientX/clientY) against
 * the SVG board's bounding DOMRect into a board Square, or null if outside the 8x8 playfield.
 */
export function clientPointToSquare(
	boardRect: Pick<DOMRect, "left" | "top" | "width" | "height">,
	clientX: number,
	clientY: number,
	flipped: boolean,
): Square | null {
	if (boardRect.width <= 0 || boardRect.height <= 0) {
		return null;
	}
	const svgX =
		((clientX - boardRect.left) / boardRect.width) * BOARD_VIEWBOX_SIZE;
	const svgY =
		((clientY - boardRect.top) / boardRect.height) * BOARD_VIEWBOX_SIZE;
	const innerX = svgX - BOARD_FRAME_INSET;
	const innerY = svgY - BOARD_FRAME_INSET;
	if (
		innerX < 0 ||
		innerY < 0 ||
		innerX >= BOARD_PLAYFIELD_SIZE ||
		innerY >= BOARD_PLAYFIELD_SIZE
	) {
		return null;
	}
	const col = Math.floor(innerX / SQUARE_SIZE);
	const row = Math.floor(innerY / SQUARE_SIZE);
	return gridCellToSquare(col, row, flipped);
}

/**
 * Moves focus by visual arrow key delta (dCol: -1 left/+1 right, dRow: -1 up/+1 down)
 * respecting the current board orientation.
 */
export function stepSquareByVisualDelta(
	square: Square,
	dCol: number,
	dRow: number,
	flipped: boolean,
): Square {
	const { col, row } = squareToSvgRect(square, flipped);
	const nextCol = Math.max(0, Math.min(7, col + dCol));
	const nextRow = Math.max(0, Math.min(7, row + dRow));
	return gridCellToSquare(nextCol, nextRow, flipped) ?? square;
}

export function getDisplayFiles(flipped: boolean): readonly string[] {
	return flipped ? [...FILES].reverse() : FILES;
}

export function getDisplayRanks(flipped: boolean): readonly string[] {
	return flipped ? [...RANKS] : [...RANKS].reverse();
}

export function isBoardFlipped(
	viewer: PlayerGameView["viewer"],
	manualFlip: boolean,
): boolean {
	const naturalFlip = viewer === "black";
	return naturalFlip !== manualFlip;
}

/**
 * Synthesizes a read-only GameState from a masked PlayerGameView so pure engine
 * query helpers (getLegalSetupSquares, getLegalMovesFrom, getPromotionCandidates,
 * isInCheck, getCheckingSquares) can run without ever accessing opponent drafts.
 */
export function viewToEngineQueryState(view: PlayerGameView): GameState {
	return {
		phase: view.phase,
		rules: view.rules,
		board: view.board,
		hands: view.hands,
		setupDrafts: {
			red: view.viewer === "red" ? view.myDraft : {},
			black: view.viewer === "black" ? view.myDraft : {},
		},
		setupReady: view.setupReady,
		turn: view.turn,
		halfmoveClock: view.halfmoveClock,
		bareKingClock: view.bareKingClock,
		fullmoveNumber: view.fullmoveNumber,
		initialSetupFen: view.initialSetupFen,
		positionCounts: view.positionCounts,
		captured: view.captured,
		moveHistory: view.moveHistory,
		outcome: view.outcome,
	};
}

/**
 * Returns the visual piece occupying a square in the current PlayerGameView.
 * During hidden setup, merges only the viewer's own draft officers onto the board.
 */
export function getVisiblePieceAt(
	view: PlayerGameView,
	square: Square,
): Piece | null {
	if (
		view.phase === "setup" &&
		view.rules.setupMode === "hidden_simultaneous" &&
		view.viewer !== "spectator"
	) {
		const draftedRole = view.myDraft[square];
		if (draftedRole !== undefined) {
			return { side: view.viewer, role: draftedRole };
		}
	}
	return view.board[squareToIndex(square)] ?? null;
}

export function hasGeneralOnBoard(view: PlayerGameView, side: Side): boolean {
	for (const piece of view.board) {
		if (piece !== null && piece.side === side && piece.role === "general") {
			return true;
		}
	}
	return false;
}

export function sortCapturedPieces(
	captured: readonly PieceRole[],
): readonly PieceRole[] {
	const orderIndex = new Map<PieceRole, number>(
		CAPTURED_ROLE_ORDER.map((role, idx) => [role, idx]),
	);
	return [...captured].sort(
		(a, b) => (orderIndex.get(a) ?? 99) - (orderIndex.get(b) ?? 99),
	);
}

export function computeMaterialScore(captured: readonly PieceRole[]): number {
	let total = 0;
	for (const role of captured) {
		total += MATERIAL_WEIGHTS[role];
	}
	return total;
}

export function computeMaterialAdvantage(
	captured: Readonly<Record<Side, readonly PieceRole[]>>,
): Readonly<Record<Side, number>> {
	const redScore = computeMaterialScore(captured.red);
	const blackScore = computeMaterialScore(captured.black);
	const diff = redScore - blackScore;
	return {
		red: Math.max(diff, 0),
		black: Math.max(-diff, 0),
	};
}

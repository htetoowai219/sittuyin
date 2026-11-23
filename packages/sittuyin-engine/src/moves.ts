import {
	isSitKeMyinSquare,
	OFFICER_ROLES,
	OFFICER_SETUP_SQUARES,
	oppositeSide,
	ROOK_SETUP_SQUARES,
} from "./constants.js";
import {
	coordsToSquare,
	indexToSquare,
	isValidSquare,
	squareToCoords,
	squareToIndex,
} from "./squares.js";
import type {
	Board,
	GameState,
	Move,
	NormalMove,
	Piece,
	PromoteMove,
	RulesConfig,
	Side,
	Square,
} from "./types.js";

const KING_OFFSETS: readonly (readonly [number, number])[] = [
	[-1, -1],
	[0, -1],
	[1, -1],
	[-1, 0],
	[1, 0],
	[-1, 1],
	[0, 1],
	[1, 1],
];

const DIAGONAL_OFFSETS: readonly (readonly [number, number])[] = [
	[-1, -1],
	[1, -1],
	[-1, 1],
	[1, 1],
];

const ORTHOGONAL_DIRS: readonly (readonly [number, number])[] = [
	[0, 1],
	[0, -1],
	[1, 0],
	[-1, 0],
];

const KNIGHT_OFFSETS: readonly (readonly [number, number])[] = [
	[-2, -1],
	[-2, 1],
	[-1, -2],
	[-1, 2],
	[1, -2],
	[1, 2],
	[2, -1],
	[2, 1],
];

export function findKingIndex(board: Board, side: Side): number {
	for (let i = 0; i < 64; i++) {
		const piece = board[i];
		if (
			piece !== null &&
			piece !== undefined &&
			piece.side === side &&
			piece.role === "king"
		) {
			return i;
		}
	}
	return -1;
}

export function getAttackerIndices(
	board: Board,
	targetIndex: number,
	bySide: Side,
): number[] {
	const tf = targetIndex % 8;
	const tr = Math.floor(targetIndex / 8);
	const byDir = bySide === "red" ? 1 : -1;
	const attackers: number[] = [];

	const checkPiece = (
		file: number,
		rank: number,
		roles: readonly Piece["role"][],
	): void => {
		if (file < 0 || file > 7 || rank < 0 || rank > 7) {
			return;
		}
		const idx = rank * 8 + file;
		const piece = board[idx];
		if (
			piece !== null &&
			piece !== undefined &&
			piece.side === bySide &&
			roles.includes(piece.role)
		) {
			attackers.push(idx);
		}
	};

	// Diagonal neighbors: King, General, Elephant, and forward-capturing Pawn (from tr - byDir)
	for (const [df, dr] of DIAGONAL_OFFSETS) {
		const nf = tf + df;
		const nr = tr + dr;
		if (nf < 0 || nf > 7 || nr < 0 || nr > 7) {
			continue;
		}
		const idx = nr * 8 + nf;
		const piece = board[idx];
		if (piece === null || piece === undefined || piece.side !== bySide) {
			continue;
		}
		if (
			piece.role === "king" ||
			piece.role === "general" ||
			piece.role === "elephant" ||
			(piece.role === "pawn" && dr === -byDir)
		) {
			attackers.push(idx);
		}
	}

	// Orthogonal 1-step neighbors: King (all 4) and Elephant (behind target relative to bySide forward)
	for (const [df, dr] of ORTHOGONAL_DIRS) {
		const nf = tf + df;
		const nr = tr + dr;
		if (nf < 0 || nf > 7 || nr < 0 || nr > 7) {
			continue;
		}
		const idx = nr * 8 + nf;
		const piece = board[idx];
		if (piece === null || piece === undefined || piece.side !== bySide) {
			continue;
		}
		if (
			piece.role === "king" ||
			(piece.role === "elephant" && df === 0 && dr === -byDir)
		) {
			attackers.push(idx);
		}
	}

	// Knight jumps
	for (const [df, dr] of KNIGHT_OFFSETS) {
		checkPiece(tf + df, tr + dr, ["knight"]);
	}

	// Rook orthogonal rays
	for (const [df, dr] of ORTHOGONAL_DIRS) {
		let nf = tf + df;
		let nr = tr + dr;
		while (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7) {
			const idx = nr * 8 + nf;
			const piece = board[idx];
			if (piece !== null && piece !== undefined) {
				if (piece.side === bySide && piece.role === "rook") {
					attackers.push(idx);
				}
				break;
			}
			nf += df;
			nr += dr;
		}
	}

	return attackers;
}

export function isKingInCheckOnBoard(board: Board, side: Side): boolean {
	const kingIndex = findKingIndex(board, side);
	if (kingIndex === -1) {
		return false;
	}
	return getAttackerIndices(board, kingIndex, oppositeSide(side)).length > 0;
}

export function isInCheck(state: GameState, side: Side): boolean {
	return isKingInCheckOnBoard(state.board, side);
}

export function getCheckingSquares(
	state: GameState,
	side: Side,
): readonly Square[] {
	const kingIndex = findKingIndex(state.board, side);
	if (kingIndex === -1) {
		return [];
	}
	return getAttackerIndices(state.board, kingIndex, oppositeSide(side)).map(
		indexToSquare,
	);
}

export function applyBoardMoveRaw(
	board: Board,
	move: NormalMove | PromoteMove,
	side: Side,
): Board {
	const next = [...board];
	const fromIdx = squareToIndex(move.from);
	const toIdx = squareToIndex(move.to);
	if (move.kind === "promote") {
		next[fromIdx] = null;
		next[toIdx] = { side, role: "general" };
	} else {
		const moving = next[fromIdx] ?? null;
		next[fromIdx] = null;
		next[toIdx] = moving;
	}
	return next;
}

function countSideGeneralsAndPawns(
	board: Board,
	side: Side,
): { readonly generals: number; readonly pawns: number } {
	let generals = 0;
	let pawns = 0;
	for (let i = 0; i < 64; i++) {
		const piece = board[i];
		if (piece !== null && piece !== undefined && piece.side === side) {
			if (piece.role === "general") {
				generals++;
			} else if (piece.role === "pawn") {
				pawns++;
			}
		}
	}
	return { generals, pawns };
}

export function isPawnEligibleForPromotion(
	board: Board,
	side: Side,
	from: Square,
	rules: RulesConfig,
	counts?: { readonly generals: number; readonly pawns: number },
): boolean {
	const piece = board[squareToIndex(from)];
	if (
		piece === null ||
		piece === undefined ||
		piece.side !== side ||
		piece.role !== "pawn"
	) {
		return false;
	}
	const { generals, pawns } = counts ?? countSideGeneralsAndPawns(board, side);
	if (generals > 0) {
		return false;
	}
	if (isSitKeMyinSquare(from, side)) {
		return true;
	}
	return rules.allowLastPawnPromoteAnywhere && pawns === 1;
}

function generatePiecePseudoMoves(
	board: Board,
	fromIdx: number,
	piece: Piece,
	rules: RulesConfig,
	counts: { readonly generals: number; readonly pawns: number },
): (NormalMove | PromoteMove)[] {
	const moves: (NormalMove | PromoteMove)[] = [];
	const from = indexToSquare(fromIdx);
	const file = fromIdx % 8;
	const rank = Math.floor(fromIdx / 8);
	const side = piece.side;
	const dir = side === "red" ? 1 : -1;

	const tryStep = (nf: number, nr: number): void => {
		const to = coordsToSquare(nf, nr);
		if (to === null) {
			return;
		}
		const target = board[nr * 8 + nf];
		if (target === null || target === undefined || target.side !== side) {
			moves.push({ kind: "normal", from, to });
		}
	};

	switch (piece.role) {
		case "king": {
			for (const [df, dr] of KING_OFFSETS) {
				tryStep(file + df, rank + dr);
			}
			break;
		}
		case "general": {
			for (const [df, dr] of DIAGONAL_OFFSETS) {
				tryStep(file + df, rank + dr);
			}
			break;
		}
		case "elephant": {
			for (const [df, dr] of DIAGONAL_OFFSETS) {
				tryStep(file + df, rank + dr);
			}
			tryStep(file, rank + dir);
			break;
		}
		case "knight": {
			for (const [df, dr] of KNIGHT_OFFSETS) {
				tryStep(file + df, rank + dr);
			}
			break;
		}
		case "rook": {
			for (const [df, dr] of ORTHOGONAL_DIRS) {
				let nf = file + df;
				let nr = rank + dr;
				while (nf >= 0 && nf <= 7 && nr >= 0 && nr <= 7) {
					const idx = nr * 8 + nf;
					const target = board[idx];
					const to = indexToSquare(idx);
					if (target === null || target === undefined) {
						moves.push({ kind: "normal", from, to });
					} else {
						if (target.side !== side) {
							moves.push({ kind: "normal", from, to });
						}
						break;
					}
					nf += df;
					nr += dr;
				}
			}
			break;
		}
		case "pawn": {
			// 1 step straight forward onto empty square
			const fwdSquare = coordsToSquare(file, rank + dir);
			if (fwdSquare !== null) {
				const fwdPiece = board[(rank + dir) * 8 + file];
				if (fwdPiece === null || fwdPiece === undefined) {
					moves.push({ kind: "normal", from, to: fwdSquare });
				}
			}
			// 1 step diagonally forward onto enemy piece
			for (const df of [-1, 1] as const) {
				const capSquare = coordsToSquare(file + df, rank + dir);
				if (capSquare !== null) {
					const capPiece = board[(rank + dir) * 8 + (file + df)];
					if (
						capPiece !== null &&
						capPiece !== undefined &&
						capPiece.side !== side
					) {
						moves.push({ kind: "normal", from, to: capSquare });
					}
				}
			}
			// Separate turn optional promotion (in place or 1 square diagonal to empty square)
			if (isPawnEligibleForPromotion(board, side, from, rules, counts)) {
				moves.push({ kind: "promote", from, to: from, promoteTo: "general" });
				for (const [df, dr] of DIAGONAL_OFFSETS) {
					const promoSquare = coordsToSquare(file + df, rank + dr);
					if (promoSquare !== null) {
						const promoTarget = board[(rank + dr) * 8 + (file + df)];
						if (promoTarget === null || promoTarget === undefined) {
							moves.push({
								kind: "promote",
								from,
								to: promoSquare,
								promoteTo: "general",
							});
						}
					}
				}
			}
			break;
		}
	}

	return moves;
}

export function passesBaseLegality(
	board: Board,
	move: NormalMove | PromoteMove,
	side: Side,
	rules: RulesConfig,
): boolean {
	const nextBoard = applyBoardMoveRaw(board, move, side);
	if (isKingInCheckOnBoard(nextBoard, side)) {
		return false;
	}
	if (
		move.kind === "promote" &&
		!rules.allowPromotionCheck &&
		isKingInCheckOnBoard(nextBoard, oppositeSide(side))
	) {
		return false;
	}
	return true;
}

export function generateBaseLegalMovesForBoard(
	board: Board,
	side: Side,
	rules: RulesConfig,
): (NormalMove | PromoteMove)[] {
	const counts = countSideGeneralsAndPawns(board, side);
	const result: (NormalMove | PromoteMove)[] = [];
	for (let i = 0; i < 64; i++) {
		const piece = board[i];
		if (piece === null || piece === undefined || piece.side !== side) {
			continue;
		}
		const pseudo = generatePiecePseudoMoves(board, i, piece, rules, counts);
		for (const move of pseudo) {
			if (passesBaseLegality(board, move, side, rules)) {
				result.push(move);
			}
		}
	}
	return result;
}

export function hasAnyBaseLegalMove(
	board: Board,
	side: Side,
	rules: RulesConfig,
): boolean {
	const counts = countSideGeneralsAndPawns(board, side);
	for (let i = 0; i < 64; i++) {
		const piece = board[i];
		if (piece === null || piece === undefined || piece.side !== side) {
			continue;
		}
		const pseudo = generatePiecePseudoMoves(board, i, piece, rules, counts);
		for (const move of pseudo) {
			if (passesBaseLegality(board, move, side, rules)) {
				return true;
			}
		}
	}
	return false;
}

export function wouldMoveStalemateOpponent(
	board: Board,
	move: NormalMove | PromoteMove,
	side: Side,
	rules: RulesConfig,
): boolean {
	const nextBoard = applyBoardMoveRaw(board, move, side);
	const opp = oppositeSide(side);
	if (isKingInCheckOnBoard(nextBoard, opp)) {
		return false;
	}
	return !hasAnyBaseLegalMove(nextBoard, opp, rules);
}

export function generateLegalPlayingMovesForBoard(
	board: Board,
	side: Side,
	rules: RulesConfig,
): (NormalMove | PromoteMove)[] {
	const baseMoves = generateBaseLegalMovesForBoard(board, side, rules);
	if (rules.stalemateRule !== "illegal") {
		return baseMoves;
	}
	return baseMoves.filter(
		(move) => !wouldMoveStalemateOpponent(board, move, side, rules),
	);
}

export function getLegalMoves(state: GameState): readonly Move[] {
	if (state.phase === "finished") {
		return [];
	}
	if (state.phase === "setup") {
		if (state.rules.setupMode !== "alternating_drops") {
			return [];
		}
		const side = state.turn;
		const hand = state.hands[side];
		const drops: Move[] = [];
		for (const role of OFFICER_ROLES) {
			if (hand[role] <= 0) {
				continue;
			}
			const zone =
				role === "rook"
					? ROOK_SETUP_SQUARES[side]
					: OFFICER_SETUP_SQUARES[side];
			for (const square of zone) {
				if (state.board[squareToIndex(square)] === null) {
					drops.push({ kind: "drop", role, to: square });
				}
			}
		}
		return drops;
	}
	return generateLegalPlayingMovesForBoard(
		state.board,
		state.turn,
		state.rules,
	);
}

export function getLegalMovesFrom(
	state: GameState,
	square: Square,
): readonly Move[] {
	if (state.phase !== "playing" || !isValidSquare(square)) {
		return [];
	}
	const idx = squareToIndex(square);
	const piece = state.board[idx];
	if (piece === null || piece === undefined || piece.side !== state.turn) {
		return [];
	}
	const counts = countSideGeneralsAndPawns(state.board, state.turn);
	const pseudo = generatePiecePseudoMoves(
		state.board,
		idx,
		piece,
		state.rules,
		counts,
	);
	const base = pseudo.filter((move) =>
		passesBaseLegality(state.board, move, state.turn, state.rules),
	);
	if (state.rules.stalemateRule !== "illegal") {
		return base;
	}
	return base.filter(
		(move) =>
			!wouldMoveStalemateOpponent(state.board, move, state.turn, state.rules),
	);
}

export function getPromotionCandidates(
	state: GameState,
	side: Side,
): readonly Square[] {
	if (state.phase !== "playing" || side !== state.turn) {
		return [];
	}
	const legalMoves = getLegalMoves(state);
	const seen = new Set<Square>();
	const squares: Square[] = [];
	for (const move of legalMoves) {
		if (move.kind === "promote" && !seen.has(move.from)) {
			seen.add(move.from);
			squares.push(move.from);
		}
	}
	return squares;
}

export function isNormalMoveGeometricallyPseudoLegal(
	board: Board,
	side: Side,
	move: NormalMove,
): boolean {
	const fromIdx = squareToIndex(move.from);
	const piece = board[fromIdx];
	if (piece === null || piece === undefined || piece.side !== side) {
		return false;
	}
	const toIdx = squareToIndex(move.to);
	const target = board[toIdx];
	if (target !== null && target !== undefined && target.side === side) {
		return false;
	}
	const fromCoords = squareToCoords(move.from);
	const toCoords = squareToCoords(move.to);
	const df = toCoords.file - fromCoords.file;
	const dr = toCoords.rank - fromCoords.rank;
	const adf = Math.abs(df);
	const adr = Math.abs(dr);
	const dir = side === "red" ? 1 : -1;

	switch (piece.role) {
		case "king":
			return adf <= 1 && adr <= 1 && (adf !== 0 || adr !== 0);
		case "general":
			return adf === 1 && adr === 1;
		case "elephant":
			return (adf === 1 && adr === 1) || (df === 0 && dr === dir);
		case "knight":
			return (adf === 2 && adr === 1) || (adf === 1 && adr === 2);
		case "rook": {
			if ((df !== 0 && dr !== 0) || (df === 0 && dr === 0)) {
				return false;
			}
			const stepF = Math.sign(df);
			const stepR = Math.sign(dr);
			let f = fromCoords.file + stepF;
			let r = fromCoords.rank + stepR;
			while (f !== toCoords.file || r !== toCoords.rank) {
				if (board[r * 8 + f] !== null) {
					return false;
				}
				f += stepF;
				r += stepR;
			}
			return true;
		}
		case "pawn":
			if (df === 0 && dr === dir) {
				return target === null || target === undefined;
			}
			if (adf === 1 && dr === dir) {
				return target !== null && target !== undefined && target.side !== side;
			}
			return false;
	}
}

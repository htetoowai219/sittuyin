import {
	isOfficerRole,
	isSquareInOfficerZone,
	isSquareOnBackRank,
	oppositeSide,
	remainingHandTotal,
} from "./constants.js";
import { formatPositionKey } from "./fen-core.js";
import {
	applyBoardMoveRaw,
	generateLegalPlayingMovesForBoard,
	hasAnyBaseLegalMove,
	isKingInCheckOnBoard,
	isNormalMoveGeometricallyPseudoLegal,
	isPawnEligibleForPromotion,
	wouldMoveStalemateOpponent,
} from "./moves.js";
import { isValidSquare, squareToCoords, squareToIndex } from "./squares.js";
import {
	type Board,
	type EngineError,
	err,
	type GameOutcome,
	type GameState,
	type Move,
	type MoveRecord,
	ok,
	type Piece,
	type Result,
	type RulesConfig,
	type Side,
} from "./types.js";
import { parseUci, toUci } from "./uci.js";

export function isInsufficientMaterial(board: Board): boolean {
	let totalPieces = 0;
	let rooks = 0;
	let elephants = 0;
	for (let i = 0; i < 64; i++) {
		const piece = board[i];
		if (piece === null || piece === undefined) {
			continue;
		}
		totalPieces++;
		if (piece.role === "rook") {
			rooks++;
		} else if (piece.role === "elephant") {
			elephants++;
		}
	}
	return rooks === 0 && elephants === 0 && totalPieces <= 3;
}

export function isEitherSideBareKing(board: Board): boolean {
	let redCount = 0;
	let blackCount = 0;
	for (let i = 0; i < 64; i++) {
		const piece = board[i];
		if (piece === null || piece === undefined) {
			continue;
		}
		if (piece.side === "red") {
			redCount++;
		} else {
			blackCount++;
		}
	}
	return redCount === 1 || blackCount === 1;
}

export function evaluateTerminalOutcome(
	board: Board,
	nextTurn: Side,
	rules: RulesConfig,
	positionCounts: Readonly<Record<string, number>>,
	positionKey: string,
	halfmoveClock: number,
	bareKingClock: number | null,
): GameOutcome | null {
	const mover = oppositeSide(nextTurn);
	const inCheck = isKingInCheckOnBoard(board, nextTurn);
	const hasBaseReply = hasAnyBaseLegalMove(board, nextTurn, rules);

	// 1. Checkmate always takes highest priority
	if (inCheck && !hasBaseReply) {
		return { status: "win", winner: mover, reason: "checkmate" };
	}

	// 2. Stalemate or unavoidable stalemate
	if (!inCheck) {
		if (!hasBaseReply) {
			return {
				status: "draw",
				winner: null,
				reason:
					rules.stalemateRule === "draw"
						? "stalemate"
						: "unavoidable_stalemate",
			};
		}
		if (rules.stalemateRule === "illegal") {
			const legalMoves = generateLegalPlayingMovesForBoard(
				board,
				nextTurn,
				rules,
			);
			if (legalMoves.length === 0) {
				return {
					status: "draw",
					winner: null,
					reason: "unavoidable_stalemate",
				};
			}
		}
	}

	// 3. Bare King dead position insufficient material
	if (isInsufficientMaterial(board)) {
		return { status: "draw", winner: null, reason: "insufficient_material" };
	}

	// 4. Threefold repetition (covers perpetual check)
	const occurrences = Object.hasOwn(positionCounts, positionKey)
		? (positionCounts[positionKey] ?? 0)
		: 0;
	if (occurrences >= 3) {
		return { status: "draw", winner: null, reason: "threefold_repetition" };
	}

	// 5. Standard 50 move rule (100 plies)
	if (halfmoveClock >= 100) {
		return { status: "draw", winner: null, reason: "fifty_move_rule" };
	}

	// 6. Bare King 50 move countdown (100 plies)
	if (
		rules.enableBareKingFiftyMove &&
		bareKingClock !== null &&
		bareKingClock >= 100
	) {
		return { status: "draw", winner: null, reason: "bare_king_fifty_move" };
	}

	return null;
}

export function applyMove(
	state: GameState,
	move: Move,
): Result<GameState, EngineError> {
	if (state.phase === "finished") {
		return err("INVALID_PHASE", "Cannot apply a move to a finished game.");
	}

	if (state.phase === "setup") {
		if (state.rules.setupMode !== "alternating_drops") {
			return err(
				"INVALID_SETUP_MODE",
				"Use applySetupAction during hidden_simultaneous setup.",
			);
		}
		if (move.kind !== "drop") {
			return err(
				"INVALID_PHASE",
				"All 16 officers must be dropped before making board moves.",
			);
		}
		if (!isValidSquare(move.to)) {
			return err(
				"INVALID_SQUARE",
				`Invalid destination square: "${String(move.to)}".`,
			);
		}
		if (!isOfficerRole(move.role)) {
			return err(
				"ILLEGAL_MOVE",
				`Invalid drop officer role: "${String(move.role)}".`,
			);
		}

		const side = state.turn;
		const hand = state.hands[side];
		if (hand[move.role] <= 0) {
			return err(
				"PIECE_NOT_IN_HAND",
				`No ${move.role} remaining in ${side} hand.`,
			);
		}
		if (move.role === "rook" && !isSquareOnBackRank(side, move.to)) {
			return err(
				"ROOK_MUST_BE_BACK_RANK",
				`Rooks must be placed on the back rank (${side === "red" ? "rank 1" : "rank 8"}).`,
			);
		}
		if (!isSquareInOfficerZone(side, move.to)) {
			return err(
				"OUTSIDE_SETUP_ZONE",
				`Square ${move.to} is outside ${side}'s legal setup zone.`,
			);
		}
		const toIdx = squareToIndex(move.to);
		if (state.board[toIdx] !== null) {
			return err("SQUARE_OCCUPIED", `Square ${move.to} is already occupied.`);
		}

		const nextBoard: (Piece | null)[] = [...state.board];
		nextBoard[toIdx] = { side, role: move.role };

		const nextSideHand = { ...hand, [move.role]: hand[move.role] - 1 };
		const nextHands = { ...state.hands, [side]: nextSideHand };
		const nextTurn = oppositeSide(side);
		const nextFullmove =
			side === "black" ? state.fullmoveNumber + 1 : state.fullmoveNumber;

		const setupComplete =
			remainingHandTotal(nextHands.red) === 0 &&
			remainingHandTotal(nextHands.black) === 0;
		const nextPhase = setupComplete ? "playing" : "setup";
		const positionKey = formatPositionKey(nextBoard, nextHands, nextTurn);
		const nextPositionCounts: Readonly<Record<string, number>> = setupComplete
			? { [positionKey]: 1 }
			: state.positionCounts;

		const record: MoveRecord = {
			ply: state.moveHistory.length + 1,
			side,
			move,
			uci: toUci(move),
			piece: move.role,
			captured: null,
			gaveCheck: false,
			gaveCheckmate: false,
			positionKey,
		};

		return ok({
			...state,
			phase: nextPhase,
			board: nextBoard,
			hands: nextHands,
			setupReady: setupComplete ? { red: true, black: true } : state.setupReady,
			turn: nextTurn,
			fullmoveNumber: nextFullmove,
			positionCounts: nextPositionCounts,
			moveHistory: [...state.moveHistory, record],
		});
	}

	// phase === "playing"
	if (move.kind === "drop") {
		return err(
			"INVALID_PHASE",
			"Drop moves are not allowed after the setup phase has ended.",
		);
	}
	if (!isValidSquare(move.from) || !isValidSquare(move.to)) {
		return err(
			"INVALID_SQUARE",
			`Invalid square in move: ${String(move.from)} to ${String(move.to)}.`,
		);
	}

	const side = state.turn;
	const fromIdx = squareToIndex(move.from);
	const fromPiece = state.board[fromIdx];
	if (fromPiece === null || fromPiece === undefined) {
		return err("ILLEGAL_MOVE", `No piece on square ${move.from}.`);
	}
	if (fromPiece.side !== side) {
		return err(
			"WRONG_TURN",
			`Piece on ${move.from} belongs to ${fromPiece.side}, but it is ${side}'s turn.`,
		);
	}

	if (move.kind === "promote") {
		if (move.promoteTo !== "general" || fromPiece.role !== "pawn") {
			return err(
				"PROMOTION_NOT_ALLOWED",
				"Only a pawn may promote to a general.",
			);
		}
		if (
			!isPawnEligibleForPromotion(state.board, side, move.from, state.rules)
		) {
			return err(
				"PROMOTION_NOT_ALLOWED",
				`Pawn on ${move.from} is not eligible to promote.`,
			);
		}
		if (move.from !== move.to) {
			const fromCoords = squareToCoords(move.from);
			const toCoords = squareToCoords(move.to);
			const adf = Math.abs(toCoords.file - fromCoords.file);
			const adr = Math.abs(toCoords.rank - fromCoords.rank);
			if (adf !== 1 || adr !== 1) {
				return err(
					"PROMOTION_NOT_ALLOWED",
					`Promotion move must be in place or 1 square diagonally (got ${move.from} to ${move.to}).`,
				);
			}
			if (state.board[squareToIndex(move.to)] !== null) {
				return err(
					"PROMOTION_NOT_ALLOWED",
					`Promotion diagonal step cannot capture on occupied square ${move.to}.`,
				);
			}
		}

		const candidateBoard = applyBoardMoveRaw(state.board, move, side);
		if (isKingInCheckOnBoard(candidateBoard, side)) {
			return err(
				"ILLEGAL_MOVE",
				"Promotion cannot leave your own King in check.",
			);
		}
		if (
			!state.rules.allowPromotionCheck &&
			isKingInCheckOnBoard(candidateBoard, oppositeSide(side))
		) {
			return err(
				"PROMOTION_NOT_ALLOWED",
				"Promotion giving or discovering check is disabled by match rules.",
			);
		}
		if (
			state.rules.stalemateRule === "illegal" &&
			wouldMoveStalemateOpponent(state.board, move, side, state.rules)
		) {
			return err(
				"ILLEGAL_STALEMATE",
				"Stalemating the opponent is illegal in Sittuyin.",
			);
		}
	} else {
		if (!isNormalMoveGeometricallyPseudoLegal(state.board, side, move)) {
			return err(
				"ILLEGAL_MOVE",
				`Illegal ${fromPiece.role} move from ${move.from} to ${move.to}.`,
			);
		}
		const candidateBoard = applyBoardMoveRaw(state.board, move, side);
		if (isKingInCheckOnBoard(candidateBoard, side)) {
			return err("ILLEGAL_MOVE", "Move cannot leave your own King in check.");
		}
		if (
			state.rules.stalemateRule === "illegal" &&
			wouldMoveStalemateOpponent(state.board, move, side, state.rules)
		) {
			return err(
				"ILLEGAL_STALEMATE",
				"Stalemating the opponent is illegal in Sittuyin.",
			);
		}
	}

	const capturedRole =
		move.kind === "normal"
			? (state.board[squareToIndex(move.to)]?.role ?? null)
			: null;
	const nextBoard = applyBoardMoveRaw(state.board, move, side);
	const nextTurn = oppositeSide(side);
	const nextHalfmove =
		capturedRole !== null ||
		fromPiece.role === "pawn" ||
		move.kind === "promote"
			? 0
			: state.halfmoveClock + 1;

	let nextBareKingClock: number | null;
	if (!state.rules.enableBareKingFiftyMove) {
		nextBareKingClock = null;
	} else if (state.bareKingClock === null) {
		nextBareKingClock = isEitherSideBareKing(nextBoard) ? 0 : null;
	} else {
		nextBareKingClock = capturedRole !== null ? 0 : state.bareKingClock + 1;
	}

	const nextFullmove =
		side === "black" ? state.fullmoveNumber + 1 : state.fullmoveNumber;
	const positionKey = formatPositionKey(nextBoard, state.hands, nextTurn);
	const prevOccurrences = Object.hasOwn(state.positionCounts, positionKey)
		? (state.positionCounts[positionKey] ?? 0)
		: 0;
	const nextPositionCounts: Readonly<Record<string, number>> = {
		...state.positionCounts,
		[positionKey]: prevOccurrences + 1,
	};

	const nextCaptured =
		capturedRole !== null
			? {
					...state.captured,
					[side]: [...state.captured[side], capturedRole],
				}
			: state.captured;

	const outcome = evaluateTerminalOutcome(
		nextBoard,
		nextTurn,
		state.rules,
		nextPositionCounts,
		positionKey,
		nextHalfmove,
		nextBareKingClock,
	);
	const gaveCheck = isKingInCheckOnBoard(nextBoard, nextTurn);
	const gaveCheckmate = outcome !== null && outcome.reason === "checkmate";

	const record: MoveRecord = {
		ply: state.moveHistory.length + 1,
		side,
		move,
		uci: toUci(move),
		piece: fromPiece.role,
		captured: capturedRole,
		gaveCheck,
		gaveCheckmate,
		positionKey,
	};

	return ok({
		...state,
		phase: outcome !== null ? "finished" : "playing",
		board: nextBoard,
		turn: nextTurn,
		halfmoveClock: nextHalfmove,
		bareKingClock: nextBareKingClock,
		fullmoveNumber: nextFullmove,
		positionCounts: nextPositionCounts,
		captured: nextCaptured,
		moveHistory: [...state.moveHistory, record],
		outcome,
	});
}

export function applyUci(
	state: GameState,
	uci: string,
): Result<GameState, EngineError> {
	const parsed = parseUci(uci);
	if (!parsed.ok) {
		return parsed;
	}
	return applyMove(state, parsed.value);
}

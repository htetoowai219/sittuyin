import {
	DEFAULT_RULES,
	EMPTY_OFFICER_HAND,
	isSquareInSetupZone,
	MAX_PIECE_COUNTS,
	oppositeSide,
	remainingHandTotal,
} from "./constants.js";
import { formatFen, formatPositionKey, toFen } from "./fen-core.js";
import { isKingInCheckOnBoard } from "./moves.js";
import { evaluateTerminalOutcome, isEitherSideBareKing } from "./rules.js";
import { indexToSquare } from "./squares.js";
import {
	type EngineError,
	err,
	type FromFenOptions,
	type GameState,
	type OfficerHand,
	type OfficerRole,
	ok,
	type Piece,
	type PieceRole,
	type Result,
	type RulesConfig,
	type Side,
} from "./types.js";

export { toFen };

const FEN_BOARD_CHAR_MAP: ReadonlyMap<string, Piece> = new Map([
	["K", { side: "red", role: "king" }],
	["F", { side: "red", role: "general" }],
	["R", { side: "red", role: "rook" }],
	["S", { side: "red", role: "elephant" }],
	["N", { side: "red", role: "knight" }],
	["P", { side: "red", role: "pawn" }],
	["k", { side: "black", role: "king" }],
	["f", { side: "black", role: "general" }],
	["r", { side: "black", role: "rook" }],
	["s", { side: "black", role: "elephant" }],
	["n", { side: "black", role: "knight" }],
	["p", { side: "black", role: "pawn" }],
]);

const FEN_HAND_CHAR_MAP: ReadonlyMap<
	string,
	{ readonly side: Side; readonly role: OfficerRole }
> = new Map([
	["K", { side: "red", role: "king" }],
	["F", { side: "red", role: "general" }],
	["R", { side: "red", role: "rook" }],
	["S", { side: "red", role: "elephant" }],
	["N", { side: "red", role: "knight" }],
	["k", { side: "black", role: "king" }],
	["f", { side: "black", role: "general" }],
	["r", { side: "black", role: "rook" }],
	["s", { side: "black", role: "elephant" }],
	["n", { side: "black", role: "knight" }],
]);

const DIGITS_ONLY_RE = /^\d+$/;

function createEmptyCounts(): Record<PieceRole, number> {
	return {
		king: 0,
		general: 0,
		rook: 0,
		elephant: 0,
		knight: 0,
		pawn: 0,
	};
}

export function fromFen(
	fen: string,
	options?: FromFenOptions,
): Result<GameState, EngineError> {
	if (typeof fen !== "string") {
		return err("INVALID_FEN", "FEN must be a string.");
	}

	if (options?.bareKingClock !== undefined) {
		if (
			typeof options.bareKingClock !== "number" ||
			!Number.isInteger(options.bareKingClock) ||
			options.bareKingClock < 0
		) {
			return err(
				"INVALID_FEN",
				"options.bareKingClock must be a non-negative integer.",
			);
		}
	}

	const parts = fen.split(" ");
	if (parts.length !== 6) {
		return err(
			"INVALID_FEN",
			`Sittuyin FEN must contain exactly 6 space separated fields (got ${parts.length}).`,
		);
	}

	const [boardAndHand, sideStr, castlingStr, epStr, halfmoveStr, fullmoveStr] =
		parts;
	if (
		boardAndHand === undefined ||
		sideStr === undefined ||
		castlingStr === undefined ||
		epStr === undefined ||
		halfmoveStr === undefined ||
		fullmoveStr === undefined
	) {
		return err("INVALID_FEN", "Malformed FEN fields.");
	}

	if (castlingStr !== "-" || epStr !== "-") {
		return err(
			"INVALID_FEN",
			'Sittuyin FEN castling and en passant fields must both be "-".',
		);
	}

	let turn: Side;
	if (sideStr === "w") {
		turn = "red";
	} else if (sideStr === "b") {
		turn = "black";
	} else {
		return err(
			"INVALID_FEN",
			`Side to move must be "w" or "b" (got "${sideStr}").`,
		);
	}

	if (!DIGITS_ONLY_RE.test(halfmoveStr) || !DIGITS_ONLY_RE.test(fullmoveStr)) {
		return err(
			"INVALID_FEN",
			"Halfmove and fullmove counters must be valid integers.",
		);
	}

	const halfmoveClock = Number.parseInt(halfmoveStr, 10);
	const fullmoveNumber = Number.parseInt(fullmoveStr, 10);
	if (
		!Number.isSafeInteger(halfmoveClock) ||
		halfmoveClock < 0 ||
		!Number.isSafeInteger(fullmoveNumber) ||
		fullmoveNumber < 1
	) {
		return err(
			"INVALID_FEN",
			"Halfmove must be >= 0 and fullmove must be >= 1.",
		);
	}

	// Split board ranks and optional [hand] pocket
	let boardPart = boardAndHand;
	let handPart = "";
	const openIdx = boardAndHand.indexOf("[");
	const closeIdx = boardAndHand.indexOf("]");
	if (openIdx !== -1 || closeIdx !== -1) {
		if (
			openIdx === -1 ||
			closeIdx !== boardAndHand.length - 1 ||
			boardAndHand.indexOf("[", openIdx + 1) !== -1 ||
			boardAndHand.indexOf("]", openIdx + 1) !== closeIdx
		) {
			return err("INVALID_FEN", "Malformed hand pocket brackets in FEN.");
		}
		boardPart = boardAndHand.slice(0, openIdx);
		handPart = boardAndHand.slice(openIdx + 1, closeIdx);
	}

	const rankStrings = boardPart.split("/");
	if (rankStrings.length !== 8) {
		return err(
			"INVALID_FEN",
			`Board section must contain 8 ranks (got ${rankStrings.length}).`,
		);
	}

	const board: (Piece | null)[] = Array.from({ length: 64 }, () => null);
	const totalCounts: Record<Side, Record<PieceRole, number>> = {
		red: createEmptyCounts(),
		black: createEmptyCounts(),
	};

	for (let r = 0; r < 8; r++) {
		const rankStr = rankStrings[r];
		if (rankStr === undefined || rankStr.length === 0) {
			return err("INVALID_FEN", "Empty rank string in FEN.");
		}
		const rankIndex = 7 - r;
		let file = 0;
		for (let i = 0; i < rankStr.length; i++) {
			const ch = rankStr[i];
			if (ch === undefined) {
				continue;
			}
			if (ch >= "1" && ch <= "8") {
				file += Number.parseInt(ch, 10);
				if (file > 8) {
					return err("INVALID_FEN", `Rank ${rankIndex + 1} exceeds 8 squares.`);
				}
			} else {
				const piece = FEN_BOARD_CHAR_MAP.get(ch);
				if (piece === undefined) {
					return err("INVALID_FEN", `Unknown FEN piece symbol: "${ch}".`);
				}
				if (file >= 8) {
					return err("INVALID_FEN", `Rank ${rankIndex + 1} exceeds 8 squares.`);
				}
				board[rankIndex * 8 + file] = piece;
				totalCounts[piece.side][piece.role]++;
				file++;
			}
		}
		if (file !== 8) {
			return err(
				"INVALID_FEN",
				`Rank ${rankIndex + 1} has ${file} squares instead of 8.`,
			);
		}
	}

	const handsMutable: Record<
		Side,
		{
			king: number;
			general: number;
			rook: number;
			elephant: number;
			knight: number;
		}
	> = {
		red: { ...EMPTY_OFFICER_HAND },
		black: { ...EMPTY_OFFICER_HAND },
	};

	for (let i = 0; i < handPart.length; i++) {
		const ch = handPart[i];
		if (ch === undefined) {
			continue;
		}
		const entry = FEN_HAND_CHAR_MAP.get(ch);
		if (entry === undefined) {
			return err(
				"INVALID_FEN",
				`Invalid piece symbol "${ch}" inside hand pocket.`,
			);
		}
		handsMutable[entry.side][entry.role]++;
		totalCounts[entry.side][entry.role]++;
	}

	const hands: Readonly<Record<Side, OfficerHand>> = {
		red: { ...handsMutable.red },
		black: { ...handsMutable.black },
	};

	// Validate piece count bounds across board + hands
	for (const side of ["red", "black"] as const) {
		if (totalCounts[side].king !== 1) {
			return err(
				"INVALID_PIECE_COUNT",
				`${side} must have exactly 1 King across board and hand (got ${totalCounts[side].king}).`,
			);
		}
		for (const role of [
			"general",
			"rook",
			"elephant",
			"knight",
			"pawn",
		] as const) {
			if (totalCounts[side][role] > MAX_PIECE_COUNTS[role]) {
				return err(
					"INVALID_PIECE_COUNT",
					`${side} has ${totalCounts[side][role]} ${role}(s), exceeding maximum ${MAX_PIECE_COUNTS[role]}.`,
				);
			}
		}
	}

	const redHandTotal = remainingHandTotal(hands.red);
	const blackHandTotal = remainingHandTotal(hands.black);
	const hasHands = redHandTotal > 0 || blackHandTotal > 0;

	if (hasHands) {
		const validParity =
			turn === "red"
				? redHandTotal >= 1 &&
					redHandTotal <= 8 &&
					redHandTotal === blackHandTotal
				: blackHandTotal >= 1 &&
					blackHandTotal <= 8 &&
					blackHandTotal === redHandTotal + 1;
		if (!validParity) {
			return err(
				"INVALID_PIECE_COUNT",
				`Invalid alternating drop hand counts for ${turn}'s turn (red: ${redHandTotal}, black: ${blackHandTotal}).`,
			);
		}

		for (let i = 0; i < 64; i++) {
			const piece = board[i];
			if (piece === null || piece === undefined || piece.role === "pawn") {
				continue;
			}
			const sq = indexToSquare(i);
			if (!isSquareInSetupZone(piece.side, piece.role, sq)) {
				return err(
					"INVALID_FEN",
					`Mid setup officer ${piece.side} ${piece.role} on ${sq} is outside its legal setup zone.`,
				);
			}
		}

		if (isKingInCheckOnBoard(board, oppositeSide(turn))) {
			return err(
				"OPPONENT_IN_CHECK",
				"Non moving side cannot already be in check.",
			);
		}

		const setupRules: RulesConfig = {
			...DEFAULT_RULES,
			...options?.rules,
			setupMode: "alternating_drops",
		};
		const normalizedFen = formatFen(
			board,
			hands,
			turn,
			halfmoveClock,
			fullmoveNumber,
		);

		return ok({
			phase: "setup",
			rules: setupRules,
			board,
			hands,
			setupDrafts: { red: {}, black: {} },
			setupReady: { red: false, black: false },
			turn,
			halfmoveClock,
			bareKingClock: null,
			fullmoveNumber,
			initialSetupFen: normalizedFen,
			positionCounts: {},
			captured: { red: [], black: [] },
			moveHistory: [],
			outcome: null,
		});
	}

	// Playing / finished FEN (hands empty)
	if (isKingInCheckOnBoard(board, oppositeSide(turn))) {
		return err(
			"OPPONENT_IN_CHECK",
			`Non moving side (${oppositeSide(turn)}) cannot already be in check.`,
		);
	}

	const resolvedRules: RulesConfig = {
		...DEFAULT_RULES,
		...options?.rules,
	};

	const bareKingClock =
		resolvedRules.enableBareKingFiftyMove && isEitherSideBareKing(board)
			? (options?.bareKingClock ?? 0)
			: null;

	const positionKey = formatPositionKey(board, hands, turn);
	const positionCounts: Readonly<Record<string, number>> = {
		[positionKey]: 1,
	};
	const outcome = evaluateTerminalOutcome(
		board,
		turn,
		resolvedRules,
		positionCounts,
		positionKey,
		halfmoveClock,
		bareKingClock,
	);
	const normalizedFen = formatFen(
		board,
		hands,
		turn,
		halfmoveClock,
		fullmoveNumber,
	);

	return ok({
		phase: outcome !== null ? "finished" : "playing",
		rules: resolvedRules,
		board,
		hands,
		setupDrafts: { red: {}, black: {} },
		setupReady: { red: true, black: true },
		turn,
		halfmoveClock,
		bareKingClock,
		fullmoveNumber,
		initialSetupFen: normalizedFen,
		positionCounts,
		captured: { red: [], black: [] },
		moveHistory: [],
		outcome,
	});
}

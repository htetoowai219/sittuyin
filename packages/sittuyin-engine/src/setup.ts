import {
	DEFAULT_RULES,
	EMPTY_OFFICER_HAND,
	INITIAL_OFFICER_HAND,
	INITIAL_PAWN_SQUARES,
	isOfficerRole,
	isSquareInOfficerZone,
	isSquareInSetupZone,
	isSquareOnBackRank,
	OFFICER_ROLES,
	OFFICER_SETUP_SQUARES,
	ROOK_SETUP_SQUARES,
	remainingHandTotal,
	STARTING_SETUP_FEN,
} from "./constants.js";
import { formatFen, formatPositionKey } from "./fen-core.js";
import { getPresetPlacements } from "./presets.js";
import { createPrng, shuffleDeterministic } from "./prng.js";
import { isValidSquare, squareToIndex } from "./squares.js";
import {
	type Board,
	type EngineError,
	err,
	type GameState,
	type OfficerHand,
	type OfficerRole,
	ok,
	type Piece,
	type Result,
	type RulesConfig,
	type SetupAction,
	type SetupPlacements,
	type Side,
	type Square,
} from "./types.js";

export function createInitialBoard(): Board {
	const board: (Piece | null)[] = Array.from({ length: 64 }, () => null);
	for (const sq of INITIAL_PAWN_SQUARES.red) {
		board[squareToIndex(sq)] = { side: "red", role: "pawn" };
	}
	for (const sq of INITIAL_PAWN_SQUARES.black) {
		board[squareToIndex(sq)] = { side: "black", role: "pawn" };
	}
	return board;
}

export function createGame(rules?: Partial<RulesConfig>): GameState {
	const resolvedRules: RulesConfig = {
		...DEFAULT_RULES,
		...rules,
	};
	return {
		phase: "setup",
		rules: resolvedRules,
		board: createInitialBoard(),
		hands: {
			red: { ...INITIAL_OFFICER_HAND },
			black: { ...INITIAL_OFFICER_HAND },
		},
		setupDrafts: {
			red: {},
			black: {},
		},
		setupReady: {
			red: false,
			black: false,
		},
		turn: "red",
		halfmoveClock: 0,
		bareKingClock: null,
		fullmoveNumber: 1,
		initialSetupFen:
			resolvedRules.setupMode === "alternating_drops"
				? STARTING_SETUP_FEN
				: null,
		positionCounts: {},
		captured: {
			red: [],
			black: [],
		},
		moveHistory: [],
		outcome: null,
	};
}

export function getLegalSetupSquares(
	state: GameState,
	side: Side,
	role: OfficerRole,
	fromSquare?: Square,
): readonly Square[] {
	if (state.phase !== "setup" || !isOfficerRole(role)) {
		return [];
	}

	const zone =
		role === "rook" ? ROOK_SETUP_SQUARES[side] : OFFICER_SETUP_SQUARES[side];

	if (state.rules.setupMode === "alternating_drops") {
		if (state.turn !== side || state.hands[side][role] <= 0) {
			return [];
		}
		return zone.filter((sq) => state.board[squareToIndex(sq)] === null);
	}

	// hidden_simultaneous
	if (state.setupReady[side]) {
		return [];
	}
	const draft = state.setupDrafts[side];
	return zone.filter((sq) => {
		if (fromSquare !== undefined && sq === fromSquare) {
			return false;
		}
		const occupant = draft[sq];
		if (occupant === undefined) {
			return true;
		}
		if (fromSquare !== undefined) {
			return isSquareInSetupZone(side, occupant, fromSquare);
		}
		return occupant !== "rook" || role === "rook";
	});
}

function validatePlacementSquare(
	side: Side,
	role: OfficerRole,
	square: Square,
): Result<true, EngineError> {
	if (role === "rook" && !isSquareOnBackRank(side, square)) {
		return err(
			"ROOK_MUST_BE_BACK_RANK",
			`Rooks must be placed on the back rank (${side === "red" ? "rank 1" : "rank 8"}).`,
		);
	}
	if (!isSquareInOfficerZone(side, square)) {
		return err(
			"OUTSIDE_SETUP_ZONE",
			`Square ${square} is outside ${side}'s legal setup zone.`,
		);
	}
	return ok(true);
}

function commitHiddenSetup(
	state: GameState,
	nextSetupReady: Readonly<Record<Side, boolean>>,
): GameState {
	const committedBoard: (Piece | null)[] = [...state.board];
	for (const side of ["red", "black"] as const) {
		const draft = state.setupDrafts[side];
		for (const [sq, role] of Object.entries(draft) as [
			Square,
			OfficerRole | undefined,
		][]) {
			if (role !== undefined) {
				committedBoard[squareToIndex(sq)] = { side, role };
			}
		}
	}
	const emptyHands: Readonly<Record<Side, OfficerHand>> = {
		red: { ...EMPTY_OFFICER_HAND },
		black: { ...EMPTY_OFFICER_HAND },
	};
	const initialSetupFen = formatFen(committedBoard, emptyHands, "red", 0, 1);
	const initialKey = formatPositionKey(committedBoard, emptyHands, "red");
	return {
		...state,
		phase: "playing",
		board: committedBoard,
		hands: emptyHands,
		setupDrafts: { red: {}, black: {} },
		setupReady: nextSetupReady,
		turn: "red",
		halfmoveClock: 0,
		bareKingClock: null,
		fullmoveNumber: 1,
		initialSetupFen,
		positionCounts: { [initialKey]: 1 },
	};
}

export function applySetupAction(
	state: GameState,
	side: Side,
	action: SetupAction,
): Result<GameState, EngineError> {
	if (state.phase !== "setup") {
		return err(
			"INVALID_PHASE",
			"Setup actions are only valid during the setup phase.",
		);
	}
	if (state.rules.setupMode !== "hidden_simultaneous") {
		return err(
			"INVALID_SETUP_MODE",
			"Setup actions require hidden_simultaneous setup mode.",
		);
	}

	if (action.kind === "unlock") {
		if (!state.setupReady[side]) {
			return ok(state);
		}
		return ok({
			...state,
			setupReady: { ...state.setupReady, [side]: false },
		});
	}

	if (state.setupReady[side]) {
		return err(
			"SIDE_ALREADY_LOCKED",
			`${side} has already locked in setup; unlock first before editing.`,
		);
	}

	const draft = state.setupDrafts[side];
	const hand = state.hands[side];

	switch (action.kind) {
		case "place": {
			if (!isValidSquare(action.to)) {
				return err("INVALID_SQUARE", `Invalid square: "${String(action.to)}".`);
			}
			if (!isOfficerRole(action.role)) {
				return err(
					"ILLEGAL_MOVE",
					`Invalid officer role: "${String(action.role)}".`,
				);
			}
			if (hand[action.role] <= 0) {
				return err(
					"PIECE_NOT_IN_HAND",
					`No ${action.role} left in ${side} hand.`,
				);
			}
			const zoneCheck = validatePlacementSquare(side, action.role, action.to);
			if (!zoneCheck.ok) {
				return zoneCheck;
			}
			if (draft[action.to] !== undefined) {
				return err(
					"SQUARE_OCCUPIED",
					`Square ${action.to} is already occupied in ${side}'s draft.`,
				);
			}
			const nextDraft: SetupPlacements = {
				...draft,
				[action.to]: action.role,
			};
			const nextHand: OfficerHand = {
				...hand,
				[action.role]: hand[action.role] - 1,
			};
			return ok({
				...state,
				setupDrafts: { ...state.setupDrafts, [side]: nextDraft },
				hands: { ...state.hands, [side]: nextHand },
			});
		}

		case "move": {
			if (!isValidSquare(action.from) || !isValidSquare(action.to)) {
				return err(
					"INVALID_SQUARE",
					`Invalid square in setup move: ${String(action.from)} to ${String(action.to)}.`,
				);
			}
			const fromRole = draft[action.from];
			if (fromRole === undefined) {
				return err(
					"SQUARE_EMPTY",
					`No drafted officer on square ${action.from}.`,
				);
			}
			if (action.from === action.to) {
				return ok(state);
			}
			const toCheck = validatePlacementSquare(side, fromRole, action.to);
			if (!toCheck.ok) {
				return toCheck;
			}
			const toRole = draft[action.to];
			const nextDraftMutable: Partial<Record<Square, OfficerRole>> = {
				...draft,
			};
			if (toRole !== undefined) {
				const swapCheck = validatePlacementSquare(side, toRole, action.from);
				if (!swapCheck.ok) {
					return swapCheck;
				}
				nextDraftMutable[action.from] = toRole;
				nextDraftMutable[action.to] = fromRole;
			} else {
				delete nextDraftMutable[action.from];
				nextDraftMutable[action.to] = fromRole;
			}
			return ok({
				...state,
				setupDrafts: { ...state.setupDrafts, [side]: nextDraftMutable },
			});
		}

		case "remove": {
			if (!isValidSquare(action.from)) {
				return err(
					"INVALID_SQUARE",
					`Invalid square: "${String(action.from)}".`,
				);
			}
			const role = draft[action.from];
			if (role === undefined) {
				return err(
					"SQUARE_EMPTY",
					`No drafted officer on square ${action.from}.`,
				);
			}
			const nextDraftMutable: Partial<Record<Square, OfficerRole>> = {
				...draft,
			};
			delete nextDraftMutable[action.from];
			const nextHand: OfficerHand = {
				...hand,
				[role]: hand[role] + 1,
			};
			return ok({
				...state,
				setupDrafts: { ...state.setupDrafts, [side]: nextDraftMutable },
				hands: { ...state.hands, [side]: nextHand },
			});
		}

		case "apply_preset": {
			const placements = getPresetPlacements(action.presetId, side);
			if (!placements.ok) {
				return placements;
			}
			return ok({
				...state,
				setupDrafts: { ...state.setupDrafts, [side]: placements.value },
				hands: { ...state.hands, [side]: { ...EMPTY_OFFICER_HAND } },
			});
		}

		case "clear": {
			return ok({
				...state,
				setupDrafts: { ...state.setupDrafts, [side]: {} },
				hands: { ...state.hands, [side]: { ...INITIAL_OFFICER_HAND } },
			});
		}

		case "lock": {
			if (remainingHandTotal(hand) > 0) {
				return err(
					"SETUP_INCOMPLETE",
					`All 8 officers must be placed before locking in (${remainingHandTotal(hand)} remaining).`,
				);
			}
			const nextReady = { ...state.setupReady, [side]: true };
			if (nextReady.red && nextReady.black) {
				return ok(commitHiddenSetup(state, nextReady));
			}
			return ok({
				...state,
				setupReady: nextReady,
			});
		}
	}
}

export function autoCompleteSetup(
	state: GameState,
	side: Side,
	seed: string | number,
): Result<GameState, EngineError> {
	if (state.phase !== "setup") {
		return err(
			"INVALID_PHASE",
			"autoCompleteSetup is only valid during the setup phase.",
		);
	}
	if (state.rules.setupMode !== "hidden_simultaneous") {
		return err(
			"INVALID_SETUP_MODE",
			"autoCompleteSetup requires hidden_simultaneous setup mode.",
		);
	}
	if (state.setupReady[side]) {
		return err("SIDE_ALREADY_LOCKED", `${side} has already locked in setup.`);
	}

	const hand = state.hands[side];
	const nextDraftMutable: Partial<Record<Square, OfficerRole>> = {
		...state.setupDrafts[side],
	};
	const nextRandom = createPrng(seed);

	// 1. Place unplaced Rooks on available back rank squares first
	if (hand.rook > 0) {
		const freeBackRank = shuffleDeterministic(
			ROOK_SETUP_SQUARES[side].filter(
				(sq) => nextDraftMutable[sq] === undefined,
			),
			nextRandom,
		);
		for (let i = 0; i < hand.rook; i++) {
			const sq = freeBackRank[i];
			if (sq !== undefined) {
				nextDraftMutable[sq] = "rook";
			}
		}
	}

	// 2. Place remaining unplaced non-rook officers onto available legal setup squares
	const remainingRoles: OfficerRole[] = [];
	for (const role of OFFICER_ROLES) {
		if (role === "rook") {
			continue;
		}
		for (let i = 0; i < hand[role]; i++) {
			remainingRoles.push(role);
		}
	}

	if (remainingRoles.length > 0) {
		const freeOfficerSquares = shuffleDeterministic(
			OFFICER_SETUP_SQUARES[side].filter(
				(sq) => nextDraftMutable[sq] === undefined,
			),
			nextRandom,
		);
		for (let i = 0; i < remainingRoles.length; i++) {
			const sq = freeOfficerSquares[i];
			const role = remainingRoles[i];
			if (sq !== undefined && role !== undefined) {
				nextDraftMutable[sq] = role;
			}
		}
	}

	const filledState: GameState = {
		...state,
		setupDrafts: { ...state.setupDrafts, [side]: nextDraftMutable },
		hands: { ...state.hands, [side]: { ...EMPTY_OFFICER_HAND } },
	};

	return applySetupAction(filledState, side, { kind: "lock" });
}

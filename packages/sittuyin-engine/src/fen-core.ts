import { OFFICER_ROLES } from "./constants.js";
import type {
	Board,
	GameState,
	OfficerHand,
	OfficerRole,
	PieceRole,
	Side,
} from "./types.js";

export const ROLE_TO_FEN_UPPER: Readonly<Record<PieceRole, string>> = {
	king: "K",
	general: "F",
	rook: "R",
	elephant: "S",
	knight: "N",
	pawn: "P",
};

export const OFFICER_TO_FEN_UPPER: Readonly<Record<OfficerRole, string>> = {
	king: "K",
	general: "F",
	rook: "R",
	elephant: "S",
	knight: "N",
};

export function pieceToFenChar(side: Side, role: PieceRole): string {
	const upper = ROLE_TO_FEN_UPPER[role];
	return side === "red" ? upper : upper.toLowerCase();
}

export function encodeBoardFen(board: Board): string {
	const ranks: string[] = [];
	for (let rank = 7; rank >= 0; rank--) {
		let row = "";
		let emptyCount = 0;
		for (let file = 0; file < 8; file++) {
			const piece = board[rank * 8 + file];
			if (piece === null || piece === undefined) {
				emptyCount++;
			} else {
				if (emptyCount > 0) {
					row += String(emptyCount);
					emptyCount = 0;
				}
				row += pieceToFenChar(piece.side, piece.role);
			}
		}
		if (emptyCount > 0) {
			row += String(emptyCount);
		}
		ranks.push(row);
	}
	return ranks.join("/");
}

export function encodeHandFen(
	hands: Readonly<Record<Side, OfficerHand>>,
): string {
	let pocket = "";
	for (const role of OFFICER_ROLES) {
		const count = hands.red[role];
		if (count > 0) {
			pocket += OFFICER_TO_FEN_UPPER[role].repeat(count);
		}
	}
	for (const role of OFFICER_ROLES) {
		const count = hands.black[role];
		if (count > 0) {
			pocket += OFFICER_TO_FEN_UPPER[role].toLowerCase().repeat(count);
		}
	}
	return pocket.length > 0 ? `[${pocket}]` : "";
}

export function formatPositionKey(
	board: Board,
	hands: Readonly<Record<Side, OfficerHand>>,
	turn: Side,
): string {
	const sideChar = turn === "red" ? "w" : "b";
	return `${encodeBoardFen(board)}${encodeHandFen(hands)} ${sideChar}`;
}

export function formatFen(
	board: Board,
	hands: Readonly<Record<Side, OfficerHand>>,
	turn: Side,
	halfmoveClock: number,
	fullmoveNumber: number,
): string {
	return `${formatPositionKey(board, hands, turn)} - - ${halfmoveClock} ${fullmoveNumber}`;
}

function getUncommittedHands(
	state: GameState,
): Readonly<Record<Side, OfficerHand>> {
	const mergeSide = (side: Side): OfficerHand => {
		const hand = state.hands[side];
		const counts = {
			king: hand.king,
			general: hand.general,
			rook: hand.rook,
			elephant: hand.elephant,
			knight: hand.knight,
		};
		const draft = state.setupDrafts[side];
		for (const role of Object.values(draft)) {
			if (role !== undefined) {
				counts[role]++;
			}
		}
		return counts;
	};
	return {
		red: mergeSide("red"),
		black: mergeSide("black"),
	};
}

export function toFen(state: GameState): string {
	const handsToEmit =
		state.phase === "setup" && state.rules.setupMode === "hidden_simultaneous"
			? getUncommittedHands(state)
			: state.hands;
	return formatFen(
		state.board,
		handsToEmit,
		state.turn,
		state.halfmoveClock,
		state.fullmoveNumber,
	);
}

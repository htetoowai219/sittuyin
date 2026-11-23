import { OFFICER_TO_FEN_UPPER } from "./fen-core.js";
import { isValidSquare } from "./squares.js";
import {
	type EngineError,
	err,
	type Move,
	type OfficerRole,
	ok,
	type Result,
} from "./types.js";

const UCI_DROP_CHAR_TO_ROLE: ReadonlyMap<string, OfficerRole> = new Map([
	["K", "king"],
	["F", "general"],
	["R", "rook"],
	["S", "elephant"],
	["N", "knight"],
]);

export function toUci(move: Move): string {
	switch (move.kind) {
		case "drop":
			return `${OFFICER_TO_FEN_UPPER[move.role]}@${move.to}`;
		case "normal":
			return `${move.from}${move.to}`;
		case "promote":
			return `${move.from}${move.to}f`;
	}
}

export function parseUci(uci: string): Result<Move, EngineError> {
	if (typeof uci !== "string") {
		return err("INVALID_UCI", "UCI move must be a string.");
	}

	if (uci.length === 4 && uci[1] === "@") {
		const role = UCI_DROP_CHAR_TO_ROLE.get(uci[0] ?? "");
		const to = uci.slice(2);
		if (role === undefined || !isValidSquare(to)) {
			return err("INVALID_UCI", `Invalid UCI drop notation: "${uci}".`, {
				uci,
			});
		}
		return ok({ kind: "drop", role, to });
	}

	if (uci.length === 4) {
		const from = uci.slice(0, 2);
		const to = uci.slice(2, 4);
		if (!isValidSquare(from) || !isValidSquare(to) || from === to) {
			return err("INVALID_UCI", `Invalid UCI move notation: "${uci}".`, {
				uci,
			});
		}
		return ok({ kind: "normal", from, to });
	}

	if (uci.length === 5) {
		const from = uci.slice(0, 2);
		const to = uci.slice(2, 4);
		const promo = uci[4];
		if (!isValidSquare(from) || !isValidSquare(to) || promo !== "f") {
			return err("INVALID_UCI", `Invalid UCI promotion notation: "${uci}".`, {
				uci,
			});
		}
		return ok({ kind: "promote", from, to, promoteTo: "general" });
	}

	return err("INVALID_UCI", `Invalid UCI notation: "${uci}".`, { uci });
}

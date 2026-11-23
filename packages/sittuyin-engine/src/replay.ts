import { fromFen } from "./fen.js";
import { applyUci } from "./rules.js";
import {
	type EngineError,
	err,
	type GameState,
	ok,
	type Result,
	type RulesConfig,
} from "./types.js";

export function replayMatch(
	initialSetupFen: string,
	uciMoves: readonly string[],
	rules?: Partial<RulesConfig>,
): Result<readonly GameState[], EngineError> {
	const initial = fromFen(
		initialSetupFen,
		rules !== undefined ? { rules } : undefined,
	);
	if (!initial.ok) {
		return initial;
	}

	const snapshots: GameState[] = [initial.value];
	let current = initial.value;

	for (let i = 0; i < uciMoves.length; i++) {
		const uci = uciMoves[i];
		const ply = i + 1;
		if (uci === undefined) {
			return err("REPLAY_MOVE_FAILED", `Missing UCI move at ply ${ply}.`, {
				ply,
				causeCode: "INVALID_UCI",
			});
		}
		const next = applyUci(current, uci);
		if (!next.ok) {
			return err(
				"REPLAY_MOVE_FAILED",
				`Replay failed at ply ${ply} ("${uci}"): ${next.error.message}`,
				{
					ply,
					uci,
					causeCode: next.error.code,
				},
			);
		}
		current = next.value;
		snapshots.push(current);
	}

	return ok(snapshots);
}

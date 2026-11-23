import { INITIAL_OFFICER_HAND, remainingHandTotal } from "./constants.js";
import type {
	GameState,
	OfficerHand,
	PlayerGameView,
	SetupPlacements,
	Side,
	Viewer,
} from "./types.js";

export function toPlayerView(state: GameState, viewer: Viewer): PlayerGameView {
	const { setupDrafts, ...rest } = state;
	const placedCounts: Readonly<Record<Side, number>> = {
		red: 8 - remainingHandTotal(state.hands.red),
		black: 8 - remainingHandTotal(state.hands.black),
	};

	const isHiddenSetup =
		state.phase === "setup" && state.rules.setupMode === "hidden_simultaneous";

	const myDraft: SetupPlacements =
		viewer === "spectator" ? {} : { ...setupDrafts[viewer] };

	let maskedHands: Readonly<Record<Side, OfficerHand>>;
	if (!isHiddenSetup) {
		maskedHands = {
			red: { ...state.hands.red },
			black: { ...state.hands.black },
		};
	} else if (viewer === "red") {
		maskedHands = {
			red: { ...state.hands.red },
			black: { ...INITIAL_OFFICER_HAND },
		};
	} else if (viewer === "black") {
		maskedHands = {
			red: { ...INITIAL_OFFICER_HAND },
			black: { ...state.hands.black },
		};
	} else {
		maskedHands = {
			red: { ...INITIAL_OFFICER_HAND },
			black: { ...INITIAL_OFFICER_HAND },
		};
	}

	return {
		...rest,
		hands: maskedHands,
		viewer,
		myDraft,
		placedCounts,
	};
}

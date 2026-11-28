import { type Schema, type SchemaType, schema, t } from "@colyseus/schema";
import {
	type GameState,
	type OfficerHand,
	type SetupPlacements,
	STARTING_SETUP_FEN,
	toFen,
	toPlayerView,
} from "@sittuyin/engine";

export const SittuyinHandCounts = schema(
	{
		king: t.uint8().default(1),
		general: t.uint8().default(1),
		rook: t.uint8().default(2),
		elephant: t.uint8().default(2),
		knight: t.uint8().default(2),
	},
	"SittuyinHandCounts",
);
export type SittuyinHandCounts = SchemaType<typeof SittuyinHandCounts>;

export const SittuyinPrivateSetup = schema(
	{
		myDraft: t.map("string"),
		hand: SittuyinHandCounts,
	},
	"SittuyinPrivateSetup",
);
export type SittuyinPrivateSetup = SchemaType<typeof SittuyinPrivateSetup>;

export const SittuyinClockState = schema(
	{
		redRemainingMs: t.int32().default(900_000),
		blackRemainingMs: t.int32().default(900_000),
		incrementMs: t.int32().default(10_000),
		setupRemainingMs: t.int32().default(60_000),
		activeSide: t.string().default(""),
		running: t.boolean().default(false),
		syncedAtMs: t.float64().default(0),
	},
	"SittuyinClockState",
);
export type SittuyinClockState = SchemaType<typeof SittuyinClockState>;

export const SittuyinPlayer = schema(
	{
		sessionId: t.string().default(""),
		userId: t.string().default(""),
		displayName: t.string().default(""),
		rating: t.float32().default(1500),
		isProvisional: t.boolean().default(true),
		isAnonymous: t.boolean().default(true),
		side: t.string().default("spectator"),
		connected: t.boolean().default(true),
		rematchAccepted: t.boolean().default(false),
	},
	"SittuyinPlayer",
);
export type SittuyinPlayer = SchemaType<typeof SittuyinPlayer>;

export const SittuyinRoomState = schema(
	{
		matchId: t.string().default(""),
		phase: t.string().default("waiting"),
		roomMode: t.string().default("public_lobby"),
		isRated: t.boolean().default(false),
		roomTitle: t.string().default(""),
		inviteCode: t.string().default(""),
		hostSessionId: t.string().default(""),
		hostPreferredSide: t.string().default("random"),
		timeControl: t.string().default("rapid_15_10"),
		turn: t.string().default("red"),
		currentFen: t.string().default(STARTING_SETUP_FEN),
		initialSetupFen: t.string().default(""),
		redPlacedCount: t.uint8().default(0),
		blackPlacedCount: t.uint8().default(0),
		redSetupReady: t.boolean().default(false),
		blackSetupReady: t.boolean().default(false),
		halfmoveClock: t.uint16().default(0),
		bareKingClock: t.int16().default(-1),
		fullmoveNumber: t.uint16().default(1),
		movesUci: t.array("string"),
		drawOfferedBy: t.string().default(""),
		rematchOfferedBy: t.string().default(""),
		outcomeStatus: t.string().default(""),
		outcomeWinner: t.string().default(""),
		outcomeReason: t.string().default(""),
		players: t.map(SittuyinPlayer),
		clock: SittuyinClockState,
		redPrivate: t.ref(SittuyinPrivateSetup).view(),
		blackPrivate: t.ref(SittuyinPrivateSetup).view(),
	},
	"SittuyinRoomState",
);
export type SittuyinRoomState = SchemaType<typeof SittuyinRoomState>;

export function getSchemaFieldCount(schemaClass: {
	new (...args: never[]): Schema;
	prototype: object;
}): number {
	const metadataSym =
		Symbol.metadata ?? Object.getOwnPropertySymbols(schemaClass)[0];
	if (metadataSym) {
		const meta = (schemaClass as unknown as Record<symbol, unknown>)[
			metadataSym
		] as Record<string, unknown> | undefined;
		if (meta) {
			return Object.keys(meta).filter((key) => /^\d+$/.test(key)).length;
		}
	}
	return Object.getOwnPropertyNames(schemaClass.prototype).filter(
		(key) => key !== "constructor",
	).length;
}

function syncPrivateSlice(
	target: SittuyinPrivateSetup,
	myDraft: SetupPlacements,
	hand: OfficerHand,
): void {
	const existingSquares = Array.from(target.myDraft.keys());
	for (const sq of existingSquares) {
		if (!(sq in myDraft)) {
			target.myDraft.delete(sq);
		}
	}

	for (const [sq, role] of Object.entries(myDraft)) {
		if (role && target.myDraft.get(sq) !== role) {
			target.myDraft.set(sq, role);
		}
	}

	target.hand.king = hand.king;
	target.hand.general = hand.general;
	target.hand.rook = hand.rook;
	target.hand.elephant = hand.elephant;
	target.hand.knight = hand.knight;
}

export function syncSchemaFromEngine(
	state: SittuyinRoomState,
	engineState: GameState,
): void {
	const specView = toPlayerView(engineState, "spectator");
	const redView = toPlayerView(engineState, "red");
	const blackView = toPlayerView(engineState, "black");

	state.turn = specView.turn;
	state.currentFen = toFen(engineState);
	state.initialSetupFen = specView.initialSetupFen ?? "";
	state.redPlacedCount = specView.placedCounts.red;
	state.blackPlacedCount = specView.placedCounts.black;
	state.redSetupReady = specView.setupReady.red;
	state.blackSetupReady = specView.setupReady.black;
	state.halfmoveClock = specView.halfmoveClock;
	state.bareKingClock = specView.bareKingClock ?? -1;
	state.fullmoveNumber = specView.fullmoveNumber;

	syncPrivateSlice(state.redPrivate, redView.myDraft, redView.hands.red);
	syncPrivateSlice(
		state.blackPrivate,
		blackView.myDraft,
		blackView.hands.black,
	);
}

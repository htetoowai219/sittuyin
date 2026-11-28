import {
	applySetupAction,
	createGame,
	OPENING_PRESETS,
	STARTING_SETUP_FEN,
	toFen,
} from "@sittuyin/engine";
import type { RoomActionError } from "@sittuyin/shared";
import { describe, expect, it } from "vitest";
import {
	clearPendingRoomHandoff,
	consumePendingRoomHandoff,
	setPendingRoomHandoff,
} from "@/lib/colyseus/client";
import {
	clearStoredRoomReconnection,
	getStoredRoomReconnection,
	RECONNECT_TTL_MS,
	type StorageLike,
	saveStoredRoomReconnection,
} from "@/lib/colyseus/reconnect-store";
import {
	ColyseusMatchController,
	type ColyseusRoomLike,
} from "./colyseus-match-adapter";

function createMemoryStorage(): StorageLike {
	const map = new Map<string, string>();
	return {
		getItem(key) {
			return map.get(key) ?? null;
		},
		setItem(key, value) {
			map.set(key, value);
		},
		removeItem(key) {
			map.delete(key);
		},
	};
}

class MockColyseusRoom implements ColyseusRoomLike {
	readonly roomId: string;
	readonly sessionId: string;
	readonly reconnectionToken: string;
	state: Record<string, unknown>;

	readonly sentMessages: Array<{ type: string; payload: unknown }> = [];
	leftConsented: boolean | null = null;

	private readonly stateListeners: Array<(state: unknown) => void> = [];
	private readonly messageListeners = new Map<
		string,
		Array<(payload: unknown) => void>
	>();
	private readonly dropListeners: Array<(code?: number) => void> = [];
	private readonly reconnectListeners: Array<() => void> = [];
	private readonly leaveListeners: Array<(code: number) => void> = [];

	constructor(options: {
		roomId?: string;
		sessionId?: string;
		reconnectionToken?: string;
		state: Record<string, unknown>;
	}) {
		this.roomId = options.roomId ?? "ROOM01";
		this.sessionId = options.sessionId ?? "sess_red";
		this.reconnectionToken =
			options.reconnectionToken ?? `${this.roomId}:token_123`;
		this.state = options.state;
	}

	send(type: string, message?: unknown): void {
		this.sentMessages.push({ type, payload: message });
	}

	leave(consented = true): void {
		this.leftConsented = consented;
	}

	onStateChange(callback: (state: unknown) => void): void {
		this.stateListeners.push(callback);
	}

	onMessage(type: string, callback: (payload: unknown) => void): void {
		const list = this.messageListeners.get(type) ?? [];
		list.push(callback);
		this.messageListeners.set(type, list);
	}

	onDrop(callback: (code?: number) => void): void {
		this.dropListeners.push(callback);
	}

	onReconnect(callback: () => void): void {
		this.reconnectListeners.push(callback);
	}

	onLeave(callback: (code: number) => void): void {
		this.leaveListeners.push(callback);
	}

	emitStateChange(nextState: Record<string, unknown>): void {
		this.state = nextState;
		for (const cb of this.stateListeners) {
			cb(this.state);
		}
	}

	emitServerMessage(type: string, payload: unknown): void {
		const list = this.messageListeners.get(type) ?? [];
		for (const cb of list) {
			cb(payload);
		}
	}

	emitDrop(code?: number): void {
		for (const cb of this.dropListeners) {
			cb(code);
		}
	}

	emitReconnect(): void {
		for (const cb of this.reconnectListeners) {
			cb();
		}
	}

	emitLeave(code: number): void {
		for (const cb of this.leaveListeners) {
			cb(code);
		}
	}
}

function createSampleSetupRoomState(): Record<string, unknown> {
	return {
		matchId: "match-001",
		phase: "setup",
		roomMode: "private_room",
		roomTitle: "Mandalay Match",
		inviteCode: "K9M4P2",
		hostSessionId: "sess_red",
		hostPreferredSide: "red",
		timeControl: "rapid_10_5",
		turn: "red",
		currentFen: STARTING_SETUP_FEN,
		initialSetupFen: "",
		redPlacedCount: 0,
		blackPlacedCount: 3,
		redSetupReady: false,
		blackSetupReady: false,
		halfmoveClock: 0,
		bareKingClock: -1,
		fullmoveNumber: 1,
		movesUci: [],
		drawOfferedBy: "",
		rematchOfferedBy: "",
		outcomeStatus: "",
		outcomeWinner: "",
		outcomeReason: "",
		players: {
			sess_red: {
				sessionId: "sess_red",
				userId: "guest_111",
				displayName: "Aung",
				rating: 1500,
				isAnonymous: true,
				side: "red",
				connected: true,
				rematchAccepted: false,
			},
			sess_black: {
				sessionId: "sess_black",
				userId: "guest_222",
				displayName: "Kyaw",
				rating: 1520,
				isAnonymous: true,
				side: "black",
				connected: true,
				rematchAccepted: false,
			},
			sess_spec: {
				sessionId: "sess_spec",
				userId: "guest_333",
				displayName: "Watcher",
				rating: 1500,
				isAnonymous: true,
				side: "spectator",
				connected: true,
				rematchAccepted: false,
			},
		},
		clock: {
			redRemainingMs: 600_000,
			blackRemainingMs: 600_000,
			incrementMs: 5_000,
			setupRemainingMs: 60_000,
			activeSide: "",
			running: false,
			syncedAtMs: 1_000_000,
		},
		redPrivate: {
			myDraft: {},
			hand: {
				king: 1,
				general: 1,
				rook: 2,
				elephant: 2,
				knight: 2,
			},
		},
	};
}

function createSamplePlayingFen(): string {
	const presetId = OPENING_PRESETS[0]?.id ?? "myinzines";
	let state = createGame();
	const redApplied = applySetupAction(state, "red", {
		kind: "apply_preset",
		presetId,
	});
	if (!redApplied.ok) throw new Error("Failed red preset");
	state = redApplied.value;

	const redLocked = applySetupAction(state, "red", { kind: "lock" });
	if (!redLocked.ok) throw new Error("Failed red lock");
	state = redLocked.value;

	const blackApplied = applySetupAction(state, "black", {
		kind: "apply_preset",
		presetId,
	});
	if (!blackApplied.ok) throw new Error("Failed black preset");
	state = blackApplied.value;

	const blackLocked = applySetupAction(state, "black", { kind: "lock" });
	if (!blackLocked.ok) throw new Error("Failed black lock");
	return toFen(blackLocked.value);
}

describe("pendingRoomHandoff and StoredRoomReconnection (AC-3, AC-4)", () => {
	it("hands off an active Room by roomId or 6-char inviteCode and clears on consume", () => {
		clearPendingRoomHandoff();
		const fakeRoom = new MockColyseusRoom({
			roomId: "K9M4P2",
			state: { inviteCode: "K9M4P2" },
		});

		setPendingRoomHandoff({
			room: fakeRoom as unknown as Parameters<
				typeof setPendingRoomHandoff
			>[0]["room"],
			inviteCode: "K9M4P2",
			nowMs: 10_000,
		});

		const consumed = consumePendingRoomHandoff("k9m4p2", 15_000);
		expect(consumed).toBe(fakeRoom);
		expect(consumePendingRoomHandoff("k9m4p2", 15_001)).toBeNull();
	});

	it("stores, reads, expires after 65s, and clears StoredRoomReconnection tokens", () => {
		const storage = createMemoryStorage();
		saveStoredRoomReconnection(
			{
				roomId: "ROOM99",
				inviteCode: "ABCDEF",
				reconnectionToken: "ROOM99:reconnect_abc",
				userId: "guest_111",
			},
			{ storage, nowMs: 1_000 },
		);

		const byId = getStoredRoomReconnection("room99", "guest_111", {
			storage,
			nowMs: 20_000,
		});
		expect(byId?.reconnectionToken).toBe("ROOM99:reconnect_abc");

		const byInvite = getStoredRoomReconnection("abcdef", "guest_111", {
			storage,
			nowMs: 20_000,
		});
		expect(byInvite?.reconnectionToken).toBe("ROOM99:reconnect_abc");

		// Wrong user cannot read token
		expect(
			getStoredRoomReconnection("ROOM99", "guest_other", {
				storage,
				nowMs: 20_000,
			}),
		).toBeNull();

		// Expired after 65s
		expect(
			getStoredRoomReconnection("ROOM99", "guest_111", {
				storage,
				nowMs: 1_000 + RECONNECT_TTL_MS + 1,
			}),
		).toBeNull();

		// Explicit clear
		saveStoredRoomReconnection(
			{
				roomId: "ROOM77",
				reconnectionToken: "ROOM77:tok",
				userId: "guest_111",
			},
			{ storage, nowMs: 2_000 },
		);
		clearStoredRoomReconnection("ROOM77", { storage, nowMs: 2_500 });
		expect(
			getStoredRoomReconnection("ROOM77", "guest_111", {
				storage,
				nowMs: 2_500,
			}),
		).toBeNull();
	});
});

describe("ColyseusMatchController (AC-6, AC-7, AC-8, AC-9, AC-10, AC-11)", () => {
	it("validates setup actions locally, applies optimistic preview, and rolls back on action_error", () => {
		const storage = createMemoryStorage();
		const room = new MockColyseusRoom({
			roomId: "K9M4P2",
			sessionId: "sess_red",
			state: createSampleSetupRoomState(),
		});
		const errors: RoomActionError[] = [];

		const controller = new ColyseusMatchController({
			room,
			locale: "en",
			userId: "guest_111",
			storage,
			autoStartTimer: false,
			onActionError: (err) => errors.push(err),
		});

		// Illegal back-rank Rook violation on a2 is rejected locally with zero network round trip
		const illegalRook = controller.dispatchSetup({
			kind: "place",
			role: "rook",
			to: "a2",
		});
		expect(illegalRook.ok).toBe(false);
		if (!illegalRook.ok) {
			expect(illegalRook.error.code).toBe("ROOK_MUST_BE_BACK_RANK");
		}
		expect(room.sentMessages).toHaveLength(0);

		// Legal Rook placement on a1 applies optimistic preview immediately and sends setup_action
		const legalRook = controller.dispatchSetup({
			kind: "place",
			role: "rook",
			to: "a1",
		});
		expect(legalRook.ok).toBe(true);
		expect(room.sentMessages).toHaveLength(1);
		expect(room.sentMessages[0]?.type).toBe("setup_action");
		expect(controller.getAdapterState().view.myDraft.a1).toBe("rook");
		expect(controller.getAdapterState().view.placedCounts.red).toBe(1);
		// Opponent placedCount is preserved
		expect(controller.getAdapterState().view.placedCounts.black).toBe(3);

		// Simulated server action_error rolls back optimistic preview to last authoritative snapshot
		room.emitServerMessage("action_error", {
			action: "setup_action",
			code: "INVALID_PHASE",
			message: "Setup timer expired on server.",
		});

		expect(errors).toHaveLength(1);
		expect(errors[0]?.code).toBe("INVALID_PHASE");
		expect(controller.getAdapterState().view.myDraft.a1).toBeUndefined();
		expect(controller.getAdapterState().view.placedCounts.red).toBe(0);
	});

	it("interpolates 60s setup timer and Fischer clocks monotonically using performance.now()", () => {
		let perfMs = 5_000;
		const room = new MockColyseusRoom({
			roomId: "K9M4P2",
			sessionId: "sess_red",
			state: createSampleSetupRoomState(),
		});

		const controller = new ColyseusMatchController({
			room,
			locale: "en",
			nowPerf: () => perfMs,
			autoStartTimer: false,
		});

		expect(controller.getAdapterState().online?.setupRemainingMs).toBe(60_000);

		// Advance monotonic perf clock by 3.4 seconds
		perfMs += 3_400;
		controller.tickClocks();
		expect(controller.getAdapterState().online?.setupRemainingMs).toBe(56_600);

		// Transition to playing phase with skewed wall clock (syncedAtMs far in the future)
		const initialSetupFen = createSamplePlayingFen();
		room.emitStateChange({
			...room.state,
			phase: "playing",
			currentFen: initialSetupFen,
			initialSetupFen,
			clock: {
				redRemainingMs: 600_000,
				blackRemainingMs: 600_000,
				incrementMs: 5_000,
				setupRemainingMs: 0,
				activeSide: "red",
				running: true,
				syncedAtMs: 9_999_999_999_999,
			},
		});

		expect(controller.getAdapterState().clock?.remainingMs.red).toBe(600_000);

		// Tick 2.5 seconds on Red's clock
		perfMs += 2_500;
		controller.tickClocks();
		expect(controller.getAdapterState().clock?.remainingMs.red).toBe(597_500);
		expect(controller.getAdapterState().clock?.remainingMs.black).toBe(600_000);
	});

	it("isolates spectators in read-only mode with zero draft coordinates and live spectatorCount", () => {
		const state = createSampleSetupRoomState();
		const room = new MockColyseusRoom({
			roomId: "K9M4P2",
			sessionId: "sess_spec",
			state,
		});

		const controller = new ColyseusMatchController({
			room,
			locale: "en",
			autoStartTimer: false,
		});

		const adapter = controller.getAdapterState();
		expect(adapter.view.viewer).toBe("spectator");
		expect(adapter.isInteractive).toBe(false);
		expect(adapter.online?.spectatorCount).toBe(1);
		expect(adapter.view.myDraft).toEqual({});
		expect(adapter.view.placedCounts.black).toBe(3);

		const res = adapter.dispatchSetup({
			kind: "place",
			role: "rook",
			to: "a1",
		});
		expect("ok" in res && res.ok).toBe(false);
		expect(room.sentMessages).toHaveLength(0);
	});

	it("supports draw offers, pre-move abort, and rematch seat swap", () => {
		const initialSetupFen = createSamplePlayingFen();
		const baseState = {
			...createSampleSetupRoomState(),
			phase: "playing",
			currentFen: initialSetupFen,
			initialSetupFen,
			movesUci: ["a3a4"], // 1 ply (< 2), so canAbort is true
		};

		const room = new MockColyseusRoom({
			roomId: "K9M4P2",
			sessionId: "sess_red",
			state: baseState,
		});

		const controller = new ColyseusMatchController({
			room,
			locale: "en",
			autoStartTimer: false,
		});

		expect(controller.getAdapterState().online?.canAbort).toBe(true);
		controller.requestDraw();
		expect(room.sentMessages.at(-1)).toEqual({
			type: "offer_draw",
			payload: {},
		});

		// Simulate finished match by agreed_draw and rematch offer from black
		room.emitStateChange({
			...baseState,
			phase: "finished",
			outcomeStatus: "draw",
			outcomeWinner: "",
			outcomeReason: "agreed_draw",
			rematchOfferedBy: "black",
		});

		expect(controller.getAdapterState().outcome).toEqual({
			status: "draw",
			winner: null,
			reason: "agreed_draw",
		});
		expect(controller.getAdapterState().online?.rematchOfferedBy).toBe("black");

		controller.respondRematch(true);
		expect(room.sentMessages.at(-1)).toEqual({
			type: "respond_rematch",
			payload: { accept: true },
		});

		// Simulate rematch_started swapping Red and Black seats
		room.emitStateChange({
			...createSampleSetupRoomState(),
			matchId: "match-002",
			phase: "setup",
			outcomeStatus: "",
			outcomeWinner: "",
			outcomeReason: "",
			rematchOfferedBy: "",
			players: {
				sess_red: {
					sessionId: "sess_red",
					userId: "guest_111",
					displayName: "Aung",
					rating: 1500,
					isAnonymous: true,
					side: "black",
					connected: true,
					rematchAccepted: false,
				},
				sess_black: {
					sessionId: "sess_black",
					userId: "guest_222",
					displayName: "Kyaw",
					rating: 1520,
					isAnonymous: true,
					side: "red",
					connected: true,
					rematchAccepted: false,
				},
			},
		});
		room.emitServerMessage("rematch_started", {
			matchId: "match-002",
			redSessionId: "sess_black",
			blackSessionId: "sess_red",
		});

		const afterRematch = controller.getAdapterState();
		expect(afterRematch.online?.roomPhase).toBe("setup");
		expect(afterRematch.outcome).toBeNull();
		expect(afterRematch.view.viewer).toBe("black");
	});
});

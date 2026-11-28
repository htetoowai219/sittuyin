// @vitest-environment jsdom

import {
	applySetupAction,
	createGame,
	OPENING_PRESETS,
	STARTING_SETUP_FEN,
	toFen,
} from "@sittuyin/engine";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColyseusRoomLike } from "@/lib/adapters/colyseus-match-adapter";
import {
	clearPendingRoomHandoff,
	setPendingRoomHandoff,
} from "@/lib/colyseus/client";
import type { LobbyRoomEntry } from "@/lib/colyseus/lobby-client";
import {
	type StorageLike,
	saveStoredRoomReconnection,
} from "@/lib/colyseus/reconnect-store";
import { OnlineLobbyView } from "@/routes/$locale/online";
import {
	connectOrReconnectOnlineRoom,
	OnlineRoomView,
} from "@/routes/$locale/room.$roomId";

afterEach(() => {
	cleanup();
	clearPendingRoomHandoff();
});

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

class FakeOnlineRoom implements ColyseusRoomLike {
	readonly roomId: string;
	readonly sessionId: string;
	readonly reconnectionToken: string;
	state: Record<string, unknown>;
	readonly sent: Array<{ type: string; payload: unknown }> = [];

	private readonly stateCallbacks: Array<(s: unknown) => void> = [];
	private readonly messageCallbacks = new Map<
		string,
		Array<(p: unknown) => void>
	>();
	private readonly leaveCallbacks: Array<(code: number) => void> = [];

	constructor(options: {
		roomId?: string;
		sessionId?: string;
		state: Record<string, unknown>;
	}) {
		this.roomId = options.roomId ?? "K9M4P2";
		this.sessionId = options.sessionId ?? "sess_host";
		this.reconnectionToken = `${this.roomId}:tok_1`;
		this.state = options.state;
	}

	send(type: string, message?: unknown): void {
		this.sent.push({ type, payload: message });
	}

	leave(): void {}

	onStateChange(cb: (state: unknown) => void): void {
		this.stateCallbacks.push(cb);
	}

	onMessage(type: string, cb: (payload: unknown) => void): void {
		const list = this.messageCallbacks.get(type) ?? [];
		list.push(cb);
		this.messageCallbacks.set(type, list);
	}

	onLeave(cb: (code: number) => void): void {
		this.leaveCallbacks.push(cb);
	}

	pushState(next: Record<string, unknown>): void {
		this.state = next;
		for (const cb of this.stateCallbacks) {
			cb(this.state);
		}
	}

	pushLeave(code: number): void {
		for (const cb of this.leaveCallbacks) {
			cb(code);
		}
	}
}

function createPlayingFen(): string {
	const presetId = OPENING_PRESETS[0]?.id ?? "myin_cha";
	let state = createGame();
	const r1 = applySetupAction(state, "red", {
		kind: "apply_preset",
		presetId,
	});
	if (r1.ok) state = r1.value;
	const r2 = applySetupAction(state, "red", { kind: "lock" });
	if (r2.ok) state = r2.value;
	const b1 = applySetupAction(state, "black", {
		kind: "apply_preset",
		presetId,
	});
	if (b1.ok) state = b1.value;
	const b2 = applySetupAction(state, "black", { kind: "lock" });
	if (b2.ok) state = b2.value;
	return toFen(state);
}

const sampleLobbyRooms: readonly LobbyRoomEntry[] = [
	{
		roomId: "CHALLENGE_1",
		clients: 1,
		maxClients: 18,
		metadata: {
			roomTitle: "Yangon Rapid Challenge",
			roomMode: "public_lobby",
			isRated: true,
			timeControl: "rapid_10_5",
			phase: "waiting",
			hostDisplayName: "Aung",
			hostRating: 1500,
			hostIsProvisional: true,
			hostPreferredSide: "red",
			hostAssignedSide: "red",
			playerCount: 1,
			spectatorCount: 0,
		},
	},
	{
		roomId: "LIVE_1",
		clients: 5,
		maxClients: 18,
		metadata: {
			roomTitle: "Mandalay Championship",
			roomMode: "public_lobby",
			isRated: false,
			timeControl: "classical_30_0",
			phase: "playing",
			hostDisplayName: "Kyaw",
			hostRating: 1620,
			hostIsProvisional: false,
			hostPreferredSide: "black",
			hostAssignedSide: "black",
			playerCount: 2,
			spectatorCount: 3,
		},
	},
];

describe("OnlineLobbyView and CreateRoomDialog (AC-2, AC-3, AC-13)", () => {
	it("renders Open Challenges, Live Matches with spectator count, time control filters, and 6-char invite code join", () => {
		const navigated: Array<{ roomId: string; role?: string }> = [];

		render(
			<OnlineLobbyView
				locale="en"
				autoConnect={false}
				initialGuest={{
					sub: "guest_11111111-1111-1111-1111-111111111111",
					displayName: "Guest_1111",
					rating: 1500,
					isAnonymous: true,
					issuedAt: 1_000,
				}}
				initialRooms={sampleLobbyRooms}
				onNavigateToRoom={(roomId, role) => navigated.push({ roomId, role })}
			/>,
		);

		expect(screen.getByTestId("open-challenge-card-CHALLENGE_1")).toBeDefined();
		expect(screen.getByTestId("live-match-card-LIVE_1")).toBeDefined();
		expect(screen.getByTestId("spectator-count-LIVE_1").textContent).toContain(
			"3 watching",
		);

		// Filter to classical_30_0 hides rapid_10_5 open challenge
		fireEvent.click(screen.getByTestId("filter-tc-classical_30_0"));
		expect(screen.queryByTestId("open-challenge-card-CHALLENGE_1")).toBeNull();
		expect(screen.getByTestId("live-match-card-LIVE_1")).toBeDefined();

		// Switch back to all and join challenge
		fireEvent.click(screen.getByTestId("filter-tc-all"));
		fireEvent.click(screen.getByTestId("join-challenge-btn-CHALLENGE_1"));
		expect(navigated.at(-1)).toEqual({
			roomId: "CHALLENGE_1",
			role: "player",
		});

		// Watch live match as spectator
		fireEvent.click(screen.getByTestId("watch-live-btn-LIVE_1"));
		expect(navigated.at(-1)).toEqual({
			roomId: "LIVE_1",
			role: "spectator",
		});

		// Enter 6-character invite code and submit
		const codeInput = screen.getByTestId(
			"invite-code-input",
		) as HTMLInputElement;
		fireEvent.change(codeInput, { target: { value: "k9m4p2" } });
		expect(codeInput.value).toBe("K9M4P2");
		fireEvent.click(screen.getByTestId("invite-code-join-btn"));
		expect(navigated.at(-1)).toEqual({
			roomId: "K9M4P2",
			role: "player",
		});
	});
});

describe("connectOrReconnectOnlineRoom state machine (AC-4, AC-12)", () => {
	it("consumes pendingRoomHandoff first, then attempts stored reconnectionToken before falling back to joinById", async () => {
		const storage = createMemoryStorage();
		const fakeRoom = new FakeOnlineRoom({
			roomId: "K9M4P2",
			state: { phase: "waiting", inviteCode: "K9M4P2" },
		});

		// 1. Handoff path
		setPendingRoomHandoff({
			room: fakeRoom as unknown as Parameters<
				typeof setPendingRoomHandoff
			>[0]["room"],
			inviteCode: "K9M4P2",
		});

		const handoffOutcome = await connectOrReconnectOnlineRoom({
			roomId: "K9M4P2",
			roleIntent: "player",
			storage,
		});
		expect(handoffOutcome.status).toBe("connected");

		// 2. Stored reconnectionToken fails -> falls back to mintJoinTicket + joinById
		saveStoredRoomReconnection(
			{
				roomId: "K9M4P2",
				reconnectionToken: "K9M4P2:stale_token",
				userId: "guest_11111111-1111-1111-1111-111111111111",
			},
			{ storage, nowMs: 10_000 },
		);

		const reconnectSpy = vi
			.fn()
			.mockRejectedValueOnce(new Error("Token expired"));
		const joinByIdSpy = vi.fn().mockResolvedValueOnce(fakeRoom);

		const fallbackOutcome = await connectOrReconnectOnlineRoom({
			roomId: "K9M4P2",
			roleIntent: "player",
			storage,
			nowMs: 20_000,
			getGuestSession: async () => ({
				sub: "guest_11111111-1111-1111-1111-111111111111",
				displayName: "Guest_1111",
				rating: 1500,
				isAnonymous: true,
				issuedAt: 10,
			}),
			mintJoinTicket: async () => ({
				token: "jwt_token",
				guest: {
					sub: "guest_11111111-1111-1111-1111-111111111111",
					displayName: "Guest_1111",
					rating: 1500,
					isAnonymous: true,
					issuedAt: 10,
				},
				expiresAtMs: 80_000,
				serverUrl: "http://localhost:2567",
			}),
			createClient: () => ({
				reconnect: reconnectSpy,
				joinById: joinByIdSpy,
			}),
		});

		expect(reconnectSpy).toHaveBeenCalledWith("K9M4P2:stale_token");
		expect(joinByIdSpy).toHaveBeenCalledWith("K9M4P2");
		expect(fallbackOutcome.status).toBe("connected");
	});
});

describe("OnlineRoomView waiting overlay, setup timer, draw/rematch, spectator, and recovery cards (AC-5, AC-8, AC-10, AC-11, AC-12, AC-13)", () => {
	it("renders WaitingRoomOverlay during waiting phase and transitions through setup countdown, draw offer, and rematch", () => {
		const room = new FakeOnlineRoom({
			roomId: "K9M4P2",
			sessionId: "sess_host",
			state: {
				matchId: "m-1",
				phase: "waiting",
				roomMode: "private_room",
				roomTitle: "Bagan Private Invite",
				inviteCode: "K9M4P2",
				hostSessionId: "sess_host",
				hostPreferredSide: "red",
				timeControl: "rapid_10_5",
				turn: "red",
				currentFen: STARTING_SETUP_FEN,
				players: {
					sess_host: {
						sessionId: "sess_host",
						userId: "guest_1",
						displayName: "HostAung",
						rating: 1500,
						side: "red",
						connected: true,
					},
				},
				clock: {
					redRemainingMs: 600_000,
					blackRemainingMs: 600_000,
					incrementMs: 5_000,
					setupRemainingMs: 60_000,
					activeSide: "",
					running: false,
					syncedAtMs: 1_000,
				},
			},
		});

		let returnedToLobby = false;
		render(
			<OnlineRoomView
				roomId="K9M4P2"
				locale="en"
				initialRoom={room}
				onReturnToLobby={() => {
					returnedToLobby = true;
				}}
			/>,
		);

		// WaitingRoomOverlay is visible with 6-character invite code
		expect(screen.getByTestId("waiting-room-overlay")).toBeDefined();
		expect(screen.getByTestId("waiting-invite-code").textContent).toBe(
			"K9M4P2",
		);

		// Second player joins -> transition to setup phase with 60s countdown
		act(() => {
			room.pushState({
				...room.state,
				phase: "setup",
				players: {
					...(room.state.players as Record<string, unknown>),
					sess_guest: {
						sessionId: "sess_guest",
						userId: "guest_2",
						displayName: "GuestKyaw",
						rating: 1500,
						side: "black",
						connected: true,
					},
				},
			});
		});

		expect(screen.queryByTestId("waiting-room-overlay")).toBeNull();
		expect(screen.getByTestId("setup-countdown-badge").textContent).toContain(
			"60s",
		);
		expect(screen.getByTestId("abort-match-btn")).toBeDefined();

		// Transition to playing phase with incoming draw offer from black and opponent disconnected banner
		const playingFen = createPlayingFen();
		act(() => {
			room.pushState({
				...room.state,
				phase: "playing",
				currentFen: playingFen,
				initialSetupFen: playingFen,
				drawOfferedBy: "black",
				players: {
					sess_host: {
						sessionId: "sess_host",
						userId: "guest_1",
						displayName: "HostAung",
						rating: 1500,
						side: "red",
						connected: true,
					},
					sess_guest: {
						sessionId: "sess_guest",
						userId: "guest_2",
						displayName: "GuestKyaw",
						rating: 1500,
						side: "black",
						connected: false,
					},
				},
			});
		});

		expect(screen.getByTestId("incoming-draw-offer-banner")).toBeDefined();
		expect(
			screen.getByTestId("online-opponent-disconnected-banner"),
		).toBeDefined();

		fireEvent.click(screen.getByTestId("accept-draw-btn"));
		expect(room.sent.at(-1)).toEqual({
			type: "respond_draw",
			payload: { accept: true },
		});

		// Simulate room closing with 4012 WAITING_TIMEOUT -> displays recovery card
		act(() => {
			room.pushLeave(4012);
		});
		expect(
			screen.getByTestId("room-error-card").getAttribute("data-error-kind"),
		).toBe("waiting_timeout_4012");
		fireEvent.click(screen.getByTestId("room-return-to-lobby-btn"));
		expect(returnedToLobby).toBe(true);
	});

	it("renders localized Myanmar (/my) error recovery cards for 409 ACTIVE_MATCH_EXISTS and 503 SERVER_MAINTENANCE", () => {
		const { unmount } = render(
			<OnlineRoomView
				roomId="K9M4P2"
				locale="my"
				initialError="conflict_409"
				onReturnToLobby={() => {}}
			/>,
		);
		expect(
			screen.getByTestId("room-error-card").getAttribute("data-error-kind"),
		).toBe("conflict_409");
		expect(screen.getByTestId("room-error-card").textContent).toContain(
			"အခြားပွဲစဉ်တစ်ခု ကစားနေဆဲဖြစ်သည်",
		);
		unmount();

		render(
			<OnlineRoomView
				roomId="K9M4P2"
				locale="my"
				initialError="maintenance_503"
				onReturnToLobby={() => {}}
			/>,
		);
		expect(
			screen.getByTestId("room-error-card").getAttribute("data-error-kind"),
		).toBe("maintenance_503");
		expect(screen.getByTestId("room-error-card").textContent).toContain(
			"ဆာဗာ ပြုပြင်ထိန်းသိမ်းနေပါသည်",
		);
	});
});

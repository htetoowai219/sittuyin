import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { NewMatchRow } from "@sittuyin/db";
import {
	CUSTOM_CLOSE_CODES,
	INVITE_CODE_ALPHABET,
	type MatchEndedEvent,
	type MatchStartedEvent,
	type RematchStartedEvent,
	type RoomActionResult,
	SITTUYIN_ROOM_NAME,
} from "@sittuyin/shared";
import { CloseCode } from "colyseus";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import appConfig, { DEFAULT_DEV_MONITOR_SECRET } from "../src/app.config.js";
import {
	activePlayerRoomMap,
	usedJtiStore,
} from "../src/auth/anti-cheat-registry.js";
import {
	signMatchJoinTicket,
	verifyMatchJoinTicket,
} from "../src/auth/ticket-verifier.js";
import { maintenanceController } from "../src/maintenance.js";
import { generateUniqueInviteCode } from "../src/rooms/invite-code.js";
import {
	persistCompletedMatchWithRetry,
	setMatchPersistenceOverride,
} from "../src/rooms/persistence.js";
import { SittuyinRoom } from "../src/rooms/SittuyinRoom.js";
import {
	getSchemaFieldCount,
	SittuyinClockState,
	SittuyinHandCounts,
	SittuyinPlayer,
	SittuyinPrivateSetup,
	SittuyinRoomState,
} from "../src/rooms/schema/SittuyinRoomState.js";

describe("SittuyinRoom realtime multiplayer lifecycle (spec 0001)", () => {
	let colyseus: ColyseusTestServer<typeof appConfig>;

	beforeAll(async () => {
		colyseus = await boot(appConfig);
	});

	afterAll(async () => {
		await colyseus.shutdown();
	});

	beforeEach(async () => {
		maintenanceController.reset();
		usedJtiStore.clear();
		activePlayerRoomMap.clear();
		SittuyinRoom.checkInviteCodeExistsOverride = null;
		setMatchPersistenceOverride(null);
		await colyseus.cleanup();
	});

	async function connectWithTicket(
		room: SittuyinRoom,
		claims: {
			sub: string;
			displayName: string;
			rating?: number;
			isAnonymous?: boolean;
			roomMode?: "public_lobby" | "private_room" | "quick_match";
			timeControl?: "rapid_10_5" | "rapid_15_10" | "classical_30_0";
			preferredSide?: "red" | "black" | "random";
			roomTitle?: string;
			roleIntent?: "player" | "spectator";
			jti?: string;
		},
		joinOptions: Record<string, unknown> = {},
	) {
		const token = await signMatchJoinTicket(claims);
		colyseus.sdk.auth.token = token;
		return await colyseus.connectTo(room, joinOptions);
	}

	async function requestAction(
		client: { request(type: string, message?: unknown): Promise<unknown> },
		type: string,
		payload: unknown = {},
	): Promise<RoomActionResult> {
		return (await client.request(type, payload)) as RoomActionResult;
	}

	async function setupAndStartPlayingMatch(
		timeControl: "rapid_10_5" | "rapid_15_10" | "classical_30_0" = "rapid_10_5",
	) {
		const room = (await colyseus.createRoom(SITTUYIN_ROOM_NAME, {
			roomMode: "public_lobby",
			timeControl,
			preferredSide: "red",
			roomTitle: "Yangon Open",
		})) as unknown as SittuyinRoom;

		const redClient = await connectWithTicket(room, {
			sub: "user_red",
			displayName: "AungRed",
			preferredSide: "red",
			timeControl,
		});
		const blackClient = await connectWithTicket(room, {
			sub: "user_black",
			displayName: "BoBlack",
			timeControl,
		});

		const redPreset = await requestAction(redClient, "setup_action", {
			action: { kind: "apply_preset", presetId: "myin_cha" },
		});
		expect(redPreset.ok).toBe(true);

		const blackPreset = await requestAction(blackClient, "setup_action", {
			action: { kind: "apply_preset", presetId: "sin_cha" },
		});
		expect(blackPreset.ok).toBe(true);

		const startedPromise = new Promise<MatchStartedEvent>((resolve) => {
			redClient.onMessage("match_started", (payload) => resolve(payload));
		});

		const redLock = await requestAction(redClient, "setup_action", {
			action: { kind: "lock" },
		});
		expect(redLock.ok).toBe(true);

		const blackLock = await requestAction(blackClient, "setup_action", {
			action: { kind: "lock" },
		});
		expect(blackLock.ok).toBe(true);

		const startedEvent = await startedPromise;
		await room.waitForNextPatch();

		return { room, redClient, blackClient, startedEvent };
	}

	it("rejects clients joining without an auth token", async () => {
		const room = await colyseus.createRoom<SittuyinRoomState>(
			SITTUYIN_ROOM_NAME,
			{},
		);

		colyseus.sdk.auth.token = "";
		await expect(colyseus.connectTo(room)).rejects.toThrow();
	});

	it("assigns red and black sides and moves from waiting to setup once two players join", async () => {
		const room = await colyseus.createRoom<SittuyinRoomState>(
			SITTUYIN_ROOM_NAME,
			{
				roomMode: "quick_match",
				timeControl: "rapid_15_10",
			},
		);

		colyseus.sdk.auth.token = "player-red";
		const client1 = await colyseus.connectTo(room);
		expect(room.state.phase).toBe("waiting");
		expect(room.state.roomMode).toBe("public_lobby");
		expect(room.state.players.get(client1.sessionId)?.side).toBe("red");

		colyseus.sdk.auth.token = "player-black";
		const client2 = await colyseus.connectTo(room);
		expect(room.state.phase).toBe("setup");
		expect(room.state.players.get(client2.sessionId)?.side).toBe("black");

		const pongPromise = new Promise<{ sentAt: number; serverTime: number }>(
			(resolve) => {
				client1.onMessage("pong", (payload) => resolve(payload));
			},
		);

		client1.send("ping", { sentAt: 1234 });
		const pong = await pongPromise;
		expect(pong.sentAt).toBe(1234);
		expect(pong.serverTime).toBeGreaterThan(0);
	});

	it("keeps all 5 @colyseus/schema classes under the 63 field cap and isolates setup drafts via @view() StateView (AC-4)", async () => {
		expect(getSchemaFieldCount(SittuyinRoomState)).toBe(29);
		expect(getSchemaFieldCount(SittuyinPlayer)).toBe(9);
		expect(getSchemaFieldCount(SittuyinClockState)).toBe(7);
		expect(getSchemaFieldCount(SittuyinPrivateSetup)).toBe(2);
		expect(getSchemaFieldCount(SittuyinHandCounts)).toBe(5);

		expect(getSchemaFieldCount(SittuyinRoomState)).toBeLessThan(63);

		const room = (await colyseus.createRoom(SITTUYIN_ROOM_NAME, {
			roomMode: "public_lobby",
			timeControl: "rapid_15_10",
			preferredSide: "red",
		})) as unknown as SittuyinRoom;

		const redClient = await connectWithTicket(room, {
			sub: "user_red_view",
			displayName: "RedView",
			preferredSide: "red",
		});
		const blackClient = await connectWithTicket(room, {
			sub: "user_black_view",
			displayName: "BlackView",
		});
		const spectatorClient = await connectWithTicket(room, {
			sub: "user_spec_view",
			displayName: "SpecView",
			roleIntent: "spectator",
		});

		await room.waitForNextPatch();

		const redPlace = await requestAction(redClient, "setup_action", {
			action: { kind: "place", role: "king", to: "g2" },
		});
		expect(redPlace.ok).toBe(true);

		const blackPlace = await requestAction(blackClient, "setup_action", {
			action: { kind: "place", role: "king", to: "b7" },
		});
		expect(blackPlace.ok).toBe(true);

		await room.waitForNextPatch();

		const redState = redClient.state as unknown as SittuyinRoomState;
		const blackState = blackClient.state as unknown as SittuyinRoomState;
		const specState = spectatorClient.state as unknown as SittuyinRoomState;

		expect(redState.redPlacedCount).toBe(1);
		expect(redState.blackPlacedCount).toBe(1);
		expect(redState.redPrivate?.myDraft?.get("g2")).toBe("king");
		expect(redState.blackPrivate?.myDraft?.size ?? 0).toBe(0);

		expect(blackState.blackPrivate?.myDraft?.get("b7")).toBe("king");
		expect(blackState.redPrivate?.myDraft?.size ?? 0).toBe(0);

		expect(specState.redPlacedCount).toBe(1);
		expect(specState.blackPlacedCount).toBe(1);
		expect(specState.redPrivate?.myDraft?.size ?? 0).toBe(0);
		expect(specState.blackPrivate?.myDraft?.size ?? 0).toBe(0);
	});

	it("enforces HS256 jose JWT verification, single-use jti anti-replay, single active match per user, and self-play downgrade (AC-12)", async () => {
		const roomA = (await colyseus.createRoom(SITTUYIN_ROOM_NAME, {
			roomMode: "public_lobby",
			preferredSide: "red",
		})) as unknown as SittuyinRoom;

		await expect(
			verifyMatchJoinTicket("eyJhbGciOiJIUzI1NiJ9.tampered.signature"),
		).rejects.toThrow("INVALID_TOKEN");

		const sharedJti = "550e8400-e29b-41d4-a716-446655440999";
		const ticket1 = await signMatchJoinTicket({
			sub: "user_jti_test",
			displayName: "ReplayTester",
			jti: sharedJti,
		});

		colyseus.sdk.auth.token = ticket1;
		await colyseus.connectTo(roomA);

		// Reusing the exact same single-use ticket must be rejected with TICKET_REPLAYED
		const roomB = (await colyseus.createRoom(SITTUYIN_ROOM_NAME, {
			roomMode: "public_lobby",
		})) as unknown as SittuyinRoom;
		colyseus.sdk.auth.token = ticket1;
		await expect(colyseus.connectTo(roomB)).rejects.toThrow(/TICKET_REPLAYED/);

		// Joining a second room as a seated player while already seated in roomA must be rejected with ACTIVE_MATCH_EXISTS
		const roomC = (await colyseus.createRoom(SITTUYIN_ROOM_NAME, {
			roomMode: "public_lobby",
		})) as unknown as SittuyinRoom;
		await expect(
			connectWithTicket(roomC, {
				sub: "user_jti_test",
				displayName: "ReplayTester",
				roleIntent: "player",
			}),
		).rejects.toThrow(/ACTIVE_MATCH_EXISTS/);

		// Opening a second tab in the same public roomA with the same user sub downgrades to spectator
		const secondTabClient = await connectWithTicket(roomA, {
			sub: "user_jti_test",
			displayName: "ReplayTester",
			roleIntent: "player",
		});
		expect(roomA.state.players.get(secondTabClient.sessionId)?.side).toBe(
			"spectator",
		);
	});

	it("publishes public lobby metadata and assigns collision-checked 6-character invite codes for private rooms (AC-2, AC-3)", async () => {
		const publicRoom = (await colyseus.createRoom(SITTUYIN_ROOM_NAME, {
			roomMode: "public_lobby",
			timeControl: "rapid_10_5",
			preferredSide: "black",
			roomTitle: "Bagan Classical Challenge",
		})) as unknown as SittuyinRoom;

		const hostClient = await connectWithTicket(publicRoom, {
			sub: "host_bagan",
			displayName: "MinKyi",
			rating: 1680,
			preferredSide: "black",
			roomTitle: "Bagan Classical Challenge",
		});

		expect(publicRoom.state.players.get(hostClient.sessionId)?.side).toBe(
			"black",
		);
		expect(publicRoom.metadata.roomTitle).toBe("Bagan Classical Challenge");
		expect(publicRoom.metadata.hostDisplayName).toBe("MinKyi");
		expect(publicRoom.metadata.hostAssignedSide).toBe("black");
		expect(publicRoom.metadata.playerCount).toBe(1);

		const guestClient = await connectWithTicket(publicRoom, {
			sub: "guest_bagan",
			displayName: "Thant",
		});
		expect(publicRoom.state.players.get(guestClient.sessionId)?.side).toBe(
			"red",
		);
		expect(publicRoom.metadata.playerCount).toBe(2);
		expect(publicRoom.metadata.phase).toBe("setup");

		// Simulate a collision on the first private invite code attempt
		let collisionChecks = 0;
		const codeFromCollisionHelper = await generateUniqueInviteCode(async () => {
			collisionChecks++;
			return collisionChecks === 1;
		});
		expect(collisionChecks).toBe(2);
		expect(codeFromCollisionHelper).toHaveLength(6);

		let roomCollisionChecks = 0;
		SittuyinRoom.checkInviteCodeExistsOverride = async () => {
			roomCollisionChecks++;
			return roomCollisionChecks === 1;
		};

		const privateRoom = (await colyseus.createRoom(SITTUYIN_ROOM_NAME, {
			roomMode: "private_room",
			timeControl: "rapid_15_10",
			preferredSide: "red",
		})) as unknown as SittuyinRoom;

		expect(roomCollisionChecks).toBe(2);
		expect(privateRoom.state.inviteCode).toHaveLength(6);
		expect(privateRoom.roomId).toBe(privateRoom.state.inviteCode);
		for (const ch of privateRoom.state.inviteCode) {
			expect(INVITE_CODE_ALPHABET.includes(ch)).toBe(true);
		}

		// Join private room by inviteCode and test 10-minute waiting timeout close code 4012
		const privateHost = await connectWithTicket(privateRoom, {
			sub: "priv_host",
			displayName: "PrivHost",
		});
		const leaveCodePromise = new Promise<number>((resolve) => {
			privateHost.onLeave((code) => resolve(code));
		});
		privateRoom.triggerWaitingTimeoutForTest();
		const leaveCode = await leaveCodePromise;
		expect(leaveCode).toBe(CUSTOM_CLOSE_CODES.WAITING_TIMEOUT);
	});

	it("rejects spectator mutations with FORBIDDEN_SPECTATOR and auto-completes unlocked setups when the 60s setup timer expires (AC-5, AC-6)", async () => {
		const room = (await colyseus.createRoom(SITTUYIN_ROOM_NAME, {
			roomMode: "public_lobby",
			timeControl: "rapid_10_5",
			preferredSide: "red",
		})) as unknown as SittuyinRoom;

		const redClient = await connectWithTicket(room, {
			sub: "red_auto",
			displayName: "RedAuto",
			preferredSide: "red",
		});
		const blackClient = await connectWithTicket(room, {
			sub: "black_auto",
			displayName: "BlackAuto",
		});
		const spectator = await connectWithTicket(room, {
			sub: "spec_auto",
			displayName: "SpecAuto",
			roleIntent: "spectator",
		});

		const specErrorPromise = new Promise<{ code: string }>((resolve) => {
			spectator.onMessage("action_error", (err) => resolve(err));
		});
		const specAttempt = await requestAction(spectator, "setup_action", {
			action: { kind: "clear" },
		});
		expect(specAttempt.ok).toBe(false);
		if (!specAttempt.ok) {
			expect(specAttempt.error.code).toBe("FORBIDDEN_SPECTATOR");
		}
		const specErrEvent = await specErrorPromise;
		expect(specErrEvent.code).toBe("FORBIDDEN_SPECTATOR");

		// Red places only 2 officers; Black uses random_setup without locking
		await requestAction(redClient, "setup_action", {
			action: { kind: "place", role: "king", to: "g2" },
		});
		await requestAction(redClient, "setup_action", {
			action: { kind: "place", role: "general", to: "f2" },
		});
		const randomRes = await requestAction(blackClient, "random_setup", {});
		expect(randomRes.ok).toBe(true);
		expect(room.state.blackPlacedCount).toBe(8);

		const matchStartedPromise = new Promise<MatchStartedEvent>((resolve) => {
			redClient.onMessage("match_started", (ev) => resolve(ev));
		});

		// Advance simulated setup timer by 60 seconds -> autoCompleteSetup runs for both unlocked sides
		room.advanceSimulatedTimeMs(60_000);

		const started = await matchStartedPromise;
		expect(room.state.phase).toBe("playing");
		expect(room.state.redSetupReady).toBe(true);
		expect(room.state.blackSetupReady).toBe(true);
		expect(room.state.initialSetupFen.length).toBeGreaterThan(10);
		expect(started.initialSetupFen).toBe(room.state.initialSetupFen);
		expect(room.state.clock.activeSide).toBe("red");
		expect(room.state.clock.running).toBe(true);
	});

	it("applies Fischer increment on valid moves and flags immediately on clock expiry (AC-7)", async () => {
		const { room, redClient } = await setupAndStartPlayingMatch("rapid_10_5");

		// Red spends 3 seconds, then plays e4e5 (rapid_10_5: 600,000 - 3,000 + 5,000 = 602,000)
		room.advanceSimulatedTimeMs(3_000);

		const moveRes = await requestAction(redClient, "move", {
			uci: "e4e5",
		});
		expect(moveRes.ok).toBe(true);
		expect(room.state.turn).toBe("black");
		expect(room.state.clock.activeSide).toBe("black");
		expect(room.state.clock.redRemainingMs).toBeGreaterThanOrEqual(601_500);
		expect(room.state.movesUci.at(0)).toBe("e4e5");

		const endedPromise = new Promise<MatchEndedEvent>((resolve) => {
			redClient.onMessage("match_ended", (ev) => resolve(ev));
		});

		// Advance Black's clock past 600,000 ms -> Black flags
		room.advanceSimulatedTimeMs(600_100);

		const ended = await endedPromise;
		expect(room.state.phase).toBe("finished");
		expect(ended.status).toBe("win");
		expect(ended.winner).toBe("red");
		expect(ended.reason).toBe("timeout");
		expect(room.state.clock.blackRemainingMs).toBe(0);
	});

	it("handles pre-move abort, draw offer/cooldown/auto-clear/accept, resignation, and in-room rematch with side swap and StateView rebind (AC-8, AC-9, AC-10)", async () => {
		// 1. Pre-move abort before ply 2
		const abortRoom = (await colyseus.createRoom(SITTUYIN_ROOM_NAME, {
			roomMode: "public_lobby",
			preferredSide: "red",
		})) as unknown as SittuyinRoom;
		const abortRed = await connectWithTicket(abortRoom, {
			sub: "abort_r",
			displayName: "AbortRed",
			preferredSide: "red",
		});
		await connectWithTicket(abortRoom, {
			sub: "abort_b",
			displayName: "AbortBlack",
		});

		const abortEndedPromise = new Promise<MatchEndedEvent>((resolve) => {
			abortRed.onMessage("match_ended", (ev) => resolve(ev));
		});
		const abortRes = await requestAction(abortRed, "abort", {});
		expect(abortRes.ok).toBe(true);
		const abortEnded = await abortEndedPromise;
		expect(abortEnded.status).toBe("aborted");
		expect(abortEnded.reason).toBe("aborted_pre_move");
		expect(abortEnded.persisted).toBe(false);

		// 2. Playing match: draw offer, cooldown, auto-clear on move, then ply 2 abort rejection, resignation, and rematch
		const { room, redClient, blackClient } =
			await setupAndStartPlayingMatch("rapid_10_5");

		const drawOffer1 = await requestAction(redClient, "offer_draw", {});
		expect(drawOffer1.ok).toBe(true);
		expect(room.state.drawOfferedBy).toBe("red");

		// Making a board move auto-clears the pending draw offer
		await requestAction(redClient, "move", { uci: "e4e5" });
		expect(room.state.drawOfferedBy).toBe("");

		// Black makes ply 2 move -> abort window is now closed
		await requestAction(blackClient, "move", { uci: "d5d4" });
		expect(room.state.movesUci.length).toBe(2);

		const lateAbort = await requestAction(redClient, "abort", {});
		expect(lateAbort.ok).toBe(false);
		if (!lateAbort.ok) {
			expect(lateAbort.error.code).toBe("ABORT_WINDOW_CLOSED");
		}

		// Red offers draw at ply 2, Black declines, Red immediately tries again at ply 2 -> cooldown active
		await requestAction(redClient, "offer_draw", {});
		await requestAction(blackClient, "respond_draw", {
			accept: false,
		});
		expect(room.state.drawOfferedBy).toBe("");

		const cooldownDraw = await requestAction(redClient, "offer_draw", {});
		expect(cooldownDraw.ok).toBe(false);
		if (!cooldownDraw.ok) {
			expect(cooldownDraw.error.code).toBe("DRAW_COOLDOWN_ACTIVE");
		}

		// Black resigns -> Red wins
		const resignEndedPromise = new Promise<MatchEndedEvent>((resolve) => {
			redClient.onMessage("match_ended", (ev) => resolve(ev));
		});
		const resignRes = await requestAction(blackClient, "resign", {});
		expect(resignRes.ok).toBe(true);
		const resignEnded = await resignEndedPromise;
		expect(resignEnded.status).toBe("win");
		expect(resignEnded.winner).toBe("red");
		expect(resignEnded.reason).toBe("resignation");

		// 3. In-room rematch: Red offers, Black accepts -> seats swap and StateViews rebind
		const previousMatchId = room.state.matchId;
		const rematchStartedPromise = new Promise<RematchStartedEvent>(
			(resolve) => {
				redClient.onMessage("rematch_started", (ev) => resolve(ev));
			},
		);

		const offerRematch = await requestAction(redClient, "offer_rematch", {});
		expect(offerRematch.ok).toBe(true);

		const acceptRematch = await requestAction(blackClient, "respond_rematch", {
			accept: true,
		});
		expect(acceptRematch.ok).toBe(true);

		const rematchStarted = await rematchStartedPromise;
		expect(room.state.phase).toBe("setup");
		expect(room.state.matchId).not.toBe(previousMatchId);
		expect(rematchStarted.redSessionId).toBe(blackClient.sessionId);
		expect(rematchStarted.blackSessionId).toBe(redClient.sessionId);
		expect(room.state.players.get(blackClient.sessionId)?.side).toBe("red");
		expect(room.state.players.get(redClient.sessionId)?.side).toBe("black");

		// Verify rebound StateViews: blackClient is now Red, so placing on g2 appears in blackClient.state.redPrivate
		const newRedPlace = await requestAction(blackClient, "setup_action", {
			action: { kind: "place", role: "king", to: "g2" },
		});
		expect(newRedPlace.ok).toBe(true);
		await room.waitForNextPatch();

		const newRedClientState = blackClient.state as unknown as SittuyinRoomState;
		const newBlackClientState = redClient.state as unknown as SittuyinRoomState;
		expect(newRedClientState.redPrivate?.myDraft?.get("g2")).toBe("king");
		expect(newBlackClientState.redPrivate?.myDraft?.size ?? 0).toBe(0);
	});

	it("enforces Fly.io maintenance lock, GET /health, Basic Auth POST /admin/maintenance, and asynchronous match persistence with retry backoff (AC-11, AC-13, AC-14)", async () => {
		const healthRes1 = await colyseus.http.get("/health");
		expect(healthRes1.statusCode).toBe(200);
		expect(healthRes1.data.ok).toBe(true);
		expect(healthRes1.data.maintenanceLocked).toBe(false);

		// Verify POST /admin/maintenance rejects unauthenticated calls
		await expect(
			colyseus.http.post("/admin/maintenance", {
				body: JSON.stringify({ locked: true }),
				headers: { "content-type": "application/json" },
			}),
		).rejects.toThrow();

		// Test asynchronous match persistence retry backoff on a completed game
		const persistedRows: NewMatchRow[] = [];
		let insertAttempts = 0;
		setMatchPersistenceOverride(async (row) => {
			insertAttempts++;
			if (insertAttempts === 1) {
				throw new Error("Simulated transient Neon scale-to-zero wakeup delay");
			}
			persistedRows.push(row);
		});

		const { room, redClient, blackClient } =
			await setupAndStartPlayingMatch("rapid_10_5");
		await requestAction(redClient, "move", { uci: "e4e5" });
		await requestAction(blackClient, "move", { uci: "d5d4" });

		// Agree to a draw so the match finishes competitively and persists
		await requestAction(redClient, "offer_draw", {});
		await requestAction(blackClient, "respond_draw", {
			accept: true,
		});

		await vi.waitFor(
			() => {
				expect(persistedRows).toHaveLength(1);
			},
			{ timeout: 2_500 },
		);
		expect(insertAttempts).toBe(2);
		expect(persistedRows[0]?.terminationReason).toBe("agreed_draw");
		expect(persistedRows[0]?.movesUciJson).toEqual(["e4e5", "d5d4"]);
		expect(persistedRows[0]?.totalPlies).toBe(2);

		// Also verify persistCompletedMatchWithRetry logs and returns false without throwing when all retries fail
		const firstRow = persistedRows[0];
		expect(firstRow).toBeDefined();
		if (!firstRow) throw new Error("Expected persisted row");
		const failingResult = await persistCompletedMatchWithRetry(firstRow, {
			insertFn: async () => {
				throw new Error("Database offline");
			},
			retryDelaysMs: [5, 10],
			logger: { warn: () => {}, error: () => {} },
		});
		expect(failingResult).toBe(false);

		// Enable maintenance lock via Basic Auth POST /admin/maintenance
		const basicAuth = Buffer.from(
			`admin:${DEFAULT_DEV_MONITOR_SECRET}`,
			"utf8",
		).toString("base64");

		const maintenanceNotifiedPromise = new Promise<{ reason: string }>(
			(resolve) => {
				redClient.onMessage("server_maintenance", (ev) => resolve(ev));
			},
		);

		const lockRes = await colyseus.http.post("/admin/maintenance", {
			body: JSON.stringify({
				locked: true,
				reason: "Deploying new release to Fly.io sin",
			}),
			headers: {
				"content-type": "application/json",
				authorization: `Basic ${basicAuth}`,
			},
		});
		expect(lockRes.statusCode).toBe(200);
		expect(lockRes.data.maintenanceLocked).toBe(true);
		expect(lockRes.data.notifiedRooms).toBeGreaterThanOrEqual(1);

		const notified = await maintenanceNotifiedPromise;
		expect(notified.reason).toBe("Deploying new release to Fly.io sin");

		// Creating a new room while maintenanceLocked === true must throw 503 SERVER_MAINTENANCE
		await expect(
			colyseus.createRoom(SITTUYIN_ROOM_NAME, {
				roomMode: "public_lobby",
			}),
		).rejects.toThrow(/SERVER_MAINTENANCE/);

		// Graceful shutdown disconnects active room clients with CloseCode.SERVER_SHUTDOWN (4001)
		const shutdownLeavePromise = new Promise<number>((resolve) => {
			redClient.onLeave((code) => resolve(code));
		});
		await room.handleServerShutdown("SIGTERM deploy");
		const shutdownCode = await shutdownLeavePromise;
		expect(shutdownCode).toBe(CloseCode.SERVER_SHUTDOWN);
	});

	it("handles 18-client capacity (2 players + 16 spectators) and onDrop / onReconnect / abandonment grace periods (AC-3, AC-11)", async () => {
		const room = (await colyseus.createRoom(SITTUYIN_ROOM_NAME, {
			roomMode: "public_lobby",
			timeControl: "rapid_10_5",
			preferredSide: "red",
		})) as unknown as SittuyinRoom;

		const redClient = await connectWithTicket(room, {
			sub: "cap_red",
			displayName: "CapRed",
			preferredSide: "red",
		});
		const blackClient = await connectWithTicket(room, {
			sub: "cap_black",
			displayName: "CapBlack",
		});

		for (let i = 1; i <= 16; i++) {
			const spec = await connectWithTicket(room, {
				sub: `cap_spec_${i}`,
				displayName: `Spec${i}`,
				roleIntent: "spectator",
			});
			expect(room.state.players.get(spec.sessionId)?.side).toBe("spectator");
		}
		expect(room.state.players.size).toBe(18);
		expect(room.metadata.playerCount).toBe(2);
		expect(room.metadata.spectatorCount).toBe(16);

		// A 19th client must be rejected because maxClients = 18 is reached
		await expect(
			connectWithTicket(room, {
				sub: "cap_spec_19",
				displayName: "OverflowSpec",
				roleIntent: "spectator",
			}),
		).rejects.toThrow();

		// Simulate onDrop and onReconnect for Red during setup
		const serverRedClient = room.clients.getById(redClient.sessionId);
		expect(serverRedClient).toBeDefined();
		if (!serverRedClient) throw new Error("Expected serverRedClient");
		room.onDrop(serverRedClient, CloseCode.ABNORMAL_CLOSURE);
		expect(room.state.players.get(redClient.sessionId)?.connected).toBe(false);

		room.onReconnect(serverRedClient);
		expect(room.state.players.get(redClient.sessionId)?.connected).toBe(true);

		// Simulate permanent reconnection timeout (onLeave with FAILED_TO_RECONNECT) for Black -> Red wins by abandonment
		const abandonmentEndedPromise = new Promise<MatchEndedEvent>((resolve) => {
			redClient.onMessage("match_ended", (ev) => resolve(ev));
		});
		const serverBlackClient = room.clients.getById(blackClient.sessionId);
		expect(serverBlackClient).toBeDefined();
		if (!serverBlackClient) throw new Error("Expected serverBlackClient");
		room.onLeave(serverBlackClient, CloseCode.FAILED_TO_RECONNECT);

		const ended = await abandonmentEndedPromise;
		expect(ended.status).toBe("win");
		expect(ended.winner).toBe("red");
		expect(ended.reason).toBe("abandonment");
	});
});

import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { StateView } from "@colyseus/schema";
import type { NewMatchRow } from "@sittuyin/db";
import {
	applyMove,
	applySetupAction,
	applyUci,
	autoCompleteSetup,
	createGame,
	type GameState,
	generateRandomSetup,
	oppositeSide,
	type Side,
	type Square,
} from "@sittuyin/engine";
import {
	AbortMessageSchema,
	CUSTOM_CLOSE_CODES,
	type LobbyRoomMetadata,
	MAX_ROOM_CLIENTS,
	type MatchEndedEvent,
	type MatchJoinTicketClaims,
	MoveMessageSchema,
	OfferDrawMessageSchema,
	OfferRematchMessageSchema,
	PingMessageSchema,
	type PreferredSide,
	PreferredSideSchema,
	RandomSetupMessageSchema,
	RECONNECT_GRACE_PLAYING_S,
	RECONNECT_GRACE_WAITING_S,
	ResignMessageSchema,
	RespondDrawMessageSchema,
	RespondRematchMessageSchema,
	type RoleIntent,
	RoleIntentSchema,
	type RoomActionErrorCode,
	type RoomActionResult,
	type RoomMode,
	type RoomModeInput,
	RoomModeSchema,
	type RoomPhase,
	SETUP_DURATION_MS,
	SetupActionMessageSchema,
	type TerminationReason,
	TIME_CONTROL_CONFIGS,
	type TimeControl,
	TimeControlSchema,
	WAITING_ROOM_TIMEOUT_MS,
} from "@sittuyin/shared";
import {
	type AuthContext,
	type Client,
	CloseCode,
	type Delayed,
	matchMaker,
	Room,
	ServerError,
	updateLobby,
	validate,
} from "colyseus";
import {
	activePlayerRoomMap,
	usedJtiStore,
} from "../auth/anti-cheat-registry.js";
import {
	signMatchJoinTicket,
	verifyMatchJoinTicket,
} from "../auth/ticket-verifier.js";
import {
	type MaintenanceRoomTarget,
	maintenanceController,
} from "../maintenance.js";
import { generateUniqueInviteCode } from "./invite-code.js";
import {
	persistAndRateCompletedMatchWithRetry,
	serverLogger,
	shouldPersistCompletedMatch,
} from "./persistence.js";
import {
	SittuyinPlayer,
	SittuyinRoomState,
	syncSchemaFromEngine,
} from "./schema/SittuyinRoomState.js";

export interface SittuyinClientAuth extends MatchJoinTicketClaims {
	readonly effectiveRoleIntent: RoleIntent;
}

export interface SittuyinRoomOptions {
	readonly roomMode?: RoomModeInput;
	readonly isRated?: boolean;
	readonly timeControl?: TimeControl;
	readonly preferredSide?: PreferredSide;
	readonly roomTitle?: string;
	readonly roleIntent?: RoleIntent;
	readonly token?: string;
	readonly disallowSpectatorDowngrade?: boolean;
	readonly waitingTimeoutMs?: number;
	readonly setupDurationMs?: number;
	readonly reconnectGracePlayingSeconds?: number;
	readonly reconnectGraceWaitingSeconds?: number;
	readonly randomSideBit?: 0 | 1;
}

function parseAllowedOrigins(): Set<string> {
	const raw = process.env.ALLOWED_ORIGINS ?? "http://localhost:3000";
	return new Set(
		raw
			.split(",")
			.map((origin) => origin.trim())
			.filter(Boolean),
	);
}

function extractOriginHeader(context?: AuthContext): string | undefined {
	const headers = context?.headers as
		| Headers
		| Record<string, string | string[] | undefined>
		| undefined;
	if (!headers) return undefined;
	if (typeof (headers as Headers).get === "function") {
		return (headers as Headers).get("origin") ?? undefined;
	}
	const raw =
		(headers as Record<string, string | string[] | undefined>).origin ??
		(headers as Record<string, string | string[] | undefined>).Origin;
	return Array.isArray(raw) ? raw[0] : raw;
}

export class SittuyinRoom
	extends Room<{
		state: SittuyinRoomState;
		metadata: LobbyRoomMetadata;
		client: Client<{ auth: SittuyinClientAuth }>;
	}>
	implements MaintenanceRoomTarget
{
	maxClients = MAX_ROOM_CLIENTS;
	maxMessagesPerSecond = 20;
	state = new SittuyinRoomState();

	private readonly spectatorView = new StateView();
	private engineState: GameState = createGame();
	private hostUserId = "";
	private hostDisplayName = "Host";
	private hostRating = 1500;
	private hostIsProvisional = true;
	private hostAssignedSide: Side = "red";
	private disposed = false;

	private waitingTimeoutMs: number = WAITING_ROOM_TIMEOUT_MS;
	private setupDurationMs: number = SETUP_DURATION_MS;
	private reconnectGracePlayingSeconds: number = RECONNECT_GRACE_PLAYING_S;
	private reconnectGraceWaitingSeconds: number = RECONNECT_GRACE_WAITING_S;
	private fixedRandomSideBit: 0 | 1 | undefined = undefined;

	private waitingTimeoutTimer: Delayed | null = null;
	private setupIntervalTimer: Delayed | null = null;
	private clockIntervalTimer: Delayed | null = null;

	private syntheticPerfOffsetMs = 0;
	private setupStartedAtPerfMs = 0;
	private lastSetupSyncPerfMs = 0;
	private lastClockTickPerfMs = 0;
	private lastClockSyncPerfMs = 0;
	private internalRemainingMs: Record<Side, number> = {
		red: 900_000,
		black: 900_000,
	};
	private lastDrawOfferPlyBySide: Record<Side, number> = {
		red: -1,
		black: -1,
	};
	private matchStartedAt: Date | null = null;
	private seatedSnapshotAtPlayStart: Record<
		Side,
		{ userId: string; displayName: string }
	> | null = null;
	private shuttingDownForMaintenance = false;

	static checkInviteCodeExistsOverride:
		| ((code: string) => Promise<boolean>)
		| null = null;

	messages = {
		setup_action: validate(
			SetupActionMessageSchema,
			(client: Client<{ auth: SittuyinClientAuth }>, payload) => {
				const seat = this.requireSeatedPlayer(client, "setup_action");
				if (!seat.ok) return seat.result;

				if (this.state.phase !== "setup") {
					return this.failAction(
						client,
						"setup_action",
						"INVALID_PHASE",
						"Setup actions are only permitted during the setup phase.",
					);
				}

				const res = applySetupAction(
					this.engineState,
					seat.side,
					payload.action,
				);
				if (!res.ok) {
					return this.failAction(
						client,
						"setup_action",
						res.error.code,
						res.error.message,
						res.error.details ? { ...res.error.details } : undefined,
					);
				}

				this.engineState = res.value;
				syncSchemaFromEngine(this.state, this.engineState);

				if (this.engineState.phase === "playing") {
					this.enterPlayingPhase();
				}

				return { ok: true, value: undefined } satisfies RoomActionResult;
			},
		),

		random_setup: validate(
			RandomSetupMessageSchema,
			(client: Client<{ auth: SittuyinClientAuth }>) => {
				const seat = this.requireSeatedPlayer(client, "random_setup");
				if (!seat.ok) return seat.result;

				if (this.state.phase !== "setup") {
					return this.failAction(
						client,
						"random_setup",
						"INVALID_PHASE",
						"Random setup is only permitted during the setup phase.",
					);
				}

				if (this.engineState.setupReady[seat.side]) {
					return this.failAction(
						client,
						"random_setup",
						"SIDE_ALREADY_LOCKED",
						"Cannot randomize setup after locking in.",
					);
				}

				const seed = randomBytes(4).readUInt32LE(0);
				const placements = generateRandomSetup(seed, seat.side);

				const cleared = applySetupAction(this.engineState, seat.side, {
					kind: "clear",
				});
				if (!cleared.ok) {
					return this.failAction(
						client,
						"random_setup",
						cleared.error.code,
						cleared.error.message,
					);
				}

				let nextState = cleared.value;
				for (const [sq, role] of Object.entries(placements)) {
					if (!role) continue;
					const placed = applySetupAction(nextState, seat.side, {
						kind: "place",
						role,
						to: sq as Square,
					});
					if (!placed.ok) {
						return this.failAction(
							client,
							"random_setup",
							placed.error.code,
							placed.error.message,
						);
					}
					nextState = placed.value;
				}

				this.engineState = nextState;
				syncSchemaFromEngine(this.state, this.engineState);

				return { ok: true, value: undefined } satisfies RoomActionResult;
			},
		),

		move: validate(
			MoveMessageSchema,
			(client: Client<{ auth: SittuyinClientAuth }>, payload) => {
				const seat = this.requireSeatedPlayer(client, "move");
				if (!seat.ok) return seat.result;

				if (this.state.phase !== "playing") {
					return this.failAction(
						client,
						"move",
						"INVALID_PHASE",
						"Moves are only permitted during the playing phase.",
					);
				}

				if (this.engineState.turn !== seat.side) {
					return this.failAction(
						client,
						"move",
						"WRONG_TURN",
						"It is not your turn.",
					);
				}

				const nowPerf = this.nowPerf();
				const elapsedMs = Math.max(0, nowPerf - this.lastClockTickPerfMs);
				this.lastClockTickPerfMs = nowPerf;
				this.internalRemainingMs[seat.side] -= elapsedMs;

				if (this.internalRemainingMs[seat.side] <= 0) {
					this.internalRemainingMs[seat.side] = 0;
					this.finishMatch({
						status: "win",
						winner: oppositeSide(seat.side),
						reason: "timeout",
					});
					return this.failAction(
						client,
						"move",
						"INVALID_PHASE",
						"Clock expired before move could be applied.",
					);
				}

				const res = payload.move
					? applyMove(this.engineState, payload.move)
					: applyUci(this.engineState, payload.uci ?? "");

				if (!res.ok) {
					return this.failAction(
						client,
						"move",
						res.error.code,
						res.error.message,
						res.error.details ? { ...res.error.details } : undefined,
					);
				}

				this.engineState = res.value;
				const lastRecord =
					this.engineState.moveHistory[this.engineState.moveHistory.length - 1];
				if (lastRecord) {
					this.state.movesUci.push(lastRecord.uci);
				}

				if (this.state.drawOfferedBy !== "") {
					this.state.drawOfferedBy = "";
				}

				syncSchemaFromEngine(this.state, this.engineState);

				if (this.engineState.phase === "finished" && this.engineState.outcome) {
					this.finishMatch({
						status: this.engineState.outcome.status,
						winner: this.engineState.outcome.winner,
						reason: this.engineState.outcome.reason,
					});
					return { ok: true, value: undefined } satisfies RoomActionResult;
				}

				this.internalRemainingMs[seat.side] += this.state.clock.incrementMs;
				this.state.clock.activeSide = this.engineState.turn;
				this.state.clock.redRemainingMs = Math.max(
					0,
					Math.ceil(this.internalRemainingMs.red),
				);
				this.state.clock.blackRemainingMs = Math.max(
					0,
					Math.ceil(this.internalRemainingMs.black),
				);
				this.state.clock.syncedAtMs = Date.now();
				this.lastClockSyncPerfMs = nowPerf;

				return { ok: true, value: undefined } satisfies RoomActionResult;
			},
		),

		abort: validate(
			AbortMessageSchema,
			(client: Client<{ auth: SittuyinClientAuth }>) => {
				const seat = this.requireSeatedPlayer(client, "abort");
				if (!seat.ok) return seat.result;

				const canAbort =
					this.state.phase === "waiting" ||
					this.state.phase === "setup" ||
					(this.state.phase === "playing" && this.state.movesUci.length < 2);

				if (!canAbort) {
					return this.failAction(
						client,
						"abort",
						"ABORT_WINDOW_CLOSED",
						"Abort is only permitted before Black completes move 1.",
					);
				}

				this.finishMatch({
					status: "aborted",
					winner: null,
					reason: "aborted_pre_move",
				});
				return { ok: true, value: undefined } satisfies RoomActionResult;
			},
		),

		resign: validate(
			ResignMessageSchema,
			(client: Client<{ auth: SittuyinClientAuth }>) => {
				const seat = this.requireSeatedPlayer(client, "resign");
				if (!seat.ok) return seat.result;

				const canResign =
					(this.state.phase === "setup" && this.getSeatedPlayerCount() === 2) ||
					this.state.phase === "playing";

				if (!canResign) {
					return this.failAction(
						client,
						"resign",
						"INVALID_PHASE",
						"Resignation is only permitted during setup (with two players) or playing.",
					);
				}

				this.finishMatch({
					status: "win",
					winner: oppositeSide(seat.side),
					reason: "resignation",
				});
				return { ok: true, value: undefined } satisfies RoomActionResult;
			},
		),

		offer_draw: validate(
			OfferDrawMessageSchema,
			(client: Client<{ auth: SittuyinClientAuth }>) => {
				const seat = this.requireSeatedPlayer(client, "offer_draw");
				if (!seat.ok) return seat.result;

				if (this.state.phase !== "playing") {
					return this.failAction(
						client,
						"offer_draw",
						"INVALID_PHASE",
						"Draw offers are only permitted during the playing phase.",
					);
				}

				if (this.state.drawOfferedBy !== "") {
					return this.failAction(
						client,
						"offer_draw",
						"DRAW_ALREADY_PENDING",
						"A draw offer is already pending.",
					);
				}

				const currentPly = this.state.movesUci.length;
				if (this.lastDrawOfferPlyBySide[seat.side] === currentPly) {
					return this.failAction(
						client,
						"offer_draw",
						"DRAW_COOLDOWN_ACTIVE",
						"You may offer a draw at most once per turn cycle.",
					);
				}

				this.lastDrawOfferPlyBySide[seat.side] = currentPly;
				this.state.drawOfferedBy = seat.side;
				this.broadcast("draw_offered", {
					offeredBy: seat.side,
					ply: currentPly,
				});

				return { ok: true, value: undefined } satisfies RoomActionResult;
			},
		),

		respond_draw: validate(
			RespondDrawMessageSchema,
			(client: Client<{ auth: SittuyinClientAuth }>, payload) => {
				const seat = this.requireSeatedPlayer(client, "respond_draw");
				if (!seat.ok) return seat.result;

				if (this.state.phase !== "playing") {
					return this.failAction(
						client,
						"respond_draw",
						"INVALID_PHASE",
						"Draw responses are only permitted during the playing phase.",
					);
				}

				if (
					this.state.drawOfferedBy === "" ||
					this.state.drawOfferedBy === seat.side
				) {
					return this.failAction(
						client,
						"respond_draw",
						"NO_DRAW_OFFER_PENDING",
						"No pending draw offer from your opponent.",
					);
				}

				this.state.drawOfferedBy = "";

				if (payload.accept) {
					this.finishMatch({
						status: "draw",
						winner: null,
						reason: "agreed_draw",
					});
				} else {
					this.broadcast("draw_declined", {
						declinedBy: seat.side,
					});
				}

				return { ok: true, value: undefined } satisfies RoomActionResult;
			},
		),

		offer_rematch: validate(
			OfferRematchMessageSchema,
			(client: Client<{ auth: SittuyinClientAuth }>) => {
				const seat = this.requireSeatedPlayer(client, "offer_rematch");
				if (!seat.ok) return seat.result;

				if (maintenanceController.isMaintenanceLocked()) {
					return this.failAction(
						client,
						"offer_rematch",
						"SERVER_MAINTENANCE",
						"Server is locked for maintenance.",
					);
				}

				if (
					this.state.phase !== "finished" ||
					this.state.outcomeReason === "aborted_maintenance"
				) {
					return this.failAction(
						client,
						"offer_rematch",
						"INVALID_PHASE",
						"Rematches can only be offered after a match finishes.",
					);
				}

				const opponent = this.getSeatedPlayerBySide(oppositeSide(seat.side));
				if (!opponent?.connected) {
					return this.failAction(
						client,
						"offer_rematch",
						"OPPONENT_DISCONNECTED",
						"Opponent is disconnected.",
					);
				}

				if (this.state.rematchOfferedBy === oppositeSide(seat.side)) {
					this.startRematch();
					return { ok: true, value: undefined } satisfies RoomActionResult;
				}

				this.state.rematchOfferedBy = seat.side;
				seat.player.rematchAccepted = true;
				this.broadcast("rematch_offered", {
					offeredBy: seat.side,
				});

				return { ok: true, value: undefined } satisfies RoomActionResult;
			},
		),

		respond_rematch: validate(
			RespondRematchMessageSchema,
			(client: Client<{ auth: SittuyinClientAuth }>, payload) => {
				const seat = this.requireSeatedPlayer(client, "respond_rematch");
				if (!seat.ok) return seat.result;

				if (this.state.phase !== "finished") {
					return this.failAction(
						client,
						"respond_rematch",
						"INVALID_PHASE",
						"Rematch responses are only valid when the match is finished.",
					);
				}

				if (
					this.state.rematchOfferedBy === "" ||
					this.state.rematchOfferedBy === seat.side
				) {
					return this.failAction(
						client,
						"respond_rematch",
						"NO_REMATCH_PENDING",
						"No rematch offer from your opponent is pending.",
					);
				}

				if (!payload.accept) {
					this.state.rematchOfferedBy = "";
					for (const p of this.state.players.values()) {
						p.rematchAccepted = false;
					}
					return { ok: true, value: undefined } satisfies RoomActionResult;
				}

				if (maintenanceController.isMaintenanceLocked()) {
					return this.failAction(
						client,
						"respond_rematch",
						"SERVER_MAINTENANCE",
						"Server is locked for maintenance.",
					);
				}

				const opponent = this.getSeatedPlayerBySide(oppositeSide(seat.side));
				if (!opponent?.connected) {
					return this.failAction(
						client,
						"respond_rematch",
						"OPPONENT_DISCONNECTED",
						"Opponent is disconnected.",
					);
				}

				this.startRematch();
				return { ok: true, value: undefined } satisfies RoomActionResult;
			},
		),

		ping: validate(
			PingMessageSchema,
			(client: Client<{ auth: SittuyinClientAuth }>, payload) => {
				const pong = {
					sentAt: payload.sentAt,
					serverTime: Date.now(),
				};
				client.send("pong", pong);
				return pong;
			},
		),
	};

	async onCreate(options: SittuyinRoomOptions = {}) {
		if (maintenanceController.isMaintenanceLocked()) {
			throw new ServerError(503, "SERVER_MAINTENANCE");
		}

		const parsedMode = RoomModeSchema.safeParse(
			options.roomMode ?? "public_lobby",
		);
		const roomMode: RoomMode = parsedMode.success
			? parsedMode.data
			: "public_lobby";

		const parsedTc = TimeControlSchema.safeParse(
			options.timeControl ?? "rapid_15_10",
		);
		const timeControl: TimeControl = parsedTc.success
			? parsedTc.data
			: "rapid_15_10";

		const parsedPrefSide = PreferredSideSchema.safeParse(
			options.preferredSide ?? "random",
		);
		const preferredSide: PreferredSide = parsedPrefSide.success
			? parsedPrefSide.data
			: "random";

		this.waitingTimeoutMs = options.waitingTimeoutMs ?? WAITING_ROOM_TIMEOUT_MS;
		this.setupDurationMs = options.setupDurationMs ?? SETUP_DURATION_MS;
		this.reconnectGracePlayingSeconds =
			options.reconnectGracePlayingSeconds ?? RECONNECT_GRACE_PLAYING_S;
		this.reconnectGraceWaitingSeconds =
			options.reconnectGraceWaitingSeconds ?? RECONNECT_GRACE_WAITING_S;
		this.fixedRandomSideBit = options.randomSideBit;

		this.hostAssignedSide = this.resolvePreferredSide(preferredSide);

		const tcConfig = TIME_CONTROL_CONFIGS[timeControl];
		this.internalRemainingMs = {
			red: tcConfig.initialMs,
			black: tcConfig.initialMs,
		};

		this.state.matchId = randomUUID();
		this.state.phase = "waiting";
		this.state.roomMode = roomMode;
		this.state.isRated =
			roomMode === "private_room" ? false : Boolean(options.isRated ?? true);
		this.state.roomTitle = (
			options.roomTitle?.trim() || "Open Sittuyin Match"
		).slice(0, 48);
		this.state.hostPreferredSide = preferredSide;
		this.state.timeControl = timeControl;

		this.state.clock.redRemainingMs = tcConfig.initialMs;
		this.state.clock.blackRemainingMs = tcConfig.initialMs;
		this.state.clock.incrementMs = tcConfig.incrementMs;
		this.state.clock.setupRemainingMs = this.setupDurationMs;
		this.state.clock.activeSide = "";
		this.state.clock.running = false;
		this.state.clock.syncedAtMs = Date.now();

		this.engineState = createGame();
		syncSchemaFromEngine(this.state, this.engineState);

		if (roomMode === "private_room") {
			await this.setPrivate(true);
			const inviteCode = await generateUniqueInviteCode(async (candidate) => {
				if (SittuyinRoom.checkInviteCodeExistsOverride) {
					return await SittuyinRoom.checkInviteCodeExistsOverride(candidate);
				}
				const existing = await matchMaker.getRoomById(candidate);
				return Boolean(existing);
			});
			this.roomId = inviteCode;
			this.state.inviteCode = inviteCode;
		} else {
			await this.setPrivate(false);
			await this.syncLobbyMetadata();
		}

		maintenanceController.registerRoom(this);
		this.armWaitingTimeout();
	}

	async onAuth(
		_client: Client,
		options: SittuyinRoomOptions = {},
		context: AuthContext,
	): Promise<SittuyinClientAuth> {
		if (maintenanceController.isMaintenanceLocked()) {
			throw new ServerError(503, "SERVER_MAINTENANCE");
		}

		const origin = extractOriginHeader(context);
		if (origin) {
			const allowedOrigins = parseAllowedOrigins();
			if (!allowedOrigins.has(origin)) {
				throw new ServerError(403, "FORBIDDEN_ORIGIN");
			}
		}

		let rawToken = context?.token ?? options?.token ?? "";
		if (
			rawToken &&
			!rawToken.includes(".") &&
			process.env.NODE_ENV !== "production"
		) {
			rawToken = await signMatchJoinTicket({
				sub: rawToken,
				displayName: rawToken.slice(0, 32),
				roomMode: options.roomMode ?? (this.state.roomMode as RoomMode),
				timeControl:
					options.timeControl ?? (this.state.timeControl as TimeControl),
				preferredSide: options.preferredSide ?? "red",
				roomTitle: options.roomTitle || this.state.roomTitle,
				roleIntent: options.roleIntent ?? "player",
			});
		}

		const claims = await verifyMatchJoinTicket(rawToken);

		if (!usedJtiStore.consume(claims.jti, claims.exp)) {
			throw new ServerError(401, "TICKET_REPLAYED");
		}

		const parsedRole = RoleIntentSchema.safeParse(
			options.roleIntent ?? claims.roleIntent,
		);
		let effectiveRoleIntent: RoleIntent = parsedRole.success
			? parsedRole.data
			: claims.roleIntent;

		const isSameUserAsHost =
			this.hostUserId !== "" && claims.sub === this.hostUserId;

		if (isSameUserAsHost && effectiveRoleIntent === "player") {
			if (
				this.state.roomMode === "private_room" &&
				options.disallowSpectatorDowngrade
			) {
				throw new ServerError(409, "SELF_PLAY_FORBIDDEN");
			}
			effectiveRoleIntent = "spectator";
		}

		const hasOpenPlayerSeat =
			this.getSeatedPlayerBySide("red") === undefined ||
			this.getSeatedPlayerBySide("black") === undefined;
		const wouldTakePlayerSeat =
			effectiveRoleIntent === "player" &&
			hasOpenPlayerSeat &&
			(this.state.phase === "waiting" || this.state.phase === "setup");

		if (
			wouldTakePlayerSeat &&
			activePlayerRoomMap.hasOtherRoomMatch(claims.sub, this.roomId)
		) {
			throw new ServerError(409, "ACTIVE_MATCH_EXISTS");
		}

		return {
			...claims,
			effectiveRoleIntent,
		};
	}

	async onJoin(
		client: Client<{ auth: SittuyinClientAuth }>,
		options: SittuyinRoomOptions = {},
	) {
		const auth = client.auth;
		if (!auth) {
			throw new ServerError(401, "MISSING_TOKEN");
		}
		const redPlayer = this.getSeatedPlayerBySide("red");
		const blackPlayer = this.getSeatedPlayerBySide("black");

		let assignedSide: Side | "spectator" = "spectator";

		if (
			auth.effectiveRoleIntent === "player" &&
			(this.state.phase === "waiting" || this.state.phase === "setup")
		) {
			if (!redPlayer && !blackPlayer) {
				this.hostUserId = auth.sub;
				this.hostDisplayName = auth.displayName;
				this.hostRating = auth.rating;
				this.hostIsProvisional = auth.isProvisional;
				this.state.hostSessionId = client.sessionId;
				this.state.isRated =
					this.state.roomMode === "private_room" ? false : auth.isRated;

				const prefSide =
					options.preferredSide ??
					auth.preferredSide ??
					(this.state.hostPreferredSide as PreferredSide);
				const parsedPref = PreferredSideSchema.safeParse(prefSide);
				if (parsedPref.success) {
					this.state.hostPreferredSide = parsedPref.data;
					this.hostAssignedSide = this.resolvePreferredSide(parsedPref.data);
				}

				const chosenTitle = options.roomTitle?.trim() || auth.roomTitle?.trim();
				if (chosenTitle) {
					this.state.roomTitle = chosenTitle.slice(0, 48);
				}

				assignedSide = this.hostAssignedSide;
			} else if (auth.sub !== this.hostUserId) {
				if (!redPlayer) {
					assignedSide = "red";
				} else if (!blackPlayer) {
					assignedSide = "black";
				}
			}
		}

		if (assignedSide === "red" || assignedSide === "black") {
			activePlayerRoomMap.claim(auth.sub, {
				roomId: this.roomId,
				sessionId: client.sessionId,
				side: assignedSide,
			});
		}

		const player = new SittuyinPlayer();
		player.sessionId = client.sessionId;
		player.userId = auth.sub;
		player.displayName = auth.displayName;
		player.rating = auth.rating;
		player.isProvisional = auth.isProvisional;
		player.isAnonymous = auth.isAnonymous;
		player.side = assignedSide;
		player.connected = true;
		player.rematchAccepted = false;

		this.state.players.set(client.sessionId, player);
		this.bindClientStateView(client, assignedSide);

		if (
			this.state.phase === "waiting" &&
			this.getSeatedPlayerBySide("red") !== undefined &&
			this.getSeatedPlayerBySide("black") !== undefined
		) {
			this.enterSetupPhase();
		}

		await this.syncLobbyMetadata();
	}

	onDrop(client: Client<{ auth: SittuyinClientAuth }>, code?: number) {
		const player = this.state.players.get(client.sessionId);
		if (!player) return;

		player.connected = false;

		if (
			this.shuttingDownForMaintenance ||
			code === CloseCode.SERVER_SHUTDOWN ||
			code === CUSTOM_CLOSE_CODES.WAITING_TIMEOUT ||
			this.state.phase === "finished"
		) {
			return;
		}

		const graceSeconds =
			player.side === "spectator"
				? this.reconnectGraceWaitingSeconds
				: this.state.phase === "setup" || this.state.phase === "playing"
					? this.reconnectGracePlayingSeconds
					: this.reconnectGraceWaitingSeconds;

		try {
			this.allowReconnection(client, graceSeconds).catch(() => {});
		} catch {
			// Room may already be disposing
		}
		void this.syncLobbyMetadata();
	}

	onReconnect(client: Client<{ auth: SittuyinClientAuth }>) {
		const player = this.state.players.get(client.sessionId);
		if (player) {
			player.connected = true;
			this.bindClientStateView(client, player.side as Side | "spectator");
		}
		void this.syncLobbyMetadata();
	}

	onLeave(client: Client<{ auth: SittuyinClientAuth }>, code?: number) {
		if (client.view && client.view !== this.spectatorView) {
			client.view.dispose();
		}

		const player = this.state.players.get(client.sessionId);
		if (!player) return;

		player.connected = false;

		if (player.side === "spectator") {
			this.state.players.delete(client.sessionId);
			void this.syncLobbyMetadata();
			return;
		}

		const leftSide = player.side as Side;
		activePlayerRoomMap.releaseUser(player.userId, this.roomId);

		if (this.shuttingDownForMaintenance) {
			this.state.players.delete(client.sessionId);
			return;
		}

		if (this.state.phase === "waiting") {
			this.state.players.delete(client.sessionId);
			this.finishMatch({
				status: "aborted",
				winner: null,
				reason: "aborted_pre_move",
			});
		} else if (this.state.phase === "setup" || this.state.phase === "playing") {
			if (
				code === CloseCode.CONSENTED &&
				this.state.phase === "playing" &&
				this.state.movesUci.length < 2
			) {
				this.finishMatch({
					status: "aborted",
					winner: null,
					reason: "aborted_pre_move",
				});
			} else {
				const reason: TerminationReason =
					code === CloseCode.CONSENTED ? "resignation" : "abandonment";
				this.finishMatch({
					status: "win",
					winner: oppositeSide(leftSide),
					reason,
				});
			}
		} else if (this.state.phase === "finished") {
			this.state.rematchOfferedBy = "";
			for (const p of this.state.players.values()) {
				p.rematchAccepted = false;
			}
			this.state.players.delete(client.sessionId);
		}

		void this.syncLobbyMetadata();
	}

	onBeforeShutdown() {
		void this.handleServerShutdown("Server shutting down for maintenance");
	}

	onDispose() {
		this.disposed = true;
		this.clearAllRoomTimers();
		activePlayerRoomMap.releaseRoom(this.roomId);
		maintenanceController.unregisterRoom(this.roomId);
	}

	notifyMaintenance(reason: string): void {
		this.broadcast("server_maintenance", {
			reason,
			timestamp: Date.now(),
		});
	}

	async handleServerShutdown(
		reason: string = "Server shutting down for maintenance",
	): Promise<void> {
		if (this.shuttingDownForMaintenance) return;
		this.shuttingDownForMaintenance = true;

		this.notifyMaintenance(reason);

		if (
			this.state.phase === "waiting" ||
			this.state.phase === "setup" ||
			this.state.phase === "playing"
		) {
			this.finishMatch({
				status: "aborted",
				winner: null,
				reason: "aborted_maintenance",
			});
		}

		await this.disconnect(CloseCode.SERVER_SHUTDOWN);
	}

	advanceSimulatedTimeMs(deltaMs: number): void {
		this.syntheticPerfOffsetMs += Math.max(0, deltaMs);
		if (this.state.phase === "setup") {
			this.tickSetupTimer();
		} else if (this.state.phase === "playing") {
			this.tickPlayClock();
		}
	}

	triggerWaitingTimeoutForTest(): void {
		if (this.state.phase === "waiting") {
			void this.disconnect(CUSTOM_CLOSE_CODES.WAITING_TIMEOUT);
		}
	}

	private nowPerf(): number {
		return performance.now() + this.syntheticPerfOffsetMs;
	}

	private resolvePreferredSide(preferredSide: PreferredSide): Side {
		if (preferredSide === "red" || preferredSide === "black") {
			return preferredSide;
		}
		const bit = this.fixedRandomSideBit ?? randomInt(2);
		return bit === 0 ? "red" : "black";
	}

	private bindClientStateView(
		client: Client<{ auth: SittuyinClientAuth }>,
		side: Side | "spectator",
	): void {
		if (client.view && client.view !== this.spectatorView) {
			client.view.dispose();
		}

		if (side === "red") {
			const view = new StateView();
			view.add(this.state.redPrivate);
			client.view = view;
		} else if (side === "black") {
			const view = new StateView();
			view.add(this.state.blackPrivate);
			client.view = view;
		} else {
			client.view = this.spectatorView;
		}
	}

	private getSeatedPlayerBySide(side: Side): SittuyinPlayer | undefined {
		for (const player of this.state.players.values()) {
			if (player.side === side) {
				return player;
			}
		}
		return undefined;
	}

	private getSeatedPlayerCount(): number {
		let count = 0;
		for (const player of this.state.players.values()) {
			if (player.side === "red" || player.side === "black") {
				count++;
			}
		}
		return count;
	}

	private getSpectatorCount(): number {
		let count = 0;
		for (const player of this.state.players.values()) {
			if (player.side === "spectator") {
				count++;
			}
		}
		return count;
	}

	private requireSeatedPlayer(
		client: Client<{ auth: SittuyinClientAuth }>,
		action: string,
	):
		| {
				readonly ok: true;
				readonly player: SittuyinPlayer;
				readonly side: Side;
		  }
		| { readonly ok: false; readonly result: RoomActionResult } {
		const player = this.state.players.get(client.sessionId);
		if (!player || (player.side !== "red" && player.side !== "black")) {
			return {
				ok: false,
				result: this.failAction(
					client,
					action,
					"FORBIDDEN_SPECTATOR",
					"Spectators cannot mutate room state.",
				),
			};
		}
		return {
			ok: true,
			player,
			side: player.side as Side,
		};
	}

	private failAction(
		client: Client<{ auth: SittuyinClientAuth }>,
		action: string,
		code: RoomActionErrorCode,
		message: string,
		details?: Record<string, unknown>,
	): RoomActionResult {
		const errorPayload =
			details !== undefined
				? { action, code, message, details }
				: { action, code, message };
		client.send("action_error", errorPayload);
		return {
			ok: false,
			error:
				details !== undefined ? { code, message, details } : { code, message },
		};
	}

	private armWaitingTimeout(): void {
		if (this.waitingTimeoutTimer) {
			this.waitingTimeoutTimer.clear();
		}
		this.waitingTimeoutTimer = this.clock.setTimeout(() => {
			if (this.state.phase === "waiting") {
				void this.disconnect(CUSTOM_CLOSE_CODES.WAITING_TIMEOUT);
			}
		}, this.waitingTimeoutMs);
	}

	private clearAllRoomTimers(): void {
		if (this.waitingTimeoutTimer) {
			this.waitingTimeoutTimer.clear();
			this.waitingTimeoutTimer = null;
		}
		if (this.setupIntervalTimer) {
			this.setupIntervalTimer.clear();
			this.setupIntervalTimer = null;
		}
		if (this.clockIntervalTimer) {
			this.clockIntervalTimer.clear();
			this.clockIntervalTimer = null;
		}
	}

	private enterSetupPhase(): void {
		this.clearAllRoomTimers();
		this.state.phase = "setup";
		this.engineState = createGame();

		const nowPerf = this.nowPerf();
		this.setupStartedAtPerfMs = nowPerf;
		this.lastSetupSyncPerfMs = nowPerf;

		this.state.clock.setupRemainingMs = this.setupDurationMs;
		this.state.clock.activeSide = "";
		this.state.clock.running = false;
		this.state.clock.syncedAtMs = Date.now();

		syncSchemaFromEngine(this.state, this.engineState);

		this.setupIntervalTimer = this.clock.setInterval(() => {
			this.tickSetupTimer();
		}, 100);
	}

	private tickSetupTimer(): void {
		if (this.state.phase !== "setup") return;

		const nowPerf = this.nowPerf();
		const elapsedMs = Math.max(0, nowPerf - this.setupStartedAtPerfMs);

		if (elapsedMs >= this.setupDurationMs) {
			this.state.clock.setupRemainingMs = 0;
			this.state.clock.syncedAtMs = Date.now();

			for (const side of ["red", "black"] as const) {
				if (!this.engineState.setupReady[side]) {
					const seed = randomBytes(4).readUInt32LE(0);
					const completed = autoCompleteSetup(this.engineState, side, seed);
					if (completed.ok) {
						this.engineState = completed.value;
					}
				}
			}

			syncSchemaFromEngine(this.state, this.engineState);
			if (this.engineState.phase === "playing") {
				this.enterPlayingPhase();
			}
			return;
		}

		if (nowPerf - this.lastSetupSyncPerfMs >= 1_000) {
			this.state.clock.setupRemainingMs = Math.max(
				0,
				this.setupDurationMs - Math.floor(elapsedMs),
			);
			this.state.clock.syncedAtMs = Date.now();
			this.lastSetupSyncPerfMs = nowPerf;
		}
	}

	private enterPlayingPhase(): void {
		this.clearAllRoomTimers();
		this.state.phase = "playing";

		const tcConfig =
			TIME_CONTROL_CONFIGS[this.state.timeControl as TimeControl] ??
			TIME_CONTROL_CONFIGS.rapid_15_10;

		this.internalRemainingMs = {
			red: tcConfig.initialMs,
			black: tcConfig.initialMs,
		};

		const syncedAtMs = Date.now();
		this.matchStartedAt = new Date(syncedAtMs);

		const redPlayer = this.getSeatedPlayerBySide("red");
		const blackPlayer = this.getSeatedPlayerBySide("black");
		this.seatedSnapshotAtPlayStart = {
			red: {
				userId: redPlayer?.userId ?? "",
				displayName: redPlayer?.displayName ?? "Red",
			},
			black: {
				userId: blackPlayer?.userId ?? "",
				displayName: blackPlayer?.displayName ?? "Black",
			},
		};

		this.state.clock.setupRemainingMs = 0;
		this.state.clock.redRemainingMs = tcConfig.initialMs;
		this.state.clock.blackRemainingMs = tcConfig.initialMs;
		this.state.clock.incrementMs = tcConfig.incrementMs;
		this.state.clock.activeSide = "red";
		this.state.clock.running = true;
		this.state.clock.syncedAtMs = syncedAtMs;

		const nowPerf = this.nowPerf();
		this.lastClockTickPerfMs = nowPerf;
		this.lastClockSyncPerfMs = nowPerf;

		syncSchemaFromEngine(this.state, this.engineState);

		this.broadcast("match_started", {
			matchId: this.state.matchId,
			initialSetupFen: this.state.initialSetupFen,
			redRemainingMs: this.state.clock.redRemainingMs,
			blackRemainingMs: this.state.clock.blackRemainingMs,
			syncedAtMs,
		});

		this.clockIntervalTimer = this.clock.setInterval(() => {
			this.tickPlayClock();
		}, 100);

		void this.syncLobbyMetadata();
	}

	private tickPlayClock(): void {
		if (this.state.phase !== "playing" || !this.state.clock.running) {
			return;
		}

		const activeSide = this.state.clock.activeSide as Side | "";
		if (activeSide !== "red" && activeSide !== "black") {
			return;
		}

		const nowPerf = this.nowPerf();
		const deltaMs = Math.max(0, nowPerf - this.lastClockTickPerfMs);
		this.lastClockTickPerfMs = nowPerf;

		this.internalRemainingMs[activeSide] -= deltaMs;

		if (this.internalRemainingMs[activeSide] <= 0) {
			this.internalRemainingMs[activeSide] = 0;
			this.state.clock.redRemainingMs = Math.max(
				0,
				Math.ceil(this.internalRemainingMs.red),
			);
			this.state.clock.blackRemainingMs = Math.max(
				0,
				Math.ceil(this.internalRemainingMs.black),
			);
			this.state.clock.syncedAtMs = Date.now();
			this.finishMatch({
				status: "win",
				winner: oppositeSide(activeSide),
				reason: "timeout",
			});
			return;
		}

		if (nowPerf - this.lastClockSyncPerfMs >= 1_000) {
			this.state.clock.redRemainingMs = Math.max(
				0,
				Math.ceil(this.internalRemainingMs.red),
			);
			this.state.clock.blackRemainingMs = Math.max(
				0,
				Math.ceil(this.internalRemainingMs.black),
			);
			this.state.clock.syncedAtMs = Date.now();
			this.lastClockSyncPerfMs = nowPerf;
		}
	}

	private finishMatch(outcome: {
		readonly status: "win" | "draw" | "aborted";
		readonly winner: Side | null;
		readonly reason: TerminationReason;
	}): void {
		if (this.state.phase === "finished") return;

		this.clearAllRoomTimers();

		this.state.phase = "finished";
		this.state.clock.running = false;
		this.state.clock.activeSide = "";
		this.state.clock.redRemainingMs = Math.max(
			0,
			Math.ceil(this.internalRemainingMs.red),
		);
		this.state.clock.blackRemainingMs = Math.max(
			0,
			Math.ceil(this.internalRemainingMs.black),
		);
		this.state.clock.syncedAtMs = Date.now();

		this.state.drawOfferedBy = "";
		this.state.rematchOfferedBy = "";
		this.state.outcomeStatus = outcome.status;
		this.state.outcomeWinner = outcome.winner ?? "";
		this.state.outcomeReason = outcome.reason;

		activePlayerRoomMap.releaseRoom(this.roomId);

		const initialSetupFen =
			this.state.initialSetupFen.trim().length > 0
				? this.state.initialSetupFen
				: null;
		const movesUci = Array.from(this.state.movesUci);
		const shouldPersist = shouldPersistCompletedMatch(
			initialSetupFen,
			outcome.reason,
		);

		const endedEvent: MatchEndedEvent = {
			matchId: this.state.matchId,
			status: outcome.status,
			winner: outcome.winner,
			reason: outcome.reason,
			initialSetupFen,
			movesUci,
			persisted: shouldPersist,
		};

		this.broadcast("match_ended", endedEvent);
		void this.syncLobbyMetadata();

		if (shouldPersist && initialSetupFen) {
			const endedAt = new Date();
			const startedAt = this.matchStartedAt ?? endedAt;
			const redPlayer = this.getSeatedPlayerBySide("red");
			const blackPlayer = this.getSeatedPlayerBySide("black");

			const redUserId =
				redPlayer?.userId || this.seatedSnapshotAtPlayStart?.red.userId || null;
			const blackUserId =
				blackPlayer?.userId ||
				this.seatedSnapshotAtPlayStart?.black.userId ||
				null;
			const redDisplayName =
				redPlayer?.displayName ||
				this.seatedSnapshotAtPlayStart?.red.displayName ||
				"Red";
			const blackDisplayName =
				blackPlayer?.displayName ||
				this.seatedSnapshotAtPlayStart?.black.displayName ||
				"Black";

			const row: NewMatchRow = {
				id: this.state.matchId,
				roomId: this.roomId,
				mode: this.state.roomMode as "public_lobby" | "private_room",
				timeControl: this.state.timeControl as TimeControl,
				redUserId,
				blackUserId,
				redDisplayName,
				blackDisplayName,
				winnerSide: outcome.winner,
				terminationReason: outcome.reason,
				initialSetupFen,
				movesUciJson: movesUci,
				totalPlies: movesUci.length,
				isRated: this.state.isRated,
				startedAt,
				endedAt,
			};

			void persistAndRateCompletedMatchWithRetry(row)
				.then((result) => {
					if (result.ratingUpdated && !this.disposed) {
						this.broadcast("rating_updated", result.ratingUpdated);
					}
				})
				.catch((err) => {
					serverLogger.error(
						{ err, matchId: row.id },
						"Unhandled error in match persistence promise",
					);
				});
		}
	}

	private startRematch(): void {
		const prevRed = this.getSeatedPlayerBySide("red");
		const prevBlack = this.getSeatedPlayerBySide("black");
		if (!prevRed || !prevBlack) return;

		prevRed.side = "black";
		prevBlack.side = "red";
		prevRed.rematchAccepted = false;
		prevBlack.rematchAccepted = false;

		activePlayerRoomMap.claim(prevBlack.userId, {
			roomId: this.roomId,
			sessionId: prevBlack.sessionId,
			side: "red",
		});
		activePlayerRoomMap.claim(prevRed.userId, {
			roomId: this.roomId,
			sessionId: prevRed.sessionId,
			side: "black",
		});

		for (const client of this.clients) {
			if (client.sessionId === prevBlack.sessionId) {
				this.bindClientStateView(client, "red");
			} else if (client.sessionId === prevRed.sessionId) {
				this.bindClientStateView(client, "black");
			}
		}

		if (this.state.hostSessionId === prevRed.sessionId) {
			this.hostAssignedSide = "black";
		} else if (this.state.hostSessionId === prevBlack.sessionId) {
			this.hostAssignedSide = "red";
		}

		this.state.matchId = randomUUID();
		this.state.rematchOfferedBy = "";
		this.state.drawOfferedBy = "";
		this.state.outcomeStatus = "";
		this.state.outcomeWinner = "";
		this.state.outcomeReason = "";
		this.state.movesUci.clear();
		this.lastDrawOfferPlyBySide = { red: -1, black: -1 };
		this.matchStartedAt = null;
		this.seatedSnapshotAtPlayStart = null;

		const tcConfig =
			TIME_CONTROL_CONFIGS[this.state.timeControl as TimeControl] ??
			TIME_CONTROL_CONFIGS.rapid_15_10;
		this.internalRemainingMs = {
			red: tcConfig.initialMs,
			black: tcConfig.initialMs,
		};
		this.state.clock.redRemainingMs = tcConfig.initialMs;
		this.state.clock.blackRemainingMs = tcConfig.initialMs;
		this.state.clock.incrementMs = tcConfig.incrementMs;

		this.enterSetupPhase();

		this.broadcast("rematch_started", {
			matchId: this.state.matchId,
			redSessionId: prevBlack.sessionId,
			blackSessionId: prevRed.sessionId,
			setupRemainingMs: this.state.clock.setupRemainingMs,
			syncedAtMs: this.state.clock.syncedAtMs,
		});

		void this.syncLobbyMetadata();
	}

	private async syncLobbyMetadata(): Promise<void> {
		if (this.state.roomMode !== "public_lobby") {
			return;
		}

		const nextMeta: LobbyRoomMetadata = {
			roomTitle: this.state.roomTitle || "Open Sittuyin Match",
			roomMode: "public_lobby",
			isRated: this.state.isRated,
			timeControl: this.state.timeControl as TimeControl,
			phase: this.state.phase as RoomPhase,
			hostDisplayName: this.hostDisplayName,
			hostRating: this.hostRating,
			hostIsProvisional: this.hostIsProvisional,
			hostPreferredSide: this.state.hostPreferredSide as PreferredSide,
			hostAssignedSide: this.hostAssignedSide,
			playerCount: Math.min(2, this.getSeatedPlayerCount()),
			spectatorCount: Math.min(16, this.getSpectatorCount()),
		};

		try {
			await this.setMatchmaking({
				metadata: {
					...(this.metadata ?? {}),
					...nextMeta,
				},
			});
			updateLobby(this);
		} catch {
			// Room may not yet be registered in matchMaker listing during early setup/teardown
		}
	}
}

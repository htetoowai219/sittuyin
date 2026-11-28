import { Callbacks, type Room } from "@colyseus/sdk";
import {
	applyMove,
	applySetupAction,
	type EngineError,
	type GameState,
	type Move,
	type OfficerRole,
	oppositeSide,
	type PlayerGameView,
	type Result,
	type SetupAction,
	type Side,
	type Square,
	toPlayerView,
	type Viewer,
} from "@sittuyin/engine";
import {
	ActionErrorEventSchema,
	type CanonicalRoomMode,
	CUSTOM_CLOSE_CODES,
	DrawDeclinedEventSchema,
	DrawOfferedEventSchema,
	MatchEndedEventSchema,
	MatchStartedEventSchema,
	type PreferredSide,
	type RatingUpdatedEvent,
	RatingUpdatedEventSchema,
	RematchOfferedEventSchema,
	RematchStartedEventSchema,
	type RoomActionError,
	type RoomPhase,
	roomSnapshotToPlayerGameView,
	ServerMaintenanceEventSchema,
	type SittuyinClockSnapshot,
	type SittuyinPlayerSnapshot,
	type SittuyinPrivateSetupSnapshot,
	type SittuyinRoomSnapshot,
	type TerminationReason,
	type TimeControl,
} from "@sittuyin/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { type AppLocale, m } from "@/i18n/locale";
import { viewToEngineQueryState } from "@/lib/board-geometry";
import {
	clearStoredRoomReconnection,
	type StorageLike,
	saveStoredRoomReconnection,
} from "@/lib/colyseus/reconnect-store";
import type {
	ExtendedOutcome,
	MatchAdapter,
	MatchClockState,
	MatchConnectionStatus,
	MatchPlayerHud,
	OnlineRoomLifecycleState,
} from "./types";

export interface ColyseusRoomLike {
	readonly roomId: string;
	readonly sessionId: string;
	readonly reconnectionToken?: string;
	readonly state: unknown;
	send(type: string, message?: unknown): void;
	leave(consented?: boolean): unknown;
	onStateChange(callback: (state: unknown) => void): unknown;
	onMessage(type: string, callback: (payload: unknown) => void): unknown;
	onDrop?(callback: (code?: number) => void): unknown;
	onReconnect?(callback: () => void): unknown;
	onLeave?(callback: (code: number) => void): unknown;
}

function readMapEntries<T>(source: unknown): Array<[string, T]> {
	if (!source || typeof source !== "object") {
		return [];
	}
	const mapLike = source as {
		entries?: () => IterableIterator<[string, T]>;
		forEach?: (cb: (val: T, key: string) => void) => void;
	};
	if (typeof mapLike.forEach === "function") {
		const entries: Array<[string, T]> = [];
		mapLike.forEach((val, key) => {
			entries.push([String(key), val]);
		});
		return entries;
	}
	if (typeof mapLike.entries === "function") {
		return Array.from(mapLike.entries());
	}
	return Object.entries(source as Record<string, T>);
}

function readStringArray(source: unknown): readonly string[] {
	if (!source) {
		return [];
	}
	if (Array.isArray(source)) {
		return source.filter((item): item is string => typeof item === "string");
	}
	if (
		typeof source === "object" &&
		Symbol.iterator in (source as Record<symbol, unknown>)
	) {
		return Array.from(source as Iterable<unknown>).filter(
			(item): item is string => typeof item === "string",
		);
	}
	return [];
}

function extractPrivateSetupSnapshot(
	raw: unknown,
): SittuyinPrivateSetupSnapshot | undefined {
	if (!raw || typeof raw !== "object") {
		return undefined;
	}
	const slice = raw as {
		myDraft?: unknown;
		hand?: {
			king?: number;
			general?: number;
			rook?: number;
			elephant?: number;
			knight?: number;
		};
	};
	const myDraft: Partial<Record<Square, OfficerRole>> = {};
	for (const [sq, role] of readMapEntries<string>(slice.myDraft)) {
		if (
			role === "king" ||
			role === "general" ||
			role === "rook" ||
			role === "elephant" ||
			role === "knight"
		) {
			myDraft[sq as Square] = role;
		}
	}
	return {
		myDraft,
		hand: {
			king: Number(slice.hand?.king ?? 1),
			general: Number(slice.hand?.general ?? 1),
			rook: Number(slice.hand?.rook ?? 2),
			elephant: Number(slice.hand?.elephant ?? 2),
			knight: Number(slice.hand?.knight ?? 2),
		},
	};
}

export function extractRoomSnapshot(rawState: unknown): SittuyinRoomSnapshot {
	const raw = (
		rawState && typeof rawState === "object" ? rawState : {}
	) as Record<string, unknown>;

	const players: Record<string, SittuyinPlayerSnapshot> = {};
	for (const [key, rawPlayer] of readMapEntries<Record<string, unknown>>(
		raw.players,
	)) {
		if (!rawPlayer || typeof rawPlayer !== "object") {
			continue;
		}
		const sideRaw = String(rawPlayer.side ?? "spectator");
		const side: "red" | "black" | "spectator" =
			sideRaw === "red" || sideRaw === "black" ? sideRaw : "spectator";
		const sessionId = String(rawPlayer.sessionId ?? key);
		players[sessionId] = {
			sessionId,
			userId:
				typeof rawPlayer.userId === "string" ? rawPlayer.userId : undefined,
			displayName: String(rawPlayer.displayName ?? "Guest"),
			rating:
				typeof rawPlayer.rating === "number" &&
				Number.isFinite(rawPlayer.rating)
					? Math.round(rawPlayer.rating)
					: 1500,
			isAnonymous:
				typeof rawPlayer.isAnonymous === "boolean"
					? rawPlayer.isAnonymous
					: true,
			side,
			connected:
				typeof rawPlayer.connected === "boolean" ? rawPlayer.connected : true,
			rematchAccepted:
				typeof rawPlayer.rematchAccepted === "boolean"
					? rawPlayer.rematchAccepted
					: false,
		};
	}

	const rawClock =
		raw.clock && typeof raw.clock === "object"
			? (raw.clock as Record<string, unknown>)
			: undefined;

	const activeSideRaw = String(rawClock?.activeSide ?? "");
	const activeSide: "" | Side =
		activeSideRaw === "red" || activeSideRaw === "black" ? activeSideRaw : "";

	const clock: SittuyinClockSnapshot | undefined = rawClock
		? {
				redRemainingMs: Number(rawClock.redRemainingMs ?? 900_000),
				blackRemainingMs: Number(rawClock.blackRemainingMs ?? 900_000),
				incrementMs: Number(rawClock.incrementMs ?? 10_000),
				setupRemainingMs: Number(rawClock.setupRemainingMs ?? 60_000),
				activeSide,
				running: Boolean(rawClock.running),
				syncedAtMs: Number(rawClock.syncedAtMs ?? 0),
			}
		: undefined;

	const phaseRaw = String(raw.phase ?? "waiting");
	const phase: RoomPhase =
		phaseRaw === "waiting" ||
		phaseRaw === "setup" ||
		phaseRaw === "playing" ||
		phaseRaw === "finished"
			? phaseRaw
			: "waiting";

	const modeRaw = String(raw.roomMode ?? "public_lobby");
	const roomMode: CanonicalRoomMode =
		modeRaw === "private_room" ? "private_room" : "public_lobby";

	const tcRaw = String(raw.timeControl ?? "rapid_15_10");
	const timeControl: TimeControl =
		tcRaw === "rapid_10_5" ||
		tcRaw === "rapid_15_10" ||
		tcRaw === "classical_30_0"
			? tcRaw
			: "rapid_15_10";

	const prefRaw = String(raw.hostPreferredSide ?? "random");
	const hostPreferredSide: PreferredSide =
		prefRaw === "red" || prefRaw === "black" ? prefRaw : "random";

	const turnRaw = String(raw.turn ?? "red");
	const turn: Side = turnRaw === "black" ? "black" : "red";

	const drawByRaw = String(raw.drawOfferedBy ?? "");
	const drawOfferedBy: "" | Side =
		drawByRaw === "red" || drawByRaw === "black" ? drawByRaw : "";

	const rematchByRaw = String(raw.rematchOfferedBy ?? "");
	const rematchOfferedBy: "" | Side =
		rematchByRaw === "red" || rematchByRaw === "black" ? rematchByRaw : "";

	const outcomeStatusRaw = String(raw.outcomeStatus ?? "");
	const outcomeStatus: "" | "win" | "draw" | "aborted" =
		outcomeStatusRaw === "win" ||
		outcomeStatusRaw === "draw" ||
		outcomeStatusRaw === "aborted"
			? outcomeStatusRaw
			: "";

	const outcomeWinnerRaw = String(raw.outcomeWinner ?? "");
	const outcomeWinner: "" | Side =
		outcomeWinnerRaw === "red" || outcomeWinnerRaw === "black"
			? outcomeWinnerRaw
			: "";

	return {
		matchId: typeof raw.matchId === "string" ? raw.matchId : "",
		phase,
		roomMode,
		roomTitle: typeof raw.roomTitle === "string" ? raw.roomTitle : "",
		inviteCode: typeof raw.inviteCode === "string" ? raw.inviteCode : "",
		hostSessionId:
			typeof raw.hostSessionId === "string" ? raw.hostSessionId : "",
		hostPreferredSide,
		timeControl,
		turn,
		currentFen: typeof raw.currentFen === "string" ? raw.currentFen : undefined,
		initialSetupFen:
			typeof raw.initialSetupFen === "string" ? raw.initialSetupFen : undefined,
		redPlacedCount: Number(raw.redPlacedCount ?? 0),
		blackPlacedCount: Number(raw.blackPlacedCount ?? 0),
		redSetupReady: Boolean(raw.redSetupReady),
		blackSetupReady: Boolean(raw.blackSetupReady),
		halfmoveClock: Number(raw.halfmoveClock ?? 0),
		bareKingClock: Number(raw.bareKingClock ?? -1),
		fullmoveNumber: Number(raw.fullmoveNumber ?? 1),
		movesUci: readStringArray(raw.movesUci),
		drawOfferedBy,
		rematchOfferedBy,
		outcomeStatus,
		outcomeWinner,
		outcomeReason:
			typeof raw.outcomeReason === "string" ? raw.outcomeReason : "",
		players,
		clock,
		redPrivate: extractPrivateSetupSnapshot(raw.redPrivate),
		blackPrivate: extractPrivateSetupSnapshot(raw.blackPrivate),
	};
}

export function deriveExtendedOutcome(
	snapshot: SittuyinRoomSnapshot,
	engineOutcome: PlayerGameView["outcome"],
): ExtendedOutcome | null {
	if (snapshot.phase !== "finished") {
		return null;
	}
	if (engineOutcome) {
		return engineOutcome;
	}
	const status = snapshot.outcomeStatus;
	const winner =
		snapshot.outcomeWinner === "red" || snapshot.outcomeWinner === "black"
			? snapshot.outcomeWinner
			: null;
	const reason = (snapshot.outcomeReason || "") as TerminationReason;

	if (status === "win" && winner) {
		if (
			reason === "checkmate" ||
			reason === "resignation" ||
			reason === "timeout" ||
			reason === "abandonment"
		) {
			return {
				status: "win",
				winner,
				reason,
			};
		}
		return {
			status: "win",
			winner,
			reason: "resignation",
		};
	}

	if (status === "draw") {
		if (
			reason === "stalemate" ||
			reason === "unavoidable_stalemate" ||
			reason === "threefold_repetition" ||
			reason === "fifty_move_rule" ||
			reason === "bare_king_fifty_move" ||
			reason === "insufficient_material" ||
			reason === "agreed_draw"
		) {
			return {
				status: "draw",
				winner: null,
				reason,
			};
		}
		return {
			status: "draw",
			winner: null,
			reason: "agreed_draw",
		};
	}

	if (status === "aborted") {
		return {
			status: "aborted",
			winner: null,
			reason:
				reason === "aborted_maintenance"
					? "aborted_maintenance"
					: "aborted_pre_move",
		};
	}

	return null;
}

export interface ColyseusMatchControllerOptions {
	readonly room: ColyseusRoomLike;
	readonly locale: AppLocale;
	readonly userId?: string;
	readonly nowPerf?: () => number;
	readonly storage?: StorageLike | null;
	readonly autoStartTimer?: boolean;
	readonly onActionError?: (error: RoomActionError) => void;
	readonly onDrawDeclined?: (declinedBy: Side) => void;
	readonly onTerminalLeave?: (code: number) => void;
}

interface OptimisticPreviewState {
	readonly view: PlayerGameView;
	readonly historyStates: readonly GameState[];
}

export class ColyseusMatchController {
	private readonly room: ColyseusRoomLike;
	private locale: AppLocale;
	private readonly userId: string | undefined;
	private readonly nowPerf: () => number;
	private readonly storage: StorageLike | null | undefined;
	private readonly onActionError?: (error: RoomActionError) => void;
	private readonly onDrawDeclined?: (declinedBy: Side) => void;
	private readonly onTerminalLeave?: (code: number) => void;

	private snapshot: SittuyinRoomSnapshot;
	private optimisticPreview: OptimisticPreviewState | null = null;
	private connectionStatus: MatchConnectionStatus = "connected";
	private maintenanceWarning: string | null = null;
	private ratingUpdate: RatingUpdatedEvent | null = null;

	private baseClockReceivedPerfMs: number;
	private baseSetupRemainingMs: number;
	private baseRedRemainingMs: number;
	private baseBlackRemainingMs: number;
	private lastClockSignature = "";

	private interpolatedSetupRemainingMs: number;
	private interpolatedRedRemainingMs: number;
	private interpolatedBlackRemainingMs: number;

	private intervalId: ReturnType<typeof setInterval> | null = null;
	private readonly listeners = new Set<() => void>();
	private cachedAdapter: MatchAdapter;

	constructor(options: ColyseusMatchControllerOptions) {
		this.room = options.room;
		this.locale = options.locale;
		this.userId = options.userId;
		this.nowPerf =
			options.nowPerf ??
			(() =>
				typeof performance !== "undefined" ? performance.now() : Date.now());
		this.storage = options.storage;
		this.onActionError = options.onActionError;
		this.onDrawDeclined = options.onDrawDeclined;
		this.onTerminalLeave = options.onTerminalLeave;

		this.snapshot = extractRoomSnapshot(this.room.state);
		const perfNow = this.nowPerf();
		this.baseClockReceivedPerfMs = perfNow;
		this.baseSetupRemainingMs = this.snapshot.clock?.setupRemainingMs ?? 60_000;
		this.baseRedRemainingMs = this.snapshot.clock?.redRemainingMs ?? 900_000;
		this.baseBlackRemainingMs =
			this.snapshot.clock?.blackRemainingMs ?? 900_000;
		this.interpolatedSetupRemainingMs = this.baseSetupRemainingMs;
		this.interpolatedRedRemainingMs = this.baseRedRemainingMs;
		this.interpolatedBlackRemainingMs = this.baseBlackRemainingMs;
		this.lastClockSignature = this.computeClockSignature(this.snapshot);

		this.bindRoomEvents();
		this.syncReconnectionToken();
		this.cachedAdapter = this.buildAdapter();

		if (options.autoStartTimer ?? true) {
			this.startInterpolationTimer();
		}
	}

	private computeClockSignature(snap: SittuyinRoomSnapshot): string {
		const c = snap.clock;
		if (!c) {
			return `${snap.phase}:no-clock`;
		}
		return `${snap.phase}:${c.syncedAtMs}:${c.setupRemainingMs}:${c.redRemainingMs}:${c.blackRemainingMs}:${c.activeSide}:${c.running}`;
	}

	private bindRoomEvents(): void {
		this.room.onStateChange((rawState) => {
			this.handleAuthoritativeState(rawState);
		});

		// Also register Colyseus 0.18 Callbacks.get(room) when passed a real SDK Room
		try {
			const sdkRoom = this.room as unknown as Room;
			const callbacks = Callbacks.get(sdkRoom);
			callbacks.onAdd("players", () => {
				this.handleAuthoritativeState(this.room.state);
			});
			callbacks.onRemove("players", () => {
				this.handleAuthoritativeState(this.room.state);
			});
		} catch {
			// Safe fallback for unit test mock rooms that don't carry full Schema internals
		}

		this.room.onMessage("action_error", (raw) => {
			const parsed = ActionErrorEventSchema.safeParse(raw);
			// Roll back optimistic state to last authoritative snapshot immediately
			this.optimisticPreview = null;
			this.rebuildAndNotify();
			if (parsed.success) {
				this.onActionError?.(parsed.data);
			}
		});

		this.room.onMessage("match_started", (raw) => {
			const parsed = MatchStartedEventSchema.safeParse(raw);
			if (parsed.success) {
				this.optimisticPreview = null;
				this.handleAuthoritativeState(this.room.state);
			}
		});

		this.room.onMessage("match_ended", (raw) => {
			const parsed = MatchEndedEventSchema.safeParse(raw);
			if (parsed.success) {
				this.optimisticPreview = null;
				this.clearStoredToken();
				this.handleAuthoritativeState(this.room.state);
			}
		});

		this.room.onMessage("draw_offered", (raw) => {
			const parsed = DrawOfferedEventSchema.safeParse(raw);
			if (parsed.success) {
				this.handleAuthoritativeState(this.room.state);
			}
		});

		this.room.onMessage("draw_declined", (raw) => {
			const parsed = DrawDeclinedEventSchema.safeParse(raw);
			this.handleAuthoritativeState(this.room.state);
			if (parsed.success) {
				this.onDrawDeclined?.(parsed.data.declinedBy);
			}
		});

		this.room.onMessage("rematch_offered", (raw) => {
			const parsed = RematchOfferedEventSchema.safeParse(raw);
			if (parsed.success) {
				this.handleAuthoritativeState(this.room.state);
			}
		});

		this.room.onMessage("rematch_started", (raw) => {
			const parsed = RematchStartedEventSchema.safeParse(raw);
			if (parsed.success) {
				this.optimisticPreview = null;
				this.ratingUpdate = null;
				this.handleAuthoritativeState(this.room.state);
			}
		});

		this.room.onMessage("rating_updated", (raw) => {
			const parsed = RatingUpdatedEventSchema.safeParse(raw);
			if (parsed.success) {
				this.ratingUpdate = parsed.data;
				this.rebuildAndNotify();
			}
		});

		this.room.onMessage("server_maintenance", (raw) => {
			const parsed = ServerMaintenanceEventSchema.safeParse(raw);
			this.maintenanceWarning = parsed.success
				? parsed.data.reason
				: "Server maintenance in progress.";
			this.rebuildAndNotify();
		});

		this.room.onDrop?.(() => {
			this.connectionStatus = "reconnecting";
			this.rebuildAndNotify();
		});

		this.room.onReconnect?.(() => {
			this.connectionStatus = "connected";
			this.syncReconnectionToken();
			this.handleAuthoritativeState(this.room.state);
		});

		this.room.onLeave?.((code) => {
			this.connectionStatus = "disconnected";
			if (
				code === CUSTOM_CLOSE_CODES.WAITING_TIMEOUT ||
				code === CUSTOM_CLOSE_CODES.ROOM_ABORTED ||
				code === 4000
			) {
				this.clearStoredToken();
			}
			this.rebuildAndNotify();
			this.onTerminalLeave?.(code);
		});
	}

	private syncReconnectionToken(): void {
		if (!this.userId || !this.room.reconnectionToken) {
			return;
		}
		const myPlayer = this.snapshot.players[this.room.sessionId];
		if (myPlayer && myPlayer.side === "spectator") {
			return;
		}
		if (this.snapshot.phase === "finished") {
			this.clearStoredToken();
			return;
		}
		saveStoredRoomReconnection(
			{
				roomId: this.room.roomId,
				inviteCode: this.snapshot.inviteCode || null,
				reconnectionToken: this.room.reconnectionToken,
				userId: this.userId,
			},
			this.storage !== undefined ? { storage: this.storage } : undefined,
		);
	}

	private clearStoredToken(): void {
		clearStoredRoomReconnection(
			this.room.roomId,
			this.storage !== undefined ? { storage: this.storage } : undefined,
		);
		if (this.snapshot.inviteCode) {
			clearStoredRoomReconnection(
				this.snapshot.inviteCode,
				this.storage !== undefined ? { storage: this.storage } : undefined,
			);
		}
	}

	public handleAuthoritativeState(rawState: unknown): void {
		const nextSnapshot = extractRoomSnapshot(rawState);
		const nextSig = this.computeClockSignature(nextSnapshot);

		this.snapshot = nextSnapshot;
		// Clear optimistic preview whenever an authoritative state patch arrives
		this.optimisticPreview = null;

		if (nextSig !== this.lastClockSignature) {
			this.lastClockSignature = nextSig;
			this.baseClockReceivedPerfMs = this.nowPerf();
			this.baseSetupRemainingMs =
				nextSnapshot.clock?.setupRemainingMs ?? 60_000;
			this.baseRedRemainingMs = nextSnapshot.clock?.redRemainingMs ?? 900_000;
			this.baseBlackRemainingMs =
				nextSnapshot.clock?.blackRemainingMs ?? 900_000;
			this.interpolatedSetupRemainingMs = this.baseSetupRemainingMs;
			this.interpolatedRedRemainingMs = this.baseRedRemainingMs;
			this.interpolatedBlackRemainingMs = this.baseBlackRemainingMs;
		}

		this.syncReconnectionToken();
		this.rebuildAndNotify();
	}

	public tickClocks(nowPerfMs = this.nowPerf()): void {
		const elapsedMs = Math.max(0, nowPerfMs - this.baseClockReceivedPerfMs);
		let changed = false;

		if (this.snapshot.phase === "setup") {
			const nextSetup = Math.max(
				0,
				Math.round(this.baseSetupRemainingMs - elapsedMs),
			);
			if (nextSetup !== this.interpolatedSetupRemainingMs) {
				this.interpolatedSetupRemainingMs = nextSetup;
				changed = true;
			}
		} else if (
			this.snapshot.phase === "playing" &&
			this.snapshot.clock?.running
		) {
			const activeSide = this.snapshot.clock.activeSide;
			if (activeSide === "red") {
				const nextRed = Math.max(
					0,
					Math.round(this.baseRedRemainingMs - elapsedMs),
				);
				if (
					nextRed !== this.interpolatedRedRemainingMs ||
					this.interpolatedBlackRemainingMs !== this.baseBlackRemainingMs
				) {
					this.interpolatedRedRemainingMs = nextRed;
					this.interpolatedBlackRemainingMs = this.baseBlackRemainingMs;
					changed = true;
				}
			} else if (activeSide === "black") {
				const nextBlack = Math.max(
					0,
					Math.round(this.baseBlackRemainingMs - elapsedMs),
				);
				if (
					nextBlack !== this.interpolatedBlackRemainingMs ||
					this.interpolatedRedRemainingMs !== this.baseRedRemainingMs
				) {
					this.interpolatedBlackRemainingMs = nextBlack;
					this.interpolatedRedRemainingMs = this.baseRedRemainingMs;
					changed = true;
				}
			}
		}

		if (changed) {
			this.rebuildAndNotify();
		}
	}

	public startInterpolationTimer(): void {
		if (this.intervalId !== null) {
			return;
		}
		this.intervalId = setInterval(() => {
			this.tickClocks();
		}, 100);
	}

	public dispose(): void {
		if (this.intervalId !== null) {
			clearInterval(this.intervalId);
			this.intervalId = null;
		}
		this.listeners.clear();
	}

	public setLocale(locale: AppLocale): void {
		if (this.locale !== locale) {
			this.locale = locale;
			this.rebuildAndNotify();
		}
	}

	public subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	public getAdapterState(): MatchAdapter {
		return this.cachedAdapter;
	}

	private rebuildAndNotify(): void {
		this.cachedAdapter = this.buildAdapter();
		for (const listener of this.listeners) {
			listener();
		}
	}

	private resolveViewer(): Viewer {
		const me = this.snapshot.players[this.room.sessionId];
		if (me && (me.side === "red" || me.side === "black")) {
			return me.side;
		}
		return "spectator";
	}

	public dispatchSetup = (action: SetupAction): Result<void, EngineError> => {
		const viewer = this.resolveViewer();
		if (viewer === "spectator") {
			return {
				ok: false,
				error: {
					code: "INVALID_PHASE",
					message: "Spectators cannot modify setup.",
				},
			};
		}
		if (this.snapshot.phase !== "setup") {
			return {
				ok: false,
				error: {
					code: "INVALID_PHASE",
					message: "Setup actions are only valid during the setup phase.",
				},
			};
		}

		const baseReconstructed =
			this.optimisticPreview ??
			roomSnapshotToPlayerGameView(this.snapshot, viewer);
		const currentView = baseReconstructed.view;
		const opponent = oppositeSide(viewer);

		// Keep setupReady[opponent] false during local preview validation so locking second
		// does not commit an empty opponent board before the server reveals initialSetupFen.
		const localQueryState: GameState = {
			...viewToEngineQueryState(currentView),
			setupReady: {
				...currentView.setupReady,
				[opponent]: false,
			},
		};

		const validated = applySetupAction(localQueryState, viewer, action);
		if (!validated.ok) {
			return validated;
		}

		const nextPlayerView = toPlayerView(validated.value, viewer);
		const previewView: PlayerGameView = {
			...nextPlayerView,
			setupReady: {
				...nextPlayerView.setupReady,
				[opponent]: currentView.setupReady[opponent],
			},
			placedCounts: {
				...nextPlayerView.placedCounts,
				[opponent]: currentView.placedCounts[opponent],
			},
		};

		this.optimisticPreview = {
			view: previewView,
			historyStates: baseReconstructed.historyStates,
		};
		this.rebuildAndNotify();

		this.room.send("setup_action", { action });
		return { ok: true, value: undefined };
	};

	public applyRandomSetup = (): Result<void, EngineError> => {
		const viewer = this.resolveViewer();
		if (viewer === "spectator" || this.snapshot.phase !== "setup") {
			return {
				ok: false,
				error: {
					code: "INVALID_PHASE",
					message:
						"Random setup is only permitted for seated players during setup.",
				},
			};
		}
		const baseReconstructed =
			this.optimisticPreview ??
			roomSnapshotToPlayerGameView(this.snapshot, viewer);
		if (baseReconstructed.view.setupReady[viewer]) {
			return {
				ok: false,
				error: {
					code: "SIDE_ALREADY_LOCKED",
					message: "Unlock setup before randomizing.",
				},
			};
		}
		this.room.send("random_setup", {});
		return { ok: true, value: undefined };
	};

	public dispatchMove = (move: Move): Result<void, EngineError> => {
		const viewer = this.resolveViewer();
		if (viewer === "spectator") {
			return {
				ok: false,
				error: {
					code: "INVALID_PHASE",
					message: "Spectators cannot make moves.",
				},
			};
		}
		if (this.snapshot.phase !== "playing") {
			return {
				ok: false,
				error: {
					code: "INVALID_PHASE",
					message: "Moves are only valid during the playing phase.",
				},
			};
		}

		const baseReconstructed =
			this.optimisticPreview ??
			roomSnapshotToPlayerGameView(this.snapshot, viewer);
		const currentView = baseReconstructed.view;

		if (currentView.turn !== viewer) {
			return {
				ok: false,
				error: {
					code: "WRONG_TURN",
					message: "It is not your turn.",
				},
			};
		}

		const queryState = viewToEngineQueryState(currentView);
		const validated = applyMove(queryState, move);
		if (!validated.ok) {
			return validated;
		}

		const nextState = validated.value;
		this.optimisticPreview = {
			view: toPlayerView(nextState, viewer),
			historyStates: [...baseReconstructed.historyStates, nextState],
		};
		this.rebuildAndNotify();

		this.room.send("move", { move });
		return { ok: true, value: undefined };
	};

	public requestResign = (): void => {
		const viewer = this.resolveViewer();
		if (viewer === "spectator") {
			return;
		}
		this.room.send("resign", {});
	};

	public requestDraw = (): void => {
		const viewer = this.resolveViewer();
		if (viewer === "spectator" || this.snapshot.phase !== "playing") {
			return;
		}
		this.room.send("offer_draw", {});
	};

	public respondDraw = (accept: boolean): void => {
		const viewer = this.resolveViewer();
		if (viewer === "spectator" || this.snapshot.phase !== "playing") {
			return;
		}
		this.room.send("respond_draw", { accept });
	};

	public offerRematch = (): void => {
		const viewer = this.resolveViewer();
		if (viewer === "spectator" || this.snapshot.phase !== "finished") {
			return;
		}
		this.room.send("offer_rematch", {});
	};

	public respondRematch = (accept: boolean): void => {
		const viewer = this.resolveViewer();
		if (viewer === "spectator" || this.snapshot.phase !== "finished") {
			return;
		}
		this.room.send("respond_rematch", { accept });
	};

	public abortMatch = (): void => {
		const viewer = this.resolveViewer();
		if (viewer === "spectator") {
			return;
		}
		if (this.snapshot.phase === "waiting") {
			this.clearStoredToken();
			this.room.send("abort", {});
			void this.room.leave(true);
			return;
		}
		this.room.send("abort", {});
	};

	public leaveRoom = (): void => {
		this.clearStoredToken();
		void this.room.leave(true);
	};

	public confirmHandoff = (): void => {
		// Online rooms use simultaneous hidden setup; no pass-and-play curtain
	};

	private buildAdapter(): MatchAdapter {
		const viewer = this.resolveViewer();
		const reconstructed =
			this.optimisticPreview ??
			roomSnapshotToPlayerGameView(this.snapshot, viewer);

		let redPlayerEntry: SittuyinPlayerSnapshot | undefined;
		let blackPlayerEntry: SittuyinPlayerSnapshot | undefined;
		let spectatorCount = 0;

		for (const p of Object.values(this.snapshot.players)) {
			if (p.side === "red") {
				redPlayerEntry = p;
			} else if (p.side === "black") {
				blackPlayerEntry = p;
			} else {
				spectatorCount++;
			}
		}

		const waitingLabel = m.online_waiting_opponent({}, { locale: this.locale });

		const players: Readonly<Record<Side, MatchPlayerHud>> = {
			red: redPlayerEntry
				? {
						side: "red",
						displayName: redPlayerEntry.displayName,
						rating: redPlayerEntry.rating ?? 1500,
						connected: redPlayerEntry.connected,
						isLocal: redPlayerEntry.sessionId === this.room.sessionId,
					}
				: {
						side: "red",
						displayName: waitingLabel,
						rating: null,
						connected: false,
						isLocal: false,
					},
			black: blackPlayerEntry
				? {
						side: "black",
						displayName: blackPlayerEntry.displayName,
						rating: blackPlayerEntry.rating ?? 1500,
						connected: blackPlayerEntry.connected,
						isLocal: blackPlayerEntry.sessionId === this.room.sessionId,
					}
				: {
						side: "black",
						displayName: waitingLabel,
						rating: null,
						connected: false,
						isLocal: false,
					},
		};

		const clockSnap = this.snapshot.clock;
		const activeSide: Side | null =
			this.snapshot.phase === "playing" &&
			clockSnap?.running &&
			(clockSnap.activeSide === "red" || clockSnap.activeSide === "black")
				? clockSnap.activeSide
				: null;

		const clock: MatchClockState = {
			enabled: true,
			timeControl: this.snapshot.timeControl,
			remainingMs: {
				red: this.interpolatedRedRemainingMs,
				black: this.interpolatedBlackRemainingMs,
			},
			activeSide,
			lowTimeThresholdMs: 30_000,
			criticalTimeThresholdMs: 10_000,
			syncedAtMs: clockSnap?.syncedAtMs ?? Date.now(),
		};

		const outcome = deriveExtendedOutcome(
			this.snapshot,
			reconstructed.view.outcome,
		);

		const isSeatedPlayer = viewer === "red" || viewer === "black";
		const roomPhase = this.snapshot.phase;
		const plyCount = this.snapshot.movesUci?.length ?? 0;

		const canAbort =
			isSeatedPlayer &&
			(roomPhase === "waiting" ||
				roomPhase === "setup" ||
				(roomPhase === "playing" && plyCount < 2));

		const myPlayerEntry = this.snapshot.players[this.room.sessionId];

		const online: OnlineRoomLifecycleState = {
			roomId: this.room.roomId,
			matchId: this.snapshot.matchId ?? "",
			roomMode: this.snapshot.roomMode,
			isRated: this.snapshot.isRated,
			roomTitle: this.snapshot.roomTitle || "Sittuyin Match",
			inviteCode:
				this.snapshot.inviteCode && this.snapshot.inviteCode.trim().length > 0
					? this.snapshot.inviteCode.trim()
					: null,
			hostPreferredSide: this.snapshot.hostPreferredSide ?? "random",
			timeControl: this.snapshot.timeControl,
			roomPhase,
			spectatorCount,
			setupRemainingMs:
				roomPhase === "setup" ? this.interpolatedSetupRemainingMs : null,
			setupSyncedAtMs:
				roomPhase === "setup" ? (clockSnap?.syncedAtMs ?? null) : null,
			drawOfferedBy:
				this.snapshot.drawOfferedBy === "red" ||
				this.snapshot.drawOfferedBy === "black"
					? this.snapshot.drawOfferedBy
					: null,
			rematchOfferedBy:
				this.snapshot.rematchOfferedBy === "red" ||
				this.snapshot.rematchOfferedBy === "black"
					? this.snapshot.rematchOfferedBy
					: null,
			rematchAcceptedByMe: Boolean(myPlayerEntry?.rematchAccepted),
			canAbort,
			maintenanceWarning: this.maintenanceWarning,
			ratingUpdate: this.ratingUpdate,
		};

		const isInteractive =
			isSeatedPlayer &&
			(roomPhase === "setup" || roomPhase === "playing") &&
			outcome === null &&
			this.connectionStatus === "connected";

		return {
			mode: "online",
			view: reconstructed.view,
			players,
			clock,
			historyStates: reconstructed.historyStates,
			pendingRevealHandoff: null,
			connectionStatus: this.connectionStatus,
			isInteractive,
			outcome,
			online,
			dispatchSetup: this.dispatchSetup,
			dispatchMove: this.dispatchMove,
			applyRandomSetup: this.applyRandomSetup,
			requestResign: this.requestResign,
			requestDraw: this.requestDraw,
			confirmHandoff: this.confirmHandoff,
			offerRematch: this.offerRematch,
			respondDraw: this.respondDraw,
			respondRematch: this.respondRematch,
			abortMatch: this.abortMatch,
			leaveRoom: this.leaveRoom,
		};
	}
}

export interface UseColyseusMatchAdapterOptions {
	readonly room: ColyseusRoomLike;
	readonly locale: AppLocale;
	readonly userId?: string;
	readonly onActionError?: (error: RoomActionError) => void;
	readonly onDrawDeclined?: (declinedBy: Side) => void;
	readonly onTerminalLeave?: (code: number) => void;
}

export function useColyseusMatchAdapter(
	options: UseColyseusMatchAdapterOptions,
): MatchAdapter {
	const {
		room,
		locale,
		userId,
		onActionError,
		onDrawDeclined,
		onTerminalLeave,
	} = options;

	const callbacksRef = useRef({
		onActionError,
		onDrawDeclined,
		onTerminalLeave,
	});
	callbacksRef.current = {
		onActionError,
		onDrawDeclined,
		onTerminalLeave,
	};

	const initialLocaleRef = useRef(locale);

	const controller = useMemo(
		() =>
			new ColyseusMatchController({
				room,
				locale: initialLocaleRef.current,
				userId,
				autoStartTimer: false,
				onActionError: (err) => callbacksRef.current.onActionError?.(err),
				onDrawDeclined: (side) => callbacksRef.current.onDrawDeclined?.(side),
				onTerminalLeave: (code) => callbacksRef.current.onTerminalLeave?.(code),
			}),
		[room, userId],
	);

	const [adapter, setAdapter] = useState<MatchAdapter>(() =>
		controller.getAdapterState(),
	);

	useEffect(() => {
		controller.setLocale(locale);
	}, [controller, locale]);

	useEffect(() => {
		setAdapter(controller.getAdapterState());
		controller.startInterpolationTimer();
		const unsubscribe = controller.subscribe(() => {
			setAdapter(controller.getAdapterState());
		});
		return () => {
			unsubscribe();
			controller.dispose();
		};
	}, [controller]);

	return adapter;
}

import type { Room } from "@colyseus/sdk";
import {
	INVITE_CODE_LENGTH,
	type LobbyRoomMetadata,
	LobbyRoomMetadataSchema,
	SITTUYIN_LOBBY_ROOM_NAME,
	type TimeControl,
} from "@sittuyin/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createColyseusClient, resolveBrowserGameServerUrl } from "./client";

export type LobbyConnectionStatus =
	| "connecting"
	| "connected"
	| "reconnecting"
	| "error";

export type TimeControlFilter = "all" | TimeControl;

export interface LobbyRoomEntry {
	readonly roomId: string;
	readonly clients: number;
	readonly maxClients: number;
	readonly metadata: LobbyRoomMetadata;
}

export interface PartitionedLobbyRooms {
	readonly openChallenges: readonly LobbyRoomEntry[];
	readonly liveMatches: readonly LobbyRoomEntry[];
}

export function normalizeInviteCodeInput(raw: string): string {
	return raw
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "")
		.slice(0, INVITE_CODE_LENGTH);
}

export function parseLobbyRoomEntry(
	raw: unknown,
	fallbackRoomId?: string,
): LobbyRoomEntry | null {
	if (!raw || typeof raw !== "object") {
		return null;
	}
	const obj = raw as Record<string, unknown>;
	const roomId = String(obj.roomId ?? fallbackRoomId ?? "").trim();
	if (!roomId) {
		return null;
	}
	const parsedMeta = LobbyRoomMetadataSchema.safeParse(obj.metadata);
	if (!parsedMeta.success) {
		return null;
	}
	return {
		roomId,
		clients:
			typeof obj.clients === "number" && Number.isFinite(obj.clients)
				? obj.clients
				: parsedMeta.data.playerCount + parsedMeta.data.spectatorCount,
		maxClients:
			typeof obj.maxClients === "number" && Number.isFinite(obj.maxClients)
				? obj.maxClients
				: 18,
		metadata: parsedMeta.data,
	};
}

export function applyLobbyMessage(
	currentRooms: readonly LobbyRoomEntry[],
	type: "rooms" | "+" | "-",
	payload: unknown,
): readonly LobbyRoomEntry[] {
	if (type === "rooms") {
		if (!Array.isArray(payload)) {
			return currentRooms;
		}
		const next: LobbyRoomEntry[] = [];
		for (const item of payload) {
			const parsed = parseLobbyRoomEntry(item);
			if (parsed) {
				next.push(parsed);
			}
		}
		return next;
	}

	if (type === "+") {
		if (!Array.isArray(payload) || payload.length < 2) {
			return currentRooms;
		}
		const roomId = String(payload[0] ?? "").trim();
		const parsed = parseLobbyRoomEntry(payload[1], roomId);
		if (!parsed) {
			return currentRooms.filter((r) => r.roomId !== roomId);
		}
		const existingIndex = currentRooms.findIndex(
			(r) => r.roomId === parsed.roomId,
		);
		if (existingIndex === -1) {
			return [parsed, ...currentRooms];
		}
		const copy = [...currentRooms];
		copy[existingIndex] = parsed;
		return copy;
	}

	if (type === "-") {
		const removedId = String(payload ?? "").trim();
		if (!removedId) {
			return currentRooms;
		}
		return currentRooms.filter((r) => r.roomId !== removedId);
	}

	return currentRooms;
}

export function partitionLobbyRooms(
	rooms: readonly LobbyRoomEntry[],
	timeControlFilter: TimeControlFilter,
): PartitionedLobbyRooms {
	const openChallenges: LobbyRoomEntry[] = [];
	const liveMatches: LobbyRoomEntry[] = [];

	for (const entry of rooms) {
		if (
			timeControlFilter !== "all" &&
			entry.metadata.timeControl !== timeControlFilter
		) {
			continue;
		}
		if (entry.metadata.roomMode !== "public_lobby") {
			continue;
		}
		if (
			entry.metadata.phase === "waiting" &&
			entry.metadata.playerCount === 1
		) {
			openChallenges.push(entry);
		} else if (
			entry.metadata.phase === "setup" ||
			entry.metadata.phase === "playing"
		) {
			liveMatches.push(entry);
		}
	}

	return {
		openChallenges,
		liveMatches,
	};
}

export interface UseOnlineLobbyOptions {
	readonly serverUrl?: string;
	readonly initialFilter?: TimeControlFilter;
	readonly initialRooms?: readonly LobbyRoomEntry[];
	readonly autoConnect?: boolean;
}

export interface UseOnlineLobbyResult {
	readonly connectionStatus: LobbyConnectionStatus;
	readonly rooms: readonly LobbyRoomEntry[];
	readonly openChallenges: readonly LobbyRoomEntry[];
	readonly liveMatches: readonly LobbyRoomEntry[];
	readonly timeControlFilter: TimeControlFilter;
	readonly setTimeControlFilter: (filter: TimeControlFilter) => void;
	readonly errorMessage: string | null;
	readonly reconnectLobby: () => void;
}

export function useOnlineLobby(
	options?: UseOnlineLobbyOptions,
): UseOnlineLobbyResult {
	const [connectionStatus, setConnectionStatus] =
		useState<LobbyConnectionStatus>(
			options?.autoConnect === false ? "connected" : "connecting",
		);
	const [rooms, setRooms] = useState<readonly LobbyRoomEntry[]>(
		() => options?.initialRooms ?? [],
	);
	const [timeControlFilter, setTimeControlFilter] = useState<TimeControlFilter>(
		options?.initialFilter ?? "all",
	);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [connectAttempt, setConnectAttempt] = useState(0);

	const lobbyRoomRef = useRef<Room | null>(null);
	const resolvedUrl = resolveBrowserGameServerUrl(options?.serverUrl);
	const autoConnect = options?.autoConnect ?? true;

	useEffect(() => {
		if (!autoConnect || connectAttempt < 0) {
			return;
		}

		let cancelled = false;
		setConnectionStatus("connecting");
		setErrorMessage(null);

		const client = createColyseusClient(resolvedUrl);

		client
			.joinOrCreate(SITTUYIN_LOBBY_ROOM_NAME)
			.then((lobbyRoom) => {
				if (cancelled) {
					void lobbyRoom.leave(true);
					return;
				}
				lobbyRoomRef.current = lobbyRoom;
				setConnectionStatus("connected");

				lobbyRoom.onMessage("rooms", (payload) => {
					if (cancelled) return;
					setRooms((prev) => applyLobbyMessage(prev, "rooms", payload));
				});

				lobbyRoom.onMessage("+", (payload) => {
					if (cancelled) return;
					setRooms((prev) => applyLobbyMessage(prev, "+", payload));
				});

				lobbyRoom.onMessage("-", (payload) => {
					if (cancelled) return;
					setRooms((prev) => applyLobbyMessage(prev, "-", payload));
				});

				lobbyRoom.onDrop?.(() => {
					if (!cancelled) {
						setConnectionStatus("reconnecting");
					}
				});

				lobbyRoom.onReconnect?.(() => {
					if (!cancelled) {
						setConnectionStatus("connected");
					}
				});

				lobbyRoom.onLeave((code) => {
					if (!cancelled && code !== 4000) {
						setConnectionStatus("error");
					}
				});
			})
			.catch((err: unknown) => {
				if (cancelled) return;
				setConnectionStatus("error");
				setErrorMessage(
					err instanceof Error ? err.message : "Could not connect to lobby",
				);
			});

		return () => {
			cancelled = true;
			const current = lobbyRoomRef.current;
			lobbyRoomRef.current = null;
			if (current) {
				void current.leave(true);
			}
		};
	}, [autoConnect, resolvedUrl, connectAttempt]);

	const reconnectLobby = useCallback(() => {
		setConnectAttempt((n) => n + 1);
	}, []);

	const partitioned = useMemo(
		() => partitionLobbyRooms(rooms, timeControlFilter),
		[rooms, timeControlFilter],
	);

	return {
		connectionStatus,
		rooms,
		openChallenges: partitioned.openChallenges,
		liveMatches: partitioned.liveMatches,
		timeControlFilter,
		setTimeControlFilter,
		errorMessage,
		reconnectLobby,
	};
}

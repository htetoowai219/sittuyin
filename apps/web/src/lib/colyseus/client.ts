import { Client, type Room } from "@colyseus/sdk";

export const DEFAULT_GAME_SERVER_URL = "http://localhost:2567";
const HANDOFF_TTL_MS = 30_000;

export function resolveBrowserGameServerUrl(explicitUrl?: string): string {
	if (explicitUrl && explicitUrl.trim().length > 0) {
		return explicitUrl.trim();
	}
	const fromImportMeta =
		typeof import.meta !== "undefined" &&
		typeof import.meta.env === "object" &&
		import.meta.env !== null
			? (import.meta.env.VITE_GAME_SERVER_URL as string | undefined)
			: undefined;
	const fromProcess =
		typeof process !== "undefined"
			? process.env.VITE_GAME_SERVER_URL
			: undefined;
	const candidate = (fromImportMeta ?? fromProcess ?? "").trim();
	return candidate.length > 0 ? candidate : DEFAULT_GAME_SERVER_URL;
}

export function createColyseusClient(
	serverUrl?: string,
	authToken?: string,
): Client {
	const client = new Client(resolveBrowserGameServerUrl(serverUrl));
	if (authToken && authToken.trim().length > 0) {
		client.auth.token = authToken.trim();
	}
	return client;
}

export interface PendingRoomHandoffEntry {
	readonly roomId: string;
	readonly inviteCode: string | null;
	readonly room: Room;
	readonly createdAtMs: number;
}

let pendingHandoff: PendingRoomHandoffEntry | null = null;

export function setPendingRoomHandoff(options: {
	readonly room: Room;
	readonly inviteCode?: string | null;
	readonly nowMs?: number;
}): void {
	const stateInvite =
		(options.room.state as { inviteCode?: string } | undefined)?.inviteCode ??
		null;
	const resolvedInvite =
		(options.inviteCode ?? stateInvite ?? "").trim() || null;

	pendingHandoff = {
		roomId: options.room.roomId,
		inviteCode: resolvedInvite,
		room: options.room,
		createdAtMs: options.nowMs ?? Date.now(),
	};
}

export function consumePendingRoomHandoff(
	roomIdOrInviteCode: string,
	nowMs = Date.now(),
): Room | null {
	if (!pendingHandoff) {
		return null;
	}
	if (nowMs - pendingHandoff.createdAtMs > HANDOFF_TTL_MS) {
		pendingHandoff = null;
		return null;
	}
	const target = roomIdOrInviteCode.trim().toUpperCase();
	const matchesRoomId = pendingHandoff.roomId.trim().toUpperCase() === target;
	const matchesInvite =
		pendingHandoff.inviteCode !== null &&
		pendingHandoff.inviteCode.trim().toUpperCase() === target;

	if (!matchesRoomId && !matchesInvite) {
		return null;
	}

	const room = pendingHandoff.room;
	pendingHandoff = null;
	return room;
}

export function clearPendingRoomHandoff(): void {
	pendingHandoff = null;
}

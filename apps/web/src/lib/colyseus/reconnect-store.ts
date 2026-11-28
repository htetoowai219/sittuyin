export const RECONNECT_STORAGE_KEY = "sittuyin.reconnect.v1";
export const RECONNECT_TTL_MS = 65_000;
export const MAX_STORED_RECONNECTIONS = 5;

export interface StoredRoomReconnection {
	readonly roomId: string;
	readonly inviteCode?: string | null;
	readonly reconnectionToken: string;
	readonly userId: string;
	readonly savedAtMs: number;
	readonly expiresAtMs: number;
}

export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

function resolveDefaultStorage(): StorageLike | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}

function normalizeRoomKey(roomId: string): string {
	return roomId.trim().toUpperCase();
}

function readValidEntries(
	storage: StorageLike | null,
	nowMs: number,
): Record<string, StoredRoomReconnection> {
	if (!storage) {
		return {};
	}
	try {
		const raw = storage.getItem(RECONNECT_STORAGE_KEY);
		if (!raw) {
			return {};
		}
		const parsed = JSON.parse(raw) as unknown;
		if (typeof parsed !== "object" || parsed === null) {
			return {};
		}
		const record = parsed as Record<string, unknown>;
		const valid: Record<string, StoredRoomReconnection> = {};

		for (const [key, item] of Object.entries(record)) {
			if (typeof item !== "object" || item === null) {
				continue;
			}
			const candidate = item as Partial<StoredRoomReconnection>;
			if (
				typeof candidate.roomId !== "string" ||
				typeof candidate.reconnectionToken !== "string" ||
				typeof candidate.userId !== "string" ||
				typeof candidate.savedAtMs !== "number" ||
				typeof candidate.expiresAtMs !== "number"
			) {
				continue;
			}
			if (nowMs >= candidate.expiresAtMs) {
				continue;
			}
			valid[normalizeRoomKey(key)] = {
				roomId: candidate.roomId,
				inviteCode: candidate.inviteCode ?? null,
				reconnectionToken: candidate.reconnectionToken,
				userId: candidate.userId,
				savedAtMs: candidate.savedAtMs,
				expiresAtMs: candidate.expiresAtMs,
			};
		}
		return valid;
	} catch {
		return {};
	}
}

function writeEntries(
	storage: StorageLike | null,
	entries: Record<string, StoredRoomReconnection>,
): void {
	if (!storage) {
		return;
	}
	try {
		const sorted = Object.entries(entries)
			.sort(([, a], [, b]) => b.savedAtMs - a.savedAtMs)
			.slice(0, MAX_STORED_RECONNECTIONS);
		if (sorted.length === 0) {
			storage.removeItem(RECONNECT_STORAGE_KEY);
			return;
		}
		const capped: Record<string, StoredRoomReconnection> = {};
		for (const [key, val] of sorted) {
			capped[key] = val;
		}
		storage.setItem(RECONNECT_STORAGE_KEY, JSON.stringify(capped));
	} catch {
		// Ignore quota or private browsing storage restrictions
	}
}

export function saveStoredRoomReconnection(
	input: {
		readonly roomId: string;
		readonly inviteCode?: string | null;
		readonly reconnectionToken: string;
		readonly userId: string;
	},
	options?: {
		readonly storage?: StorageLike | null;
		readonly nowMs?: number;
	},
): StoredRoomReconnection | null {
	const token = input.reconnectionToken?.trim() ?? "";
	const roomId = input.roomId?.trim() ?? "";
	const userId = input.userId?.trim() ?? "";
	if (!token || !roomId || !userId) {
		return null;
	}

	const nowMs = options?.nowMs ?? Date.now();
	const storage =
		options && "storage" in options
			? (options.storage ?? null)
			: resolveDefaultStorage();

	const existing = readValidEntries(storage, nowMs);
	const entry: StoredRoomReconnection = {
		roomId,
		inviteCode: input.inviteCode?.trim() || null,
		reconnectionToken: token,
		userId,
		savedAtMs: nowMs,
		expiresAtMs: nowMs + RECONNECT_TTL_MS,
	};

	existing[normalizeRoomKey(roomId)] = entry;
	if (entry.inviteCode) {
		existing[normalizeRoomKey(entry.inviteCode)] = entry;
	}

	writeEntries(storage, existing);
	return entry;
}

export function getStoredRoomReconnection(
	roomIdOrInviteCode: string,
	userId: string,
	options?: {
		readonly storage?: StorageLike | null;
		readonly nowMs?: number;
	},
): StoredRoomReconnection | null {
	const targetKey = normalizeRoomKey(roomIdOrInviteCode);
	if (!targetKey || !userId) {
		return null;
	}

	const nowMs = options?.nowMs ?? Date.now();
	const storage =
		options && "storage" in options
			? (options.storage ?? null)
			: resolveDefaultStorage();

	const valid = readValidEntries(storage, nowMs);
	writeEntries(storage, valid);

	const direct = valid[targetKey];
	if (direct && direct.userId === userId) {
		return direct;
	}

	for (const entry of Object.values(valid)) {
		const matchesRoom = normalizeRoomKey(entry.roomId) === targetKey;
		const matchesInvite =
			entry.inviteCode && normalizeRoomKey(entry.inviteCode) === targetKey;
		if ((matchesRoom || matchesInvite) && entry.userId === userId) {
			return entry;
		}
	}

	return null;
}

export function clearStoredRoomReconnection(
	roomIdOrInviteCode: string,
	options?: {
		readonly storage?: StorageLike | null;
		readonly nowMs?: number;
	},
): void {
	const targetKey = normalizeRoomKey(roomIdOrInviteCode);
	if (!targetKey) {
		return;
	}
	const nowMs = options?.nowMs ?? Date.now();
	const storage =
		options && "storage" in options
			? (options.storage ?? null)
			: resolveDefaultStorage();

	const valid = readValidEntries(storage, nowMs);
	const remaining: Record<string, StoredRoomReconnection> = {};

	for (const [key, entry] of Object.entries(valid)) {
		const matchesKey = key === targetKey;
		const matchesRoom = normalizeRoomKey(entry.roomId) === targetKey;
		const matchesInvite =
			entry.inviteCode && normalizeRoomKey(entry.inviteCode) === targetKey;
		if (!matchesKey && !matchesRoom && !matchesInvite) {
			remaining[key] = entry;
		}
	}

	writeEntries(storage, remaining);
}

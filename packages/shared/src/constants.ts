export const SITTUYIN_ROOM_NAME = "sittuyin" as const;
export const SITTUYIN_LOBBY_ROOM_NAME = "lobby" as const;

export const MAX_ROOM_CLIENTS = 18 as const;
export const MAX_SPECTATORS = 16 as const;

export const SETUP_DURATION_MS = 60_000 as const;
export const RECONNECT_GRACE_PLAYING_S = 60 as const;
export const RECONNECT_GRACE_WAITING_S = 15 as const;
export const WAITING_ROOM_TIMEOUT_MS = 600_000 as const;

export const INVITE_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ" as const;
export const INVITE_CODE_LENGTH = 6 as const;

export const CUSTOM_CLOSE_CODES = {
	WAITING_TIMEOUT: 4012,
	ROOM_ABORTED: 4013,
} as const;

export type TimeControlId = "rapid_10_5" | "rapid_15_10" | "classical_30_0";

export interface TimeControlConfig {
	readonly id: TimeControlId;
	readonly initialMs: number;
	readonly incrementMs: number;
}

export const TIME_CONTROL_CONFIGS: Readonly<
	Record<TimeControlId, TimeControlConfig>
> = {
	rapid_10_5: {
		id: "rapid_10_5",
		initialMs: 600_000,
		incrementMs: 5_000,
	},
	rapid_15_10: {
		id: "rapid_15_10",
		initialMs: 900_000,
		incrementMs: 10_000,
	},
	classical_30_0: {
		id: "classical_30_0",
		initialMs: 1_800_000,
		incrementMs: 0,
	},
};

import { type SchemaType, schema, t } from "@colyseus/schema";

export const SittuyinPlayer = schema(
	{
		sessionId: t.string().default(""),
		displayName: t.string().default(""),
		side: t.string().default("spectator"),
		connected: t.boolean().default(true),
	},
	"SittuyinPlayer",
);
export type SittuyinPlayer = SchemaType<typeof SittuyinPlayer>;

export const SittuyinRoomState = schema(
	{
		phase: t.string().default("waiting"),
		roomMode: t.string().default("quick_match"),
		timeControl: t.string().default("rapid_15_10"),
		players: t.map(SittuyinPlayer),
	},
	"SittuyinRoomState",
);
export type SittuyinRoomState = SchemaType<typeof SittuyinRoomState>;

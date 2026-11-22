import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { SITTUYIN_ROOM_NAME } from "@sittuyin/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import appConfig from "../src/app.config.js";
import type { SittuyinRoomState } from "../src/rooms/schema/SittuyinRoomState.js";

describe("SittuyinRoom scaffold", () => {
	let colyseus: ColyseusTestServer<typeof appConfig>;

	beforeAll(async () => {
		colyseus = await boot(appConfig);
	});

	afterAll(async () => {
		await colyseus.shutdown();
	});

	beforeEach(async () => {
		await colyseus.cleanup();
	});

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
});

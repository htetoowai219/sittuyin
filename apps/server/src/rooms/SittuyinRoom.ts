import {
	PingMessageSchema,
	type RoomMode,
	type TimeControl,
} from "@sittuyin/shared";
import {
	type AuthContext,
	type Client,
	type CloseCode,
	Room,
	ServerError,
	validate,
} from "colyseus";
import {
	SittuyinPlayer,
	SittuyinRoomState,
} from "./schema/SittuyinRoomState.js";

export interface SittuyinClientAuth {
	sub: string;
	displayName: string;
}

export interface SittuyinRoomOptions {
	roomMode?: RoomMode;
	timeControl?: TimeControl;
}

export class SittuyinRoom extends Room<{
	state: SittuyinRoomState;
	client: Client<{ auth: SittuyinClientAuth }>;
}> {
	maxClients = 2;
	state = new SittuyinRoomState();

	messages = {
		ping: validate(PingMessageSchema, (client: Client, payload) => {
			client.send("pong", {
				sentAt: payload.sentAt,
				serverTime: Date.now(),
			});
		}),
	};

	static async onAuth(
		token: string,
		_options: SittuyinRoomOptions,
		_context: AuthContext,
	): Promise<SittuyinClientAuth> {
		if (!token || token.trim().length === 0) {
			throw new ServerError(401, "Missing auth token");
		}

		// Scaffold placeholder: full HS256 jose JWT verification and single use jti
		// checks land in the dedicated auth and multiplayer room specs.
		return {
			sub: token,
			displayName: token.slice(0, 32),
		};
	}

	onCreate(options: SittuyinRoomOptions) {
		this.state.phase = "waiting";
		this.state.roomMode = options.roomMode ?? "quick_match";
		this.state.timeControl = options.timeControl ?? "rapid_15_10";
	}

	onJoin(client: Client<{ auth: SittuyinClientAuth }>) {
		const side = this.state.players.size === 0 ? "red" : "black";
		const player = new SittuyinPlayer();
		player.sessionId = client.sessionId;
		player.displayName = client.auth?.displayName ?? "Guest";
		player.side = side;
		player.connected = true;

		this.state.players.set(client.sessionId, player);

		if (this.state.players.size === this.maxClients) {
			this.lock();
			this.state.phase = "setup";
		}
	}

	onDrop(client: Client<{ auth: SittuyinClientAuth }>, _code: CloseCode) {
		const player = this.state.players.get(client.sessionId);
		if (player) {
			player.connected = false;
		}
		this.allowReconnection(client, 30).catch(() => {});
	}

	onReconnect(client: Client<{ auth: SittuyinClientAuth }>) {
		const player = this.state.players.get(client.sessionId);
		if (player) {
			player.connected = true;
		}
	}

	onLeave(client: Client<{ auth: SittuyinClientAuth }>, _code: CloseCode) {
		this.state.players.delete(client.sessionId);
	}
}

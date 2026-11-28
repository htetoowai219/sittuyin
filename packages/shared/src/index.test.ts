import { describe, expect, it } from "vitest";
import {
	AbortMessageSchema,
	ActionErrorEventSchema,
	CUSTOM_CLOSE_CODES,
	DrawDeclinedEventSchema,
	DrawOfferedEventSchema,
	INVITE_CODE_ALPHABET,
	INVITE_CODE_LENGTH,
	LobbyRoomMetadataSchema,
	MAX_ROOM_CLIENTS,
	MAX_SPECTATORS,
	MatchEndedEventSchema,
	MatchJoinTicketClaimsSchema,
	MatchStartedEventSchema,
	MoveMessageSchema,
	OfferDrawMessageSchema,
	OfferRematchMessageSchema,
	PingMessageSchema,
	PongEventSchema,
	PreferredSideSchema,
	RandomSetupMessageSchema,
	RematchOfferedEventSchema,
	RematchStartedEventSchema,
	ResignMessageSchema,
	RespondDrawMessageSchema,
	RespondRematchMessageSchema,
	RoleIntentSchema,
	RoomActionErrorSchema,
	RoomModeSchema,
	roomSnapshotToPlayerGameView,
	ServerMaintenanceEventSchema,
	SetupActionMessageSchema,
	SITTUYIN_LOBBY_ROOM_NAME,
	SITTUYIN_ROOM_NAME,
	TIME_CONTROL_CONFIGS,
	TimeControlSchema,
} from "./index.js";

describe("@sittuyin/shared wire contracts (AC-1)", () => {
	it("exports room constants and time control configurations", () => {
		expect(SITTUYIN_ROOM_NAME).toBe("sittuyin");
		expect(SITTUYIN_LOBBY_ROOM_NAME).toBe("lobby");
		expect(MAX_ROOM_CLIENTS).toBe(18);
		expect(MAX_SPECTATORS).toBe(16);
		expect(INVITE_CODE_ALPHABET).toHaveLength(32);
		expect(INVITE_CODE_LENGTH).toBe(6);
		expect(CUSTOM_CLOSE_CODES.WAITING_TIMEOUT).toBe(4012);
		expect(TIME_CONTROL_CONFIGS.rapid_10_5).toEqual({
			id: "rapid_10_5",
			initialMs: 600_000,
			incrementMs: 5_000,
		});
		expect(TIME_CONTROL_CONFIGS.rapid_15_10).toEqual({
			id: "rapid_15_10",
			initialMs: 900_000,
			incrementMs: 10_000,
		});
		expect(TIME_CONTROL_CONFIGS.classical_30_0).toEqual({
			id: "classical_30_0",
			initialMs: 1_800_000,
			incrementMs: 0,
		});
	});

	it("validates MatchJoinTicketClaimsSchema and normalizes legacy quick_match to public_lobby", () => {
		const parsedLegacy = MatchJoinTicketClaimsSchema.parse({
			sub: "user_123",
			displayName: "guest_abcd1234",
			isAnonymous: true,
			rating: 1500,
			roomMode: "quick_match",
			timeControl: "rapid_15_10",
			iss: "sittuyin-web",
			aud: "sittuyin-server",
			iat: 1_700_000_000,
			exp: 1_700_000_060,
			jti: "550e8400-e29b-41d4-a716-446655440000",
		});

		expect(parsedLegacy.roomMode).toBe("public_lobby");
		expect(parsedLegacy.preferredSide).toBe("random");
		expect(parsedLegacy.roleIntent).toBe("player");
		expect(parsedLegacy.roomTitle).toBe("guest_abcd1234's Room");

		const parsedExplicit = MatchJoinTicketClaimsSchema.parse({
			sub: "user_456",
			displayName: "KyawSwar",
			isAnonymous: false,
			rating: 1720,
			roomMode: "private_room",
			timeControl: "rapid_10_5",
			preferredSide: "red",
			roomTitle: "Mandalay Championship",
			roleIntent: "spectator",
			iss: "sittuyin-web",
			aud: "sittuyin-server",
			iat: 1_700_000_000,
			exp: 1_700_000_060,
			jti: "550e8400-e29b-41d4-a716-446655440001",
		});

		expect(parsedExplicit.roomMode).toBe("private_room");
		expect(parsedExplicit.preferredSide).toBe("red");
		expect(parsedExplicit.roleIntent).toBe("spectator");
		expect(parsedExplicit.roomTitle).toBe("Mandalay Championship");
	});

	it("validates RoomModeSchema, PreferredSideSchema, RoleIntentSchema, TimeControlSchema, and LobbyRoomMetadataSchema", () => {
		expect(RoomModeSchema.parse("public_lobby")).toBe("public_lobby");
		expect(RoomModeSchema.parse("private_room")).toBe("private_room");
		expect(RoomModeSchema.parse("quick_match")).toBe("public_lobby");
		expect(PreferredSideSchema.parse("black")).toBe("black");
		expect(RoleIntentSchema.parse("spectator")).toBe("spectator");
		expect(TimeControlSchema.parse("classical_30_0")).toBe("classical_30_0");

		const meta = LobbyRoomMetadataSchema.parse({
			roomTitle: "Open Rapid Match",
			roomMode: "public_lobby",
			timeControl: "rapid_10_5",
			phase: "waiting",
			hostDisplayName: "Aung",
			hostRating: 1500,
			hostPreferredSide: "random",
			hostAssignedSide: "red",
			playerCount: 1,
			spectatorCount: 0,
		});
		expect(meta.playerCount).toBe(1);
	});

	it("validates all 10 client to server message payloads and rejects malformed squares", () => {
		expect(
			SetupActionMessageSchema.parse({
				action: { kind: "place", role: "king", to: "g2" },
			}),
		).toEqual({
			action: { kind: "place", role: "king", to: "g2" },
		});
		expect(() =>
			SetupActionMessageSchema.parse({
				action: { kind: "place", role: "king", to: "z9" },
			}),
		).toThrow();

		expect(RandomSetupMessageSchema.parse({})).toEqual({});
		expect(
			MoveMessageSchema.parse({
				move: { kind: "normal", from: "e3", to: "e4" },
			}),
		).toEqual({
			move: { kind: "normal", from: "e3", to: "e4" },
		});
		expect(MoveMessageSchema.parse({ uci: "e3e4" })).toEqual({ uci: "e3e4" });
		expect(ResignMessageSchema.parse({})).toEqual({});
		expect(OfferDrawMessageSchema.parse({})).toEqual({});
		expect(RespondDrawMessageSchema.parse({ accept: true })).toEqual({
			accept: true,
		});
		expect(AbortMessageSchema.parse({})).toEqual({});
		expect(OfferRematchMessageSchema.parse({})).toEqual({});
		expect(RespondRematchMessageSchema.parse({ accept: false })).toEqual({
			accept: false,
		});
		expect(PingMessageSchema.parse({ sentAt: 100 })).toEqual({ sentAt: 100 });
	});

	it("validates all 8 server to client event payloads and RoomActionErrorSchema", () => {
		expect(
			RoomActionErrorSchema.parse({
				code: "FORBIDDEN_SPECTATOR",
				message: "Spectators cannot mutate room state.",
			}).code,
		).toBe("FORBIDDEN_SPECTATOR");

		expect(
			ActionErrorEventSchema.parse({
				action: "move",
				code: "WRONG_TURN",
				message: "Not your turn",
			}).action,
		).toBe("move");

		expect(
			MatchStartedEventSchema.parse({
				matchId: "m1",
				initialSetupFen: "2r2r2/8/4pppp/pppp4/4PPPP/PPPP4/8/2R2R2[] r - 0 1",
				redRemainingMs: 600_000,
				blackRemainingMs: 600_000,
				syncedAtMs: 1_700_000_000_000,
			}).matchId,
		).toBe("m1");

		expect(
			MatchEndedEventSchema.parse({
				matchId: "m1",
				status: "win",
				winner: "red",
				reason: "checkmate",
				initialSetupFen: "2r2r2/8/4pppp/pppp4/4PPPP/PPPP4/8/2R2R2[] r - 0 1",
				movesUci: ["e3e4"],
				persisted: true,
			}).winner,
		).toBe("red");

		expect(DrawOfferedEventSchema.parse({ offeredBy: "red", ply: 4 }).ply).toBe(
			4,
		);
		expect(
			DrawDeclinedEventSchema.parse({ declinedBy: "black" }).declinedBy,
		).toBe("black");
		expect(
			RematchOfferedEventSchema.parse({ offeredBy: "red" }).offeredBy,
		).toBe("red");
		expect(
			RematchStartedEventSchema.parse({
				matchId: "m2",
				redSessionId: "s2",
				blackSessionId: "s1",
				setupRemainingMs: 60_000,
				syncedAtMs: 1_700_000_100_000,
			}).matchId,
		).toBe("m2");
		expect(
			ServerMaintenanceEventSchema.parse({
				reason: "Deploy in progress",
				timestamp: 1_700_000_200_000,
			}).reason,
		).toBe("Deploy in progress");
		expect(
			PongEventSchema.parse({ sentAt: 100, serverTime: 105 }).serverTime,
		).toBe(105);
	});

	it("reconstructs PlayerGameView from setup and playing room snapshots", () => {
		const setupSnapshot = roomSnapshotToPlayerGameView(
			{
				phase: "setup",
				roomMode: "public_lobby",
				timeControl: "rapid_10_5",
				redPlacedCount: 1,
				blackPlacedCount: 2,
				redSetupReady: false,
				blackSetupReady: false,
				players: {},
				redPrivate: {
					myDraft: { g2: "king" },
					hand: {
						king: 0,
						general: 1,
						rook: 2,
						elephant: 2,
						knight: 2,
					},
				},
			},
			"red",
		);

		expect(setupSnapshot.view.myDraft.g2).toBe("king");
		expect(setupSnapshot.view.placedCounts.red).toBe(1);
		expect(setupSnapshot.view.placedCounts.black).toBe(2);
	});
});

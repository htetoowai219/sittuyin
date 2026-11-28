import { describe, expect, it } from "vitest";
import {
	applyLobbyMessage,
	normalizeInviteCodeInput,
	partitionLobbyRooms,
} from "./lobby-client";

const waitingChallenge = {
	roomId: "PUB_WAIT_1",
	clients: 1,
	maxClients: 18,
	metadata: {
		roomTitle: "Yangon Open Challenge",
		roomMode: "public_lobby",
		timeControl: "rapid_10_5",
		phase: "waiting",
		hostDisplayName: "Aung",
		hostRating: 1500,
		hostPreferredSide: "random",
		hostAssignedSide: "red",
		playerCount: 1,
		spectatorCount: 0,
	},
};

const activeSetupMatch = {
	roomId: "PUB_SETUP_1",
	clients: 4,
	maxClients: 18,
	metadata: {
		roomTitle: "Mandalay Rapid Match",
		roomMode: "public_lobby",
		timeControl: "rapid_15_10",
		phase: "setup",
		hostDisplayName: "Kyaw",
		hostRating: 1580,
		hostPreferredSide: "red",
		hostAssignedSide: "red",
		playerCount: 2,
		spectatorCount: 2,
	},
};

const activePlayingMatch = {
	roomId: "PUB_PLAY_1",
	clients: 7,
	maxClients: 18,
	metadata: {
		roomTitle: "Bagan Classical Championship",
		roomMode: "public_lobby",
		timeControl: "classical_30_0",
		phase: "playing",
		hostDisplayName: "Min",
		hostRating: 1650,
		hostPreferredSide: "black",
		hostAssignedSide: "black",
		playerCount: 2,
		spectatorCount: 5,
	},
};

describe("lobby-client room partitioning and filtering (AC-2)", () => {
	it("processes rooms, +, and - LobbyRoom messages and partitions Open Challenges vs Live Matches", () => {
		let rooms = applyLobbyMessage([], "rooms", [
			waitingChallenge,
			activeSetupMatch,
		]);
		expect(rooms).toHaveLength(2);

		// Add a third room via "+"
		rooms = applyLobbyMessage(rooms, "+", [
			activePlayingMatch.roomId,
			activePlayingMatch,
		]);
		expect(rooms).toHaveLength(3);

		// Update spectator count on PUB_PLAY_1 via "+"
		rooms = applyLobbyMessage(rooms, "+", [
			activePlayingMatch.roomId,
			{
				...activePlayingMatch,
				metadata: {
					...activePlayingMatch.metadata,
					spectatorCount: 8,
				},
			},
		]);

		const allPartitioned = partitionLobbyRooms(rooms, "all");
		expect(allPartitioned.openChallenges).toHaveLength(1);
		expect(allPartitioned.openChallenges[0]?.roomId).toBe("PUB_WAIT_1");

		expect(allPartitioned.liveMatches).toHaveLength(2);
		expect(
			allPartitioned.liveMatches.find((r) => r.roomId === "PUB_PLAY_1")
				?.metadata.spectatorCount,
		).toBe(8);

		// Filter by time control
		const rapid10Only = partitionLobbyRooms(rooms, "rapid_10_5");
		expect(rapid10Only.openChallenges).toHaveLength(1);
		expect(rapid10Only.liveMatches).toHaveLength(0);

		const classicalOnly = partitionLobbyRooms(rooms, "classical_30_0");
		expect(classicalOnly.openChallenges).toHaveLength(0);
		expect(classicalOnly.liveMatches).toHaveLength(1);
		expect(classicalOnly.liveMatches[0]?.roomId).toBe("PUB_PLAY_1");

		// Remove room via "-"
		rooms = applyLobbyMessage(rooms, "-", "PUB_WAIT_1");
		expect(partitionLobbyRooms(rooms, "all").openChallenges).toHaveLength(0);
	});

	it("normalizes 6-character invite codes to uppercase alphanumeric", () => {
		expect(normalizeInviteCodeInput(" k9-m4 p2x9 ")).toBe("K9M4P2");
	});
});

import { describe, expect, it } from "vitest";
import { MatchJoinTicketClaimsSchema, SITTUYIN_ROOM_NAME } from "./index.js";

describe("@sittuyin/shared scaffold", () => {
	it("validates HS256 match join ticket claims per spec 0001", () => {
		const parsed = MatchJoinTicketClaimsSchema.parse({
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

		expect(parsed.roomMode).toBe("quick_match");
		expect(SITTUYIN_ROOM_NAME).toBe("sittuyin");
	});
});

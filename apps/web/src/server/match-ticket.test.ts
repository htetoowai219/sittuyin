import { MatchJoinTicketClaimsSchema } from "@sittuyin/shared";
import { describe, expect, it } from "vitest";
import {
	GUEST_COOKIE_MAX_AGE_SECONDS,
	GUEST_COOKIE_NAME,
	type getGuestCookieSerializeOptions,
	verifyGuestCookieValue,
} from "./guest-cookie";
import {
	type GuestCookieStore,
	mintMatchJoinTicket,
	resolveOrCreateGuestSession,
	updateGuestDisplayName,
	verifyMintedMatchJoinTicket,
} from "./match-ticket";

function createMemoryCookieJar(): {
	readonly store: GuestCookieStore;
	readonly rawCookies: Map<string, string>;
	readonly lastOptions: Map<
		string,
		ReturnType<typeof getGuestCookieSerializeOptions>
	>;
} {
	const rawCookies = new Map<string, string>();
	const lastOptions = new Map<
		string,
		ReturnType<typeof getGuestCookieSerializeOptions>
	>();

	const store: GuestCookieStore = {
		get(name) {
			return rawCookies.get(name);
		},
		set(name, value, options) {
			rawCookies.set(name, value);
			lastOptions.set(name, options);
		},
	};

	return { store, rawCookies, lastOptions };
}

describe("guest cookie signer and match ticket server functions (AC-1)", () => {
	it("initializes a 30-day signed HTTP-only guest cookie with Guest_XXXX and rating 1500", async () => {
		const jar = createMemoryCookieJar();
		const session = await resolveOrCreateGuestSession({
			cookieStore: jar.store,
		});

		expect(session.sub).toMatch(/^guest_[0-9a-f-]{36}$/i);
		expect(session.displayName).toBe(
			`Guest_${session.sub.slice(6, 10).toUpperCase()}`,
		);
		expect(session.rating).toBe(1500);
		expect(session.isAnonymous).toBe(true);

		const rawCookie = jar.rawCookies.get(GUEST_COOKIE_NAME);
		expect(rawCookie).toBeTruthy();

		const cookieOpts = jar.lastOptions.get(GUEST_COOKIE_NAME);
		expect(cookieOpts?.httpOnly).toBe(true);
		expect(cookieOpts?.sameSite).toBe("lax");
		expect(cookieOpts?.maxAge).toBe(GUEST_COOKIE_MAX_AGE_SECONDS);

		const verified = await verifyGuestCookieValue(rawCookie);
		expect(verified).toEqual(session);
	});

	it("mints a fresh guest identity cleanly if the cookie signature is tampered", async () => {
		const jar = createMemoryCookieJar();
		const first = await resolveOrCreateGuestSession({
			cookieStore: jar.store,
		});

		const raw = jar.rawCookies.get(GUEST_COOKIE_NAME) ?? "";
		jar.rawCookies.set(GUEST_COOKIE_NAME, `${raw}tampered`);

		const recovered = await resolveOrCreateGuestSession({
			cookieStore: jar.store,
		});
		expect(recovered.sub).not.toBe(first.sub);
		expect(recovered.rating).toBe(1500);
	});

	it("updates displayName (including Myanmar script) while preserving sub and rating", async () => {
		const jar = createMemoryCookieJar();
		const initial = await resolveOrCreateGuestSession({
			cookieStore: jar.store,
		});

		const updated = await updateGuestDisplayName(
			{ displayName: "  အောင်အောင်\u0007  " },
			{ cookieStore: jar.store },
		);

		expect(updated.sub).toBe(initial.sub);
		expect(updated.rating).toBe(1500);
		expect(updated.displayName).toBe("အောင်အောင်");
		expect(updated.isAnonymous).toBe(true);

		const roundTrip = await resolveOrCreateGuestSession({
			cookieStore: jar.store,
		});
		expect(roundTrip.sub).toBe(initial.sub);
		expect(roundTrip.displayName).toBe("အောင်အောင်");
	});

	it("rejects empty or overlong displayName values with VALIDATION_ERROR", async () => {
		const jar = createMemoryCookieJar();

		await expect(
			updateGuestDisplayName(
				{ displayName: "   " },
				{ cookieStore: jar.store },
			),
		).rejects.toThrow(/VALIDATION_ERROR/);

		await expect(
			updateGuestDisplayName(
				{ displayName: "A".repeat(33) },
				{ cookieStore: jar.store },
			),
		).rejects.toThrow(/VALIDATION_ERROR/);
	});

	it("mints a 60-second HS256 JWT validated by MatchJoinTicketClaimsSchema and ignores spoofed sub or rating", async () => {
		const jar = createMemoryCookieJar();
		const initial = await updateGuestDisplayName(
			{ displayName: "ကျော်စွာ" },
			{ cookieStore: jar.store },
		);

		// Simulate an untrusted payload trying to override sub, rating, and isAnonymous
		const untrustedPayload = {
			roomMode: "private_room",
			timeControl: "rapid_10_5",
			preferredSide: "red",
			roomTitle: "ရန်ကုန် စစ်ဘုရင် ပွဲစဉ်",
			roleIntent: "player",
			sub: "guest_00000000-0000-0000-0000-000000000000",
			rating: 2900,
			isAnonymous: false,
		} as unknown as Parameters<typeof mintMatchJoinTicket>[0];

		const minted = await mintMatchJoinTicket(untrustedPayload, {
			cookieStore: jar.store,
		});

		expect(minted.guest.sub).toBe(initial.sub);
		expect(minted.guest.rating).toBe(1500);

		const claims = await verifyMintedMatchJoinTicket(minted.token);
		const parsed = MatchJoinTicketClaimsSchema.parse(claims);

		expect(parsed.sub).toBe(initial.sub);
		expect(parsed.displayName).toBe("ကျော်စွာ");
		expect(parsed.rating).toBe(1500);
		expect(parsed.isAnonymous).toBe(true);
		expect(parsed.roomMode).toBe("private_room");
		expect(parsed.timeControl).toBe("rapid_10_5");
		expect(parsed.preferredSide).toBe("red");
		expect(parsed.roomTitle).toBe("ရန်ကုန် စစ်ဘုရင် ပွဲစဉ်");
		expect(parsed.roleIntent).toBe("player");
		expect(parsed.iss).toBe("sittuyin-web");
		expect(parsed.aud).toBe("sittuyin-server");
		expect(parsed.exp - parsed.iat).toBe(60);
	});
});

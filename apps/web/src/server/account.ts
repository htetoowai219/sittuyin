import type { PlayerProfileRow } from "@sittuyin/db";
import { isProvisionalRating } from "@sittuyin/shared";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	GUEST_COOKIE_NAME,
	GuestDisplayNameSchema,
	verifyGuestCookieValue,
} from "./guest-cookie";

const HANDLE_REGEX = /^[a-z0-9_]{3,24}$/;

export interface PublicAccountUser {
	readonly id: string;
	readonly isAnonymous: boolean;
	readonly image: string | null;
}

export interface PlayerProfileDto {
	readonly userId: string;
	readonly handle: string;
	readonly displayName: string;
	readonly rating: number;
	readonly ratingDeviation: number;
	readonly volatility: number;
	readonly gamesPlayed: number;
	readonly wins: number;
	readonly losses: number;
	readonly draws: number;
	readonly lastRatedAt: string | null;
	readonly locale: "my" | "en";
	readonly isProvisional: boolean;
}

export interface AccountSessionProfile {
	readonly user: PublicAccountUser;
	readonly profile: PlayerProfileDto;
}

export const UpdatePlayerProfileInputSchema = z.object({
	displayName: GuestDisplayNameSchema.optional(),
	handle: z
		.string()
		.trim()
		.transform((val) => val.toLowerCase())
		.refine((val) => HANDLE_REGEX.test(val), {
			message:
				"VALIDATION_ERROR: Handle must be 3 to 24 lowercase letters, numbers, or underscores.",
		})
		.optional(),
	locale: z.enum(["my", "en"]).optional(),
});

export type UpdatePlayerProfileInput = z.input<
	typeof UpdatePlayerProfileInputSchema
>;

export function toPlayerProfileDto(row: PlayerProfileRow): PlayerProfileDto {
	return {
		userId: row.userId,
		handle: row.handle,
		displayName: row.displayName,
		rating: Math.round(row.rating),
		ratingDeviation: row.ratingDeviation,
		volatility: row.volatility,
		gamesPlayed: row.gamesPlayed,
		wins: row.wins,
		losses: row.losses,
		draws: row.draws,
		lastRatedAt: row.lastRatedAt ? row.lastRatedAt.toISOString() : null,
		locale: row.locale,
		isProvisional: isProvisionalRating(row.ratingDeviation, row.gamesPlayed),
	};
}

function detectLocaleFromHeaders(headers: Headers): "my" | "en" {
	const cookieHeader = headers.get("cookie") ?? "";
	const match = cookieHeader.match(/(?:^|;\s*)PARAGLIDE_LOCALE=(my|en)(?:;|$)/);
	if (match?.[1] === "en" || match?.[1] === "my") {
		return match[1];
	}
	const acceptLang = (headers.get("accept-language") ?? "").toLowerCase();
	if (acceptLang.startsWith("en")) {
		return "en";
	}
	return "my";
}

export async function getCurrentSessionProfileFromHeaders(
	headers: Headers,
): Promise<AccountSessionProfile | null> {
	const [{ getAuth }, { createEdgeDb, createPlayerProfileForUser, getPlayerProfileByUserId }] =
		await Promise.all([import("./auth"), import("@sittuyin/db")]);

	const { auth, env } = await getAuth();
	const session = await auth.api.getSession({ headers });
	if (!session?.user) {
		return null;
	}

	const db = createEdgeDb(env.DATABASE_URL);
	let profile = await getPlayerProfileByUserId(db, session.user.id);

	if (!profile) {
		const freshSession = await auth.api.getSession({
			headers,
			query: { disableCookieCache: true },
		});
		if (!freshSession?.user) {
			return null;
		}
		profile = await createPlayerProfileForUser(db, {
			userId: freshSession.user.id,
			name: freshSession.user.name,
			locale: detectLocaleFromHeaders(headers),
		});
	}

	return {
		user: {
			id: session.user.id,
			isAnonymous: Boolean(
				(session.user as { isAnonymous?: boolean | null }).isAnonymous,
			),
			image: session.user.image ?? null,
		},
		profile: toPlayerProfileDto(profile),
	};
}

export async function ensureGuestSessionProfileFromRequest(): Promise<AccountSessionProfile> {
	const [
		{ getCookie, getRequestHeaders, setResponseHeader },
		{ getAuth },
		{ createEdgeDb, createPlayerProfileForUser, updatePlayerProfile },
	] = await Promise.all([
		import("@tanstack/react-start/server"),
		import("./auth"),
		import("@sittuyin/db"),
	]);
	const headers = getRequestHeaders();

	const existing = await getCurrentSessionProfileFromHeaders(headers);
	if (existing) {
		return existing;
	}

	const { auth, env } = await getAuth();
	const anonResult = await auth.api.signInAnonymous({ headers });
	if (!anonResult?.user) {
		throw new Error("AUTH_ERROR: Failed to initialize anonymous guest session.");
	}

	const db = createEdgeDb(env.DATABASE_URL);
	const detectedLocale = detectLocaleFromHeaders(headers);
	const legacyRaw = getCookie(GUEST_COOKIE_NAME);
	const legacyGuest = legacyRaw
		? await verifyGuestCookieValue(legacyRaw, env.MATCH_TICKET_SECRET)
		: null;

	const patch: { displayName?: string; locale: "my" | "en" } = {
		locale: detectedLocale,
	};
	if (legacyGuest?.displayName) {
		patch.displayName = legacyGuest.displayName;
	}

	let profile = await updatePlayerProfile(db, anonResult.user.id, patch);
	if (!profile) {
		profile = await createPlayerProfileForUser(db, {
			userId: anonResult.user.id,
			name: legacyGuest?.displayName ?? anonResult.user.name,
			locale: detectedLocale,
		});
	}

	if (legacyRaw) {
		const secureFlag = env.BETTER_AUTH_URL.startsWith("https://")
			? "; Secure"
			: "";
		const expireCookie = `${GUEST_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secureFlag}`;
		setResponseHeader("Set-Cookie", expireCookie);
	}

	return {
		user: {
			id: anonResult.user.id,
			isAnonymous: true,
			image: anonResult.user.image ?? null,
		},
		profile: toPlayerProfileDto(profile),
	};
}

export const getCurrentSessionProfileFn = createServerFn({
	method: "GET",
}).handler(async (): Promise<AccountSessionProfile | null> => {
	const { getRequestHeaders } = await import("@tanstack/react-start/server");
	return await getCurrentSessionProfileFromHeaders(getRequestHeaders());
});

export const ensureGuestSessionProfileFn = createServerFn({
	method: "POST",
}).handler(async (): Promise<AccountSessionProfile> => {
	return await ensureGuestSessionProfileFromRequest();
});

export const updatePlayerProfileFn = createServerFn({
	method: "POST",
})
	.validator((input: UpdatePlayerProfileInput) =>
		UpdatePlayerProfileInputSchema.parse(input),
	)
	.handler(
		async ({
			data,
		}): Promise<
			| { readonly ok: true; readonly profile: PlayerProfileDto }
			| {
					readonly ok: false;
					readonly code: "HANDLE_TAKEN";
					readonly message: string;
			  }
		> => {
			const [
				{ getRequestHeaders },
				{ getAuth },
				{ createEdgeDb, HandleTakenError, updatePlayerProfile },
			] = await Promise.all([
				import("@tanstack/react-start/server"),
				import("./auth"),
				import("@sittuyin/db"),
			]);
			const headers = getRequestHeaders();
			const { auth, env } = await getAuth();
			const session = await auth.api.getSession({ headers });
			if (!session?.user) {
				throw new Response(
					JSON.stringify({
						code: "UNAUTHENTICATED",
						message: "Authentication required",
					}),
					{
						status: 401,
						headers: { "Content-Type": "application/json" },
					},
				);
			}

			const db = createEdgeDb(env.DATABASE_URL);
			try {
				const updated = await updatePlayerProfile(db, session.user.id, data);
				if (!updated) {
					throw new Error("NOT_FOUND: Player profile not found.");
				}
				return { ok: true, profile: toPlayerProfileDto(updated) };
			} catch (err) {
				if (err instanceof HandleTakenError) {
					return {
						ok: false,
						code: "HANDLE_TAKEN",
						message: err.message,
					};
				}
				throw err;
			}
		},
	);

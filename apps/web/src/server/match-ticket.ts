import {
	CanonicalRoomModeSchema,
	type MatchJoinTicketClaims,
	MatchJoinTicketClaimsSchema,
	PreferredSideSchema,
	RoleIntentSchema,
	TimeControlSchema,
} from "@sittuyin/shared";
import { createServerFn } from "@tanstack/react-start";
import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import {
	type AccountSessionProfile,
	ensureGuestSessionProfileFromRequest,
	type PlayerProfileDto,
} from "./account";
import {
	createFreshGuestIdentity,
	GUEST_COOKIE_NAME,
	GuestDisplayNameSchema,
	type GuestSessionIdentity,
	getGuestCookieSerializeOptions,
	getMatchTicketSecret,
	sanitizeDisplayName,
	signGuestCookieValue,
	verifyGuestCookieValue,
} from "./guest-cookie";

export const MATCH_TICKET_ISSUER = "sittuyin-web";
export const MATCH_TICKET_AUDIENCE = "sittuyin-server";
export const MATCH_TICKET_TTL_SECONDS = 60;
export const DEFAULT_GAME_SERVER_URL = "http://localhost:2567";

export interface GuestCookieStore {
	get(name: string): string | undefined;
	set(
		name: string,
		value: string,
		options: ReturnType<typeof getGuestCookieSerializeOptions>,
	): void;
}

const fallbackNoopCookieStore: GuestCookieStore = {
	get(): string | undefined {
		return undefined;
	},
	set(): void {
		// Safe no-op when invoked outside a Start request scope in unit tests
	},
};

export const UpdateGuestDisplayNameInputSchema = z.object({
	displayName: GuestDisplayNameSchema,
});

export type UpdateGuestDisplayNameInput = z.input<
	typeof UpdateGuestDisplayNameInputSchema
>;

export const MintMatchJoinTicketInputSchema = z.object({
	roomMode: CanonicalRoomModeSchema,
	timeControl: TimeControlSchema,
	isRated: z.boolean().optional(),
	preferredSide: PreferredSideSchema.optional().default("random"),
	roomTitle: z
		.string()
		.optional()
		.transform((raw) => {
			if (typeof raw !== "string") {
				return undefined;
			}
			const cleaned = sanitizeDisplayName(raw);
			return cleaned.length > 0 ? cleaned : undefined;
		})
		.refine((val) => val === undefined || val.length <= 48, {
			message: "VALIDATION_ERROR: Room title must be at most 48 characters.",
		}),
	roleIntent: RoleIntentSchema.optional().default("player"),
});

export type MintMatchJoinTicketInput = z.input<
	typeof MintMatchJoinTicketInputSchema
>;

export interface MintMatchJoinTicketResult {
	readonly token: string;
	readonly guest: GuestSessionIdentity;
	readonly profile?: PlayerProfileDto;
	readonly expiresAtMs: number;
	readonly serverUrl: string;
}

export function resolveGameServerUrl(): string {
	const fromProcess =
		typeof process !== "undefined"
			? process.env.VITE_GAME_SERVER_URL
			: undefined;
	const fromImportMeta =
		typeof import.meta !== "undefined" &&
		typeof import.meta.env === "object" &&
		import.meta.env !== null
			? (import.meta.env.VITE_GAME_SERVER_URL as string | undefined)
			: undefined;
	const candidate = (fromProcess ?? fromImportMeta ?? "").trim();
	return candidate.length > 0 ? candidate : DEFAULT_GAME_SERVER_URL;
}

export async function resolveOrCreateGuestSession(options?: {
	readonly cookieStore?: GuestCookieStore;
	readonly secret?: string;
	readonly nowSec?: number;
}): Promise<GuestSessionIdentity> {
	const store = options?.cookieStore ?? fallbackNoopCookieStore;
	const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
	const rawCookie = store.get(GUEST_COOKIE_NAME);
	const existing = await verifyGuestCookieValue(rawCookie, options?.secret);

	const identity: GuestSessionIdentity = existing
		? {
				...existing,
				issuedAt: nowSec,
			}
		: createFreshGuestIdentity(nowSec);

	const signedCookie = await signGuestCookieValue(identity, options?.secret);
	store.set(GUEST_COOKIE_NAME, signedCookie, getGuestCookieSerializeOptions());

	return identity;
}

export async function updateGuestDisplayName(
	rawInput: UpdateGuestDisplayNameInput,
	options?: {
		readonly cookieStore?: GuestCookieStore;
		readonly secret?: string;
		readonly nowSec?: number;
	},
): Promise<GuestSessionIdentity> {
	const parsed = UpdateGuestDisplayNameInputSchema.safeParse(rawInput);
	if (!parsed.success) {
		throw new Error(
			parsed.error.issues[0]?.message ??
				"VALIDATION_ERROR: Invalid display name.",
		);
	}

	const store = options?.cookieStore ?? fallbackNoopCookieStore;
	const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
	const rawCookie = store.get(GUEST_COOKIE_NAME);
	const existing =
		(await verifyGuestCookieValue(rawCookie, options?.secret)) ??
		createFreshGuestIdentity(nowSec);

	const updated: GuestSessionIdentity = {
		sub: existing.sub,
		displayName: parsed.data.displayName,
		rating: existing.rating,
		isAnonymous: true,
		issuedAt: nowSec,
	};

	const signedCookie = await signGuestCookieValue(updated, options?.secret);
	store.set(GUEST_COOKIE_NAME, signedCookie, getGuestCookieSerializeOptions());

	return updated;
}

export async function mintMatchJoinTicket(
	rawInput: MintMatchJoinTicketInput,
	options?: {
		readonly cookieStore?: GuestCookieStore;
		readonly accountSession?: AccountSessionProfile;
		readonly secret?: string;
		readonly nowSec?: number;
		readonly serverUrl?: string;
	},
): Promise<MintMatchJoinTicketResult> {
	const parsedInput = MintMatchJoinTicketInputSchema.safeParse(rawInput);
	if (!parsedInput.success) {
		throw new Error(
			parsedInput.error.issues[0]?.message ??
				"VALIDATION_ERROR: Invalid match ticket parameters.",
		);
	}

	const nowSec = options?.nowSec ?? Math.floor(Date.now() / 1000);
	const expSec = nowSec + MATCH_TICKET_TTL_SECONDS;
	const isRated =
		parsedInput.data.roomMode === "private_room"
			? false
			: (parsedInput.data.isRated ?? true);

	let sub: string;
	let displayName: string;
	let isAnonymous: boolean;
	let rating: number;
	let isProvisional: boolean;
	let guest: GuestSessionIdentity;
	let profile: PlayerProfileDto | undefined;

	if (options?.accountSession) {
		const { user, profile: p } = options.accountSession;
		sub = user.id;
		displayName = p.displayName;
		isAnonymous = user.isAnonymous;
		rating = Math.round(p.rating);
		isProvisional = p.isProvisional;
		profile = p;
		guest = {
			sub: user.id,
			displayName: p.displayName,
			rating,
			isAnonymous: true,
			issuedAt: nowSec,
		};
	} else {
		guest = await resolveOrCreateGuestSession({
			cookieStore: options?.cookieStore,
			secret: options?.secret,
			nowSec: options?.nowSec,
		});
		sub = guest.sub;
		displayName = guest.displayName;
		isAnonymous = guest.isAnonymous;
		rating = guest.rating;
		isProvisional = true;
	}

	const validatedClaims: MatchJoinTicketClaims =
		MatchJoinTicketClaimsSchema.parse({
			sub,
			displayName,
			isAnonymous,
			rating,
			isProvisional,
			roomMode: parsedInput.data.roomMode,
			isRated,
			timeControl: parsedInput.data.timeControl,
			preferredSide: parsedInput.data.preferredSide,
			roomTitle: parsedInput.data.roomTitle,
			roleIntent: parsedInput.data.roleIntent,
			iss: MATCH_TICKET_ISSUER,
			aud: MATCH_TICKET_AUDIENCE,
			iat: nowSec,
			exp: expSec,
			jti: crypto.randomUUID(),
		});

	const resolvedSecret = getMatchTicketSecret(options?.secret);
	const key = new TextEncoder().encode(resolvedSecret);

	const token = await new SignJWT(
		validatedClaims as unknown as Record<string, unknown>,
	)
		.setProtectedHeader({ alg: "HS256", typ: "JWT" })
		.sign(key);

	return {
		token,
		guest,
		profile,
		expiresAtMs: expSec * 1000,
		serverUrl: options?.serverUrl ?? resolveGameServerUrl(),
	};
}

export async function verifyMintedMatchJoinTicket(
	token: string,
	secret?: string,
): Promise<MatchJoinTicketClaims> {
	const resolvedSecret = getMatchTicketSecret(secret);
	const key = new TextEncoder().encode(resolvedSecret);
	const verified = await jwtVerify(token, key, {
		algorithms: ["HS256"],
		issuer: MATCH_TICKET_ISSUER,
		audience: MATCH_TICKET_AUDIENCE,
		maxTokenAge: `${MATCH_TICKET_TTL_SECONDS}s`,
	});
	return MatchJoinTicketClaimsSchema.parse(verified.payload);
}

export const getOrCreateGuestSessionFn = createServerFn({
	method: "GET",
}).handler(async (): Promise<GuestSessionIdentity> => {
	const { getCookie, setCookie } = await import("@tanstack/react-start/server");
	const cookieStore: GuestCookieStore = {
		get: (name) => getCookie(name),
		set: (name, value, opts) => setCookie(name, value, opts),
	};
	return await resolveOrCreateGuestSession({ cookieStore });
});

export const updateGuestDisplayNameFn = createServerFn({
	method: "POST",
})
	.validator((input: UpdateGuestDisplayNameInput) =>
		UpdateGuestDisplayNameInputSchema.parse(input),
	)
	.handler(async ({ data }): Promise<GuestSessionIdentity> => {
		const { getCookie, setCookie } = await import(
			"@tanstack/react-start/server"
		);
		const cookieStore: GuestCookieStore = {
			get: (name) => getCookie(name),
			set: (name, value, opts) => setCookie(name, value, opts),
		};
		return await updateGuestDisplayName(data, { cookieStore });
	});

export const mintMatchJoinTicketFn = createServerFn({
	method: "POST",
})
	.validator((input: MintMatchJoinTicketInput) =>
		MintMatchJoinTicketInputSchema.parse(input),
	)
	.handler(async ({ data }): Promise<MintMatchJoinTicketResult> => {
		const accountSession = await ensureGuestSessionProfileFromRequest();
		return await mintMatchJoinTicket(data, { accountSession });
	});

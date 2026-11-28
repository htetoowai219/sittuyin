import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";

export const GUEST_COOKIE_NAME = "sittuyin.guest.v1";
export const GUEST_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const GUEST_JWT_ISSUER = "sittuyin-web";
export const GUEST_JWT_AUDIENCE = "sittuyin-web-guest";

export const DEFAULT_DEV_MATCH_TICKET_SECRET =
	"sittuyin-local-dev-match-ticket-secret-min-32-bytes";

export function sanitizeDisplayName(rawName: string): string {
	let cleaned = "";
	for (const char of rawName) {
		const code = char.charCodeAt(0);
		if (code > 0x1f && code !== 0x7f) {
			cleaned += char;
		}
	}
	return cleaned.trim();
}

export const GuestDisplayNameSchema = z
	.string()
	.transform((val) => sanitizeDisplayName(val))
	.refine((val) => val.length >= 1 && val.length <= 32, {
		message:
			"VALIDATION_ERROR: Display name must be between 1 and 32 characters.",
	});

export const GuestSessionIdentitySchema = z.object({
	sub: z.string().regex(/^guest_[0-9a-f-]{8,}$/i),
	displayName: GuestDisplayNameSchema,
	rating: z.number().int().min(100).max(4000),
	isAnonymous: z.literal(true),
	issuedAt: z.number().int().nonnegative(),
});

export type GuestSessionIdentity = z.infer<typeof GuestSessionIdentitySchema>;

export function getMatchTicketSecret(explicitSecret?: string): string {
	const envSecret =
		typeof process !== "undefined"
			? process.env.MATCH_TICKET_SECRET
			: undefined;
	const raw = explicitSecret ?? envSecret;
	if (raw && raw.trim().length >= 32) {
		return raw.trim();
	}
	const isProd =
		typeof process !== "undefined" && process.env.NODE_ENV === "production";
	if (isProd) {
		throw new Error(
			"CONFIG_ERROR: MATCH_TICKET_SECRET must be set to at least 32 bytes in production.",
		);
	}
	return raw && raw.trim().length > 0
		? raw.trim()
		: DEFAULT_DEV_MATCH_TICKET_SECRET;
}

export function createFreshGuestIdentity(
	nowSec = Math.floor(Date.now() / 1000),
): GuestSessionIdentity {
	const uuid = crypto.randomUUID();
	const sub = `guest_${uuid}`;
	const shortHex = sub.slice(6, 10).toUpperCase();
	return {
		sub,
		displayName: `Guest_${shortHex}`,
		rating: 1500,
		isAnonymous: true,
		issuedAt: nowSec,
	};
}

export async function signGuestCookieValue(
	identity: GuestSessionIdentity,
	secret?: string,
): Promise<string> {
	const validated = GuestSessionIdentitySchema.parse(identity);
	const resolvedSecret = getMatchTicketSecret(secret);
	const key = new TextEncoder().encode(resolvedSecret);

	return await new SignJWT({
		sub: validated.sub,
		displayName: validated.displayName,
		rating: validated.rating,
		isAnonymous: validated.isAnonymous,
		issuedAt: validated.issuedAt,
	})
		.setProtectedHeader({ alg: "HS256", typ: "JWT" })
		.setIssuedAt(validated.issuedAt)
		.setIssuer(GUEST_JWT_ISSUER)
		.setAudience(GUEST_JWT_AUDIENCE)
		.setExpirationTime(validated.issuedAt + GUEST_COOKIE_MAX_AGE_SECONDS)
		.sign(key);
}

export async function verifyGuestCookieValue(
	cookieValue: string | null | undefined,
	secret?: string,
): Promise<GuestSessionIdentity | null> {
	const trimmed = cookieValue?.trim() ?? "";
	if (trimmed.length === 0) {
		return null;
	}

	const resolvedSecret = getMatchTicketSecret(secret);
	const key = new TextEncoder().encode(resolvedSecret);

	try {
		const verified = await jwtVerify(trimmed, key, {
			algorithms: ["HS256"],
			issuer: GUEST_JWT_ISSUER,
			audience: GUEST_JWT_AUDIENCE,
		});
		const parsed = GuestSessionIdentitySchema.safeParse(verified.payload);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export function getGuestCookieSerializeOptions(isProduction?: boolean): {
	readonly httpOnly: true;
	readonly sameSite: "lax";
	readonly path: "/";
	readonly maxAge: number;
	readonly secure: boolean;
} {
	const secure =
		isProduction ??
		(typeof process !== "undefined" && process.env.NODE_ENV === "production");
	return {
		httpOnly: true,
		sameSite: "lax",
		path: "/",
		maxAge: GUEST_COOKIE_MAX_AGE_SECONDS,
		secure,
	};
}

import { randomUUID } from "node:crypto";
import {
	type MatchJoinTicketClaims,
	type MatchJoinTicketClaimsInput,
	MatchJoinTicketClaimsSchema,
} from "@sittuyin/shared";
import { ServerError } from "colyseus";
import { jwtVerify, SignJWT } from "jose";

export const DEFAULT_DEV_MATCH_TICKET_SECRET =
	"sittuyin-local-dev-match-ticket-secret-min-32-bytes";

export function getMatchTicketSecret(explicitSecret?: string): string {
	const raw = explicitSecret ?? process.env.MATCH_TICKET_SECRET;
	if (raw && raw.trim().length >= 32) {
		return raw.trim();
	}
	if (process.env.NODE_ENV === "production") {
		throw new Error(
			"MATCH_TICKET_SECRET must be set to at least 32 bytes in production.",
		);
	}
	return raw && raw.trim().length > 0
		? raw.trim()
		: DEFAULT_DEV_MATCH_TICKET_SECRET;
}

export interface SignMatchJoinTicketInput
	extends Partial<Omit<MatchJoinTicketClaimsInput, "sub" | "displayName">> {
	readonly sub: string;
	readonly displayName: string;
}

export async function signMatchJoinTicket(
	input: SignMatchJoinTicketInput,
	secret?: string,
): Promise<string> {
	const nowSec = Math.floor(Date.now() / 1000);
	const claims: MatchJoinTicketClaimsInput = {
		sub: input.sub,
		displayName: input.displayName,
		isAnonymous: input.isAnonymous ?? true,
		rating: input.rating ?? 1500,
		roomMode: input.roomMode ?? "public_lobby",
		timeControl: input.timeControl ?? "rapid_15_10",
		preferredSide: input.preferredSide ?? "random",
		roomTitle: input.roomTitle,
		roleIntent: input.roleIntent ?? "player",
		iss: input.iss ?? "sittuyin-web",
		aud: input.aud ?? "sittuyin-server",
		iat: input.iat ?? nowSec,
		exp: input.exp ?? nowSec + 60,
		jti: input.jti ?? randomUUID(),
	};

	const resolvedSecret = getMatchTicketSecret(secret);
	const key = new TextEncoder().encode(resolvedSecret);

	return await new SignJWT(claims as unknown as Record<string, unknown>)
		.setProtectedHeader({ alg: "HS256", typ: "JWT" })
		.sign(key);
}

export async function verifyMatchJoinTicket(
	token: string,
	secret?: string,
): Promise<MatchJoinTicketClaims> {
	const trimmed = token?.trim() ?? "";
	if (trimmed.length === 0) {
		throw new ServerError(401, "MISSING_TOKEN");
	}

	const resolvedSecret = getMatchTicketSecret(secret);
	const key = new TextEncoder().encode(resolvedSecret);

	let rawPayload: unknown;
	try {
		const verified = await jwtVerify(trimmed, key, {
			algorithms: ["HS256"],
			issuer: "sittuyin-web",
			audience: "sittuyin-server",
			maxTokenAge: "60s",
		});
		rawPayload = verified.payload;
	} catch {
		throw new ServerError(401, "INVALID_TOKEN");
	}

	const parsed = MatchJoinTicketClaimsSchema.safeParse(rawPayload);
	if (!parsed.success) {
		throw new ServerError(401, "INVALID_TOKEN");
	}

	return parsed.data;
}

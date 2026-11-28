import {
	createEdgeDb,
	createPlayerProfileForUser,
	dbSchema,
	linkAnonymousProfileAndMatches,
	withEdgeTransaction,
} from "@sittuyin/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins/anonymous";
import { tanstackStartCookies } from "better-auth/tanstack-start";

export interface AuthEnv {
	readonly DATABASE_URL: string;
	readonly BETTER_AUTH_SECRET: string;
	readonly BETTER_AUTH_URL: string;
	readonly GOOGLE_CLIENT_ID?: string;
	readonly GOOGLE_CLIENT_SECRET?: string;
	readonly MATCH_TICKET_SECRET?: string;
	readonly VITE_GAME_SERVER_URL?: string;
}

const DEFAULT_DEV_BETTER_AUTH_SECRET =
	"sittuyin-local-dev-better-auth-secret-min-32-bytes";
const DEFAULT_DEV_BETTER_AUTH_URL = "http://localhost:3000";

export async function resolveAuthEnv(
	overrides?: Partial<AuthEnv>,
): Promise<AuthEnv> {
	let cfEnv: Record<string, string | undefined> = {};
	try {
		const cfWorkersSpecifier = "cloudflare:workers";
		const mod = (await import(/* @vite-ignore */ cfWorkersSpecifier)) as {
			env?: Record<string, string | undefined>;
		};
		if (mod && typeof mod.env === "object" && mod.env !== null) {
			cfEnv = mod.env;
		}
	} catch {
		// Not running inside Cloudflare Workers (e.g. Vitest or Node dev)
	}

	const procEnv = typeof process !== "undefined" ? process.env : {};
	const read = (key: keyof AuthEnv): string | undefined => {
		const val = overrides?.[key] ?? cfEnv[key] ?? procEnv[key];
		return typeof val === "string" && val.trim().length > 0
			? val.trim()
			: undefined;
	};

	const databaseUrl = read("DATABASE_URL");
	if (!databaseUrl) {
		throw new Error("CONFIG_ERROR: DATABASE_URL is required for Better Auth.");
	}

	const isProd = procEnv.NODE_ENV === "production";
	const secret =
		read("BETTER_AUTH_SECRET") ??
		(isProd ? undefined : DEFAULT_DEV_BETTER_AUTH_SECRET);
	if (!secret || secret.length < 32) {
		throw new Error(
			"CONFIG_ERROR: BETTER_AUTH_SECRET must be at least 32 characters.",
		);
	}

	const url = read("BETTER_AUTH_URL") ?? DEFAULT_DEV_BETTER_AUTH_URL;

	return {
		DATABASE_URL: databaseUrl,
		BETTER_AUTH_SECRET: secret,
		BETTER_AUTH_URL: url,
		GOOGLE_CLIENT_ID: read("GOOGLE_CLIENT_ID"),
		GOOGLE_CLIENT_SECRET: read("GOOGLE_CLIENT_SECRET"),
		MATCH_TICKET_SECRET: read("MATCH_TICKET_SECRET"),
		VITE_GAME_SERVER_URL: read("VITE_GAME_SERVER_URL"),
	};
}

export function createAuth(env: AuthEnv) {
	const db = createEdgeDb(env.DATABASE_URL);
	const hasGoogle = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

	return betterAuth({
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,
		trustedOrigins: [env.BETTER_AUTH_URL],
		database: drizzleAdapter(db, {
			provider: "pg",
			schema: dbSchema,
		}),
		advanced: {
			database: {
				generateId: "uuid",
			},
			useSecureCookies: env.BETTER_AUTH_URL.startsWith("https://"),
		},
		session: {
			cookieCache: {
				enabled: true,
				maxAge: 300,
				strategy: "compact",
			},
		},
		...(hasGoogle
			? {
					socialProviders: {
						google: {
							clientId: env.GOOGLE_CLIENT_ID!,
							clientSecret: env.GOOGLE_CLIENT_SECRET!,
						},
					},
				}
			: {}),
		databaseHooks: {
			user: {
				create: {
					after: async (createdUser) => {
						await createPlayerProfileForUser(db, {
							userId: createdUser.id,
							name: createdUser.name,
							locale: "my",
						});
					},
				},
			},
		},
		plugins: [
			anonymous({
				onLinkAccount: async ({ anonymousUser, newUser }) => {
					await withEdgeTransaction(env.DATABASE_URL, async (tx) => {
						await linkAnonymousProfileAndMatches(tx, {
							anonymousUserId: anonymousUser.user.id,
							newUserId: newUser.user.id,
						});
					});
				},
			}),
			tanstackStartCookies(),
		],
	});
}

export async function getAuth(overrides?: Partial<AuthEnv>) {
	const env = await resolveAuthEnv(overrides);
	return { auth: createAuth(env), env };
}

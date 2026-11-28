import { neon, Pool as NeonPool } from "@neondatabase/serverless";
import {
	drizzle as drizzleNeonHttp,
	type NeonHttpDatabase,
} from "drizzle-orm/neon-http";
import {
	drizzle as drizzleNeonServerless,
	type NeonDatabase,
} from "drizzle-orm/neon-serverless";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { account, session, user, verification } from "./schema/auth-schema.js";
import { matches } from "./schema/matches.js";
import { playerProfiles } from "./schema/player-profiles.js";

export const dbSchema = {
	user,
	session,
	account,
	verification,
	playerProfiles,
	matches,
};

export type DbSchema = typeof dbSchema;
export type ServerDb = NodePgDatabase<DbSchema>;
export type EdgeDb = NeonHttpDatabase<DbSchema>;
export type EdgeTxDb = NeonDatabase<DbSchema>;
export type EdgeTxCallback<T> = Parameters<EdgeTxDb["transaction"]>[0] extends (
	tx: infer Tx,
) => Promise<unknown>
	? (tx: Tx) => Promise<T>
	: never;

export interface CreateServerDbOptions {
	readonly max?: number;
	readonly idleTimeoutMillis?: number;
	readonly connectionTimeoutMillis?: number;
	readonly onPoolError?: (err: Error) => void;
}

export interface ServerDbConnection {
	readonly db: ServerDb;
	readonly pool: pg.Pool;
}

export interface EdgeTxPoolConnection {
	readonly db: EdgeTxDb;
	readonly pool: NeonPool;
}

export function createEdgeDb(databaseUrl: string): EdgeDb {
	const sql = neon(databaseUrl);
	return drizzleNeonHttp(sql, { schema: dbSchema });
}

export function createEdgeTxPool(databaseUrl: string): EdgeTxPoolConnection {
	const pool = new NeonPool({ connectionString: databaseUrl });
	const db = drizzleNeonServerless(pool, { schema: dbSchema });
	return { db, pool };
}

export async function withEdgeTransaction<T>(
	databaseUrl: string,
	fn: EdgeTxCallback<T>,
): Promise<T> {
	const { db, pool } = createEdgeTxPool(databaseUrl);
	try {
		return (await db.transaction(
			fn as Parameters<EdgeTxDb["transaction"]>[0],
		)) as T;
	} finally {
		await pool.end();
	}
}

export function createServerDb(
	databaseUrl: string,
	options: CreateServerDbOptions = {},
): ServerDbConnection {
	const pool = new pg.Pool({
		connectionString: databaseUrl,
		max: options.max ?? 10,
		idleTimeoutMillis: options.idleTimeoutMillis ?? 30_000,
		connectionTimeoutMillis: options.connectionTimeoutMillis ?? 10_000,
	});

	pool.on("error", (err) => {
		if (options.onPoolError) {
			options.onPoolError(err);
		}
	});

	const db = drizzle(pool, { schema: dbSchema });

	return { db, pool };
}

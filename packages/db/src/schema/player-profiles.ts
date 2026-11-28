import { sql } from "drizzle-orm";
import {
	doublePrecision,
	index,
	integer,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

export const playerProfiles = pgTable(
	"player_profiles",
	{
		userId: text("user_id")
			.primaryKey()
			.references(() => user.id, { onDelete: "cascade" }),
		handle: text("handle").notNull(),
		displayName: text("display_name").notNull(),
		rating: doublePrecision("rating").default(1500).notNull(),
		ratingDeviation: doublePrecision("rating_deviation").default(350).notNull(),
		volatility: doublePrecision("volatility").default(0.06).notNull(),
		gamesPlayed: integer("games_played").default(0).notNull(),
		wins: integer("wins").default(0).notNull(),
		losses: integer("losses").default(0).notNull(),
		draws: integer("draws").default(0).notNull(),
		lastRatedAt: timestamp("last_rated_at", {
			withTimezone: true,
			mode: "date",
		}),
		locale: text("locale").$type<"my" | "en">().default("my").notNull(),
		createdAt: timestamp("created_at", {
			withTimezone: true,
			mode: "date",
		})
			.defaultNow()
			.notNull(),
		updatedAt: timestamp("updated_at", {
			withTimezone: true,
			mode: "date",
		})
			.defaultNow()
			.notNull(),
	},
	(table) => [
		uniqueIndex("player_profiles_handle_uidx").on(table.handle),
		index("player_profiles_rating_idx").on(sql`${table.rating} DESC`),
		index("player_profiles_leaderboard_idx")
			.on(table.rating.desc(), table.userId.asc())
			.where(
				sql`${table.ratingDeviation} <= 110 AND ${table.gamesPlayed} >= 10`,
			),
	],
);

export type PlayerProfileRow = typeof playerProfiles.$inferSelect;
export type NewPlayerProfileRow = typeof playerProfiles.$inferInsert;

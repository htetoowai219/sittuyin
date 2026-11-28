import {
	boolean,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema.js";

export const matches = pgTable(
	"matches",
	{
		id: text("id").primaryKey(),
		roomId: text("room_id").notNull(),
		mode: text("mode").$type<"public_lobby" | "private_room">().notNull(),
		timeControl: text("time_control")
			.$type<"rapid_10_5" | "rapid_15_10" | "classical_30_0">()
			.notNull(),
		redUserId: text("red_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		blackUserId: text("black_user_id").references(() => user.id, {
			onDelete: "set null",
		}),
		redDisplayName: text("red_display_name").notNull(),
		blackDisplayName: text("black_display_name").notNull(),
		winnerSide: text("winner_side").$type<"red" | "black" | null>(),
		terminationReason: text("termination_reason").notNull(),
		initialSetupFen: text("initial_setup_fen").notNull(),
		movesUciJson: jsonb("moves_uci_json").$type<string[]>().notNull(),
		totalPlies: integer("total_plies").notNull(),
		isRated: boolean("is_rated").default(false).notNull(),
		ratingAppliedAt: timestamp("rating_applied_at", {
			withTimezone: true,
			mode: "date",
		}),
		redRatingBefore: integer("red_rating_before"),
		redRatingAfter: integer("red_rating_after"),
		blackRatingBefore: integer("black_rating_before"),
		blackRatingAfter: integer("black_rating_after"),
		startedAt: timestamp("started_at", {
			withTimezone: true,
			mode: "date",
		}).notNull(),
		endedAt: timestamp("ended_at", {
			withTimezone: true,
			mode: "date",
		}).notNull(),
	},
	(table) => [
		index("matches_red_user_ended_id_idx").on(
			table.redUserId,
			table.endedAt.desc(),
			table.id.desc(),
		),
		index("matches_black_user_ended_id_idx").on(
			table.blackUserId,
			table.endedAt.desc(),
			table.id.desc(),
		),
	],
);

export type NewMatchRow = typeof matches.$inferInsert;
export type MatchRow = typeof matches.$inferSelect;

DROP INDEX "matches_red_user_ended_idx";--> statement-breakpoint
DROP INDEX "matches_black_user_ended_idx";--> statement-breakpoint
CREATE INDEX "player_profiles_leaderboard_idx" ON "player_profiles" USING btree ("rating" DESC NULLS LAST,"user_id") WHERE "player_profiles"."rating_deviation" <= 110 AND "player_profiles"."games_played" >= 10;--> statement-breakpoint
CREATE INDEX "matches_red_user_ended_id_idx" ON "matches" USING btree ("red_user_id","ended_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "matches_black_user_ended_id_idx" ON "matches" USING btree ("black_user_id","ended_at" DESC NULLS LAST,"id" DESC NULLS LAST);
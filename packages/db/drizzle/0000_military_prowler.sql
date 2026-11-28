CREATE TABLE "matches" (
	"id" text PRIMARY KEY NOT NULL,
	"room_id" text NOT NULL,
	"mode" text NOT NULL,
	"time_control" text NOT NULL,
	"red_user_id" text,
	"black_user_id" text,
	"red_display_name" text NOT NULL,
	"black_display_name" text NOT NULL,
	"winner_side" text,
	"termination_reason" text NOT NULL,
	"initial_setup_fen" text NOT NULL,
	"moves_uci_json" jsonb NOT NULL,
	"total_plies" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "matches_red_user_ended_idx" ON "matches" USING btree ("red_user_id","ended_at");--> statement-breakpoint
CREATE INDEX "matches_black_user_ended_idx" ON "matches" USING btree ("black_user_id","ended_at");
import {
	type GetMatchReplayInput,
	GetMatchReplayInputSchema,
	type MatchReplayPayload,
} from "@sittuyin/shared";
import { createServerFn } from "@tanstack/react-start";

export const getMatchReplayFn = createServerFn({ method: "GET" })
	.validator((input: GetMatchReplayInput) =>
		GetMatchReplayInputSchema.parse(input),
	)
	.handler(async ({ data }): Promise<MatchReplayPayload | null> => {
		const [
			{ setResponseHeader },
			{ getAuth },
			{ createEdgeDb, getMatchReplayById },
		] = await Promise.all([
			import("@tanstack/react-start/server"),
			import("./auth"),
			import("@sittuyin/db"),
		]);

		const { env } = await getAuth();
		const db = createEdgeDb(env.DATABASE_URL);
		const replay = await getMatchReplayById(db, data.matchId);

		if (replay && replay.mode === "public_lobby") {
			setResponseHeader(
				"Cache-Control",
				"public, max-age=300, stale-while-revalidate=3600",
			);
		} else {
			setResponseHeader("Cache-Control", "private, no-store");
		}

		return replay;
	});

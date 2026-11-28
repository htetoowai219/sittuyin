import {
	decodeLeaderboardCursor,
	type GetLeaderboardInput,
	GetLeaderboardInputSchema,
	type LeaderboardPage,
	PUBLIC_PAGE_SIZE_DEFAULT,
} from "@sittuyin/shared";
import { createServerFn } from "@tanstack/react-start";

export async function readOptionalViewerUserId(
	headers: Headers,
): Promise<string | null> {
	const cookie = headers.get("cookie");
	if (!cookie) {
		return null;
	}
	try {
		const { getAuth } = await import("./auth");
		const { auth } = await getAuth();
		const session = await auth.api.getSession({ headers });
		return session?.user?.id ?? null;
	} catch {
		return null;
	}
}

export const getLeaderboardFn = createServerFn({ method: "GET" })
	.validator((input: GetLeaderboardInput | undefined) => {
		const parsed = GetLeaderboardInputSchema.parse(input ?? {});
		if (parsed.cursor !== undefined) {
			decodeLeaderboardCursor(parsed.cursor);
		}
		return parsed;
	})
	.handler(async ({ data }): Promise<LeaderboardPage> => {
		const [
			{ getRequestHeaders, setResponseHeader },
			{ getAuth },
			{ createEdgeDb, getLeaderboardPage, getViewerLeaderboardStanding },
		] = await Promise.all([
			import("@tanstack/react-start/server"),
			import("./auth"),
			import("@sittuyin/db"),
		]);

		setResponseHeader("Cache-Control", "private, no-store");

		const decodedCursor = data.cursor
			? decodeLeaderboardCursor(data.cursor)
			: null;
		const limit = data.limit ?? PUBLIC_PAGE_SIZE_DEFAULT;
		const headers = getRequestHeaders();

		const [{ env }, viewerUserId] = await Promise.all([
			getAuth(),
			readOptionalViewerUserId(headers),
		]);
		const db = createEdgeDb(env.DATABASE_URL);

		const [page, viewerStanding] = await Promise.all([
			getLeaderboardPage(db, { cursor: decodedCursor, limit }),
			viewerUserId
				? getViewerLeaderboardStanding(db, viewerUserId)
				: Promise.resolve(null),
		]);

		return {
			entries: page.entries,
			nextCursor: page.nextCursor,
			viewerStanding,
		};
	});

import {
	decodeMatchHistoryCursor,
	type GetPlayerMatchHistoryInput,
	GetPlayerMatchHistoryInputSchema,
	type GetPublicPlayerProfileInput,
	GetPublicPlayerProfileInputSchema,
	type PlayerMatchHistoryPage,
	PUBLIC_PAGE_SIZE_DEFAULT,
	type PublicPlayerProfilePage,
} from "@sittuyin/shared";
import { createServerFn } from "@tanstack/react-start";
import { readOptionalViewerUserId } from "./leaderboard";

export const getPublicPlayerProfileFn = createServerFn({ method: "GET" })
	.validator((input: GetPublicPlayerProfileInput) => {
		const normalized = {
			...input,
			handle:
				typeof input?.handle === "string"
					? input.handle.trim().toLowerCase()
					: input?.handle,
		};
		return GetPublicPlayerProfileInputSchema.parse(normalized);
	})
	.handler(async ({ data }): Promise<PublicPlayerProfilePage | null> => {
		const [
			{ getRequestHeaders, setResponseHeader },
			{ getAuth },
			{
				createEdgeDb,
				getPlayerMatchHistoryPage,
				getPublicPlayerProfileByHandle,
			},
		] = await Promise.all([
			import("@tanstack/react-start/server"),
			import("./auth"),
			import("@sittuyin/db"),
		]);

		setResponseHeader("Cache-Control", "private, no-store");

		const headers = getRequestHeaders();
		const [{ env }, viewerUserId] = await Promise.all([
			getAuth(),
			readOptionalViewerUserId(headers),
		]);
		const db = createEdgeDb(env.DATABASE_URL);

		const profile = await getPublicPlayerProfileByHandle(db, data.handle);
		if (!profile) {
			return null;
		}

		const isOwner = viewerUserId !== null && viewerUserId === profile.userId;
		const history = await getPlayerMatchHistoryPage(db, {
			userId: profile.userId,
			includePrivate: isOwner,
			limit: data.limit ?? PUBLIC_PAGE_SIZE_DEFAULT,
		});

		return {
			profile,
			isOwner,
			matches: history.matches,
			nextCursor: history.nextCursor,
		};
	});

export const getPlayerMatchHistoryFn = createServerFn({ method: "GET" })
	.validator((input: GetPlayerMatchHistoryInput) => {
		const normalized = {
			...input,
			handle:
				typeof input?.handle === "string"
					? input.handle.trim().toLowerCase()
					: input?.handle,
		};
		const parsed = GetPlayerMatchHistoryInputSchema.parse(normalized);
		if (parsed.cursor !== undefined) {
			decodeMatchHistoryCursor(parsed.cursor);
		}
		return parsed;
	})
	.handler(async ({ data }): Promise<PlayerMatchHistoryPage | null> => {
		const [
			{ getRequestHeaders, setResponseHeader },
			{ getAuth },
			{
				createEdgeDb,
				getPlayerMatchHistoryPage,
				getPublicPlayerProfileByHandle,
			},
		] = await Promise.all([
			import("@tanstack/react-start/server"),
			import("./auth"),
			import("@sittuyin/db"),
		]);

		setResponseHeader("Cache-Control", "private, no-store");

		const decodedCursor = data.cursor
			? decodeMatchHistoryCursor(data.cursor)
			: null;
		const headers = getRequestHeaders();
		const [{ env }, viewerUserId] = await Promise.all([
			getAuth(),
			readOptionalViewerUserId(headers),
		]);
		const db = createEdgeDb(env.DATABASE_URL);

		const profile = await getPublicPlayerProfileByHandle(db, data.handle);
		if (!profile) {
			return null;
		}

		const isOwner = viewerUserId !== null && viewerUserId === profile.userId;
		return getPlayerMatchHistoryPage(db, {
			userId: profile.userId,
			includePrivate: isOwner,
			cursor: decodedCursor,
			limit: data.limit ?? PUBLIC_PAGE_SIZE_DEFAULT,
		});
	});

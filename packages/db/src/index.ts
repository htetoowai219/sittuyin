export {
	type CreateServerDbOptions,
	createEdgeDb,
	createEdgeTxPool,
	createServerDb,
	type DbSchema,
	dbSchema,
	type EdgeDb,
	type EdgeTxCallback,
	type EdgeTxDb,
	type EdgeTxPoolConnection,
	type ServerDb,
	type ServerDbConnection,
	withEdgeTransaction,
} from "./client.js";
export {
	type InsertMatchRepositoryLike,
	insertCompletedMatch,
	type PersistAndRateMatchResult,
	type PersistMatchLogger,
	persistAndRateCompletedMatch,
} from "./repositories/matches.js";
export {
	type AnyDb,
	type CreatePlayerProfileInput,
	createPlayerProfileForUser,
	DEFAULT_GUEST_DISPLAY_NAME_REGEX,
	DEFAULT_GUEST_HANDLE_REGEX,
	generateGuestHandle,
	getPlayerProfileByUserId,
	HANDLE_REGEX,
	HandleTakenError,
	isPgUniqueViolation,
	type LinkAnonymousProfileInput,
	type LinkAnonymousProfileResult,
	linkAnonymousProfileAndMatches,
	normalizeDisplayName,
	type UpdatePlayerProfileInput,
	updatePlayerProfile,
} from "./repositories/player-profiles.js";
export {
	type GetLeaderboardPageOptions,
	type GetPlayerMatchHistoryPageInput,
	getLeaderboardPage,
	getMatchReplayById,
	getPlayerMatchHistoryPage,
	getPublicPlayerProfileByHandle,
	getViewerLeaderboardStanding,
	type LeaderboardPageSlice,
} from "./repositories/public-reads.js";
export {
	type AccountRow,
	account,
	type NewUserRow,
	type SessionRow,
	session,
	type UserRow,
	user,
	type VerificationRow,
	verification,
} from "./schema/auth-schema.js";
export {
	type MatchRow,
	matches,
	type NewMatchRow,
} from "./schema/matches.js";
export {
	type NewPlayerProfileRow,
	type PlayerProfileRow,
	playerProfiles,
} from "./schema/player-profiles.js";

export const DB_PACKAGE_METADATA = {
	name: "@sittuyin/db",
	status: "ready",
} as const;

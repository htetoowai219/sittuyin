# 0002. Build Better Auth guest sessions, Google OAuth account linking, player profiles, and post match Glicko 2 ratings

**Date**: 2026-11-24
**Status**: In Progress

## Summary

You are replacing the temporary signed guest cookie with real Better Auth accounts in Neon PostgreSQL, adding a `player_profiles` table for handles, display names, and unified Glicko 2 ratings (a skill rating system that tracks both strength and uncertainty), and wiring automatic rating updates after every completed public rated match. Visitors still start playing in one click as anonymous guests whose progress persists in the database, and signing in with Google transfers their guest matches and rating cleanly in one database transaction. Public lobby rooms now let hosts pick Rated (default) or Normal, while private invite rooms stay unrated so friend games cannot be used to farm rating points.

## Requirements

**User stories**:

- As a first time Sittuyin visitor, I want to jump straight into a public or private match as an anonymous guest with a persistent rating and editable display name, without filling out a registration form first.
- As a returning guest player, I want to click Sign in with Google to upgrade my guest account (keeping my rating, stats, and match history on a brand new Google account, or keeping my existing Google rating while preserving my guest match history) without losing my place.
- As a competitive player in the online lobby, I want to create either a Rated or Normal public match (while private invite rooms stay unrated), see provisional ratings clearly, and see my updated Glicko 2 rating delta appear right after a completed rated game.
- As an engineer operating `packages/db`, `packages/shared`, `apps/web`, and `apps/server`, I want lazy Better Auth sessions with compact cookie caching on Cloudflare Workers, atomic Neon WebSocket Pool transactions for `onLinkAccount`, pure TypeScript Glicko 2 math verified against Mark Glickman's reference example, and deadlock free idempotent post match transactions on Colyseus.

**Acceptance criteria**:

- **AC-1**: `packages/db` generates and exports Better Auth core Drizzle tables (`user`, `session`, `account`, `verification` in `packages/db/src/schema/auth-schema.ts` with UUID `text` IDs and `user.isAnonymous`), adds `player_profiles` (`user_id` PK/FK `ON DELETE CASCADE`, unique `handle`, `display_name`, `rating`, `rating_deviation`, `volatility`, `games_played`, `wins`, `losses`, `draws`, `last_rated_at`, `locale`, `created_at`, `updated_at`), and updates `matches` with `is_rated` (`boolean`, default `false`), `rating_applied_at` (nullable `timestamptz`), `red_rating_before`, `red_rating_after`, `black_rating_before`, `black_rating_after` (nullable `integer`), plus nullable FK references from `matches.red_user_id` and `matches.black_user_id` to `user.id` (`ON DELETE SET NULL`). The single Drizzle SQL migration first nulls out any pre existing orphaned `matches.red_user_id` or `matches.black_user_id` values not found in `"user"` before adding the foreign key constraints.
- **AC-2**: `packages/db` exports runtime database factories for both Cloudflare Workers and Node 22: `createEdgeDb(databaseUrl)` (`drizzle-orm/neon-http` for fast edge reads), `createEdgeTxPool(databaseUrl)` plus a `withEdgeTransaction(databaseUrl, fn)` wrapper (short lived `@neondatabase/serverless` WebSocket `Pool` with `drizzle-orm/neon-serverless` that guarantees `await pool.end()` in a `finally` block), and the existing `createServerDb(databaseUrl)` (`drizzle-orm/node-postgres` on `apps/server`).
- **AC-3**: `packages/shared` implements and exports a pure, zero dependency TypeScript Glicko 2 module (`calculateGlicko2PeriodUpdate`, `calculateGlicko2MatchUpdate`, and `isProvisionalRating`) using Mark Glickman's 2013 algorithm with defaults `initialRating = 1500`, `initialRd = 350`, `initialVolatility = 0.06`, `tau = 0.5`, `rdFloor = 45`, `rdCap = 350`, and provisional status true whenever `ratingDeviation > 110` or `gamesPlayed < 10`. `calculateGlicko2MatchUpdate` delegates to `calculateGlicko2PeriodUpdate` with a 1 opponent array, applying continuous daily inactivity RD growth for `Math.max(0, elapsedDays - 1)` inactive days before Steps 3 to 5 (capped at `350`) and running Glickman's standard Step 6 once for the active match period so `elapsedDays <= 1` matches the 2013 paper exactly. Unit tests verify `calculateGlicko2PeriodUpdate` against Mark Glickman's 3 opponent worked example (`1464.06`, `151.52`, `0.05999`).
- **AC-4**: `packages/shared` updates `MatchJoinTicketClaimsSchema` (`isRated`, `isProvisional`), `LobbyRoomMetadataSchema` (`isRated`, `hostIsProvisional`), and `SittuyinRoomSnapshot` (`isRated`, plus `isProvisional` on `SittuyinPlayerSnapshot`), defaulting `isRated` to `false` when `roomMode === "private_room"`, and adds `RatingUpdatedEventSchema` (`matchId`, `isRated`, `red`, `black`, where each player entry carries `userId`, `ratingBefore`, `ratingAfter`, `delta`, `ratingDeviationAfter`, `isProvisional`).
- **AC-5**: `apps/web` configures a lazy per request Better Auth factory `createAuth(env)` reading `cloudflare:workers` `env` (`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), mounting unprefixed `GET` and `POST` handlers at `apps/web/src/routes/api/auth/$.ts` (so `/api/auth/ok` returns `{ status: "ok" }` and `/api/auth/callback/google` stays locale independent), enabling `drizzleAdapter(db, { provider: "pg", schema })`, `advanced.database.generateId: "uuid"`, `session.cookieCache` (`strategy: "compact"`, `maxAge: 300`), `socialProviders.google`, `anonymous()` imported from `better-auth/plugins/anonymous`, and `tanstackStartCookies()` placed last in `plugins`.
- **AC-6**: Creating any Better Auth user (anonymous or Google) automatically creates a matching `player_profiles` row inside `databaseHooks.user.create.after` with a unique `guest_<8 lowercase hex>` handle, normalized `display_name` (trimming `user.name`, slicing to 32 Unicode characters, and falling back to `Guest_<4hex>` if empty), starting Glicko 2 values (`1500`, `350`, `0.06`, `0` games), and `locale` (`"my"` default). Landing page SSR calls `getCurrentSessionProfileFn()` (read only, re validating with `disableCookieCache: true` if `player_profiles` is missing so deleted linked accounts never trigger a `23503` backfill crash) and never creates anonymous rows until the user takes a play action (`ensureGuestSessionProfileFn()`).
- **AC-7**: When an anonymous guest upgrades via Google OAuth, Better Auth `anonymous({ onLinkAccount })` runs inside `withEdgeTransaction` (`createEdgeTxPool` with guaranteed `pool.end()`) in strict order: (a) **before** reassigning matches, check whether `newUser` is a brand new account (`newProfile.gamesPlayed === 0` and zero existing rows in `matches` for `newUser.user.id`); (b) reassign all `matches.red_user_id` and `matches.black_user_id` rows from `anonymousUser.user.id` to `newUser.user.id`; (c) if `newUser` was brand new, copy the guest's `rating`, `rating_deviation`, `volatility`, `games_played`, `wins`, `losses`, `draws`, `last_rated_at`, and `locale` onto `newUser`'s `player_profiles` row, copy `display_name` only if customized (not matching `^Guest_[0-9a-fA-F]{4}$`), and copy `handle` only if customized (not matching `^guest_[0-9a-f]{8}$`, renaming the anonymous row's handle to a temporary `migrating_<uuid>` first inside the transaction to satisfy `player_profiles_handle_uidx`); and (d) if `newUser` was an existing Google account, preserve `newUser`'s existing rating, handle, display name, and stats untouched while keeping the reassigned guest matches.
- **AC-8**: `apps/web/src/server/match-ticket.ts` replaces the `sittuyin.guest.v1` cookie identity with Better Auth sessions plus `player_profiles`: on first lazy guest creation, `ensureGuestSessionProfileFn` runs a follow up `UPDATE` on `player_profiles` right after `signInAnonymous()` to apply the detected Paraglide `locale` and (if a valid legacy `sittuyin.guest.v1` cookie is present) carry over its `displayName` once, expiring the legacy cookie by appending a `Set-Cookie` header (`Max-Age=0`) without overwriting Better Auth's session cookie. `mintMatchJoinTicketFn` reads `sub`, `displayName`, `isAnonymous`, rounded `rating`, and `isProvisional` strictly from the authenticated Better Auth session and `player_profiles` row, forces `isRated = false` whenever `roomMode === "private_room"`, and mints the 60 second HS256 JWT.
- **AC-9**: `apps/web` exposes `updatePlayerProfileFn` allowing an authenticated user (guest or Google) to update their own `displayName` (1 to 32 trimmed Unicode characters, supporting Burmese and English; `player_profiles.display_name` is the canonical display name across the UI), `handle` (3 to 24 lowercase Latin letters, digits, and underscores, returning structured `HANDLE_TAKEN` on PostgreSQL unique error `23505`), and `locale` (`"my" | "en"`), while rejecting unauthenticated calls with `401`.
- **AC-10**: `apps/server` `SittuyinRoom` reads verified `isRated` strictly from the room creator's `MatchJoinTicketClaims` (ignoring joiners' `isRated` claims and enforcing `isRated = false` for `"private_room"`), reads `isProvisional` for seated players (`hostIsProvisional` in `LobbyRoomMetadata`), stores `isRated` on `SittuyinRoomState` and `LobbyRoomMetadata`, and persists `is_rated` on completed competitive matches.
- **AC-11**: When a completed competitive match finishes in `SittuyinRoom`, the room broadcasts `"match_ended"` immediately (zero DB wait) and runs an asynchronous single PostgreSQL transaction (with the existing retry backoff in `persistence.ts`) that: (a) locks existing `"user"` rows for `red_user_id` and `black_user_id` in ascending `id` order using `SELECT id FROM "user" WHERE id IN (...) ORDER BY id ASC FOR KEY SHARE` to prevent concurrent `onLinkAccount` deletion races (setting any already deleted mid match anonymous seat to `null` and skipping Glicko 2 with a warning log); (b) inserts the `matches` row idempotently (`ON CONFLICT (id) DO NOTHING`); (c) if `is_rated === true` and both seats exist and `rating_applied_at IS NULL`, locks both `player_profiles` rows in ascending `user_id` order (`SELECT ... FOR UPDATE`) to prevent deadlocks, computes Glicko 2 updates, updates both `player_profiles` rows (`rating`, `rating_deviation`, `volatility`, `games_played`, `wins`/`losses`/`draws`, `last_rated_at`), and stamps `rating_applied_at` plus the four integer before/after rating snapshots on `matches`; and (d) emits `"rating_updated"` to all room clients once committed, guarded by a room disposal check so disposed rooms never throw.
- **AC-12**: Retrying persistence after a transient error never applies Glicko 2 twice for the same `matchId`, and unrated games (`is_rated === false`), aborted games (`aborted_pre_move`, `aborted_maintenance`), or mid match deleted anonymous seats never alter Glicko 2 ratings.
- **AC-13**: `apps/web` adds minimal bilingual (`/my` and `/en`) account and rating UI: (a) a top bar account menu reading `profile.displayName`, showing guest or Google status, rating (with `?` suffix when provisional), inline `displayName` and `handle` edit dialog, Sign in with Google button (passing current pathname plus search as `callbackURL` so players return to their exact locale and page), and Sign out button shown only for non anonymous Google accounts (hidden for anonymous guests so they cannot accidentally orphan their rating and matches); (b) a Rated (default) vs Normal toggle inside the Create Room modal (locked to Unrated for Private Rooms) plus Rated/Normal and provisional `?` badges on lobby room cards; and (c) a post match rating delta badge (`+14`, `-12`, `0`, plus provisional `?`) inside `<SittuyinMatchWorkspace>` updated live when `"rating_updated"` arrives.

## Decision

**Chosen option**: Option 1: Better Auth (Anonymous plus Google OAuth) in `apps/web` with transactional Neon WebSocket Pool `onLinkAccount`, unified `player_profiles` in `packages/db`, pure TypeScript Glicko 2 in `packages/shared`, and deadlock free transactional post match updates in `apps/server`.

Wire Better Auth with its Anonymous plugin, compact 5 minute cookie cache, and Google OAuth in `apps/web` on Cloudflare Workers backed by Neon HTTP reads and short lived WebSocket Pool transactions, persist a unified Glicko 2 profile on `player_profiles`, and execute atomic row locked post match rating updates inside `apps/server` with an asynchronous `"rating_updated"` room broadcast.

**Implementation skills**: `better-auth-best-practices` (`better-auth/skills`, `.agents/skills/better-auth-best-practices/`) · `neon-drizzle` (`neondatabase/ai-rules`, `.agents/skills/neon-drizzle/`) · `neon-postgres` (`neondatabase/agent-skills`, `.agents/skills/neon-postgres/`) · `tanstack-start-best-practices` (`deckardger/tanstack-agent-skills`, `.agents/skills/tanstack-start-best-practices/`) · `colyseus` (`colyseus/skill`, `.agents/skills/colyseus/`) · `cloudflare` (`cloudflare/skills`, `.agents/skills/cloudflare/`) · `vitest` (`antfu/skills`, `.agents/skills/vitest/`) · `playwright-best-practices` (`currents-dev/playwright-best-practices-skill`, `.agents/skills/playwright-best-practices/`)

## Rationale

Reasoning, architecture options compared, and internal implementation defaults: see [rationale.md](rationale.md).

## Feature design

### Data model sketch

| Entity | Primary key | Foreign keys | Fields (required unless marked nullable) | Relationships and constraints |
| :--- | :--- | :--- | :--- | :--- |
| `user` (`packages/db/src/schema/auth-schema.ts`) | `id` (`text`, UUID) | None | `id`, `name` (`text`), `email` (`text`, unique), `emailVerified` (`boolean`), `image` (`text`, nullable), `isAnonymous` (`boolean`, default `false`), `createdAt` (`timestamptz`), `updatedAt` (`timestamptz`) | `1:1` with `player_profiles`; `1:N` with `session`, `account`, and `matches` |
| `session` (`packages/db/src/schema/auth-schema.ts`) | `id` (`text`, UUID) | `userId` to `user.id` (`ON DELETE CASCADE`) | `id`, `userId`, `token` (`text`, unique), `expiresAt` (`timestamptz`), `ipAddress` (nullable), `userAgent` (nullable), `createdAt`, `updatedAt` | `N:1` owned by `user`; indexed on `userId` and `token` |
| `account` (`packages/db/src/schema/auth-schema.ts`) | `id` (`text`, UUID) | `userId` to `user.id` (`ON DELETE CASCADE`) | `id`, `accountId` (`text`), `providerId` (`text`, e.g. `"google"`), `userId`, `accessToken` (nullable), `refreshToken` (nullable), `idToken` (nullable), `accessTokenExpiresAt` (nullable), `refreshTokenExpiresAt` (nullable), `scope` (nullable), `password` (nullable), `createdAt`, `updatedAt` | `N:1` owned by `user`; indexed on `userId` |
| `verification` (`packages/db/src/schema/auth-schema.ts`) | `id` (`text`, UUID) | None | `id`, `identifier` (`text`), `value` (`text`), `expiresAt` (`timestamptz`), `createdAt`, `updatedAt` | OAuth state and verification tokens |
| `player_profiles` (`packages/db/src/schema/player-profiles.ts`) | `user_id` (`text`) | `user_id` to `user.id` (`ON DELETE CASCADE`) | `user_id`, `handle` (`text`, unique, 3 to 24 lowercase Latin, digits, underscores), `display_name` (`text`, 1 to 32 trimmed Unicode chars), `rating` (`doublePrecision`, default `1500`), `rating_deviation` (`doublePrecision`, default `350`), `volatility` (`doublePrecision`, default `0.06`), `games_played` (`integer`, default `0`), `wins` (`integer`, default `0`), `losses` (`integer`, default `0`), `draws` (`integer`, default `0`), `last_rated_at` (`timestamptz`, nullable), `locale` (`text`, `"my" \| "en"`, default `"my"`), `created_at` (`timestamptz`), `updated_at` (`timestamptz`) | `1:1` with `user`; unique index `player_profiles_handle_uidx` on `handle`; btree index `player_profiles_rating_idx` on `rating DESC`; non negative counters |
| `matches` (updated `packages/db/src/schema/matches.ts`) | `id` (`text`, UUID) | `red_user_id` to `user.id` (`ON DELETE SET NULL`), `black_user_id` to `user.id` (`ON DELETE SET NULL`) | Existing match columns plus: `is_rated` (`boolean`, default `false`), `rating_applied_at` (`timestamptz`, nullable), `red_rating_before` (`integer`, nullable), `red_rating_after` (`integer`, nullable), `black_rating_before` (`integer`, nullable), `black_rating_after` (`integer`, nullable) | `N:1` optional to `user` on each seat; `rating_applied_at` guards at most once Glicko 2 application |

### State transitions

**1. Player identity and Google OAuth linking lifecycle**:

```
[Passive visitor on /$locale] (no session cookie, zero DB writes)
  └─ Clicks Play / Online / Create Room -> ensureGuestSessionProfileFn()
       ├─ Better Auth signIn.anonymous() -> databaseHooks.user.create.after inserts player_profiles
       ├─ Follow up UPDATE applies detected Paraglide locale and legacy sittuyin.guest.v1 displayName (appending Set-Cookie Max-Age=0)
       └─ [Anonymous Guest] (user.isAnonymous = true, persisted Glicko 2 rating)
            └─ Clicks Sign in with Google (callbackURL = current pathname + search)
                 └─ Google callback /api/auth/callback/google -> anonymous onLinkAccount (withEdgeTransaction)
                      ├─ First check brand new status (newProfile.games_played = 0 AND zero prior matches for newUser)
                      ├─ Reassign matches.red_user_id and matches.black_user_id from guest to newUser
                      ├─ Brand new Google account:
                      │    ├─ Copy guest rating, RD, volatility, wins/losses/draws, last_rated_at, locale
                      │    ├─ Copy display_name only if customized (not Guest_<4hex>); otherwise keep Google name
                      │    └─ Copy handle only if customized (not guest_<8hex>), renaming anon handle to migrating_<uuid> first
                      └─ Existing Google account:
                           └─ Keep Google account's existing rating, handle, display name, and stats; keep reassigned guest matches
                 └─ Better Auth deletes anonymous user (CASCADE removes old anonymous player_profiles)
                      └─ [Signed in Google Account] (user.isAnonymous = false)
```

**2. Post match persistence and Glicko 2 transaction (`apps/server`)**:

```
[Match reaches terminal competitive outcome after playing phase]
  ├─ Immediately broadcast "match_ended" to all room clients (zero DB latency)
  └─ Enqueue async persistAndRateCompletedMatchWithRetry (1 attempt + 500ms + 1500ms backoff)
       └─ Inside single PostgreSQL transaction (pg.Pool):
            ├─ SELECT id FROM "user" WHERE id IN (redId, blackId) ORDER BY id ASC FOR KEY SHARE
            │    └─ Any seat already deleted mid match -> set that seat to null, mark ratingSkipped = true
            ├─ INSERT INTO matches (...) ON CONFLICT (id) DO NOTHING
            ├─ SELECT is_rated, rating_applied_at FROM matches WHERE id = matchId FOR UPDATE
            ├─ If is_rated AND rating_applied_at IS NULL AND both seats exist AND red_user_id !== black_user_id:
            │    ├─ SELECT ... FROM player_profiles WHERE user_id IN (idA, idB) ORDER BY user_id ASC FOR UPDATE
            │    ├─ Compute calculateGlicko2MatchUpdate(redProfile, blackProfile, scoreRed, endedAt)
            │    ├─ UPDATE player_profiles for both players (rating, RD, volatility, games_played, wins/losses/draws, last_rated_at, updated_at)
            │    └─ UPDATE matches SET rating_applied_at = endedAt, red_rating_before/after, black_rating_before/after
            └─ COMMIT -> If rating applied and room is not disposed, broadcast "rating_updated" to room clients
```

### API surface

| Endpoint / Function / Event | Method / Direction | Key inputs | Key outputs | Auth | Key errors |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/auth/$` (`apps/web/src/routes/api/auth/$.ts`) | `GET`, `POST` | Better Auth standard payloads (Google OAuth callback, anonymous sign in, session, sign out) | Better Auth JSON or redirect plus `Set-Cookie` | Public / Session cookie | `400` bad state, `403` invalid origin |
| `getCurrentSessionProfileFn` (`apps/web/src/server/account.ts`) | TanStack Start ServerFn (`GET`) | None | `{ user, profile } \| null` (never exposes `email`) | Optional session cookie (read only, no lazy creation) | `500` DB unavailable |
| `ensureGuestSessionProfileFn` (`apps/web/src/server/account.ts`) | TanStack Start ServerFn (`POST`) | None (reads optional legacy `sittuyin.guest.v1` cookie) | `{ user, profile }` | Public (creates lazy Better Auth anonymous session if absent) | `500` DB unavailable |
| `updatePlayerProfileFn` (`apps/web/src/server/account.ts`) | TanStack Start ServerFn (`POST`) | `displayName?` (`string`, 1..32), `handle?` (`string`, 3..24 `[a-z0-9_]`), `locale?` (`"my" \| "en"`) | `{ profile }` | Authenticated session (guest or Google) | `401` unauthenticated, `409` `HANDLE_TAKEN`, `422` validation error |
| `mintMatchJoinTicketFn` (`apps/web/src/server/match-ticket.ts`) | TanStack Start ServerFn (`POST`) | `roomMode`, `timeControl`, `isRated?` (`boolean`, default `true` for public, forced `false` for private), `preferredSide?`, `roomTitle?`, `roleIntent?` | `{ token, profile, expiresAtMs, serverUrl }` | Authenticated (lazily creates anonymous session if absent) | `422` invalid input, `500` missing secret or DB |
| `"rating_updated"` (`apps/server` room broadcast) | Server to client Colyseus message | Triggered after post match DB commit | `{ matchId, isRated, red: RatingDeltaSummary, black: RatingDeltaSummary }` | Room member (seated or spectator) | Omitted if unrated, aborted, or DB unreachable |

### Value sourcing

| Action | Value produced or displayed | Source |
| :--- | :--- | :--- |
| `ensureGuestSessionProfileFn` | Initial `display_name` for a new anonymous guest | Follow up `UPDATE` right after `signInAnonymous()` applies legacy `sittuyin.guest.v1` cookie `displayName` if valid (appending `Set-Cookie` `Max-Age=0`), else `databaseHooks.user.create.after` normalizes `user.name` (trim, slice 32 chars) or generates `Guest_<4hex>` |
| `ensureGuestSessionProfileFn` | Initial `handle` (`guest_<8hex>`) | Generated via `crypto.randomBytes(4).toString("hex")` in `databaseHooks.user.create.after` with collision retry |
| `ensureGuestSessionProfileFn` | Initial `locale` (`"my" \| "en"`) | Follow up `UPDATE` right after `signInAnonymous()` applies Paraglide locale cookie / request header if valid, else `"my"` |
| `mintMatchJoinTicketFn` | `sub`, `displayName`, `isAnonymous`, `rating`, `isProvisional` JWT claims | Authenticated Better Auth `session.user.id`, `session.user.isAnonymous`, and `player_profiles.display_name`, `Math.round(player_profiles.rating)`, and `isProvisionalRating(rating_deviation, games_played)` (never client input) |
| `mintMatchJoinTicketFn` | `isRated` JWT claim | Forced `false` when `roomMode === "private_room"`; otherwise validated boolean input defaulting to `true` for `"public_lobby"` (used only for room creation; ignored on joins) |
| `calculateGlicko2PeriodUpdate` | Inactive rating periods before Steps 3 to 5 | `Math.max(0, (endedAt.getTime() - lastRatedAt.getTime()) / 86_400_000 - 1)` (`0` when `lastRatedAt` is `null` or within 1 day), followed by Glickman's standard Step 6 once for the active match |
| `calculateGlicko2MatchUpdate` | Match score `s` for Red (`1`, `0.5`, `0`) | Derived from `matches.winner_side` (`"red"` -> `1`, `null` draw -> `0.5`, `"black"` -> `0`) |
| `SittuyinRoom` `"rating_updated"` event | `ratingBefore`, `ratingAfter`, `delta`, `isProvisional` | Returned directly from the committed PostgreSQL transaction (`Math.round(before)`, `Math.round(after)`, `Math.round(after) - Math.round(before)`, `rdAfter > 110 \|\| gamesPlayedAfter < 10`) |
| Header account badge & lobby card | Provisional `?` indicator | Header derives from `isProvisionalRating(profile.ratingDeviation, profile.gamesPlayed)`; lobby card reads `LobbyRoomMetadata.hostIsProvisional` sourced from the host's verified JWT `isProvisional` claim |
| Header Google OAuth button | OAuth `callbackURL` | Current browser `window.location.pathname + window.location.search` so Google upgrade returns the user to their exact locale and page |

### Key invariants

- **Single profile per user (cache safe)**: every Better Auth `user` row has one `player_profiles` row created in `databaseHooks.user.create.after`. If a lookup misses `player_profiles`, re validate the session with `disableCookieCache: true` before attempting any backfill so a stale 5 minute cookie cache for a deleted linked anonymous user never raises a `23503` FK error.
- **Private rooms are never rated**: both `mintMatchJoinTicketFn` on `apps/web` and `SittuyinRoom.onCreate` on `apps/server` independently enforce `isRated = false` whenever `roomMode === "private_room"`.
- **At most once rating application**: a match updates Glicko 2 ratings if and only if `matches.is_rated === true`, `matches.rating_applied_at IS NULL`, both `red_user_id` and `black_user_id` exist in `"user"`, and `red_user_id !== black_user_id`.
- **Deadlock free lock ordering**: every transaction locking two `player_profiles` rows orders `SELECT ... FOR UPDATE` strictly by ascending `user_id` (`id1 < id2`).
- **Rating deviation bounds**: `rating_deviation` is always clamped to `[45, 350]` (`rdFloor = 45`, `rdCap = 350`) after both inactivity growth and post match updates.
- **Handle format and uniqueness**: `player_profiles.handle` is normalized to lowercase, matches `/^[a-z0-9_]{3,24}$/`, and is enforced by a PostgreSQL unique index.
- **No silent DB writes on passive SSR**: `getCurrentSessionProfileFn()` never inserts into `user`, `session`, or `player_profiles`.

### Security model

- **Ownership and mutation rules**: `updatePlayerProfileFn` derives the target `user_id` solely from the verified Better Auth server session (`auth.api.getSession({ headers })`) and rejects unauthenticated requests with `401`. No user can modify another user's `player_profiles` row, rating, or match counts.
- **PII minimization**: `user.email`, `account` OAuth tokens, and `session.token` are strictly server only and are never returned by `getCurrentSessionProfileFn`, never embedded in `MatchJoinTicketClaims`, and never placed in `SittuyinRoomState` or `LobbyRoomMetadata`.
- **CSRF and origin validation**: Better Auth enforces origin and CSRF checks using `BETTER_AUTH_URL` and `trustedOrigins`, and `useSecureCookies` is enabled automatically on HTTPS production origins.
- **Anti farming protections**: private rooms are forced unrated, self play (`red_user_id === black_user_id`) is blocked both in `SittuyinRoom.onAuth` and in the rating transaction guard, and aborted matches (`aborted_pre_move`, `aborted_maintenance`) never persist or update ratings.
- **Compliance note**: Google OAuth stores the user's email and display name in Neon PostgreSQL (basic personal data). Keep email private to the account owner and never expose it to other players or logs.

### Configuration required

All variables below were introduced in spec 0001 and become active on `apps/web` in this feature:

- `DATABASE_URL`: pooled Neon PostgreSQL connection string for `createEdgeDb` (HTTP), `createEdgeTxPool` (WebSocket Pool), and `apps/server` `createServerDb` (`pg`).
- `DATABASE_URL_UNPOOLED`: unpooled Neon PostgreSQL connection string used by `drizzle-kit migrate`.
- `BETTER_AUTH_SECRET`: minimum 32 character secret for signing Better Auth session cookies and `cookieCache`.
- `BETTER_AUTH_URL`: canonical web origin (for example `https://sittuyin.app` or `http://localhost:3000`) for unprefixed `/api/auth/callback/google`.
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: Google Cloud OAuth 2.0 credentials configured with authorized redirect URI `<BETTER_AUTH_URL>/api/auth/callback/google`.

### Critical test scenarios

- **Happy path (Glicko 2 math)**: running `calculateGlicko2MatchUpdate` on Mark Glickman's 2013 worked example inputs reproduces his published rating (`1464.06`), RD (`151.52`), and volatility (`0.05999`) within `0.05` tolerance, and daily inactivity RD growth increases RD smoothly up to cap `350`, verifies **AC-3**.
- **Happy path (lazy guest to ticket to rated match)**: a passive landing page load creates zero DB rows; clicking Online calls `ensureGuestSessionProfileFn` (carrying over legacy `sittuyin.guest.v1` `displayName` once and expiring it), creates a Better Auth anonymous user plus `player_profiles`, mints a ticket with `isRated: true`, completes a public rated match on `SittuyinRoom`, commits `matches` plus both `player_profiles` updates, and broadcasts `"rating_updated"` with exact integer deltas, verifies **AC-1**, **AC-5**, **AC-6**, **AC-8**, **AC-10**, **AC-11**, **AC-13**.
- **Happy path (Google OAuth linking, new vs existing)**: linking an anonymous guest with 3 games into a brand new Google account copies the guest's rating, RD, volatility, stats, and reassigns all 3 matches in one `createEdgeTxPool` transaction; linking a second guest into that already existing Google account preserves the Google account's existing rating and stats while still reassigning the second guest's matches, verifies **AC-2**, **AC-7**.
- **Failure case (idempotent retry & deadlock avoidance)**: invoking `persistAndRateCompletedMatch` twice concurrently or retrying after a simulated transient failure after commit applies Glicko 2 strictly once (`rating_applied_at` non null), and two concurrent matches finishing between swapped seat pairs acquire `player_profiles` locks in ascending `user_id` order without deadlocking, verifies **AC-11**, **AC-12**.
- **Failure case (mid match Google link)**: if Red's anonymous user row is deleted mid match (because Red linked Google in another tab), post match persistence catches the missing user inside the transaction, stores `red_user_id = null`, skips Glicko 2 cleanly with a warning log, and never throws an unhandled FK error, verifies **AC-11**, **AC-12**.
- **Failure case (private & normal unrated enforcement)**: sending `isRated: true` with `roomMode: "private_room"` is coerced to `isRated: false` in both `mintMatchJoinTicketFn` and `SittuyinRoom`, and completing a private room or public Normal match (`isRated: false`) persists the `matches` row with `rating_applied_at = null` and leaves both players' `player_profiles` unchanged, verifies **AC-4**, **AC-8**, **AC-10**, **AC-12**.
- **Auth and permission**: an unauthenticated request to `updatePlayerProfileFn` returns `401`, updating to an already taken handle returns `409 HANDLE_TAKEN`, and neither `getCurrentSessionProfileFn` nor `MatchJoinTicketClaims` ever exposes `user.email`, verifies **AC-5**, **AC-9**.

## Build plan

Ordered in Tracer Bullet end to end vertical slices (assumed default because no root `AGENTS.md` or `docs/scope/` build approach is recorded yet): stand up the database schema and pure Glicko 2 engine first, wire Better Auth and ticket minting end to end, connect `apps/server` transactional rating updates, and finish with the bilingual web account and rating delta UI.

1. Add `better-auth` and `@neondatabase/serverless` to the workspace packages, generate `packages/db/src/schema/auth-schema.ts` (with UUID IDs and Anonymous plugin fields), create `packages/db/src/schema/player-profiles.ts`, update `packages/db/src/schema/matches.ts` (FKs, `is_rated`, `rating_applied_at`, rating snapshots), generate the single Drizzle SQL migration (nulling orphaned legacy `matches` user IDs before adding FK constraints), and export `createEdgeDb`, `createEdgeTxPool`, and `withEdgeTransaction` (guaranteed `pool.end()` in `finally`) alongside `createServerDb` in `packages/db/src/client.ts`, satisfies **AC-1**, **AC-2**.
2. Implement the pure zero dependency Glicko 2 engine (`calculateGlicko2PeriodUpdate`, `calculateGlicko2MatchUpdate`, `isProvisionalRating`) in `packages/shared/src/glicko2.ts` with unit tests verifying Mark Glickman's 3 opponent 2013 worked example and bounds, and extend `packages/shared` ticket (`isRated`, `isProvisional`), lobby metadata (`isRated`, `hostIsProvisional`), snapshot, and `RatingUpdatedEventSchema` contracts, satisfies **AC-3**, **AC-4**.
3. Implement `packages/db/src/repositories/player-profiles.ts` (profile lookup, creation with collision checked `guest_<8hex>` handle, profile update mapping `23505` to `HANDLE_TAKEN`, and transactional `linkAnonymousProfileAndMatches` checking brand new status before match reassignment and preserving customized handles/display names) plus transactional `persistAndRateCompletedMatch` in `packages/db/src/repositories/matches.ts` (`FOR KEY SHARE` `"user"` lock, idempotent insert, ascending `user_id` `SELECT FOR UPDATE`, Glicko 2 application, and snapshot stamping) with repository unit tests, satisfies **AC-1**, **AC-7**, **AC-11**, **AC-12**.
4. Implement lazy per request `createAuth(env)` in `apps/web/src/server/auth.ts` (`drizzleAdapter`, compact 5 minute `cookieCache`, Google OAuth, `anonymous({ onLinkAccount })` using `withEdgeTransaction`, `databaseHooks.user.create.after` with normalized `user.name`, and `tanstackStartCookies()` last in `plugins`), mount `apps/web/src/routes/api/auth/$.ts`, and create `apps/web/src/lib/auth-client.ts` (`createAuthClient` with `anonymousClient()`), satisfies **AC-5**, **AC-6**, **AC-7**.
5. Build `apps/web/src/server/account.ts` (`getCurrentSessionProfileFn` with `disableCookieCache` re validation on profile miss, `ensureGuestSessionProfileFn` with follow up `UPDATE` for Paraglide `locale` and legacy `sittuyin.guest.v1` `displayName` carryover plus appended `Set-Cookie` expiration, `updatePlayerProfileFn`) and update `apps/web/src/server/match-ticket.ts` so `mintMatchJoinTicketFn` reads verified Better Auth plus `player_profiles` data (`rating`, `isProvisional`) and enforces `isRated = false` on private rooms, satisfies **AC-6**, **AC-8**, **AC-9**.
6. Update `apps/server` (`SittuyinRoomState`, `SittuyinRoom`, `persistence.ts`) to carry creator verified `isRated` and player `isProvisional` (`hostIsProvisional`), invoke `persistAndRateCompletedMatch` asynchronously with retry backoff after broadcasting `"match_ended"`, emit `"rating_updated"` on commit (guarded against room disposal), and cover rated, normal, private, retry idempotency, and mid match deleted user cases in `SittuyinRoom.test.ts`, satisfies **AC-10**, **AC-11**, **AC-12**.
7. Add the bilingual (`/my` and `/en`) header account menu (guest/Google status reading `profile.displayName`, provisional `?` rating, editable `displayName` and `handle`, Sign in with Google with current pathname plus search `callbackURL`, Sign out hidden for anonymous guests), the Rated (default) vs Normal toggle in the Create Room modal plus lobby card Rated/Normal and provisional `?` badges, and the live post match rating delta badge wired to `"rating_updated"` in `ColyseusMatchAdapter` and `<SittuyinMatchWorkspace>`, satisfies **AC-13**.

## Consequences

**Positive**:

- Guest players experience zero signup friction while still earning real persisted Glicko 2 ratings that transfer seamlessly on their first Google sign in.
- Separating public Rated matches, public Normal matches, and unrated Private Rooms protects rating integrity from friend farming without blocking casual or instructional games.
- Pure TypeScript Glicko 2 in `packages/shared` keeps rating math deterministic, dependency free, and testable across both Workers and Node 22.
- Broadcasting `"match_ended"` immediately and streaming `"rating_updated"` after the PostgreSQL commit keeps endgame UX instant even during Neon cold starts.

**Negative / tradeoffs**:

- Linking a guest account in another tab while actively playing a match causes that in flight game to fall back to `user_id = null` and unrated rather than building and maintaining a temporary user ID redirect table.
- Using a single unified rating pool across Rapid (`10+5`, `15+10`) and Classical (`30+0`) means strong fast players and strong slow players share one number until player volume justifies splitting pools.
- Running `onLinkAccount` over `@neondatabase/serverless` WebSocket `Pool` on Cloudflare Workers adds a short lived WebSocket handshake latency during Google account upgrades (acceptable because upgrades are rare one time events).
- Keeping inactive anonymous rows indefinitely in PostgreSQL means the `user` and `player_profiles` tables will grow slowly over time until a scheduled cleanup job is added later.

**Neutral**:

- Legacy `sittuyin.guest.v1` cookie files in `apps/web/src/server/guest-cookie.ts` remain only for one time `displayName` carryover and expiration during the transition and can be deleted once all testers have rotated onto Better Auth sessions.
- Existing `matches` rows written before this migration get `is_rated = false` and `rating_applied_at = null` by default.

## Follow-up

- [ ] Capture `better-auth-best-practices` conventions in `apps/web/src/server/AGENTS.md` (or `apps/web/AGENTS.md`) and `neon-drizzle` plus `neon-postgres` conventions in `packages/db/AGENTS.md` once root `AGENTS.md` is initialized (per spec 0001 follow up).
- [ ] Run `/architect` for **Public player profiles, match history, interactive replay viewer, and leaderboards** (consuming `player_profiles` and `matches` with cursor pagination).
- [ ] Add a scheduled Neon cleanup job later to prune unlinked anonymous `user` rows with zero matches older than 30 days once traffic grows.
- [ ] Configure Google Cloud OAuth 2.0 consent screen and authorized redirect URIs (`http://localhost:3000/api/auth/callback/google` and production `<BETTER_AUTH_URL>/api/auth/callback/google`) before end to end OAuth testing.

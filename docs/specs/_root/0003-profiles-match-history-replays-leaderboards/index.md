# 0003. Build public player profiles, match history, shareable interactive replays, and leaderboards

**Date**: 2026-11-28
**Status**: In Progress

## Summary

You are adding the public competitive surface for Sittuyin: a live leaderboard (`/$locale/leaderboard`), public player profile pages with match history (`/$locale/u/$handle`), and shareable interactive match replay links (`/$locale/match/$matchId`). Everything reads directly from your existing `player_profiles` and `matches` tables in Neon PostgreSQL through TanStack Start server functions (server endpoints on Cloudflare Workers), backed by three targeted composite indexes for fast cursor pagination (fetching the next page by the last seen row instead of slow offsets). Established rated players climb the public leaderboard, players and spectators can share any completed match down to a specific move (`?ply=N`), and private room games stay unlisted while remaining viewable by anyone holding the exact match link.

## Requirements

**User stories**:

- As a competitive Sittuyin player, I want to browse a public leaderboard of established rated players and see my own live rank (or how many rated games I need to qualify) so I can track my standing in the community.
- As a Sittuyin player or visitor, I want to open any player's public profile (`/$locale/u/$handle`) to view their Glicko 2 rating, provisional status, win/loss/draw record, and paginated match history without needing to sign in.
- As a player who just finished a match (or is studying an earlier game), I want a shareable interactive replay link (`/$locale/match/$matchId`) with move deep linking (`?ply=N`), Copy Match Link, and Copy Link at Move buttons so I can review or share exact board positions with friends.
- As a player who plays private invite games with friends, I want my private room matches to stay hidden from other visitors on my public profile while still appearing in my own match history (badged as Private) and opening cleanly when I share the exact replay URL.

**Acceptance criteria**:

- **AC-1**: `packages/db` adds a single Drizzle SQL migration that creates a partial composite leaderboard index `player_profiles_leaderboard_idx` on `player_profiles (rating DESC, user_id ASC) WHERE rating_deviation <= 110 AND games_played >= 10`, and replaces the two existing ascending match history indexes with composite descending keyset indexes `matches_red_user_ended_id_idx (red_user_id, ended_at DESC, id DESC)` and `matches_black_user_ended_id_idx (black_user_id, ended_at DESC, id DESC)` without adding any new columns to `player_profiles` or `matches`.
- **AC-2**: `packages/shared` defines and exports Zod schemas and opaque base64url cursor codecs (`encodeLeaderboardCursor`, `decodeLeaderboardCursor`, `encodeMatchHistoryCursor`, `decodeMatchHistoryCursor`) plus shared typed read contracts (`LeaderboardPageSchema`, `ViewerLeaderboardStandingSchema`, `PublicPlayerProfileSchema`, `PlayerMatchHistoryPageSchema`, `MatchReplayPayloadSchema`) with page size strictly capped at `25`, handle format `/^[a-z0-9_]{3,24}$/`, and `matchId` UUID validation.
- **AC-3**: `packages/db` implements and exports read repository helpers (`getLeaderboardPage`, `getViewerLeaderboardStanding`, `getPublicPlayerProfileByHandle`, `getPlayerMatchHistoryPage`, `getMatchReplayById`) that never select `user.email`, OAuth tokens, or session tokens; compute `viewerStanding.rank` using `1 + COUNT(*)` against the established filter (`rating_deviation <= 110 AND games_played >= 10`); join `player_profiles` onto `matches` seats so live `display_name` and `handle` appear when the account exists while falling back to historical `matches.*_display_name` when `user_id` is `null`; and filter out `mode = "private_room"` rows unless `includePrivate === true`.
- **AC-4**: `apps/web` exposes four read only TanStack Start server functions (`getLeaderboardFn`, `getPublicPlayerProfileFn`, `getPlayerMatchHistoryFn`, `getMatchReplayFn`) over `createEdgeDb` that validate all inputs with Zod before touching Neon, never create anonymous Better Auth users on read, check optional session ownership solely via `getCurrentSessionProfileFn` / Better Auth `getSession` (passing `includePrivate = viewerUserId === targetProfile.userId`), and set `Cache-Control: public, max-age=300, stale-while-revalidate=3600` on `public_lobby` match replays and `Cache-Control: private, no-store` on `private_room` match replays, leaderboard responses, and profile responses.
- **AC-5**: `apps/web` adds `/$locale/leaderboard` (SSR initial page of 25 established players sorted by `rating DESC, user_id ASC`, with a Load More button that appends subsequent cursor pages and dedupes by `userId`), displaying rank, player display name (linked to `/$locale/u/$handle`), Guest badge when `isAnonymous === true`, rounded rating, games played, and W/L/D summary, plus a pinned Your Rank banner for any signed in viewer showing either their exact live rank or their remaining qualification requirements (`gamesRemaining` and/or high rating deviation).
- **AC-6**: `apps/web` adds `/$locale/u/$handle` (SSR initial profile plus first 25 matches, with a Load More button for older matches), displaying display name, `@handle`, Guest badge when anonymous, rounded Glicko 2 rating with provisional `?` indicator when `isProvisionalRating` is true, W/L/D summary, and paginated match history rows (opponent live name/link or historical fallback name, result badge, Rated/Normal/Private badge, time control, rating delta when rated, ended timestamp, and Replay link to `/$locale/match/$matchId`). Private room matches appear only when the signed in owner views their own profile; unknown or old handles return a clean localized 404 state.
- **AC-7**: `apps/web` adds `/$locale/match/$matchId` (SSR loaded from PostgreSQL and rendered inside `<SittuyinMatchWorkspace>` via `createReplayAdapter`), displaying both seated players (with live `/$locale/u/$handle` links or historical fallback names, rating before/after deltas when rated, winner/termination summary, time control, and Private/Rated/Normal badge), supporting `?ply=N` deep linking (clamped safely to `[0, snapshots.length - 1]` and kept in sync as the user scrubs moves), and providing Copy Match Link and Copy Link at Move buttons. Unknown `matchId` values show a clean localized Not Found card with a Retry button to handle the brief async persistence window right after a live game ends.
- **AC-8**: `apps/web` adds a Share Replay button inside the post match overlay of `<SittuyinMatchWorkspace>` for completed competitive online matches (whenever `snapshot.matchId` is non empty and termination is not `aborted_pre_move` or `aborted_maintenance`), copying `/$locale/match/$matchId` and linking directly to the saved replay page.
- **AC-9**: `apps/web` wires bilingual (`/my` and `/en`) navigation across the app: a Leaderboard link in the top navigation bar, a My Profile link in the top bar account menu (linking to `/$locale/u/${profile.handle}`), and clickable player profile links in leaderboard rows, match history rows, and match replay headers.
- **AC-10**: All three new routes emit dynamic SSR `<title>`, `<meta name="description">`, canonical URLs, and Open Graph tags (`og:title`, `og:description`, `og:url`, using the existing site preview image), and emit `<meta name="robots" content="noindex, nofollow">` on `private_room` match replay pages and anonymous guest profiles (`isAnonymous === true`).

## Decision

**Chosen option**: Option 1: Direct Drizzle read repositories on Neon HTTP with targeted composite indexes, opaque base64url keyset cursors, and dedicated TanStack Start SSR routes reusing `<SittuyinMatchWorkspace>`.

Build public player profiles, match history, shareable interactive replays, and leaderboards directly over your existing `player_profiles` and `matches` tables using three targeted PostgreSQL indexes, Zod validated opaque keyset cursors in `packages/shared`, read only TanStack Start server functions over `createEdgeDb`, and three bilingual SSR routes (`/$locale/leaderboard`, `/$locale/u/$handle`, `/$locale/match/$matchId`) with zero new runtime dependencies.

**Implementation skills**: `neon-drizzle` (`neondatabase/ai-rules`, `.agents/skills/neon-drizzle/`) · `neon-postgres` (`neondatabase/agent-skills`, `.agents/skills/neon-postgres/`) · `tanstack-start-best-practices` (`deckardger/tanstack-agent-skills`, `.agents/skills/tanstack-start-best-practices/`) · `better-auth-best-practices` (`better-auth/skills`, `.agents/skills/better-auth-best-practices/`) · `shadcn` (`shadcn-ui/ui`, `.agents/skills/shadcn/`) · `tailwind-4-docs` (`tailwindlabs/tailwindcss`, `.agents/skills/tailwind-4-docs/`) · `vitest` (`antfu/skills`, `.agents/skills/vitest/`) · `playwright-best-practices` (`currents-dev/playwright-best-practices-skill`, `.agents/skills/playwright-best-practices/`)

## Rationale

Reasoning, architecture options compared, and internal implementation defaults: see [rationale.md](rationale.md).

## Feature design

### Data model sketch

No new tables or columns are added. This feature reads from the existing `user`, `player_profiles`, and `matches` tables (from Spec 0002) and adds three targeted PostgreSQL indexes in one Drizzle migration:

| Entity | Primary key | Foreign keys | Columns read by this feature | Relationships and indexes |
| :--- | :--- | :--- | :--- | :--- |
| `user` (existing, read only) | `id` (`text`, UUID) | None | `id`, `is_anonymous` (`boolean`) (email and auth tokens are never selected) | `1:1` with `player_profiles`; `1:N` optional with `matches` on `red_user_id` and `black_user_id` |
| `player_profiles` (existing, index added) | `user_id` (`text`) | `user_id` to `user.id` (`ON DELETE CASCADE`) | `user_id`, `handle`, `display_name`, `rating`, `rating_deviation`, `games_played`, `wins`, `losses`, `draws`, `last_rated_at`, `created_at` | `1:1` with `user`; existing unique `player_profiles_handle_uidx(handle)`; **new** partial composite index `player_profiles_leaderboard_idx(rating DESC, user_id ASC) WHERE rating_deviation <= 110 AND games_played >= 10` |
| `matches` (existing, indexes upgraded) | `id` (`text`, UUID) | `red_user_id` to `user.id` (`ON DELETE SET NULL`), `black_user_id` to `user.id` (`ON DELETE SET NULL`) | `id`, `mode`, `time_control`, `red_user_id`, `black_user_id`, `red_display_name`, `black_display_name`, `winner_side`, `termination_reason`, `initial_setup_fen`, `moves_uci_json`, `total_plies`, `is_rated`, `rating_applied_at`, `red_rating_before`, `red_rating_after`, `black_rating_before`, `black_rating_after`, `started_at`, `ended_at` | `N:1` optional to `user` on each seat (left joined to `player_profiles` for live handles); **new** keyset indexes `matches_red_user_ended_id_idx(red_user_id, ended_at DESC, id DESC)` and `matches_black_user_ended_id_idx(black_user_id, ended_at DESC, id DESC)` replacing the old 2 column ascending indexes |

### API surface

| Endpoint / ServerFn | Method | Key inputs | Key outputs | Auth | Key errors |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `getLeaderboardFn` (`apps/web/src/server/leaderboard.ts`) | TanStack Start ServerFn (`GET`) | `cursor?` (opaque base64url string), `limit?` (`1..25`, default `25`) | `{ entries: LeaderboardEntry[], nextCursor: string \| null, viewerStanding: ViewerLeaderboardStanding \| null }` | Public (reads optional session for `viewerStanding`, never creates anonymous user) | `422` invalid cursor or limit, `500` DB unavailable |
| `getPublicPlayerProfileFn` (`apps/web/src/server/profile.ts`) | TanStack Start ServerFn (`GET`) | `handle` (`string`, `/^[a-z0-9_]{3,24}$/`), `limit?` (`1..25`, default `25`) | `{ profile: PublicPlayerProfile, isOwner: boolean, matches: PlayerMatchHistoryItem[], nextCursor: string \| null } \| null` | Public (reads optional session to set `isOwner` and `includePrivate`, never creates anonymous user) | `422` invalid handle, `null` (route renders `404`), `500` DB unavailable |
| `getPlayerMatchHistoryFn` (`apps/web/src/server/profile.ts`) | TanStack Start ServerFn (`GET`) | `handle` (`string`, `/^[a-z0-9_]{3,24}$/`), `cursor?` (opaque base64url string), `limit?` (`1..25`, default `25`) | `{ matches: PlayerMatchHistoryItem[], nextCursor: string \| null }` | Public (reads optional session to allow `private_room` rows only when `viewerUserId === targetUserId`) | `404` unknown handle, `422` invalid cursor/handle, `500` DB unavailable |
| `getMatchReplayFn` (`apps/web/src/server/replay.ts`) | TanStack Start ServerFn (`GET`) | `matchId` (`string`, UUID format) | `MatchReplayPayload \| null` (sets `Cache-Control: public, max-age=300, stale-while-revalidate=3600` for `public_lobby` and `private, no-store` for `private_room`) | Public (unlisted by UUID for `private_room`; never creates anonymous user) | `422` invalid UUID, `null` (route renders Not Found + Retry), `500` DB unavailable |

### Value sourcing

| Action | Value produced or displayed | Source |
| :--- | :--- | :--- |
| `getLeaderboardFn` | Ranked row `rank` (`1, 2, 3...`) | Derived on the initial page from `1 + index`, and for Load More pages from `previousRows.length + index + 1` (or optional starting offset); exact rank for `viewerStanding` is computed in SQL via `1 + COUNT(*)` where `rating_deviation <= 110 AND games_played >= 10 AND (rating > viewer.rating OR (rating = viewer.rating AND user_id < viewer.user_id))` |
| `getLeaderboardFn` | `viewerStanding` (`qualified` vs `provisional`) | Read from authenticated viewer's `player_profiles` row via optional Better Auth session: `qualified = !isProvisionalRating(ratingDeviation, gamesPlayed)`, `gamesRemaining = Math.max(0, 10 - gamesPlayed)`, `rdThresholdMet = ratingDeviation <= 110` |
| `getLeaderboardFn` / `getPublicPlayerProfileFn` | `isAnonymous` (Guest badge) | Joined from `user.is_anonymous` (`INNER JOIN "user" ON user.id = player_profiles.user_id`), never exposing `user.email` |
| `getPublicPlayerProfileFn` / `getPlayerMatchHistoryFn` | `isOwner` and `includePrivate` | Server side equality check `session?.user.id === targetProfile.userId` (never trusted from client input) |
| `getPlayerMatchHistoryFn` / `getMatchReplayFn` | Seat `displayName` and clickable `handle` | `COALESCE(seat_profile.display_name, matches.<side>_display_name)` and `seat_profile.handle` (nullable `string \| null` when `user_id` is `null` or deleted) from `LEFT JOIN player_profiles` |
| `getPlayerMatchHistoryFn` / `getMatchReplayFn` | Per side `ratingDelta` (`+14`, `-12`, `0`, or `null`) | Derived from `matches.<side>_rating_after - matches.<side>_rating_before` when `is_rated === true` and both integer snapshot columns are non null; otherwise `null` |
| `getPlayerMatchHistoryFn` | Player centric `outcome` (`"win" \| "loss" \| "draw"`) | Derived from `matches.winner_side` compared against which seat (`red_user_id` vs `black_user_id`) equals `targetProfile.userId` |
| `/$locale/match/$matchId` | Initial and active board ply (`ply`) | Parsed from URL search param `?ply=N` via `Number.parseInt`, defaulted to `snapshots.length - 1` (or `0` when `ply=0` is explicit; final position when omitted so shared links show the finished game, or exact ply when `?ply=N` is present), clamped to `[0, Math.max(0, snapshots.length - 1)]`, and updated via `history.replaceState` / router `replace` on scrubber change |
| `<SittuyinMatchWorkspace>` post match overlay | Share Replay URL | Built from `/${locale}/match/${snapshot.matchId}` only when `snapshot.matchId` is non empty and `terminationReason` is neither `"aborted_pre_move"` nor `"aborted_maintenance"` |
| Route `head()` on all three pages | `og:image`, `canonical`, and `robots` | `og:image` uses the existing static site preview image on the request origin; `canonical` strips transient params (`?ply=` kept out of canonical so search engines index one canonical match URL); `robots` sets `"noindex, nofollow"` whenever `match.mode === "private_room"` or `profile.isAnonymous === true` |

### Key invariants

- **Established leaderboard threshold matches Glicko 2 provisional rule**: a player qualifies for the public leaderboard if and only if `rating_deviation <= 110 AND games_played >= 10` (the exact inverse of `isProvisionalRating` in `packages/shared`, matching the partial index predicate in `packages/db`).
- **Deterministic keyset ordering**: leaderboard queries always order by `(rating DESC, user_id ASC)` and match history queries always order by `(ended_at DESC, id DESC)`, fetching `limit + 1` rows to determine `nextCursor` without running a separate `COUNT(*)` query.
- **No silent writes on public reads**: none of the four read server functions or route loaders ever call `ensureGuestSessionProfileFn` or insert rows into `user`, `session`, or `player_profiles`.
- **Private room history isolation**: `matches` rows with `mode = "private_room"` are never returned by `getPublicPlayerProfileFn` or `getPlayerMatchHistoryFn` unless the server verifies `session.user.id === targetProfile.userId`.
- **Zero PII leakage**: `user.email`, `account` tokens, and `session.token` are never selected in any repository query or returned in any SSR loader payload.
- **Safe replay clamping**: any non numeric, negative, or out of bounds `?ply=` search parameter is clamped cleanly to `[0, snapshots.length - 1]` and never throws an error or blanks the board.

### Security model

- **Public read surface**: `/$locale/leaderboard`, `/$locale/u/$handle`, and `/$locale/match/$matchId` are publicly readable without authentication.
- **Unlisted private replays**: `private_room` matches use cryptographically random UUID v4 `matchId` values (`randomUUID()` from `apps/server`). Anyone with the exact link can view the replay, `robots` is forced to `noindex, nofollow`, `Cache-Control` is forced to `private, no-store`, and the match is excluded from all public lists and non owner profile histories.
- **Input validation before DB execution**: all four server functions validate `handle` (`/^[a-z0-9_]{3,24}$/`), `matchId` (UUID regex), `limit` (integer `1..25`), and opaque `cursor` (decoded base64url JSON validated with Zod) before executing any Neon PostgreSQL query, relying on Cloudflare Workers edge protection against volumetric abuse.
- **No PII exposed**: only `handle`, `displayName`, `isAnonymous`, Glicko 2 rating fields, W/L/D stats, and match game records are exposed publicly.

### Critical test scenarios

- **Happy path (leaderboard & Your Rank)**: seeding 30 established players and 2 provisional players returns 25 ranked rows on page 1 sorted by `(rating DESC, user_id ASC)` with a non null `nextCursor`, excludes provisional players from the table, loads the remaining 5 rows cleanly on page 2 with `nextCursor: null`, and returns exact `rank` for a signed in established viewer or `gamesRemaining` for a signed in provisional viewer, verifies **AC-1**, **AC-2**, **AC-3**, **AC-4**, **AC-5**.
- **Happy path (public profile, owner private visibility, & deleted opponent fallback)**: viewing `/$locale/u/$handle` as another visitor hides `private_room` matches while showing `public_lobby` matches with live opponent handles and rating deltas; viewing the same URL as the signed in owner shows `private_room` matches with a Private badge; a match whose opponent's `user_id` is `null` renders the historical `*_display_name` as plain unlinked text without crashing, verifies **AC-1**, **AC-3**, **AC-4**, **AC-6**.
- **Happy path (shareable replay & `?ply=N` deep link)**: opening `/$locale/match/$matchId?ply=4` loads the persisted `initialSetupFen` and `movesUciJson` into `<SittuyinMatchWorkspace>` at ply 4, updates `?ply=` as the user steps through moves, copies exact match and move URLs, sets `Cache-Control: public, max-age=300, stale-while-revalidate=3600` for `public_lobby` matches, and shows Share Replay in the live post match overlay for completed competitive matches only, verifies **AC-4**, **AC-7**, **AC-8**, **AC-10**.
- **Failure case (invalid inputs, old handles, async save race, & bad `?ply=`)**: malformed handles, non UUID `matchId` values, and tampered base64url cursors fail Zod validation before hitting Neon; an unknown or renamed handle renders a localized 404; an unknown `matchId` renders a localized Not Found state with a working Retry button; `?ply=999` and `?ply=abc` clamp safely without errors, verifies **AC-2**, **AC-4**, **AC-6**, **AC-7**.
- **Auth, privacy, & SEO**: `private_room` replays emit `noindex, nofollow` and `Cache-Control: private, no-store`; anonymous guest profiles emit `noindex, nofollow`; passive visits to all three routes create zero rows in `user` or `player_profiles`; and no response payload contains `email`, verifies **AC-3**, **AC-4**, **AC-6**, **AC-10**.

## Build plan

Ordered in Tracer Bullet end to end slices (matching Specs 0001 and 0002 because no root `AGENTS.md` or `docs/scope/` build approach is recorded yet): land the single index migration and shared cursor contracts first, build the tested read repositories and server functions next, then wire each public SSR route and navigation link end to end.

1. Update `packages/db/src/schema/player-profiles.ts` and `packages/db/src/schema/matches.ts` with the partial composite leaderboard index (`player_profiles_leaderboard_idx`) and descending keyset match history indexes (`matches_red_user_ended_id_idx`, `matches_black_user_ended_id_idx`), generate the single Drizzle SQL migration, and export the opaque cursor codecs and Zod read contracts in `packages/shared` with unit tests, satisfies **AC-1**, **AC-2**.
2. Implement the read repository functions in `packages/db/src/repositories/` (`getLeaderboardPage`, `getViewerLeaderboardStanding`, `getPublicPlayerProfileByHandle`, `getPlayerMatchHistoryPage` using `UNION ALL` over the red and black keyset indexes, and `getMatchReplayById`) with unit tests covering established filtering, rank counting, private match gating, and deleted seat fallback, satisfies **AC-1**, **AC-3**.
3. Create the read only TanStack Start server functions (`apps/web/src/server/leaderboard.ts`, `apps/web/src/server/profile.ts`, `apps/web/src/server/replay.ts`) with Zod input validation, optional read only Better Auth session checks (zero silent guest writes), and `Cache-Control` response headers, satisfies **AC-2**, **AC-4**.
4. Build the `/$locale/leaderboard` route with SSR initial page, Load More cursor pagination (deduping by `userId`), pinned Your Rank banner, localized `/my` and `/en` Paraglide copy, and SSR SEO/Open Graph `head()` metadata, satisfies **AC-5**, **AC-9**, **AC-10**.
5. Build the `/$locale/u/$handle` public profile route with SSR profile header (display name, `@handle`, Guest badge, Glicko 2 rating with provisional `?`, W/L/D summary), paginated match history (Load More, owner only Private matches, deleted opponent fallback), localized 404 state, and SSR SEO/Open Graph `head()` metadata (`noindex, nofollow` for anonymous guest profiles), satisfies **AC-6**, **AC-9**, **AC-10**.
6. Build the `/$locale/match/$matchId` interactive replay route reusing `<SittuyinMatchWorkspace>` and `createReplayAdapter` with initial ply support (`?ply=N` clamping and URL sync), player header bar with rating deltas and live profile links, Copy Match Link and Copy Link at Move buttons, localized Not Found with Retry state, and SSR SEO/Open Graph `head()` metadata (`noindex, nofollow` for `private_room`), satisfies **AC-7**, **AC-9**, **AC-10**.
7. Wire the Share Replay button into the live post match overlay of `<SittuyinMatchWorkspace>` (only for completed competitive online matches with non empty `matchId`), add the top navigation Leaderboard link and account menu My Profile link, and verify end to end flows with Vitest and Playwright across `/my` and `/en`, satisfies **AC-8**, **AC-9**.

## Consequences

**Positive**:

- Zero new infrastructure, zero new database tables, and zero new npm dependencies keep deployment and runtime operations simple on Cloudflare Workers and Neon.
- The partial composite leaderboard index keeps both paginated leaderboard reads and exact "Your Rank" counts fast as anonymous zero game accounts accumulate in `player_profiles`.
- Reusing `<SittuyinMatchWorkspace>` and `createReplayAdapter` guarantees that saved match replays look and feel identical to live games and manual FEN/UCI replays.
- Unlisted UUID links for private matches let friends share memorable games effortlessly without exposing casual friend matches on public profile pages or search engines.

**Negative / tradeoffs**:

- Changing a handle breaks old `/$locale/u/$oldHandle` bookmarks (returning `404`) rather than maintaining a redirect table; internal links always stay current because they join `player_profiles.handle` live.
- Live Neon HTTP SSR queries on `/$locale/leaderboard` and `/$locale/u/$handle` skip shared edge caching so personalized Your Rank and owner Private matches stay fresh on first paint; if traffic spikes heavily later, splitting public cached payloads from personalized client fetches will be needed.
- Enabling Share Replay immediately when `"match_ended"` arrives relies on the Retry button on `/$locale/match/$matchId` during the brief sub second window while `apps/server` commits the match row asynchronously.

**Neutral**:

- The existing `/$locale/replay` sandbox route stays untouched for manual FEN and UCI pasting, while `/$locale/match/$matchId` becomes the canonical home for saved online games.
- Rating history sparklines, match history filters, and dynamic per match PNG Open Graph cards are intentionally deferred to keep this first release lean and fast to ship.

## Follow-up

- [ ] Capture `neon-drizzle`, `neon-postgres`, and `tanstack-start-best-practices` conventions in root `AGENTS.md` (and area nested `AGENTS.md` files) once root `AGENTS.md` is initialized (per Specs 0001 and 0002 follow up).
- [ ] Consider adding a rating history sparkline chart, match history filters (Rated/Normal, time control), and dynamic PNG Open Graph cards once player match volume grows.
- [ ] If `/$locale/leaderboard` traffic grows large enough to stress Neon HTTP reads, split the public leaderboard table into a 60 second edge cached response and fetch `viewerStanding` client side.

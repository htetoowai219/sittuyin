# Rationale: 0003. Build public player profiles, match history, shareable interactive replays, and leaderboards

## Context

With Spec 0002 putting persistent Better Auth accounts, `player_profiles` (handles, display names, and unified Glicko 2 ratings), and completed `matches` (initial setup FEN, UCI move lists, and before/after rating snapshots) into Neon PostgreSQL, players now have real ratings and saved games, but no public way to view them, climb a visible ladder, or share a completed match with friends.

Three project constraints shape how this read surface should be built:

- **Small team and low operational footprint**: `apps/web` runs on Cloudflare Workers (TanStack Start SSR) backed by Neon PostgreSQL over HTTP (`createEdgeDb`), with no Redis cache, no search cluster, and no image rendering service. Adding new infrastructure before traffic demands it slows down shipping and creates maintenance overhead.
- **Guest friendly yet fair competition**: anonymous guests can play rated public matches and earn real Glicko 2 ratings, while passive visitors who never click Play should never trigger database writes. At the same time, private invite rooms are unrated and meant for friends, so they must not leak onto other people's view of a player's public match history or into search engines.
- **Reuse of the existing board and replay engine**: `apps/web` already ships `<SittuyinMatchWorkspace>` and `createReplayAdapter` over `@sittuyin/engine`, and `apps/server` already generates a UUID v4 `matchId` and sends it in `"match_ended"`.

## Options considered

### Option 1: Direct Drizzle read repositories on Neon HTTP with targeted composite indexes, opaque keyset cursors, and dedicated TanStack Start SSR routes

Keep all data in the existing `player_profiles` and `matches` tables with zero new columns, add one Drizzle migration with three composite indexes (a partial leaderboard index and two descending keyset match history indexes), expose read only TanStack Start server functions over `createEdgeDb`, and build three dedicated bilingual SSR routes (`/$locale/leaderboard`, `/$locale/u/$handle`, `/$locale/match/$matchId`) that reuse `<SittuyinMatchWorkspace>` and static Open Graph metadata.

**Pros**:
- Zero new infrastructure, zero new tables, and zero new runtime dependencies.
- Partial index on `(rating DESC, user_id ASC) WHERE rating_deviation <= 110 AND games_played >= 10` makes both leaderboard pagination and exact `viewerStanding.rank` counts fast even as inactive guest rows accumulate.
- Live SSR queries keep personalized Your Rank and owner Private match visibility immediately accurate with zero stale cache bugs.

**Cons**:
- Leaderboard and profile SSR pages hit Neon HTTP on every request until traffic justifies splitting public edge cached payloads from personalized client fetches.
- Renaming a handle returns `404` on the old `/$locale/u/$oldHandle` URL instead of redirecting.

### Option 2: Split edge cached public APIs with separate client side personalized overlays

Serve public leaderboard and profile pages with aggressive Cloudflare Cache API / `Cache-Control` headers (for example 60 seconds) by stripping all session awareness from SSR, and fetch the signed in player's Your Rank banner and private room match history in a second client side request after hydration.

**Pros**:
- Absorbs sudden traffic spikes on `/$locale/leaderboard` with near zero Neon HTTP query load.
- Keeps CDN caching rules uniform across public pages.

**Cons**:
- Adds a noticeable client loading flash (layout shift or delayed banner) for Your Rank and owner Private matches on every page load.
- Introduces cache staleness right after a player finishes a rated match or updates their handle/display name, adding complexity before any database bottleneck exists.

### Option 3: Materialized leaderboard table plus handle redirect history and dynamic PNG Open Graph rendering

Add a periodically refreshed leaderboard snapshot table (or Cron trigger), a `player_handle_history` table for 301 redirects, and a Workers PNG renderer (`satori` / `resvg`) to generate custom social preview images per match and profile.

**Pros**:
- Rich custom board thumbnails when sharing links on chat apps and social media, plus permanent redirects when players rename handles.
- Decouples leaderboard reads from live `player_profiles` updates.

**Cons**:
- Adds schema sprawl, background refresh scheduling, and heavy WebAssembly image rendering bundles on Cloudflare Workers before the core public pages are even live.
- Materialized ranks lag behind live post match Glicko 2 updates, confusing players right after a game.

## Rationale

Option 1 fits all three forces in Context best. Because Neon HTTP reads over targeted composite indexes are fast and cheap at early to medium scale, skipping a materialized leaderboard table and skipping split SSR/client caching avoids premature complexity and keeps post match rank and match history updates immediately visible.

Reusing the existing `player_profiles` and `matches` columns with one focused index migration (and omitting a handle redirect table, profile bio fields, and PNG OG rendering) keeps the build tight while preserving clean extension points. Specifically, keyset pagination with opaque base64url cursors prevents slow `OFFSET` scans from day one, and separating `/$locale/match/$matchId` from the manual `/$locale/replay` sandbox keeps shareable match URLs clean and cacheable.

### Internal implementation defaults settled

- **Default `?ply=` when omitted on `/$locale/match/$matchId`**: open at the final ply (`snapshots.length - 1`) so someone opening a shared match link immediately sees the decisive ending position, while `?ply=0` opens at the initial setup and `?ply=N` opens at move `N`. Runner up: always open at ply `0` (forces an extra step to see the finish).
- **Match history union query shape**: fetch `limit + 1` rows from each side (`red_user_id = target` and `black_user_id = target`, each using its own `(user_id, ended_at DESC, id DESC)` index) combined via `UNION ALL`, ordered by `(ended_at DESC, id DESC) LIMIT limit + 1`. Runner up: a single `WHERE red_user_id = $1 OR black_user_id = $1` query (often degrades to a bitmap scan instead of two clean index scans).
- **Client side Load More deduplication**: dedupe appended leaderboard entries by `userId` and match history rows by `matchId` so a rating shift between page 1 and page 2 never renders duplicate rows. Runner up: naive array concatenation (can show a duplicate row if someone moves across a page boundary mid scroll).

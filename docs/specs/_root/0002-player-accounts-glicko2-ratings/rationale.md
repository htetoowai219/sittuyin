# Rationale: Build Better Auth guest sessions, Google OAuth account linking, player profiles, and post match Glicko 2 ratings

## Context

Sittuyin's online multiplayer stack is now working across `apps/web` (TanStack Start on Cloudflare Workers) and `apps/server` (Colyseus 0.18 on Fly.io Singapore), with completed matches persisted into Neon PostgreSQL via `packages/db`. However, player identity on `apps/web` currently relies on a temporary signed browser cookie (`sittuyin.guest.v1`) that fixes every player at a `1500` rating, has no database account or Google sign in, and cannot survive clearing cookies or switching devices. Meanwhile, `apps/server` persists completed games into `matches` without foreign keys to real user accounts, without distinguishing Rated from Normal public matches, and without updating player skill ratings.

Several real operational constraints shape this design:

- **Two deployment runtimes**: `apps/web` runs on Cloudflare Workers (where `drizzle-orm/neon-http` is fast for single queries but does not support multi statement SQL transactions), while `apps/server` runs on Node 22 with a persistent `pg.Pool`.
- **Zero friction guest onboarding**: Myanmar and international players should start a match in one click without registering, yet bots and search crawlers hitting landing pages must not wake Neon compute or insert empty guest rows.
- **Anti farming and concurrency**: friend matches in private rooms and casual public games must not inflate competitive ratings, and post match rating writes must stay safe against persistence retries, concurrent room completions, and a player upgrading their guest account in another browser tab mid match.

## Options considered

### Option 1: Better Auth (Anonymous plus Google OAuth) in `apps/web` with transactional Neon WebSocket Pool `onLinkAccount`, unified `player_profiles`, pure TypeScript Glicko 2 in `packages/shared`, and atomic row locked updates in `apps/server`

Host Better Auth in `apps/web` with its Anonymous plugin, compact 5 minute cookie cache, and Google OAuth, using Neon HTTP for fast edge reads and a short lived Neon WebSocket Pool strictly for atomic `onLinkAccount` migrations. Store a single unified Glicko 2 profile on `player_profiles`, compute ratings with a zero dependency TypeScript module in `packages/shared`, and run one deadlock free PostgreSQL transaction per finished match on `apps/server` that emits `"rating_updated"` asynchronously after `"match_ended"`.

**Pros**:

- Keeps the entire auth and profile lifecycle in your own Neon PostgreSQL database with zero third party auth monthly fees or vendor lock in.
- Guarantees atomic guest to Google upgrades via WebSocket Pool transactions while keeping normal SSR reads fast over Neon HTTP and 5 minute `cookieCache`.
- Zero dependency Glicko 2 in `packages/shared` avoids unmaintained CommonJS npm packages and runs identically in tests, Workers, and Node 22.
- Asynchronous post match transaction plus `"rating_updated"` keeps endgame UI instant while guaranteeing idempotent, deadlock free rating updates.

**Cons**:

- Requires managing both Neon HTTP (`createEdgeDb`) and short lived WebSocket Pool (`createEdgeTxPool`) factories in `packages/db`.
- Mid match Google upgrades in another tab fall back to unrated `user_id = null` for that single in flight match instead of maintaining a redirect table.

### Option 2: Host Better Auth on `apps/server` (Node 22 Fly.io) and proxy `/api/auth/*` from `apps/web`

Run Better Auth directly inside the Node 22 Express server on Fly.io alongside Colyseus so all auth queries and `onLinkAccount` transactions reuse the existing `pg.Pool`, and proxy `/api/auth/*` requests from Cloudflare Workers to Fly.io.

**Pros**:

- Eliminates Neon WebSocket Pool setup on Cloudflare Workers because Node 22 `pg.Pool` natively supports SQL transactions.
- Centralizes all database writes on one Node runtime.

**Cons**:

- Couples web login and SSR session checks to the single stateful game server machine; any Fly.io deploy or restart breaks web sign in and profile reads.
- Adds cross origin proxy complexity for `Set-Cookie`, CSRF `Origin` checks, and Google OAuth callbacks between Cloudflare Workers and Fly.io.

### Option 3: Await Neon match persistence and Glicko 2 updates before broadcasting `"match_ended"`, using an external `glicko2` npm package and separate per time control rating tables

Block `SittuyinRoom` match termination until PostgreSQL finishes inserting `matches` and updating per time control `player_ratings` rows (computed via an npm `glicko2` package), then include the deltas directly inside `"match_ended"`.

**Pros**:

- Client receives the final outcome and rating delta in a single WebSocket message without handling a second `"rating_updated"` event.
- Separate Rapid and Classical rating pools prevent cross speed rating mixing from day one.

**Cons**:

- Adds 100 to 500 ms (or several seconds on a Neon cold start) of visible freeze before players see Checkmate or Timeout.
- Splits an early player base across multiple rating pools and adds an extra external CommonJS dependency.

## Rationale

Option 1 fits your operational constraints best. Keeping Better Auth on `apps/web` preserves clean fault isolation: players can browse, sign in, edit their profile, and view their rating on Cloudflare Workers even while `apps/server` restarts for a Fly.io deploy. Using Neon HTTP plus `cookieCache` (`compact`, 5 minutes) keeps everyday SSR fast, while confining `@neondatabase/serverless` WebSocket `Pool` strictly to the rare `onLinkAccount` upgrade gives full ACID atomicity without paying WebSocket connection overhead on every page load.

For ratings, a single unified pool on `player_profiles` keeps early matchmaking and display simple, while giving public hosts a Rated (default) vs Normal switch and forcing private rooms unrated solves friend farming cleanly. Writing the 2013 Mark Glickman Glicko 2 algorithm in pure TypeScript inside `packages/shared` takes under 150 lines, eliminates CJS/ESM bundling friction on Workers and Node 22, and is trivially verifiable against Glickman's published worked example.

Finally, running post match persistence asynchronously after broadcasting `"match_ended"`, ordering `SELECT ... FOR UPDATE` locks by ascending `user_id`, and guarding with `rating_applied_at IS NULL` gives players instant endgame feedback while preventing deadlocks, double rating updates on retries, and foreign key crashes if a guest upgrades mid game.

## Internal defaults settled

- **Anonymous email domain**: `guest.sittuyin.app` (`anonymous({ emailDomainName: "guest.sittuyin.app" })`), keeping synthetic guest emails clearly distinguishable from real Google addresses (runner up: `anonymous.local`, rejected because some email validators reject `.local`).
- **Handle validation regex**: `/^[a-z0-9_]{3,24}$/` stored lowercase, avoiding homoglyph impersonation and URL encoding issues in future `/@$handle` profile links while `display_name` remains open to full Burmese and English Unicode up to 32 trimmed characters (runner up: Unicode handles, rejected due to spoofing and URL escaping complexity).
- **Glicko 2 convergence tolerance**: Illinois algorithm tolerance `epsilon = 0.000001` (`1e-6`), matching Mark Glickman's 2013 specification exactly (runner up: Newton Raphson, rejected because Glickman specifically replaced it with the Illinois method for guaranteed convergence).
- **Inactivity RD growth cap**: `1` rating period equals `1` day (`86_400_000` ms). Before Steps 3 to 5, apply `phi_inactive = Math.min(Math.sqrt(phi^2 + Math.max(0, elapsedDays - 1) * sigma^2), 350 / 173.7178)` when `last_rated_at` is non null, then run Glickman's standard Step 6 once for the active match period. When `elapsedDays <= 1` (or on a player's first game), this reduces identically to Mark Glickman's 2013 paper with zero double counting, while returning players adjust faster without exceeding the `350` RD cap (runner up: fixed 7 day step buckets, rejected because continuous elapsed days avoids abrupt jumps).

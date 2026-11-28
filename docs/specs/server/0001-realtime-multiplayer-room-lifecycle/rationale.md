# 0001. Implement realtime multiplayer room lifecycle, clocks, and lobby matchmaking: Rationale

## Context

`packages/sittuyin-engine` now provides the pure, deterministic Burmese chess rules engine (staggered pawn setup, hidden simultaneous and alternating officer setup, piece movement, General promotion on `sit ke myin` diagonals, 1 ply illegal stalemate filtering, draw rules, FEN/UCI serialization, and `toPlayerView` privacy masking), and `apps/web` provides the custom 2D teak SVG board workspace behind a `MatchAdapter` interface. However, `apps/server`, `packages/shared`, and `packages/db` still contain only minimal initial scaffolds (`SittuyinRoom` accepts any unverified token string, caps clients at 2, and has no game engine integration, timers, clocks, lobby listing, or database persistence).

To turn Sittuyin into a live multiplayer game on a single always on Fly.io machine in Singapore (`sin`), `apps/server` must act as the strict authoritative referee over untrusted WebSocket clients. Specifically, Sittuyin's default opening (`hidden_simultaneous` setup) requires both players to arrange 8 officers secretly behind their pawns at the same time while spectators watch; if the server puts raw `GameState.setupDrafts` into public Colyseus state, any browser DevTools inspection or stream viewer can read the opponent's formation before reveal. Furthermore, Myanmar mobile players frequently experience short network switches or background tab reloads, meaning a naive disconnect handler that deletes the player immediately would ruin active rapid and classical games.

Finally, the bridge between the stateless TanStack Start web app on Cloudflare Workers (`apps/web`) and the stateful Colyseus Node.js 22 server on Fly.io (`apps/server`) needs stateless authentication without cross domain cookie fragility, protection against replay and two tab self play farming, safe deploy locking when Fly.io replaces the machine container, and resilient persistence into Neon PostgreSQL (`packages/db`) that tolerates Neon cold start wakeups without freezing live room broadcasts.

## Options considered

### Option 1: Authoritative Colyseus 0.18 `SittuyinRoom` and `LobbyRoom` with `@view()` `StateView` setup isolation, monotonic Fischer clocks, single use `jose` JWT anti cheat registries, and asynchronous Drizzle `matches` persistence

Use Colyseus 0.18 `defineServer()` with built in `LobbyRoom` and `.enableRealtimeListing()` for public rooms (allowing players to pick Red, Black, or Random and a room title, and allowing up to 16 spectators to join live) alongside private rooms whose `this.roomId` is set directly to a collision checked 6 character uppercase alphanumeric invite code. Split room state across five compact `@colyseus/schema` 5 structures (all well under 63 fields), isolating each player's hidden setup draft and hand behind `.view()` fields (`redPrivate` and `blackPrivate`) populated from `toPlayerView` while sharing a single `spectatorView` across all spectators. Drive the 60 second `autoCompleteSetup` countdown and 100ms monotonic Fischer chess clocks via `this.clock`, patch synchronized clock values on turn changes and 1 second intervals, verify 60 second HS256 JWT tickets with `jose` against in memory `UsedJtiStore` and `ActivePlayerRoomMap` singletons, support 60 second reconnection windows and in room side swapping rematches, expose a Basic Auth maintenance lock plus `onBeforeShutdown`, and persist finished games asynchronously to Neon PostgreSQL via Drizzle ORM with 2 backoff retries.

**Pros**:

- Enforces hidden setup privacy at both the domain engine level (`toPlayerView`) and the Colyseus binary encoder level (`@view()` with per player `StateView` and shared `spectatorView`), guaranteeing zero wire leakage to rivals or spectators.
- Setting `this.roomId = inviteCode` for private rooms and using Colyseus `LobbyRoom` for public rooms lets clients join either mode through standard `@colyseus/sdk` calls (`joinById` and `LobbyRoom`) with zero custom database matchmaking tables.
- Checking clock flags every 100ms via `performance.now()` while patching synchronized `remainingMs` once per second and on turn changes delivers sub 100ms flag accuracy with minimal WebSocket bandwidth.
- Asynchronous Drizzle persistence with 2 retries (`500` ms, `1500` ms) shields players from Neon scale to zero cold start latency at the moment checkmate occurs.

**Cons**:

- Per view encoding (`Red`, `Black`, and shared `spectatorView`) encodes state patches up to 3 times per room instead of once, trading a tiny server CPU cost for cryptographic grade hidden setup privacy.
- In memory `UsedJtiStore` and `ActivePlayerRoomMap` are scoped to the single Fly.io Node process and must move to Redis if the server scales horizontally across multiple machines in the future.

### Option 2: Custom Express REST lobby and private invite mapping table with raw JSON message broadcasting (bypassing `@colyseus/schema` `@view()`)

Skip Colyseus `LobbyRoom` and `@colyseus/schema` `@view()` filtering; maintain custom Express REST endpoints (`GET /api/lobby`, `POST /api/rooms`, `GET /api/invite/:code`) backed by PostgreSQL room rows, keep the board out of Colyseus `Schema` state, and send custom JSON snapshots of `toPlayerView(state, viewer)` manually via `client.send("state_snapshot", ...)` after every action and every 100ms clock tick.

**Pros**:

- Avoids learning Colyseus 0.18 `StateView` and `@view()` mechanics.
- Room listings survive a server process restart in PostgreSQL (even though the in memory live rooms themselves do not).

**Cons**:

- Throws away Colyseus binary delta compression and automatic reconnection state reconciliation (`onReconnect` automatically reconciles `Schema` state, whereas custom `client.send` snapshots require custom client resync protocols).
- Broadcasting full JSON state and 100ms clock payloads manually to 18 clients per room multiplies bandwidth and garbage collection pressure on the Fly.io node.
- Writing and deleting ephemeral lobby rows in Neon PostgreSQL on every room creation and abort prevents Neon from scaling to zero during idle hours and adds unnecessary database latency to room joins.

### Option 3: Dedicated Colyseus `QueueRoom` blind matchmaking only with strict 2 client room cap and synchronous database writes

Force all public players into a blind rating queue (`QueueRoom`) with no lobby browser or side preference, cap `SittuyinRoom` strictly at `maxClients = 2` (no spectators), forfeit any player whose 60 second setup timer expires instead of running `autoCompleteSetup`, and `await` the Drizzle PostgreSQL `matches` insert synchronously before updating room state to `"finished"`.

**Pros**:

- Slightly simpler `onJoin` seat logic because every client is a player and no `spectatorView` is needed.
- Synchronous database persistence guarantees the database row exists before any client sees the `"match_ended"` screen.

**Cons**:

- Fails the product requirement for a social lobby where players choose Red, Black, or Random, name their room, browse open challenges, and spectate ongoing games.
- Forfeiting a player who placed 7 of 8 officers when the 60 second setup timer expires wastes both players' time when `@sittuyin/engine` already provides deterministic `autoCompleteSetup`.
- Blocking the `"match_ended"` state patch on a cold Neon TCP connection (which can take 1 to 3 seconds on wakeup) makes the final checkmate move feel frozen in the browser.

## Rationale

Option 1 aligns directly with the constraints in the accepted stack spec (`0001-sittuyin-tech-stack-architecture`) and rules engine spec (`0001-sittuyin-rules-engine`). Colyseus 0.18 already includes `LobbyRoom`, `.enableRealtimeListing()`, `StateView`, `this.clock`, and `onDrop`/`onReconnect`/`onLeave` reconnection hooks. Leveraging those primitives directly avoids writing and operating a parallel REST matchmaking service or polling Neon PostgreSQL for ephemeral lobby state.

For hidden simultaneous setup privacy, routing `this.engineState` through `toPlayerView(this.engineState, viewer)` before populating `@view()` tagged `redPrivate` and `blackPrivate` child schemas gives defense in depth: the public `SittuyinRoomState` never holds draft square coordinates, Red's `StateView` only includes `redPrivate`, Black's `StateView` only includes `blackPrivate`, and all 16 spectators share one `spectatorView` instance (`new StateView()`). Because `@colyseus/schema` 5 caches the encoded patch buffer per `StateView` object, 16 spectators cost only 1 encode pass per tick.

**Internal implementation decisions settled (`RECOMMEND` items)**:

- **Invite code alphabet and custom `roomId` assignment**: Picked a 6 character Crockford style uppercase alphanumeric alphabet excluding ambiguous glyphs (`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`, 32 characters = $32^6 = 1,073,741,824$ combinations) assigned directly to `this.roomId` in `onCreate` after checking `matchMaker.getRoomById(code)` (runner up: separate in memory map from invite code to random 9 char Colyseus `roomId`). Why: setting `this.roomId = inviteCode` lets `@colyseus/sdk` call `client.joinById(inviteCode)` directly with zero extra lookup endpoint.
- **Server CSPRNG seed for `random_setup` and `autoCompleteSetup`**: Picked Node `crypto.randomBytes(4).readUInt32LE(0)` inside `SittuyinRoom` (runner up: accepting a client supplied seed). Why: keeps `@sittuyin/engine` pure and deterministic while preventing a malicious client from crafting a seed after timing analysis.
- **Monotonic clock measurement vs wall clock sync timestamps**: Picked Node `performance.now()` deltas for elapsed countdown calculation paired with `Date.now()` for `SittuyinClockState.syncedAtMs` (runner up: `Date.now()` for both). Why: `performance.now()` is monotonic and immune to NTP clock steps on the container host, while `Date.now()` gives clients a wall clock reference timestamp to pair with `ping`/`pong` offset estimation.
- **Message acknowledgment pattern**: Picked returning `{ ok: true }` or `{ ok: false, error }` from every message handler AND emitting a direct `"action_error"` message on failure (runner up: `ctx.reject()` only). Why: returning a `Result` object lets `ColyseusMatchAdapter` use `await room.request("move", ...)` to satisfy `MatchAdapter.dispatchMove(): Promise<Result<void, EngineError>>` directly, while also supporting fire and forget `room.send("move", ...)` listeners during tests.
- **Idempotent match persistence key**: Picked generating `matchId = crypto.randomUUID()` when a match (or rematch) starts and using `matchId` as `matches.id` with `.onConflictDoNothing()` across the 2 backoff retries (runner up: database auto generated serial/UUID on insert). Why: if a retry fires after an uncertain network timeout, idempotent `matchId` primary keys guarantee a match is never inserted twice.

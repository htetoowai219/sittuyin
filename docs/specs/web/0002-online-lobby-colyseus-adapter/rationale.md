# Rationale: Build online lobby, private room invite flow, guest ticket minting, and ColyseusMatchAdapter in apps/web

> ⚠️ Premise note: The full Better Auth account system (`user`, `session`, `player_profiles` tables in `packages/db`, and Google OAuth linking) has not been built yet, while `apps/server` (`0001-realtime-multiplayer-room-lifecycle`) requires a valid HS256 JWT (`MatchJoinTicketClaimsSchema`) signed with `MATCH_TICKET_SECRET` on every room creation and join. Blocking online multiplayer UI on full database backed accounts would delay end to end multiplayer testing, whereas trusting raw `sub` and `rating` strings from browser `localStorage` would let anyone spoof another player's `sub` or fake their rating. Using a server signed HTTP only guest cookie (`sittuyin.guest.v1`) inside TanStack Start server functions satisfies `apps/server`'s anti cheat contract today and swaps cleanly to Better Auth sessions later without touching `ColyseusMatchAdapter`.

## Context

`apps/web` now has a complete 2D Burmese chess (Sittuyin) board workspace (`0001-sittuyin-board-ui`) decoupled behind `MatchAdapter` with working local pass and play (`LocalMatchAdapter`) and replay (`ReplayAdapter`) controllers. In parallel, `apps/server` and `packages/shared` (`0001-realtime-multiplayer-room-lifecycle`) implement the authoritative Colyseus 0.18 `SittuyinRoom` and `LobbyRoom`, `@view()` `StateView` setup isolation, 6 character private invite codes, 60 second `autoCompleteSetup` countdowns, 100ms monotonic Fischer chess clocks, single use `jose` JWT verification (`UsedJtiStore` and `ActivePlayerRoomMap`), and `roomSnapshotToPlayerGameView` in `@sittuyin/shared`.

However, `apps/web` has no online lobby page, no private invite room flow, no server function to mint the 60 second HS256 join tickets that `apps/server` expects in `onAuth`, and no `ColyseusMatchAdapter` connecting live Colyseus rooms to `<SittuyinMatchWorkspace>`. Furthermore, online play introduces lifecycle states that offline pass and play never needed: waiting for an opponent to join via lobby or 6 character invite code, a ticking 60 second setup clock, network latency between a pointer drop and the server state patch, draw and rematch negotiations between remote sockets, read only live spectating, and surviving a mobile browser refresh within the server's 60 second reconnection grace window.

## Options considered

### Option 1: Stateless HS256 signed HTTP only guest cookie, TanStack Start ticket server functions, dedicated `/$locale/online` and `/$locale/room/$roomId` routes, and optimistic `ColyseusMatchAdapter`

Manage guest identity via a 30 day sliding HTTP only cookie (`sittuyin.guest.v1`) signed with `MATCH_TICKET_SECRET` inside TanStack Start server functions (`getOrCreateGuestSessionFn`, `updateGuestDisplayNameFn`, `mintMatchJoinTicketFn`), build `/$locale/online` around Colyseus `LobbyRoom` (splitting rooms into Open Challenges and Live Matches alongside a Create Room modal and 6 character invite code bar), and build `/$locale/room/$roomId` over an optimistic `ColyseusMatchAdapter` that reuses `roomSnapshotToPlayerGameView` from `@sittuyin/shared`, validates moves locally with `@sittuyin/engine`, interpolates clocks monotonically at 100ms intervals, and persists `room.reconnectionToken` in `localStorage` (`sittuyin.reconnect.v1`) for 60 second reload recovery.

**Pros**:

- Enforces server authority over guest `sub` and `rating` (`1500`) with zero database queries or Neon cold start latency on Cloudflare Workers.
- Shareable `/$locale/room/$roomId` URLs work identically for 6 character private invite codes and public rooms, supporting both direct link sharing and manual code entry.
- Reusing `roomSnapshotToPlayerGameView` from `@sittuyin/shared` and `<SittuyinMatchWorkspace>` from `web/0001` avoids duplicating FEN reconstruction or board rendering logic.
- Local `@sittuyin/engine` validation plus optimistic previews deliver zero latency piece drops while rolling back cleanly if the server emits `"action_error"`.

**Cons**:

- Clearing browser cookies resets the guest's `sub` until the Better Auth and `player_profiles` database spec lands.
- Requires an in memory room handoff registry (`pendingRoomHandoff`) when navigating from `/$locale/online` (after `client.create("sittuyin")`) to `/$locale/room/$roomId` so the newly created WebSocket connection is not closed and reopened.

### Option 2: Unverified browser `localStorage` guest identity passed in the ticket minting POST body

Generate `{ sub, displayName, rating }` in browser `localStorage` and send those fields in the request body to `mintMatchJoinTicketFn`, which signs whatever `sub` and `rating` the browser supplies.

**Pros**:

- Slightly simpler server function implementation with no cookie parsing or signing helper.

**Cons**:

- Breaks the trust boundary of `apps/server`'s `ActivePlayerRoomMap` and rating metadata: any user could edit `localStorage` to impersonate another guest's `sub` or advertise a fake `9999` rating in the public lobby.

### Option 3: Wait for full Better Auth + Neon PostgreSQL database integration before building the online lobby and `ColyseusMatchAdapter`

Bundle Better Auth setup, Drizzle `auth-schema.ts` migrations, `player_profiles`, Google OAuth, and `ColyseusMatchAdapter` into a single combined feature spec.

**Pros**:

- Guests would get database backed `user` and `player_profiles` rows from their first match.

**Cons**:

- Mixes two large, independent decisions (authentication/database accounts vs realtime Colyseus frontend integration) into one oversized build, delaying multiplayer playtesting and coupling local development of the lobby UI to a live Neon PostgreSQL connection.

## Rationale

Option 1 gives you a secure, production quality bridge between Cloudflare Workers (`apps/web`) and Fly.io (`apps/server`) immediately while keeping the architecture modular. Signing `sittuyin.guest.v1` as an HTTP only cookie with `jose` and `MATCH_TICKET_SECRET` means `mintMatchJoinTicketFn` never trusts client supplied `sub` or `rating` values (avoiding the spoofing hole in Option 2), yet requires zero database round trips or third party auth setup to playtest multiplayer today (avoiding the scope bloat of Option 3). When Better Auth lands in its own dedicated spec, only the identity lookup inside `apps/web/src/server/match-ticket.ts` changes.

On the frontend, giving `/$locale/online` and `/$locale/room/$roomId` dedicated routes leaves `/$locale/play` clean for offline pass and play and sandbox testing while making every online room addressable by a shareable URL (`/$locale/room/K7M9P2`). Extending `MatchAdapter` with the optional `online: OnlineRoomLifecycleState` slice lets `<SittuyinMatchWorkspace>` render the waiting overlay card, 60 second setup timer, draw offer banner, pre move abort button, and rematch controls without forking the board or setup tray components.

**Internal implementation defaults settled in this spec**:

- **In memory `pendingRoomHandoff` singleton across route transition**: when the host clicks Create Room on `/$locale/online`, `client.create("sittuyin")` resolves with a connected `Room` instance (whose `room.roomId` is the 6 character `inviteCode` for private rooms). Storing that `Room` in a short lived module singleton (`setPendingRoomHandoff(room)`) before calling `navigate({ to: "/$locale/room/$roomId" })` lets the room route adopt the open socket immediately instead of disconnecting and burning the server's 15 second waiting grace window. Runner up: passing creation parameters via URL query string and calling `client.create` inside `/$locale/room/$roomId` (pollutes the shareable URL or requires a temporary `/$locale/room/new` redirect that breaks browser Back button history).
- **Monotonic `performance.now()` anchor for 100ms client clock interpolation**: whenever `ColyseusMatchAdapter` receives a `SittuyinClockSnapshot`, it records `receivedAtPerfMs = performance.now()` and computes displayed remaining time as `Math.max(0, snapshotRemainingMs - (performance.now() - receivedAtPerfMs))` while `running` is true. This avoids subtracting `Date.now() - snapshot.clock.syncedAtMs`, which would jump or freeze whenever a player's device clock is skewed by even a few seconds from the server. Runner up: wall clock `Date.now() - syncedAtMs` delta (vulnerable to client clock drift).
- **65 second `localStorage` TTL for `StoredRoomReconnection` (`sittuyin.reconnect.v1`)**: storing a small JSON map of `{ [roomId]: { roomId, reconnectionToken, userId, savedAtMs, expiresAtMs } }` in `localStorage` (rather than `sessionStorage`) lets players recover both from an in tab mobile pull to refresh and from accidentally closing and reopening the room link from history within the server's 60 second grace window. Runner up: `sessionStorage` only (lost if the mobile tab is closed and reopened from a shared link).
- **Development fallback secret for `MATCH_TICKET_SECRET`**: in non production environments (`NODE_ENV !== "production"`), if `MATCH_TICKET_SECRET` is unset, `apps/web` uses the same deterministic 32+ character development fallback secret as `apps/server` so `pnpm dev` and Playwright tests work immediately without manual `.env` ceremony, while throwing a hard configuration error in production if `MATCH_TICKET_SECRET` is missing. Runner up: requiring `.env` creation before running `pnpm test` or `pnpm dev`.

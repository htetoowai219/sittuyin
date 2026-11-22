# 0001. Rationale: Sittuyin web game stack and architecture

This document holds the context, full stack alternatives evaluated, reasoning, landscape scan summary, and references behind [index.md](index.md).

## Context

> ⚠️ Premise note: Your starting idea separated React ("non game scene and landing page") from a separate game scene runtime alongside a Colyseus server. For a crisp 2D board game like Sittuyin, introducing a separate canvas or WebGL game engine (such as Phaser, PixiJS, or Unity) creates a brittle state bridge, larger mobile downloads, and accessibility issues without solving a problem a 2D board actually has. Keeping the 2D Sittuyin board inside React using SVG overlays and GPU accelerated CSS transforms removes an entire rendering runtime while giving you native control over Burmese artwork, diagonal promotion lines, and touch ergonomics. In addition, pairing an edge web host (Cloudflare Workers) with a stateful game server (Fly.io) introduces a two runtime boundary that must be bridged explicitly with short lived signed join tickets, CORS and Origin checks, and atomic guest upgrade transactions rather than relying on shared cookies.

You are starting a greenfield web game for traditional Burmese chess (Sittuyin, မြန်မာ့ စစ်တုရင်) with no existing code or repository conventions yet. The goal is a deeply refined 2D playing experience that feels sharp and responsive on both desktop and mobile browsers, launches with online realtime multiplayer (quick matchmaking plus private invite links), and lets anyone play immediately as a guest while optionally signing in with Google to save ratings, profiles, and match replays.

Several domain forces shape the foundation. First, Sittuyin has unique rules that differ meaningfully from Western chess: an uncheckered 8 by 8 board crossed by two corner to corner diagonal lines (_sit ke myin_), an opening drop phase where players place their major pieces behind eight fixed pawns under specific placement rules, promotion limited to the General (_Sit ke_) on enemy diagonal squares (including in place promotion when the General has been captured), and a strict ban on stalemate (basis: Burmese Wikipedia Sittuyin reference). Second, both the browser (for instant legal move highlights and drag previews) and the game server (for authoritative anti cheat validation) must agree on every edge case of these rules. Third, primary players in Myanmar and Southeast Asia often play on mobile networks with intermittent connectivity, making low regional latency (Singapore), crisp touch drag and drop, small bundle sizes, and graceful reconnection load bearing. Finally, the team is small (solo or tiny team), so operational simplicity, fast local iteration, and clear scaling paths matter far more than premature distributed infrastructure.

## Options considered

### Option 1: TypeScript Monorepo with TanStack Start (Cloudflare Workers), Custom React SVG Board, Colyseus 0.18 (Fly.io Singapore), Neon PostgreSQL with Drizzle ORM, and Better Auth

A `pnpm` and Turborepo TypeScript monorepo splitting `apps/web` (TanStack Start `1.0` deployed to Cloudflare Workers via `@cloudflare/vite-plugin` with Tailwind CSS v4, `shadcn/ui`, Paraglide JS `/my` and `/en` routes, and a custom React plus SVG 2D board), `apps/server` (Colyseus `0.18.x` deployed on an always on Fly.io Singapore machine), `packages/sittuyin-engine` (pure zero dependency TypeScript using Sittuyin FEN and UCI notation), `packages/db` (Drizzle ORM on Neon PostgreSQL Singapore), and `packages/shared` (shared Zod and Colyseus protocol types). Better Auth with its Anonymous plugin handles lazy guest sessions and transactional Google OAuth upgrades, handing 60 second HS256 `jose` JWT tickets to Colyseus on room join (basis: Colyseus Docs; TanStack Start Docs; Better Auth Anonymous Plugin Docs; Fly.io Docs; Cloudflare Workers Docs; Sittuyin FEN and UCI style notation convention).

**Pros**:

- Single TypeScript rules package runs identically in the browser and on the Colyseus server with zero rule drift.
- Colyseus 0.18 gives authoritative rooms, matchmaking, reconnection hooks, `@view()` hidden state filtering, and accurate in memory chess clocks out of the box.
- Custom React plus SVG board handles Sittuyin diagonal lines, reserve drop trays, Burmese Unicode labels, and mobile touch natively without fighting a Western chess library or canvas engine.
- Standard Node.js 22 on Fly.io Singapore pairs cleanly with Neon PostgreSQL (`pg` pooled TCP with error handlers) while Cloudflare Workers delivers a fast global edge landing page and bilingual SEO match previews.

**Cons**:

- Operates two separate deployment runtimes (Cloudflare Workers and Fly.io) with an explicit HS256 `jose` join ticket bridge, CORS/Origin validation, and `AsyncLocalStorage` locale middleware on Workers.
- Single always on Fly.io machine carries a small steady monthly compute cost and cannot drain 40 minute live matches across server restarts until Redis or mid match snapshotting is added later.
- Custom board rendering requires building and testing pointer drag and animation polish yourself rather than wrapping a prebuilt chess board widget.

### Option 2: Serverless Edge Full Stack with Next.js, Cloudflare Durable Objects (PartyServer), and Supabase (PostgreSQL and Auth)

A monorepo pairing Next.js (on Vercel or Cloudflare) with Cloudflare Durable Objects via `partyserver` where each Sittuyin match runs in its own isolated edge Durable Object using WebSocket Hibernation, paired with Chessground wrapped in React for the 2D board and Supabase for managed PostgreSQL and Anonymous Sign Ins (basis: Cloudflare Durable Objects Docs; PartyServer npm; Chessground GitHub).

**Pros**:

- Durable Objects scale horizontally to thousands of concurrent games automatically with zero Redis setup and near zero idle compute cost via WebSocket Hibernation.
- Global edge placement puts game rooms close to any pair of players without managing regional server fleets.
- Supabase bundles PostgreSQL, anonymous auth upgrades, and a visual dashboard under one vendor.

**Cons**:

- Durable Objects lock the game server into Cloudflare proprietary storage, Alarm APIs (which add friction for millisecond accurate chess clocks across hibernation wakeups), and edge compatible database drivers.
- Wrapping Lichess Chessground fights its Western chess assumptions (checkered squares, standard piece roles, no diagonal _sit ke myin_ lines, and clunky drop tray overrides).
- Heavier Next.js build and runtime footprint compared to Vite based TanStack Start when realtime play lives outside Next.js anyway.

### Option 3: Unified Single Runtime Node Stack with Vite SPA, PixiJS 2D Canvas, Custom Fastify WebSockets, and Self Managed PostgreSQL on Railway or VPS

A single Node.js backend built with Fastify and Socket.IO (or native WebSockets) serving both REST APIs, Better Auth, and custom game rooms alongside a PostgreSQL instance on Railway or a Singapore VPS, paired with a plain Vite React single page app that embeds a PixiJS 2D canvas for the board scene.

**Pros**:

- Single backend process and origin simplifies auth cookies, local startup, and operational monitoring with zero cross runtime ticket handoff.
- Zero game server framework lock in and flat predictable hosting costs on a VPS or Railway.
- PixiJS unlocks rich WebGL shaders, wooden lighting, and particle effects if visual spectacle becomes the primary goal.

**Cons**:

- Rebuilding room lifecycle, matchmaking queues, private room codes, reconnection grace windows, and delta state sync from scratch delays shipping refined Sittuyin gameplay.
- A plain Vite single page app weakens SEO and rich social preview cards for the landing page and shared match links.
- Maintaining a React to PixiJS canvas bridge adds bundle weight, hurts mobile battery and screen reader accessibility, and is overkill for a crisp 2D board.

## Rationale

Option 1 directly matches every force in Context while validating your instinct to use React and Colyseus where they shine and trimming complexity where they would hurt. First, keeping Colyseus `0.18.x` on Node.js 22 in Fly.io Singapore (rather than switching to Durable Objects or writing a raw Socket.IO room manager) buys proven room lifecycle management, millisecond accurate in memory clocks, `@view()` per client filtering for hidden setup drops, and graceful mobile reconnection without locking server code into edge runtime constraints (basis: authoritative game server pattern; Colyseus Docs; installed `colyseus` skill). Second, replacing a separate canvas game engine with a custom React plus SVG and GPU transform board gives Sittuyin first class support for its diagonal lines, reserve drop tray, in place promotion UX, and Burmese typography at a fraction of the bundle size and engineering friction (basis: DOM and SVG board architecture inspired by Chessground; Burmese Wikipedia Sittuyin reference).

Third, pairing TanStack Start `1.0` on Cloudflare Workers with Neon PostgreSQL, Drizzle ORM, and Better Auth keeps the entire repository in one strict TypeScript toolchain while respecting edge runtime limits. Lazy runtime factories avoid top level secret reads in Workers; `@sentry/cloudflare` plus lightweight `@sentry/react` (replay off) avoids Node startup SDK issues and stays well under the 3 MB Workers free tier; lazy guest creation plus Better Auth `cookieCache` prevents crawler traffic from waking Neon compute; and running `onLinkAccount` over a short lived Neon WebSocket `Pool` transaction with `ON DELETE SET NULL` match FKs closes both the `neon-http` transaction gap and the mid match guest upgrade race (basis: TanStack Start Docs; Better Auth Anonymous Plugin Docs; installed `tanstack-start-best-practices`, `cloudflare`, `better-auth-best-practices`, `neon-drizzle`, and `neon-postgres` skills).

Finally, signing 60 second HS256 `jose` JWT tickets with single use `jti` tracking and one active match per `sub` secures the Workers to Fly.io boundary without cross domain cookies or self match rating abuse (basis: stateless JWT handoff between edge web and stateful game server). Starting on one always on Fly.io Singapore machine (`auto_stop_machines = "off"`, `min_machines_running = 1`) with `pg` pool error guards keeps day one operational load simple and affordable (typically a few dollars per month alongside Neon and Cloudflare free tiers) while preserving a clean upgrade path to Redis presence if concurrent player counts outgrow one node (basis: monolith first before horizontal scaling).

### Additional architectural defaults decided here

- **Client state, validation, and audio**: use TanStack Query for server data caching (runner up: route loaders alone, less responsive optimistic refreshes), Zustand for local board preferences such as sound, board flip, and coordinate display (runner up: React Context, noisier rerenders during dragging), Zod for runtime validation on all server functions and Colyseus messages (runner up: Valibot, smaller ecosystem integration), and native Web Audio API for low latency wooden piece clack and clock tick sounds (runner up: Howler.js, unnecessary extra dependency for a handful of short audio buffers).
- **Rating baseline**: default to Glicko 2 on `player_profiles` because its rating deviation handles new guest upgrades and infrequent players far better than static K factor Elo (runner up: classic Elo, simpler math but slower convergence). Exact rating pools and provisional rules belong in the dedicated player and ratings spec.
- **Runtime and CI**: standardize on Node.js 22 LTS across local development, Fly.io containers, and GitHub Actions CI running `pnpm lint` (Biome), `pnpm typecheck`, and `pnpm test` (Vitest) on every pull request (runner up: Node.js 24 current line, slightly less uniform third party native addon coverage).

## Tool landscape check (2026-11-22)

A read only web check ran during Stage (c) to verify current versions and official documentation URLs before locking stack recommendations:

- **Colyseus**: `0.18.x` stable with `@colyseus/schema` `5.x`, `@colyseus/sdk`, `defineServer()`, `Callbacks.get(room)`, `CloseCode` reconnection hooks, and `@view()` state filtering.
- **Cloudflare Durable Objects / PartyServer**: `partyserver` stable on Cloudflare Workers with WebSocket Hibernation support.
- **TanStack Start**: `1.0` stable (released October 2026), Vite based with full type safe routing, server functions, and `@cloudflare/vite-plugin` Workers deployment.
- **Interactive 2D chess boards**: `chessground` remains the canonical reference architecture for high performance CSS transform plus SVG 2D boards, though tailored to Western chess.
- **Auth and persistence**: Better Auth Anonymous plugin (`onLinkAccount` migration hook, `cookieCache`), Drizzle ORM with Neon HTTP/WebSocket (edge) and `pg` pooled TCP (Node) adapters, and Neon PostgreSQL Singapore region.
- **Hosting**: Fly.io Singapore (`sin`) for always on persistent WebSockets and Cloudflare Workers for edge web rendering.

## References

**Project sources**:

- Installed `colyseus` skill (`.agents/skills/colyseus/`): Colyseus 0.18 `defineServer`, `@colyseus/sdk`, `Callbacks.get`, `CloseCode`, and `@view()` conventions.
- Installed `tanstack-start-best-practices` and `cloudflare` skills (`.agents/skills/tanstack-start-best-practices/`, `.agents/skills/cloudflare/`): TanStack Start server function, middleware, SSR, `nodejs_compat`, and Workers deployment conventions.
- Installed `better-auth-best-practices` skill (`.agents/skills/better-auth-best-practices/`): Better Auth Drizzle adapter, `cookieCache`, session config, and environment variable rules.
- Installed `neon-drizzle` and `neon-postgres` skills (`.agents/skills/neon-drizzle/`, `.agents/skills/neon-postgres/`): Neon HTTP vs WebSocket transaction vs pooled TCP adapter selection, `DATABASE_URL_UNPOOLED`, and idle scale to zero safeguards.

**Practices & standards**:

- Authoritative game server pattern (single source of truth for move validation and clocks, shared rules package to prevent client server drift).
- Stateless JWT handoff between edge web app and stateful WebSocket game server (HS256 via `jose` with single use `jti` anti replay and active match caps).
- Monolith first before horizontal scaling (single always on Fly.io instance in memory before adding Redis presence).
- DOM and SVG board architecture inspired by Chessground (GPU `translate3d` positioning and SVG overlay layer).
- Sittuyin FEN and UCI style notation convention (aligned with Fairy Stockfish and PyChess variants for replay portability and future AI compatibility).

**Links**:

- Burmese Wikipedia Sittuyin reference: https://my.wikipedia.org/wiki/%E1%80%99%E1%80%BC%E1%80%94%E1%80%BA%E1%80%99%E1%80%AC%E1%80%B7%E1%80%9B%E1%80%AD%E1%80%AF%E1%80%B8%E1%80%9B%E1%80%AC_%E1%80%85%E1%80%85%E1%80%BA%E1%80%90%E1%80%AF%E1%80%9B%E1%80%84%E1%80%BA
- Colyseus Docs: https://docs.colyseus.io/
- TanStack Start Docs: https://tanstack.com/start
- Better Auth Anonymous Plugin Docs: https://better-auth.com/docs/plugins/anonymous
- Cloudflare Workers Docs: https://developers.cloudflare.com/workers/
- Cloudflare Durable Objects Docs: https://developers.cloudflare.com/durable-objects/
- PartyServer npm: https://www.npmjs.com/package/partyserver
- Fly.io Docs: https://fly.io/docs/
- Chessground GitHub: https://github.com/lichess-org/chessground

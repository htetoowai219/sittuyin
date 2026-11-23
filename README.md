<div align="center">
  <h1>Sittuyin (မြန်မာ့ စစ်တုရင်)</h1>
  <p>Traditional Myanmar chess on the web with an uncheckered teak SVG board, hidden simultaneous setup, and bilingual Myanmar/English play.</p>
  <p>
    <img src="https://img.shields.io/badge/node-%3E%3D22-informational?style=flat-square" alt="Node 22+" />
    <img src="https://img.shields.io/badge/pnpm-12.15-informational?style=flat-square" alt="pnpm 12.15" />
    <img src="https://img.shields.io/badge/TypeScript-strict-blue?style=flat-square" alt="TypeScript" />
  </p>
</div>

## Quick Start

### Prerequisites
- Node.js 22+ (see `.nvmrc`)
- pnpm 12 (`corepack enable` or install `pnpm@12.15.0`)

### Run Locally
```bash
# 1. Clone the repository
git clone https://github.com/htetoowai219/sittuyin.git
cd sittuyin

# 2. Install workspace dependencies
pnpm install

# 3. Start the web app (no .env required for local play or replay)
pnpm --filter @sittuyin/web dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. It redirects to `/my` by default, and you can switch to `/en` from the top bar at any time.

To boot both the web client (`3000`) and the Colyseus game server (`2567`) together via Turborepo:

```bash
pnpm dev
```

## Why I Built This

Most online chess variants treat Sittuyin as a reskinned Western board and skip hidden simultaneous setup or traditional Burmese notation. I wanted a browser board that respects the real rules: an uncheckered 8x8 teak surface with `sit ke myin` diagonals, private officer placement before move one, and first-class Myanmar script alongside English.

## What You Can Do Today

- **Local Match Play (`/my/play`, `/en/play`):** Arrange your 8 officers privately with tap, drag, swap, double-tap removal, random generation, or 5 classic Myanmar opening formations (`မြင်းချ`, `ဆင်ချ`, `ရထားချ`, `ခံတပ်`, `စစ်ကဲချ`). Pass-and-play mode puts up a privacy curtain between Red and Black; sandbox mode lets you edit both sides directly.
- **Authentic Sittuyin Rules:** Powered by `@sittuyin/engine` with back-rank Chariot placement checks, illegal stalemate rejection, and an anchored General (`စစ်ကဲ`) promotion picker for in-place or 1-square diagonal promotions when you have no General left.
- **Clocks, Themes & Wooden Sound:** Pick Untimed, `10+5` Rapid, `15+10` Rapid, or `30+0` Classical clocks, flip between dark lacquer and daylight parchment themes, toggle Burmese script initials on pieces, and hear synthesized wooden clacks and low-time ticks via Web Audio (zero audio files).
- **Replay Viewer (`/my/replay`, `/en/replay`):** Step through the built-in sample game or paste any Sittuyin FEN + UCI move list to scrub ply by ply with keyboard shortcuts (`ArrowLeft`, `ArrowRight`, `Home`, `End`) and bilingual move notation.

## Current Scope

Local play, the standalone rules engine (`packages/sittuyin-engine`), and the FEN/UCI replay viewer are working today. Realtime online matchmaking rooms (`apps/server`) and accounts/Glicko-2 ratings (`packages/db`) are scaffolded and next on the list; the board UI already talks through a decoupled `MatchAdapter` so Colyseus rooms can plug in without rewriting the board.

<details>
<summary>Workspace layout and commands</summary>

```text
sittuyin/
├── apps/
│   ├── web/                 # TanStack Start + React 19 + Tailwind v4 + Paraglide UI (port 3000)
│   └── server/              # Colyseus 0.18 + Express game server scaffold (port 2567)
├── packages/
│   ├── sittuyin-engine/     # Pure TypeScript rules engine, FEN/UCI parser, presets & replay
│   ├── shared/              # Shared Zod schemas for time controls and room contracts
│   └── db/                  # Database package scaffold
└── docs/specs/              # Accepted architecture, engine, and web UI specs
```

```bash
pnpm test       # Run Vitest across all packages (engine + web + server + shared)
pnpm lint       # Run Biome lint and formatting checks
pnpm typecheck  # Run tsc --noEmit across every workspace
pnpm build      # Build packages, web client, and Cloudflare Workers SSR bundle
```

</details>

<details>
<summary>Environment variables (.env.example)</summary>

Local play and replay in `apps/web` need no environment variables. Copy `.env.example` to `.env` when working on the server or upcoming auth/database integrations:

| Variable | Default / Notes | Purpose |
|---|---|---|
| `PORT` | `2567` | Colyseus game server listen port (`apps/server`) |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated CORS origins for `apps/server` |
| `VITE_GAME_SERVER_URL` | `http://localhost:2567` | Game server URL read by `apps/web` |
| `MONITOR_AUTH_SECRET` | Optional | Basic auth password for `/monitor` in production |
| `DATABASE_URL` / `DATABASE_URL_UNPOOLED` | Upcoming | Neon PostgreSQL connection strings |
| `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` / `GOOGLE_CLIENT_*` | Upcoming | Better Auth session and OAuth config |
| `MATCH_TICKET_SECRET` | Upcoming | Shared HS256 JWT secret (min 32 bytes) for room join tickets |
| `SENTRY_DSN` / `VITE_SENTRY_DSN` / `SENTRY_AUTH_TOKEN` | Optional | Error reporting when Sentry is wired |

</details>

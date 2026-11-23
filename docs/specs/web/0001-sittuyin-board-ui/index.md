# 0001. Build custom 2D Sittuyin board UI, setup tray, and match play workspace

**Date**: 2026-11-23
**Status**: Accepted

## Summary

You are building the custom 2D Burmese chess (Sittuyin) board, hidden setup tray, bilingual move history, replay scrubber, local preferences store, and procedural wooden sound engine inside `apps/web`. The interface uses a warm Myanmar dark lacquer and teak table palette (with an optional daylight ivory parchment theme), an uncheckered 8 by 8 inline SVG board with inlaid `sit ke myin` diagonal promotion lines, and carved Burmese wooden medallion SVG pieces built directly over `@sittuyin/engine`. Decoupling the workspace behind a typed `MatchAdapter` contract lets players test full hidden simultaneous pass and play matches, timed games, and FEN or UCI replays right away while letting future Colyseus multiplayer rooms plug into the exact same UI with zero board rewrite.

## Requirements

**User stories**:

- As a Sittuyin player on desktop or mobile, I want an authentic uncheckered teak board with carved Burmese pieces, clear `sit ke myin` promotion diagonals, and smooth tap or drag controls so playing feels natural on any screen size.
- As a player opening a match, I want an interactive hidden simultaneous setup tray with one click Myanmar opening presets, random setup, piece swapping, ready lock and unlock, and opponent placement progress so preparing my formation is fast and private.
- As a player or spectator studying a match in Myanmar or English, I want a bilingual move history table, replay scrubber, wooden audio cues, and saved local board preferences so every match is easy to follow and review.

**Acceptance criteria**:

- **AC-1**: `apps/web/src/styles.css` defines the warm Myanmar teak, vermilion lacquer red, smoked ebony, antique ivory, and burnished gold design tokens through Tailwind CSS v4 `@theme inline` and semantic CSS variables supporting dark lacquer table default (`data-theme="dark"`) and daylight ivory parchment (`data-theme="light"`), styled with `shadcn/ui` primitives, `Noto Sans Myanmar` font loading with Burmese safe line height (`1.65`), and WCAG AA contrast for text and pieces in both themes.
- **AC-2**: `<SittuyinBoard>` renders an uncheckered 8 by 8 warm teak SVG board with fine carved grid lines, inlaid full X `sit ke myin` diagonal promotion lines (`a1` to `h8` and `a8` to `h1`) that highlight the active enemy promotion half (`SIT_KE_MYIN_SQUARES[side]`) when the moving side has 0 Generals on the board and `highlightSitKeMyin` is enabled, coordinates (`a` to `h`, `1` to `8`) inside the teak bevel border when `showCoordinates` is enabled, and instant 180 degree orientation flip (`manualFlip`) updating both squares and coordinates accurately.
- **AC-3**: All six traditional piece roles (`king`, `general`, `rook`, `elephant`, `knight`, `pawn`) for Red (vermilion lacquer medallion with burnished gold carved inlay) and Black (smoked ebony medallion with antique ivory carved inlay) render as crisp custom inline React SVG artwork legible from desktop down to 360px mobile viewports, and honor `pieceScriptOverlay` to display compact Burmese piece initials (`မ`, `စ`, `ရ`, `ဆ`, `မြ`, `န`).
- **AC-4**: Both board play and officer setup support hybrid tap to select plus tap target and unified native Pointer Events drag (`setPointerCapture` with GPU CSS `translate3d` drag ghost), applying `touch-action: none` on draggable board and tray elements, lifting touch dragged pieces upward by 44px so fingers never obscure the target square, cancelling cleanly on right click, `Escape`, outside tap, or `pointercancel`, and animating committed slides according to `animationSpeed` and `prefers-reduced-motion`.
- **AC-5**: During `phase === "setup"` (`hidden_simultaneous`), `<SetupTray>` shows remaining officer count badges from `view.hands[viewer]`, supports tap or drag placement onto legal squares from `getLegalSetupSquares`, dragging placed officers on the board to move or swap, dragging off the board or double tapping to remove back to hand, a one click `OPENING_PRESETS` gallery with 8 by 8 mini board previews and bilingual names, a Random setup button (`generateRandomSetup` seeded via `crypto.getRandomValues`), Clear, Ready lock and Unlock toggle (`applySetupAction`), and live opponent progress (`0/8` to `8/8` from `view.placedCounts[opponent]`) without ever reading or rendering opponent draft coordinates; local pass and play enforces a privacy handoff curtain between Red and Black with a quick Sandbox toggle for dual side testing.
- **AC-6**: Selecting a promotable pawn returned by `getPromotionCandidates(state, turn)` displays normal pawn moves as standard target dots and highlights legal in place (`from === to`) and empty 1 square diagonal promotion squares (`kind === "promote"`) with burnished gold General badges; clicking the pawn again or a gold promotion square opens an anchored confirmation overlay (showing localized "Promote in place" or "Promote to `<sq>`" with `Escape` dismissal) when `confirmPromotion` is true, or commits immediately when `confirmPromotion` is false.
- **AC-7**: The board displays a warm gold wash on the last move `from` and `to` squares, a crimson King halo plus subtle checker square highlight from `getCheckingSquares` whenever `isInCheck` is true, color blind safe move hints (dots for quiet targets, corner capture brackets for captures, gold General badges for promotions) when `showLegalHints` is true, and top and bottom captured trays grouped in traditional role order (`rook`, `elephant`, `knight`, `general`, `pawn`) with computed material advantage delta (`rook: 5`, `elephant: 3`, `knight: 3`, `general: 2`, `pawn: 1`) shown on the leading side.
- **AC-8**: `apps/web` wires Paraglide JS with `/my` (default) and `/en` URL prefixes, cookie locale override, and `AsyncLocalStorage` SSR middleware in `src/server.ts`, localizing all workspace UI copy and rendering a paired Red and Black move history table formatted exclusively via `formatMoveDisplay(record, locale)` with active ply highlighting and automatic scroll into view.
- **AC-9**: Both the match control rail and the standalone `/$locale/replay` route provide First, Previous, Next, Last, and Play or Pause auto step (`0.5x`, `1x`, `2x` speed selector) buttons plus `ArrowLeft`, `ArrowRight`, `Home`, and `End` shortcuts over `replayMatch` snapshots; inspecting an earlier ply during an active match freezes the board on that snapshot, blocks move input, and shows a pulsing "Back to live" pill with the unseen ply count whenever new moves arrive; `/$locale/replay` also provides a FEN plus UCI paste loader (and a built in sample match) that displays structured `replayMatch` errors including the exact 1 indexed failing ply.
- **AC-10**: `<SittuyinMatchWorkspace>` renders an asymmetric desktop match table (top and bottom player HUD bars with clocks and captured trays flanking the centered square board, plus a 360px right rail) collapsing below `1024px` into a mobile portrait stack with zero horizontal overflow at `360px` width; `/$locale/play` includes an optional time control selector (Untimed default plus `rapid_10_5`, `rapid_15_10`, and `classical_30_0` from `@sittuyin/shared`) with working countdown clocks and timeout termination.
- **AC-11**: `useBoardPreferencesStore` persists `theme`, `soundEnabled`, `soundVolume`, `pieceScriptOverlay`, `showLegalHints`, `showCoordinates`, `highlightSitKeMyin`, `confirmPromotion`, and `animationSpeed` under versioned `localStorage` key `sittuyin.board.prefs.v1` using Zustand `persist` with `skipHydration: true` and post mount client rehydration (plus safe storage fallback on private browsing or corrupt JSON) so SSR produces zero React hydration mismatches, while keeping `manualFlip` ephemeral per match.
- **AC-12**: A zero asset `AudioEngine` built on native Web Audio API procedurally synthesizes wooden acoustic cues (quiet move clack, deeper capture knock, setup drop tap, General promotion chime, check alert, game over cadence, low time warning at 30 seconds, and crisp 1 second wooden ticks during the final 10 seconds), unlocks cleanly on the first user pointer or key gesture, respects `soundEnabled` and `soundVolume`, and degrades silently when `AudioContext` is blocked or unavailable.
- **AC-13**: `<SittuyinMatchWorkspace>` interacts strictly through the typed `MatchAdapter` contract (`LocalMatchAdapter` and `ReplayAdapter` implemented now, ready for future `ColyseusMatchAdapter` with zero board rewrite) and translates every rejected `EngineErrorCode` (including `ILLEGAL_STALEMATE`, `ROOK_MUST_BE_BACK_RANK`, `OUTSIDE_SETUP_ZONE`, and `PROMOTION_NOT_ALLOWED`) into a localized toast or inline alert plus subtle square shake feedback.
- **AC-14**: The 64 square board supports roving keyboard focus (arrow keys move focus across files and ranks respecting board orientation, `Enter` or `Space` selects and commits, `Escape` cancels selection or promotion overlay), provides bilingual `/my` and `/en` `aria-label` descriptions for every square, piece, and control, keeps every dialog, sheet, and popover titled for screen readers, and automatically disables slide animations and pulsing check rings when `prefers-reduced-motion: reduce` is active.

## Decision

**Chosen option**: Option 1: Decoupled custom React and inline SVG board workspace over `MatchAdapter` with Tailwind v4 teak tokens, native Pointer Events, Paraglide `/my` and `/en` routing, Zustand preferences, and procedural Web Audio synthesis.

Build the Sittuyin 2D match experience in `apps/web` as a reusable `<SittuyinMatchWorkspace>` backed by an uncheckered inline SVG board, custom carved Burmese medallion SVG pieces, native Pointer Events drag and tap controls, Paraglide `/my` and `/en` routing, SSR safe Zustand preferences, procedural Web Audio synthesis, and working local play and replay adapters over `@sittuyin/engine`.

**Implementation skills**: `tanstack-start-best-practices` (`deckardger/tanstack-agent-skills`, `.agents/skills/tanstack-start-best-practices/`) · `tailwind-4-docs` (`lombiq/tailwind-agent-skills`, `.agents/skills/tailwind-4-docs/`) · `shadcn` (`shadcn-ui/ui`, `.agents/skills/shadcn/`) · `vitest` (`antfu/skills`, `.agents/skills/vitest/`) · `playwright-best-practices` (`currents-dev/playwright-best-practices-skill`, `.agents/skills/playwright-best-practices/`)

## Rationale

Reasoning, design options compared, and internal implementation picks: see [rationale.md](rationale.md).

## Feature design

### Visual direction and theme tokens

**Design source**: No Figma file exists yet; this spec is the authoritative visual and token source for `/develop`.

**Palette and semantic CSS variables** (`apps/web/src/styles.css` via Tailwind CSS v4 `@theme inline`):

| Semantic token          | Dark lacquer default (`data-theme="dark"`) | Daylight ivory parchment (`data-theme="light"`) | Usage                                                |
| ----------------------- | ------------------------------------------ | ----------------------------------------------- | ---------------------------------------------------- |
| `--bg-table`            | `#16100C` (deep smoked teak lacquer)       | `#F4EDE0` (warm hand made Shan parchment)       | Page canvas around the match table                   |
| `--bg-surface`          | `#231913` (oiled dark teak panel)          | `#FBF7EE` (antique ivory card)                  | Player HUD cards, setup tray, move rail, popovers    |
| `--bg-surface-elevated` | `#2F221A` (raised lacquer wood)            | `#EFE5D3` (warm sand hover surface)             | Active rows, hover states, secondary controls        |
| `--border-subtle`       | `#423024`                                  | `#D7C4A5`                                       | Panel hairlines, divider separators                  |
| `--text-primary`        | `#F6EFE2` (antique ivory)                  | `#231710` (dark lacquer ink)                    | Headings, move notation, player names                |
| `--text-muted`          | `#BDA992`                                  | `#6B5542`                                       | Secondary labels, clock units, preset subtitles      |
| `--board-teak-light`    | `#CFA065`                                  | `#D6AA6E`                                       | Warm teak board grain highlight stop                 |
| `--board-teak-base`     | `#BC874B`                                  | `#C49154`                                       | Uncheckered 8 by 8 teak board primary surface        |
| `--board-teak-frame`    | `#4A2D18`                                  | `#633C20`                                       | Outer beveled teak frame carrying coordinates        |
| `--board-grid-line`     | `#6A4322`                                  | `#744A26`                                       | Fine carved 8 by 8 uncheckered grid strokes          |
| `--board-sit-ke-myin`   | `#E6B85C` (inlaid burnished gold)          | `#9B3B1E` (inlaid vermilion lacquer)            | Full X diagonal promotion lines (`a1..h8`, `a8..h1`) |
| `--piece-red-fill`      | `#B5231D` (Myanmar lacquer vermilion)      | `#B5231D`                                       | Red piece medallion body                             |
| `--piece-red-accent`    | `#F2C96B` (burnished gold leaf)            | `#F6D782`                                       | Red piece carved icon stroke and rim inlay           |
| `--piece-black-fill`    | `#1E1A17` (carved smoked ebony)            | `#211C18`                                       | Black piece medallion body                           |
| `--piece-black-accent`  | `#F3E7D1` (antique ivory inlay)            | `#F6EDE0`                                       | Black piece carved icon stroke and rim inlay         |
| `--highlight-last-move` | `rgba(218, 165, 58, 0.34)`                 | `rgba(212, 146, 38, 0.32)`                      | Warm gold wash over last move `from` and `to`        |
| `--highlight-check`     | `#DC2626`                                  | `#B91C1C`                                       | Crimson King halo and subtle checker ring            |
| `--highlight-legal`     | `rgba(28, 19, 13, 0.42)`                   | `rgba(35, 23, 16, 0.36)`                        | Quiet target dots and corner capture brackets        |
| `--highlight-promote`   | `#EAB308`                                  | `#B45309`                                       | Gold General promotion target rings and badges       |
| `--clock-low`           | `#D97706`                                  | `#B45309`                                       | Clock badge warning below 30 seconds                 |
| `--clock-critical`      | `#DC2626`                                  | `#B91C1C`                                       | Clock badge urgent pulse below 10 seconds            |

**Typography and layout rules**:

- Load `Noto Sans Myanmar` (weights `400, 500, 600, 700`) and `Plus Jakarta Sans` (weights `400, 500, 600, 700`) via stylesheet links in `apps/web/src/routes/__root.tsx`, paired with fallback stacks (`"Noto Sans Myanmar", "Myanmar Text", "Pyidaungsu", sans-serif` for Myanmar text and `tabular-nums` for clocks and move numbers).
- Apply `line-height: 1.65` to Myanmar prose and move cells so stacked Burmese vowel signs and medial consonants never clip inside buttons, badges, or table rows.
- Follow `shadcn/ui` conventions (Radix base initialized via `pnpm dlx shadcn@latest init --template start`, `lucide-react` chrome icons, `sonner` toasts, semantic token classes, `flex flex-col gap-*` rather than `space-y-*`, `size-*` for equal dimensions, `ToggleGroup` for segmented controls, titled `Dialog`/`Sheet`/`Popover` overlays).

**Custom SVG board and Burmese piece artwork**:

- `<SittuyinBoard>` uses a fixed `viewBox="0 0 880 880"` (`40` unit outer teak bevel frame on all sides plus `800 x 800` inner playfield with `100 x 100` unit squares).
- Subtle procedural SVG `<linearGradient>` and low opacity `<feTurbulence>` wood grain filter (optional static SVG grain lines fallback if filter cost impacts mobile scroll) creates a warm hand rubbed uncheckered teak surface with zero raster images.
- Full X `sit ke myin` diagonals draw from corner `(40, 40)` to `(840, 840)` and `(840, 40)` to `(40, 840)` as double inlaid hairline grooves; when `highlightSitKeMyin` is enabled and the active side has `0` Generals on the board, the 8 enemy half squares (`SIT_KE_MYIN_SQUARES[side]`) receive a subtle burnished gold diagonal sheen.
- Each of the 6 pieces renders inside a reusable `<SittuyinPieceSvg role side showScript />` component using distinct carved Myanmar silhouettes inside a beveled wooden medallion (soft drop shadow + inner gold or ivory ring):
  - `king` (`မင်းကြီး`, script badge `မ`): tiered Burmese royal `pyatthat` spire crown.
  - `general` (`စစ်ကဲ`, script badge `စ`): crested Burmese commander helmet with crossed spear tips.
  - `rook` (`ရထား`, script badge `ရ`): spoked royal war chariot carriage wheel and arched roof.
  - `elephant` (`ဆင်`, script badge `ဆ`): royal war elephant profile with tusk and ceremonial howdah saddle.
  - `knight` (`မြင်း`, script badge `မြ`): arched Myanmar cavalry horse head silhouette.
  - `pawn` (`နယ်`, script badge `န`): stepped traditional conical wooden foot soldier token.

**Page composition and responsive breakpoints**:

- **Desktop (`>= 1024px`)**: Two column asymmetric studio centered in `max-w-6xl`:
  - **Left play column**: Top opponent HUD bar (avatar badge, display name, optional rating, captured pieces with material delta, digital clock) -> square `<SittuyinBoard>` (responsive up to `min(74vh, 680px)`) -> Bottom player HUD bar + compact board action strip (Flip, Sound toggle, Theme toggle, Preferences dialog, Locale `/my` or `/en` switch).
  - **Right control rail (`360px` wide)**: Context switches cleanly by match phase:
    - During `phase === "setup"`: `<SetupTray>` (opponent `0/8..8/8` readiness pills, officer dock with count badges, 5 `OPENING_PRESETS` cards with 8 by 8 SVG mini previews, Random, Clear, Ready lock or Unlock CTA, plus Pass and Play vs Sandbox toggle in local mode).
    - During `phase === "playing"` and `phase === "finished"`: `<MoveHistoryPanel>` (paired Red/Black table using `formatMoveDisplay`) + `<ReplayScrubberBar>` (First, Prev, Play/Pause with speed toggle, Next, Last, plus "Back to live" pill when scrubbed back) + match controls (New Local Game, Resign, Draw offer, Copy FEN/UCI, outcome banner when finished).
- **Mobile (`< 1024px`, tested down to `360px`)**: Single vertical portrait stack with zero horizontal overflow: compact top opponent bar -> full width square board (`w-full aspect-square`) -> compact bottom player bar -> inline setup tray dock during setup (with presets opening cleanly in a `Sheet` or horizontal scroll strip) or compact scrubber bar plus collapsible move history card during play.

### Data model sketch

There are no SQL tables in this feature; all entities are typed frontend state models, versioned `localStorage` preferences, and adapter contracts over `@sittuyin/engine`.

| Entity                  | Scope and identity                                                                                 | Fields (required unless marked nullable)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Relationships and cardinality                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `BoardPreferences`      | Persisted Zustand store (`sittuyin.board.prefs.v1` in `localStorage`, `version: 1`)                | `theme` (`"dark" \| "light"`, default `"dark"`), `soundEnabled` (`boolean`, default `true`), `soundVolume` (`number`, `0..1`, default `0.75`), `pieceScriptOverlay` (`boolean`, default `false`), `showLegalHints` (`boolean`, default `true`), `showCoordinates` (`boolean`, default `true`), `highlightSitKeMyin` (`boolean`, default `true`), `confirmPromotion` (`boolean`, default `true`), `animationSpeed` (`"normal" \| "fast" \| "none"`, default `"normal"`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `1:1` browser singleton; `skipHydration: true` hydrated after mount                 |
| `BoardInteractionState` | Ephemeral state per `<SittuyinMatchWorkspace>`                                                     | `manualFlip` (`boolean`, default `false`), `focusedSquare` (`Square`, default `"e4"`), `selectedSquare` (`Square \| null`, nullable), `selectedHandRole` (`OfficerRole \| null`, nullable), `dragSession` (`DragSession \| null`, nullable: `source: "board" \| "hand"`, `fromSquare: Square \| null`, `role: PieceRole`, `side: Side`, `pointerId: number`, `startX: number`, `startY: number`, `currentX: number`, `currentY: number`, `isTouch: boolean`, `isDragging: boolean`, `hoverSquare: Square \| null`), `pendingPromotion` (`{ from: Square; to: Square \| null; options: readonly PromoteMove[] } \| null`, nullable), `replayCursor` (`number \| null`, nullable; `null` = live head, `0..N` = inspected ply), `isAutoPlaying` (`boolean`, default `false`), `autoPlaySpeed` (`0.5 \| 1 \| 2`, default `1`), `lastFeedback` (`{ code: EngineErrorCode \| "TIMEOUT" \| "GENERIC"; message: string; square?: Square; nonce: number } \| null`, nullable) | `1:1` owned by `<SittuyinMatchWorkspace>`; drives board overlays and keyboard focus |
| `MatchClockState`       | Ephemeral clock snapshot supplied by `MatchAdapter`                                                | `enabled` (`boolean`), `timeControl` (`TimeControl \| null`, nullable), `remainingMs` (`Readonly<Record<Side, number>>`), `activeSide` (`Side \| null`, nullable), `lowTimeThresholdMs` (`number`, default `30000`), `criticalTimeThresholdMs` (`number`, default `10000`), `syncedAtMs` (`number`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `0..1` owned by `MatchAdapter`; drives HUD clock display and low time audio ticks   |
| `MatchPlayerHud`        | Ephemeral display metadata per side                                                                | `side` (`Side`), `displayName` (`string`), `rating` (`number \| null`, nullable), `connected` (`boolean`), `isLocal` (`boolean`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `2:1` owned by `MatchAdapter` (`red` and `black`)                                   |
| `MatchAdapter`          | Runtime controller interface (`LocalMatchAdapter`, `ReplayAdapter`, future `ColyseusMatchAdapter`) | `mode` (`"local_pass_and_play" \| "local_sandbox" \| "replay" \| "online"`), `view` (`PlayerGameView`), `players` (`Readonly<Record<Side, MatchPlayerHud>>`), `clock` (`MatchClockState \| null`, nullable), `historyStates` (`readonly GameState[]`, length `1` during setup or `moveHistory.length + 1` during play/finished), `pendingRevealHandoff` (`Side \| null`, nullable for local privacy curtain), `connectionStatus` (`"local" \| "connected" \| "reconnecting" \| "disconnected"`), `isInteractive` (`boolean`), plus action callbacks                                                                                                                                                                                                                                                                                                                                                                                                                  | `1:1` injected into `<SittuyinMatchWorkspace>`                                      |
| `ReplaySessionState`    | Ephemeral state on `/$locale/replay`                                                               | `initialSetupFen` (`string`), `uciMoves` (`readonly string[]`), `rules` (`Partial<RulesConfig>`), `snapshots` (`readonly GameState[]`), `parseError` (`{ code: EngineErrorCode; ply?: number; message: string } \| null`, nullable)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `1:1` constructed via `replayMatch` and passed to `ReplayAdapter`                   |

### State transitions

**Pointer drag and tap state machine** (board and setup tray):

```
[idle]
  ├─ pointerdown on own piece / hand officer -> [pointer_pressed] (setPointerCapture, record startX/startY)
  │    ├─ move > 6px threshold -> [dragging] (render GPU translate3d ghost; +44px Y lift if isTouch; update hoverSquare)
  │    │    ├─ pointerup on legal square -> dispatch setup/move (or open [promotion_picker] if confirmPromotion) -> [idle]
  │    │    ├─ pointerup outside board (from setup board square) -> dispatch setup remove -> [idle]
  │    │    └─ pointerup on illegal square / pointercancel / Escape / right click -> feedback shake (if dropped on board) -> [idle]
  │    └─ pointerup within 6px (tap/click) -> [selected] (selectedSquare or selectedHandRole set)
  └─ keyboard Enter/Space on own piece -> [selected]

[selected]
  ├─ tap/Enter on legal quiet or capture target -> dispatch move/place/swap -> [idle]
  ├─ tap/Enter on eligible promotable pawn itself or gold diagonal promotion square
  │    ├─ confirmPromotion === true -> [promotion_picker] (anchored overlay over pawn)
  │    └─ confirmPromotion === false -> dispatch PromoteMove immediately -> [idle]
  ├─ double tap on own placed draft officer (setup) -> dispatch remove -> [idle]
  ├─ tap on another own piece -> switch [selected]
  └─ tap elsewhere / right click / Escape -> [idle]

[promotion_picker]
  ├─ click/Enter "Promote in place" or "Promote to <sq>" -> dispatch PromoteMove -> [idle]
  └─ Escape / outside click / turn change -> [idle]
```

**Local pass and play hidden setup handoff flow**:

```
[setup: viewer = "red", pendingRevealHandoff = null]
  ├─ Red arranges 8 officers (place/move/swap/remove/preset/random) -> Red clicks Ready (lock)
  └─ pendingRevealHandoff = "black" (privacy curtain hides Red draft; shows "Pass device to Black")
       └─ Black clicks "Reveal Black Setup" -> viewer = "black", pendingRevealHandoff = null
            ├─ Black arranges 8 officers -> Black clicks Ready (lock)
            └─ Engine commits both drafts atomically -> phase = "playing", turn = "red"
```

_(In `local_sandbox` mode, a segmented toggle lets the developer switch `viewer` between `"red"` and `"black"` directly with no privacy curtain.)_

**Replay cursor flow during an active match**:

```
[live: replayCursor = null]
  ├─ click any ply row or Prev/First -> [scrubbing: replayCursor = k] (board renders historyStates[k], moves blocked)
  │    ├─ new live move arrives -> historyStates grows, replayCursor stays at k, unseenPlies increments, "Back to live" pill pulses
  │    └─ click Last / "Back to live" / End key -> [live: replayCursor = null]
```

### API, component, and module surface

**Module layout (`apps/web/src/`)**:

- `server.ts`: TanStack Start SSR entry wrapping requests in Paraglide `AsyncLocalStorage` locale middleware (matching stack spec 0001).
- `i18n/`: Paraglide JS project config (`project.inlang`), Myanmar (`messages/my.json`) and English (`messages/en.json`) message catalogs, and locale helpers (`getActiveLocale`, `setLocaleCookie`).
- `routes/__root.tsx`: root HTML document setting `<html lang={locale} data-theme={...}>`, loading `Noto Sans Myanmar` + `Plus Jakarta Sans`, mounting `Toaster`, and hydrating `useBoardPreferencesStore` post mount.
- `routes/index.tsx`: redirects `/` to preferred cookie locale or default `/my`.
- `routes/$locale/index.tsx`: bilingual landing hub with warm teak hero, piece reference cards, and direct links to `/$locale/play` and `/$locale/replay`.
- `routes/$locale/play.tsx`: local match play page wiring `LocalMatchAdapter` (Pass and Play / Sandbox switch, optional `TimeControl` picker, New Match reset) into `<SittuyinMatchWorkspace>`.
- `routes/$locale/replay.tsx`: standalone replay viewer wiring FEN/UCI paste loader, sample classic Myanmar game preset, `replayMatch`, and `ReplayAdapter` into `<SittuyinMatchWorkspace>`.
- `stores/board-preferences.ts`: versioned Zustand preferences store (`useBoardPreferencesStore`).
- `lib/audio-engine.ts`: procedural Web Audio API synthesizer (`AudioEngine`, `SoundCue`).
- `lib/board-geometry.ts`: pure square to SVG coordinate math, 180 degree flip projection, `clientPointToSquare(rect, x, y, flipped)`, and material advantage calculator.
- `lib/adapters/types.ts`, `lib/adapters/local-match-adapter.ts`, `lib/adapters/replay-adapter.ts`: `MatchAdapter` contract and concrete local and replay implementations.
- `components/sittuyin/`:
  - `SittuyinMatchWorkspace.tsx`: top level responsive layout, keyboard shortcuts, audio reaction hooks, and adapter orchestration.
  - `SittuyinBoard.tsx`: uncheckered 8 by 8 SVG board, `sit ke myin` diagonals, bevel coordinates, highlight layers, pointer drag ghost, and roving keyboard focus grid.
  - `SittuyinPieceSvg.tsx`: bespoke inline React SVG carved medallions for all 6 piece roles and both sides plus optional Burmese script badge.
  - `PromotionOverlay.tsx`: anchored in place vs 1 square diagonal General (`စစ်ကဲ`) confirmation popover.
  - `SetupTray.tsx`: hidden simultaneous officer dock, `OPENING_PRESETS` mini board preview gallery, Random/Clear/Lock/Unlock buttons, opponent progress pills, and local privacy handoff curtain.
  - `PlayerHudBar.tsx`: player identity, connection badge, captured pieces tray with material delta, and low time clock display.
  - `MoveHistoryPanel.tsx` & `ReplayScrubberBar.tsx`: bilingual `formatMoveDisplay` move table, scrubber buttons, auto play timer, speed selector, and "Back to live" pill.
  - `BoardPreferencesDialog.tsx`: `shadcn/ui` settings modal for all persisted Zustand toggles and volume slider.

**Key public contracts**:

| Interface / Hook / Route   | Inputs                                                                                                                                                                                                               | Outputs / Events                                                                                                                                                                     | Caller boundary              | Key error cases                                                                                    |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | -------------------------------------------------------------------------------------------------- |
| `useBoardPreferencesStore` | Preference setters (`setTheme`, `setSoundEnabled`, `setSoundVolume`, `toggleScriptOverlay`, `toggleLegalHints`, `toggleCoordinates`, `toggleSitKeMyin`, `setConfirmPromotion`, `setAnimationSpeed`, `resetDefaults`) | Persisted `BoardPreferences` state plus `hasHydrated: boolean`                                                                                                                       | `apps/web` client components | Corrupt `localStorage` JSON or blocked storage -> falls back to defaults without throwing          |
| `AudioEngine.play(cue)`    | `cue: "move" \| "capture" \| "setup_drop" \| "promote" \| "check" \| "game_over" \| "clock_low" \| "clock_tick"` plus `{ enabled, volume }`                                                                          | Synthesized Web Audio sound burst (no op if muted or locked)                                                                                                                         | `SittuyinMatchWorkspace`     | `AudioContext` suspended or absent -> silently queues unlock on next user gesture without throwing |
| `MatchAdapter`             | Actions: `dispatchSetup(action: SetupAction)`, `dispatchMove(move: Move)`, `applyRandomSetup()`, `requestResign()`, `requestDraw()`, `confirmHandoff()`                                                              | `Result<void, EngineError>` (or `Promise<Result<void, EngineError>>`) plus reactive `{ view, players, clock, historyStates, pendingRevealHandoff, connectionStatus, isInteractive }` | `SittuyinMatchWorkspace`     | Any `EngineErrorCode` -> surfaced via localized toast + square shake; never mutates view on error  |
| `GET /$locale/play`        | URL param `locale` (`"my" \| "en"`), optional query `?mode=sandbox&tc=rapid_10_5`                                                                                                                                    | SSR shell + interactive local Sittuyin match workspace                                                                                                                               | Public browser route         | Unknown `$locale` -> redirects to `/my/play`                                                       |
| `GET /$locale/replay`      | URL param `locale` (`"my" \| "en"`), optional query `?fen=...&moves=...`                                                                                                                                             | SSR shell + interactive replay viewer and FEN/UCI loader                                                                                                                             | Public browser route         | Invalid FEN/UCI -> renders inline `Alert` with `parseError.code` and 1 indexed `parseError.ply`    |

### Value sourcing

| Action / UI element                         | Value produced or displayed                                                      | Source                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Theme tokens and active palette             | Dark lacquer or daylight ivory CSS variables (`data-theme`)                      | `useBoardPreferencesStore.theme` (default `"dark"` during SSR; rehydrated post mount from `localStorage` key `sittuyin.board.prefs.v1`)                                                                                                                                        |
| Board orientation                           | Red at bottom vs Black at bottom                                                 | Derived from `adapter.view.viewer === "black"` XOR ephemeral `interaction.manualFlip` (`spectator` defaults Red at bottom XOR `manualFlip`)                                                                                                                                    |
| Piece labels, ARIA text, and script overlay | Myanmar/English piece names and compact script initials                          | `SITTUYIN_PIECE_NAMES[role]` from `@sittuyin/engine`, active Paraglide locale (`$locale`), and static `PIECE_SCRIPT_BADGES` map (`မ, စ, ရ, ဆ, မြ, န`)                                                                                                                          |
| `sit ke myin` active shimmer                | Highlighted enemy diagonal squares                                               | `SIT_KE_MYIN_SQUARES[activeSide]` when `board` contains 0 Generals for `activeSide` and `preferences.highlightSitKeMyin` is true                                                                                                                                               |
| Setup legal targets and opponent progress   | Highlighted drop/swap squares and opponent `0/8..8/8` count                      | `getLegalSetupSquares(view, viewer, role)` and `adapter.view.placedCounts[opponentSide]` plus `adapter.view.setupReady[opponentSide]` from `@sittuyin/engine`                                                                                                                  |
| Opening presets gallery                     | 5 traditional Myanmar preset names, descriptions, and 8 by 8 preview coordinates | Static `OPENING_PRESETS` and `getPresetPlacements(id, viewer)` from `@sittuyin/engine`                                                                                                                                                                                         |
| Random setup seed                           | Deterministic PRNG seed for `generateRandomSetup`                                | Browser `crypto.getRandomValues(new Uint32Array(1))[0]` generated at button click in `LocalMatchAdapter` (never during SSR)                                                                                                                                                    |
| Legal move hints and promotion options      | Quiet dots, capture brackets, in place and diagonal promotion squares            | `getLegalMovesFrom(activeState, selectedSquare)` and `getPromotionCandidates(activeState, activeState.turn)` from `@sittuyin/engine`                                                                                                                                           |
| Check and checker highlights                | King halo square and attacking piece squares                                     | `isInCheck(activeState, side)` and `getCheckingSquares(activeState, side)` from `@sittuyin/engine`                                                                                                                                                                             |
| Captured trays and material delta           | Ordered captured piece lists and `+N` advantage badge                            | `activeState.captured[side]` sorted by `[rook, elephant, knight, general, pawn]` and summed using constant weights `{ rook: 5, elephant: 3, knight: 3, general: 2, pawn: 1 }`                                                                                                  |
| Bilingual move history rows                 | Localized move strings for Red and Black plies                                   | `formatMoveDisplay(record, locale)` from `@sittuyin/engine` with active route/Paraglide locale (`"my"` or `"en"`)                                                                                                                                                              |
| Replay frames and paste errors              | Per ply `GameState` snapshots and failing ply index                              | `replayMatch(initialSetupFen, uciMoves, rules)` from `@sittuyin/engine` (length `uciMoves.length + 1`, error `details.ply`)                                                                                                                                                    |
| Clock countdown and low time alerts         | Formatted `MM:SS` (or `SS.t` under 10s) and alert state                          | `adapter.clock` (`remainingMs`, `activeSide`, `syncedAtMs`, `lowTimeThresholdMs: 30000`, `criticalTimeThresholdMs: 10000`), initialized in local play from `@sittuyin/shared` `TimeControl` constants (`rapid_10_5`: 10m+5s, `rapid_15_10`: 15m+10s, `classical_30_0`: 30m+0s) |
| Rejected action feedback                    | Localized explanation banner/toast                                               | `EngineErrorCode` returned by `adapter.dispatchSetup` or `adapter.dispatchMove`, mapped to Paraglide `/my` and `/en` error messages                                                                                                                                            |

### Key invariants

- **Strict `PlayerGameView` rendering**: `<SittuyinBoard>` and `<SetupTray>` render exclusively from `adapter.view` (`PlayerGameView`), never accepting raw `GameState.setupDrafts` for an opponent; during hidden setup, opponent draft squares never exist in rendered DOM or board component props.
- **Zero SSR hydration mismatch**: no component reads `localStorage`, `window.matchMedia`, `AudioContext`, or `crypto.getRandomValues` during render; Zustand `persist` uses `skipHydration: true` with `useEffect` rehydration, and Paraglide uses `AsyncLocalStorage` per request on Cloudflare Workers.
- **Non overlapping promotion vs normal pawn targets**: normal pawn captures target occupied enemy squares while diagonal promotions target empty diagonal squares, and in place promotion targets `from === to`; the board highlight layer always distinguishes standard dots/brackets from burnished gold General badges so players never confuse a normal move with a promotion.
- **Scrubbing read only lock**: whenever `replayCursor !== null` (inspecting any ply before the live head), all board move and drag dispatch is disabled until the user returns to live (`replayCursor = null`).
- **Engine as sole rules oracle**: `apps/web` never duplicates Sittuyin move geometry, setup zone checks, or stalemate logic; every legal hint and validation passes through `@sittuyin/engine`.
- **Bundle budget discipline**: all 6 pieces are lightweight inline SVGs and all sounds are procedural Web Audio API synthesis (zero external audio/image assets or drag libraries), keeping `apps/web` well under the Cloudflare Workers 3 MB free tier limit.

### Security and privacy model

- **No authentication or PII in this feature**: local play and replay run purely in the browser with no user accounts, server writes, or regulated data.
- **Hidden setup privacy boundary**: `<SittuyinMatchWorkspace>` strictly reads `PlayerGameView` (masked via `toPlayerView` in `LocalMatchAdapter` and future `apps/server`), preventing accidental DOM or React DevTools leaks of hidden opponent officer drafts. Local pass and play inserts an explicit privacy handoff curtain between Red and Black turns.
- **Safe FEN and UCI input handling**: `/$locale/replay` parses pasted FEN and UCI text purely through `@sittuyin/engine` `replayMatch` with bounded string lengths (max 1024 characters for FEN, max 1000 UCI tokens) rendered as escaped React text, eliminating XSS and UI freeze risks from malformed pastes.

### Configuration required

None. This feature requires zero new environment variables, secrets, or third party service credentials. Local preferences persist in browser `localStorage` (`sittuyin.board.prefs.v1`) and locale override uses a standard non sensitive cookie (`sittuyin_locale`).

### Critical test scenarios

- **Theme tokens and daylight toggle**: rendering in dark lacquer default and toggling to daylight parchment updates `data-theme`, CSS tokens, and `localStorage` with zero SSR hydration warnings on reload, verifies **AC-1**, **AC-11**.
- **Uncheckered SVG board, `sit ke myin` shimmer, and flip**: board renders 64 uncheckered squares, full X diagonals, active enemy `sit ke myin` shimmer when General is absent, bevel coordinates, and accurately inverts coordinates and piece positions when flipped 180 degrees, verifies **AC-2**.
- **Burmese piece SVGs and script overlay**: all 12 role/side variants render cleanly at desktop and 360px widths, and toggling `pieceScriptOverlay` shows and hides the Myanmar initials (`မ, စ, ရ, ဆ, မြ, န`), verifies **AC-3**.
- **Hybrid pointer drag and touch lift**: clicking to select and move works identically to pointer dragging; simulated touch drag applies the 44px upward lift and `touch-action: none`; `pointercancel` or `Escape` aborts cleanly with zero stuck ghost piece, verifies **AC-4**.
- **Hidden simultaneous setup end to end**: placing all 8 officers via tap, drag, swap, remove, preset gallery click, and random setup enforces back rank Rook rejection (`ROOK_MUST_BE_BACK_RANK` toast + shake), displays opponent `0/8` to `8/8` progress without leaking opponent squares, triggers local privacy handoff curtain after Red locks in, and transitions atomically to `"playing"` after Black locks in, verifies **AC-5**, **AC-13**.
- **In place vs diagonal General promotion**: selecting an eligible pawn on `c6` highlights normal moves plus gold promotion badges on `c6` and empty diagonals; clicking `c6` or a diagonal opens the anchored confirmation overlay when `confirmPromotion` is true and commits `c6c6f` or `c6b5f` cleanly (or commits directly when `confirmPromotion` is false), verifies **AC-6**.
- **Check, last move, and captured material diff**: delivering check highlights the checked King halo and attacker square from `getCheckingSquares`; capturing a Rook updates the captured tray in sorted role order and displays `+5` material advantage on the capturing side, verifies **AC-7**.
- **Bilingual `/my` and `/en` SSR and move history**: visiting `/my/play` and `/en/play` renders Myanmar and English UI copy and `formatMoveDisplay` move rows without SSR locale bleed across concurrent requests, verifies **AC-8**.
- **Replay scrubber, live unseen pill, and corrupt paste error**: stepping with First/Prev/Next/Last, Play/Pause, and keyboard arrows updates the board across `replayMatch` snapshots; receiving a live move while scrubbed back keeps the historical ply and shows the pulsing "Back to live" pill; pasting a corrupt UCI at ply 4 on `/$locale/replay` displays a structured error naming ply `4`, verifies **AC-9**.
- **Mobile 360px layout and local clocks**: Playwright viewport test at `360x780` confirms zero horizontal overflow and reachable controls; starting a `rapid_10_5` local match decrements the active clock, adds `+5s` increment on move, fires low time warning below 30s and ticks below 10s, and terminates cleanly on timeout, verifies **AC-10**, **AC-12**.
- **Web Audio unlock and silent degradation**: mocking `AudioContext` verifies sound synthesis calls on move, capture, promotion, check, and low time ticks respecting `soundEnabled` and `soundVolume`, and verifies zero uncaught exceptions when `AudioContext` is absent or throws, verifies **AC-12**.
- **Keyboard board navigation and reduced motion**: moving across squares with arrow keys, selecting and committing a move via `Enter`, cancelling with `Escape`, inspecting bilingual `aria-label` attributes, and enabling `prefers-reduced-motion: reduce` disables slide animations and pulses cleanly, verifies **AC-14**.

## Build plan

Ordered using a **Tracer Bullet** approach (default matching `sittuyin-engine/0001` since `AGENTS.md` and `docs/scope/` are not created yet): stand up a thin interactive end to end vertical slice first (theme tokens, Paraglide `/my` and `/en` routes, uncheckered SVG board with custom pieces, and playable local adapter), then thicken with pointer drag ergonomics, hidden simultaneous setup tray, promotion picker, highlights and captured HUD, move history and replay scrubber, local clocks, Zustand preferences, procedural Web Audio, and full accessibility and Playwright verification. No database migration is needed.

1. **Theme tokens, `shadcn/ui` setup, typography, and SSR safe Zustand preferences**: initialize `shadcn/ui` in `apps/web`, configure warm Myanmar dark lacquer and daylight ivory `@theme inline` tokens in `apps/web/src/styles.css`, load `Noto Sans Myanmar` and `Plus Jakarta Sans` in `__root.tsx`, and build versioned `useBoardPreferencesStore` (`skipHydration: true` + post mount rehydration + safe storage fallback) with Vitest tests, satisfies **AC-1**, **AC-11**.
2. **Paraglide JS `/my` and `/en` bilingual routing and SSR isolation**: configure Paraglide JS (`my` default, `en` secondary), add `AsyncLocalStorage` locale middleware in `apps/web/src/server.ts`, create `/$locale`, `/$locale/play`, and `/$locale/replay` routes with root `/` locale redirect and bilingual message catalogs, satisfies **AC-8**.
3. **Thin playable board vertical slice (SVG board, carved Burmese pieces, and `LocalMatchAdapter`)**: implement `board-geometry.ts`, `<SittuyinPieceSvg>` (all 6 roles, both sides, optional script badge), `<SittuyinBoard>` (uncheckered teak grain, grid lines, full X `sit ke myin` diagonals, bevel coordinates, 180 degree flip, click to select and move), and core `MatchAdapter` + `LocalMatchAdapter` wired into `/$locale/play`, satisfies **AC-2**, **AC-3**, **AC-13**.
4. **Hybrid Pointer Events drag and mobile touch ergonomics**: add unified Pointer Events drag physics (`setPointerCapture`, `translate3d` ghost, 44px touch vertical lift, `touch-action: none`, clean cancel on `Escape`/right click/`pointercancel`, slide transitions) and responsive desktop/mobile `<SittuyinMatchWorkspace>` shell tested at `360px` width, satisfies **AC-4**, **AC-10**.
5. **Hidden simultaneous setup tray, `OPENING_PRESETS` gallery, and privacy curtain**: build `<SetupTray>` (officer dock with counts, tap/drag placement, board swap, off board drag and double tap removal, 5 `OPENING_PRESETS` mini board previews, `generateRandomSetup` with `crypto.getRandomValues`, Clear, Lock/Unlock, opponent `0/8..8/8` progress pills, local pass and play privacy handoff curtain + Sandbox toggle) with localized setup error toasts and square shake, satisfies **AC-5**, **AC-13**.
6. **General (`စစ်ကဲ`) promotion picker overlay, board highlights, and captured HUD**: implement `<PromotionOverlay>` (in place vs 1 square diagonal gold badges, anchored confirmation popover honoring `confirmPromotion`), last move gold wash, crimson King check halo plus `getCheckingSquares` attacker highlight, color blind safe move hints, and `<PlayerHudBar>` captured trays with material advantage delta, satisfies **AC-6**, **AC-7**.
7. **Bilingual move history, replay scrubber, and `/$locale/replay` viewer**: build `<MoveHistoryPanel>` (`formatMoveDisplay` paired table, auto scroll), `<ReplayScrubberBar>` (First/Prev/Play Pause with `0.5x/1x/2x`/Next/Last, keyboard shortcuts, live "Back to live" unseen ply pill), and `ReplayAdapter` + FEN/UCI paste loader with structured ply error alerts on `/$locale/replay`, satisfies **AC-8**, **AC-9**.
8. **Optional local chess clocks and procedural Web Audio engine**: add optional `TimeControl` (`rapid_10_5`, `rapid_15_10`, `classical_30_0`) countdown and increment logic to `LocalMatchAdapter` and `<PlayerHudBar>`, implement zero asset Web Audio `AudioEngine` (clack, capture knock, setup tap, promotion chime, check alert, game over cadence, 30s warning and 10s ticks, first gesture unlock), and add `<BoardPreferencesDialog>`, satisfies **AC-10**, **AC-11**, **AC-12**.
9. **Keyboard board accessibility, reduced motion, and Playwright E2E suite**: implement 64 square roving keyboard navigation, bilingual ARIA labels, `prefers-reduced-motion` static fallback, and end to end Vitest + Playwright tests covering desktop and 360px mobile play, hidden setup, promotion, replay scrubbing, and sound hooks, satisfies **AC-14** (and verifies **AC-1** through **AC-13**).

## Consequences

**Positive**:

- Custom inline SVG board and carved Burmese piece medallions deliver an unmistakable traditional Myanmar Sittuyin aesthetic with sharp retina rendering and zero raster asset bloat.
- The `MatchAdapter` contract lets you play, test, and verify the entire Sittuyin experience locally today while guaranteeing the upcoming Colyseus multiplayer room layer connects cleanly with no board rewrite.
- Procedural Web Audio synthesis and native Pointer Events keep `apps/web` fast, responsive on touch devices, and comfortably inside the Cloudflare Workers 3 MB free tier bundle limit.
- Strict `PlayerGameView` rendering and SSR safe Zustand hydration eliminate both hidden setup leaks and React SSR hydration mismatches from day one.

**Negative / tradeoffs**:

- Hand crafting 6 custom Burmese SVG piece icons and fine tuning procedural Web Audio envelopes takes more upfront polish than dropping in generic Western chess icons or MP3 samples.
- Maintaining bilingual `/my` and `/en` Paraglide message keys for every setup prompt, error code, and ARIA label adds ongoing copy maintenance on every new UI control.
- Building custom Pointer Events hit testing and roving 64 square keyboard focus means `apps/web` owns its own interaction edge cases and needs Playwright tests across desktop and mobile viewports.

**Neutral**:

- Local pass and play clocks run on the browser clock for casual offline matches; authoritative server clocks, reconnection banners, and rating updates will flow through the same `MatchClockState` and `MatchPlayerHud` props once the Colyseus room spec ships.
- `apps/web` establishes its visual tokens directly in `apps/web/src/styles.css` today; if you create a Figma design system later, those tokens map one to one into Figma variables.

## Follow-up

- [ ] `tanstack-start-best-practices`, `tailwind-4-docs`, and `shadcn` conventions are not yet captured in `apps/web/AGENTS.md` (with a one line pointer from root `AGENTS.md`); create these context files before implementation scales across `apps/web`.
- [ ] `vitest` and `playwright-best-practices` conventions are not yet captured in root `AGENTS.md` `## Rules`; these apply across the monorepo and belong at root level.
- [ ] Run `/architect` next for **Realtime multiplayer room lifecycle, clocks, and matchmaking** (`apps/server` `SittuyinRoom` binding into `MatchAdapter` as `ColyseusMatchAdapter`).
- [ ] Optionally mirror the finalized CSS tokens and carved SVG pieces from `apps/web` into a Figma file later if you want a visual design library for marketing assets or landing pages.

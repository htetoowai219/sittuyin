# Rationale: Build custom 2D Sittuyin board UI, setup tray, and match play workspace

> ⚠️ Premise note: The realtime multiplayer room spec (`apps/server` `SittuyinRoom`, authoritative clocks, and matchmaking) is not written yet. Building the board UI tightly coupled to hypothetical WebSocket messages would create rework once server rooms land, whereas waiting on the server blocks playtesting the rules engine visually. Framing this feature around a strict `MatchAdapter` contract backed by working local (`LocalMatchAdapter`) and replay (`ReplayAdapter`) adapters lets you playtest and verify every Sittuyin UI mechanic now while keeping the online Colyseus integration cleanly decoupled.

## Context

`packages/sittuyin-engine` now implements the complete traditional Burmese chess (Sittuyin) ruleset, including staggered starting pawns, hidden simultaneous officer setup with back rank Rook constraints, five curated Myanmar opening presets, separate turn General (`စစ်ကဲ`) promotion on `sit ke myin` diagonals, illegal stalemate filtering, bilingual move formatting (`formatMoveDisplay`), and match replay (`replayMatch`). `apps/web`, however, currently holds only a minimal TanStack Start scaffold showing piece names.

Sittuyin breaks almost every assumption baked into Western chess board widgets. The board is traditionally uncheckered warm teak crossed by prominent full X `sit ke myin` diagonal promotion lines rather than alternating light and dark squares. Every match opens with a hidden simultaneous officer arrangement phase requiring drag, swap, remove, preset previews, lock or unlock controls, and masked opponent progress (`0/8` to `8/8`) before the first move is played. Midgame pawn promotion is optional, takes a separate turn, and offers either in place promotion (`from === to`) or a 1 square diagonal step onto an empty square.

At the same time, `apps/web` deploys to Cloudflare Workers (strict 3 MB free tier bundle budget), serves bilingual Myanmar (`/my`) and English (`/en`) routes with proper Burmese Unicode rendering, and must feel crisp on both desktop mice and 360px mobile touch screens. Without settling the visual tokens, piece art direction, pointer interaction model, promotion UX, sound engine, preferences persistence, and adapter boundary upfront, implementation would drift into ad hoc styling, mobile drag glitches, SSR hydration warnings, or painful rewrites when Colyseus rooms connect.

## Options considered

### Option 1: Decoupled custom React and inline SVG board workspace over `MatchAdapter` with native Pointer Events and procedural Web Audio

Build `<SittuyinBoard>` and `<SittuyinMatchWorkspace>` in `apps/web` as custom React components rendering an uncheckered inline SVG teak board, bespoke inline SVG carved Burmese wooden medallion pieces, native Pointer Events (`setPointerCapture` + GPU `translate3d` drag ghost), Tailwind CSS v4 `@theme inline` tokens (dark lacquer default + daylight ivory parchment toggle), Paraglide `/my` and `/en` routing, SSR safe Zustand preferences, and zero asset procedural Web Audio synthesis, decoupled from transport via `MatchAdapter` (`LocalMatchAdapter` and `ReplayAdapter` now, `ColyseusMatchAdapter` later).

**Pros**:

- Zero Western chess library workarounds for uncheckered boards, `sit ke myin` diagonals, hidden setup trays, and separate turn in place or diagonal promotions.
- Ultra lightweight bundle (no canvas engine, no drag library, no external audio or raster piece files), staying comfortably within Cloudflare Workers free tier limits.
- Native DOM and SVG elements make roving keyboard focus, bilingual ARIA labels, mobile touch lift offsets, and Playwright E2E selectors straightforward.
- Clean `MatchAdapter` boundary lets local play and replay ship immediately and lets Colyseus bind later without touching board UI internals.

**Cons**:

- Requires authoring and polishing six bespoke Burmese SVG piece illustrations and tuning procedural Web Audio wooden acoustic envelopes by hand.
- Team owns custom Pointer Events hit testing, drag cancellation edge cases, and keyboard roving focus logic.

### Option 2: Fork or wrap an existing chess board library (such as Chessground) with custom CSS and overlay hacks

Wrap `chessground` (Lichess's open source board library) inside a React wrapper, hide its checkered square pattern with CSS, inject an SVG overlay for `sit ke myin` diagonals, and bolt on external React drawers for setup drops and General promotion.

**Pros**:

- Inherits battle tested pointer drag feel and basic board arrow animations out of the box.
- Slightly less initial code for standard piece slides on an 8 by 8 grid.

**Cons**:

- Chessground assumes Western chess promotion on the last rank, single click move commits, and standard checkered board coordinates; fighting its internal state machine for hidden simultaneous setup swaps, back rank Rook constraints, and separate turn in place vs diagonal promotion produces brittle DOM synchronization bugs.
- Imperative non React DOM mutations complicate React 19 hydration, bilingual ARIA labeling, and SSR safety on TanStack Start.

### Option 3: HTML5 Canvas or PixiJS 2D renderer with bundled audio and sprite assets

Render the teak board, carved pieces, highlights, and drag physics inside an HTML5 `<canvas>` (or PixiJS WebGL stage) paired with bundled PNG sprites and MP3 wooden sound samples via Howler.js.

**Pros**:

- Smooth 60fps particle effects and rich painterly wood textures if the game later adds heavy visual effects.
- Uniform pixel rendering independent of browser SVG filter quirks.

**Cons**:

- Breaks native DOM accessibility (screen readers, roving square focus, and crisp Burmese text inside overlays require building a parallel shadow DOM tree anyway).
- Adds significant bundle weight (canvas framework plus sprite sheets and MP3 files), pressuring mobile load times in Myanmar and Cloudflare Workers asset budgets.
- Harder to inspect and assert square states reliably in Playwright E2E tests.

## Rationale

Option 1 directly resolves the domain and operational forces in Context. Sittuyin's uncheckered teak board, `sit ke myin` promotion diagonals, hidden simultaneous setup curtain, and separate turn in place vs empty diagonal General promotion are first class rules rather than minor tweaks on Western chess. Trying to bend Chessground (Option 2) around them would trade a few hundred lines of clean Pointer Events math for ongoing state synchronization bugs, while a Canvas or PixiJS renderer (Option 3) would sacrifice native accessibility, bundle size, and crisp vector scaling across 360px phones and retina desktops.

Pairing custom inline React SVGs with Tailwind CSS v4 `@theme inline` tokens and `shadcn/ui` matches the accepted stack spec (`0001-sittuyin-tech-stack-architecture`) cleanly, keeps total client assets minimal for Myanmar mobile networks and Cloudflare Workers, and makes every square, highlight, and promotion overlay testable through standard Playwright DOM selectors. Decoupling `<SittuyinMatchWorkspace>` behind `MatchAdapter` (consuming `@sittuyin/engine` `PlayerGameView` strictly) ensures hidden setup privacy is enforced architecturally from day one and lets `/$locale/play` and `/$locale/replay` ship as full playable experiences ahead of the Colyseus server spec.

**Internal implementation defaults settled in this spec**:

- **Captured material weights (`rook: 5`, `elephant: 3`, `knight: 3`, `general: 2`, `pawn: 1`)**: reflects Sittuyin tactical strength where 5 direction Elephants (`ဆင်`) match Knights (`မြင်း`) while 4 diagonal Generals (`စစ်ကဲ`) sit slightly lower. Runner up: equal 3 point weight for all minor officers (less accurate in Elephant vs General endgames).
- **Touch vertical lift offset (`44px`)**: clears an average fingertip on 360px to 430px phone screens without clipping pieces dragged onto rank 8. Runner up: `60px` lift (can push top rank pieces under the opponent HUD bar).
- **Replay auto play speeds (`0.5x` = `2000ms`, `1x` = `1000ms`, `2x` = `500ms`)**: covers study pace, standard playback, and quick opening review. Runner up: fixed `1000ms` only.
- **`shadcn/ui` Radix base with `lucide-react` chrome icons and `sonner` toasts**: proven TanStack Start compatibility and accessible overlay focus management, while keeping all 6 Sittuyin piece medallions as bespoke inline React SVGs. Runner up: Base UI primitives (newer ecosystem conventions).
- **Google Fonts stylesheet for `Noto Sans Myanmar` and `Plus Jakarta Sans` with system Myanmar fallback**: delivers consistent Burmese diacritic metrics without bloating the Cloudflare Workers bundle with multi megabyte self hosted font binaries. Runner up: self hosted WOFF2 subsets in `apps/web/public` (can be added later for offline PWA support).
- **Versioned `localStorage` store (`sittuyin.board.prefs.v1`) with `skipHydration: true` and try/catch fallback**: prevents React SSR hydration mismatches and handles Safari private browsing or corrupted JSON cleanly. Runner up: cookie backed preferences (adds unnecessary header overhead to every Workers request).

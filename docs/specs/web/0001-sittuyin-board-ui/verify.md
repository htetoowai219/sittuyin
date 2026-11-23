# Verify: Custom 2D Sittuyin board UI, setup tray, and match play workspace · spec 0001 · updated 2026-11-23

_Steps derived from spec 0001 acceptance criteria and Value sourcing rows. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [ ] Visit `/my` and `/en`, toggle the theme control between dark lacquer (`data-theme="dark"`) and daylight ivory parchment (`data-theme="light"`), reload the page, and confirm `sittuyin.board.prefs.v1` restores your chosen theme with zero React hydration warnings and clean Myanmar text rendering (`line-height: 1.65`) → AC-1, AC-11
- [ ] Visit `/en/play`, confirm the uncheckered 8 by 8 warm teak SVG board shows carved grid lines, full X `sit ke myin` diagonals, and bevel coordinates (`a` to `h`, `1` to `8`), then click Flip board and confirm both coordinates and pieces invert 180 degrees (`data-flipped="true"`) → AC-2
- [ ] Open Preferences on `/my/play`, turn on Burmese script badges, and confirm all 6 carved Red (vermilion and gold) and Black (ebony and ivory) piece medallions show compact initials (`မ`, `စ`, `ရ`, `ဆ`, `မြ`, `န`) legibly at both desktop and `360x780` mobile sizes → AC-3
- [ ] Drag a piece on desktop and simulate touch drag on mobile, confirm GPU `translate3d` ghost movement with `touch-action: none` and 44px upward touch lift, then cancel with right click or `Escape` and confirm zero stuck ghost pieces → AC-4
- [ ] During hidden simultaneous setup on `/en/play`, attempt to drop a Chariot (Rook) on `e2` (expect localized `ROOK_MUST_BE_BACK_RANK` toast and square shake), place officers via tap, drag, swap, double tap remove, Random setup, and an `OPENING_PRESETS` card with mini board preview, lock Red ready, confirm the privacy handoff curtain hides Red's draft while showing opponent progress (`0/8` to `Ready`), reveal Black, lock Black, and confirm atomic transition to Playing → AC-5, AC-13
- [ ] Load a position where the active side has 0 Generals and a promotable pawn on a `sit ke myin` square (for example `7k/8/2P5/8/8/8/8/R3K3 w - - 0 1`), select `c6`, confirm active enemy `sit ke myin` sheen plus burnished gold General badges on `c6` and empty diagonals, click `c6` to verify the anchored confirmation overlay commits `c6c6f`, then disable `confirmPromotion` and confirm a diagonal promotion commits directly → AC-2, AC-6
- [ ] Deliver check with a Rook capture (for example `e1` to `e7` on `4k3/4r3/8/8/8/8/8/4RK2 w - - 0 1`), confirm last move gold wash on `e1` and `e7`, crimson King halo on `e8`, attacker ring on `e7`, Check badge on Black HUD, and `+5` material advantage on Red's captured tray sorted in traditional order → AC-7
- [ ] Switch between `/my/play` and `/en/play` (and verify the `sittuyin_locale` cookie updates), play moves, and confirm all UI chrome and paired move history rows render via `formatMoveDisplay(record, locale)` with active ply highlight and scroll into view → AC-8
- [ ] Visit `/en/replay`, step through the built in 10 ply sample match with First, Prev, Play or Pause (`0.5x`, `1x`, `2x`), Next, Last, and `ArrowLeft`/`ArrowRight`/`Home`/`End`, then paste `e4d5 c6d5 f3d4 a1h8` and click Load Replay to verify the structured error alert names ply `4` while keeping the prior valid board visible → AC-9
- [ ] While scrubbed back to an earlier ply in an active match, confirm board moves are locked read only and that receiving a new live move displays the pulsing Back to live pill with the unseen ply count (`+1`) → AC-9
- [ ] Test `/my/play` at `360x780` mobile width and confirm zero horizontal overflow, full header visibility with no logo overlap, wrapping opening preset pills, and reachable board and tray controls → AC-10
- [ ] Select `10+5 Rapid` (`rapid_10_5`) on `/en/play`, finish setup, confirm the active clock decrements smoothly, adds `+5s` on move, switches visual state below 30s and 10s, and terminates cleanly on timeout → AC-10, AC-12
- [ ] Unmute sound and perform setup placement, quiet move, capture, General promotion, check, and low time tick, confirm Web Audio procedural wooden cues unlock cleanly on first gesture, obey volume and mute, and never throw when `AudioContext` is blocked or absent → AC-12
- [ ] Focus the board by keyboard, move roving focus across squares with arrow keys respecting flip, select and commit a move with `Enter`, cancel with `Escape`, inspect bilingual square `aria-label` strings, and enable `prefers-reduced-motion: reduce` to confirm animations and pulsing rings stop cleanly → AC-14

## Commands

- [ ] `pnpm lint` → Biome checks all files with 0 errors and 0 warnings → AC-1
- [ ] `pnpm typecheck` → All 5 workspace packages pass `tsc --noEmit` cleanly → AC-13
- [ ] `pnpm test` → All unit and component suites pass (`@sittuyin/web` 24 tests, `@sittuyin/engine` 23 tests, `@sittuyin/shared` 1 test, `@sittuyin/server` 2 tests) → AC-1, AC-2, AC-3, AC-5, AC-6, AC-7, AC-8, AC-9, AC-11, AC-12, AC-13, AC-14
- [ ] `pnpm build` → Client bundle and Cloudflare Workers SSR entry (with Paraglide `AsyncLocalStorage` middleware in `dist/server/index.js`) build cleanly → AC-8, AC-11

## Acceptance criteria coverage

- AC-1 covered by UI step 1 and Commands `pnpm lint`, `pnpm test`
- AC-2 covered by UI steps 2, 6 and Command `pnpm test`
- AC-3 covered by UI step 3 and Command `pnpm test`
- AC-4 covered by UI step 4
- AC-5 covered by UI step 5 and Command `pnpm test`
- AC-6 covered by UI step 6 and Command `pnpm test`
- AC-7 covered by UI step 7 and Command `pnpm test`
- AC-8 covered by UI step 8 and Commands `pnpm test`, `pnpm build`
- AC-9 covered by UI steps 9, 10 and Command `pnpm test`
- AC-10 covered by UI steps 11, 12
- AC-11 covered by UI step 1 and Commands `pnpm test`, `pnpm build`
- AC-12 covered by UI steps 12, 13 and Command `pnpm test`
- AC-13 covered by UI step 5 and Commands `pnpm typecheck`, `pnpm test`
- AC-14 covered by UI step 14 and Command `pnpm test`

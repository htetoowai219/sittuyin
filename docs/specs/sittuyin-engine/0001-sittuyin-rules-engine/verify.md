# Verify: sittuyin-rules-engine · spec 0001 · updated 2026-11-22

_Steps derived from spec 0001 acceptance criteria and Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [ ] Inspect `packages/sittuyin-engine/package.json` → confirm zero runtime `dependencies` and clean ESM `exports` → AC-1
- [ ] Call `createGame()` and `createGame({ setupMode: "alternating_drops", enableBareKingFiftyMove: false })` → confirm 16 staggered starting pawns from `INITIAL_PAWN_SQUARES`, 8 officer hands from `INITIAL_OFFICER_HAND`, preserved scaffold exports (`BOARD_SIZE`, `Side`, `PieceRole`, `PieceNameEntry`, `SITTUYIN_PIECE_NAMES`, `ENGINE_METADATA`), and `rules` merged over `DEFAULT_RULES` → AC-1, AC-3
- [ ] Run hidden simultaneous setup flow (`place`, `move`, swap, `remove`, `apply_preset` for `"red"` and 180 degree mirrored `"black"`, `clear`, `lock`, `unlock`) → confirm Rooks stay strictly on back rank, locking both sides merges drafts atomically onto `board`, captures `initialSetupFen` via `toFen`, and starts `"playing"` with Red to move → AC-2, AC-4
- [ ] Vary `seed` in `generateRandomSetup(seed)` and `autoCompleteSetup(state, side, seed)` (`"match-42"` repeated vs `"match-99"`, and 6 non rooks already on rank 1) → confirm identical output per seed, distinct output across seeds, Rooks placed on back rank first, and automatic lock in → AC-4, AC-13
- [ ] Exercise all 6 piece roles, Elephant forward asymmetry (Red north only, Black south only), pinned pieces, separate turn promotion (in place `c6c6f` and empty diagonal `c6b5f`, no capture, single General limit, `allowPromotionCheck: false` without soft lock, and last surviving pawn anywhere), and checkmate priority → confirm exact legal moves and `getCheckingSquares` / `getPromotionCandidates` parity → AC-5, AC-6, AC-7, AC-13
- [ ] Exercise illegal stalemate filtering (`ILLEGAL_STALEMATE`), promotion escape from stalemate, `unavoidable_stalemate` draw with zero recursion, and `stalemateRule: "draw"` override → confirm exact outcomes → AC-8
- [ ] Exercise threefold repetition, bare King dead positions (`K vs K`, `K+N vs K`, `K+F vs K`, `K+P vs K`) vs playable `K+S vs K` corner mate, standard 50 move draw, and bare King 50 move countdown (varying `enableBareKingFiftyMove` and `options.bareKingClock` in `fromFen`) → confirm draw triggers and checkmate priority → AC-9, AC-10
- [ ] Exercise `toFen` during hidden setup (`[KFRRSSNNkfrrssnn]` full pool, zero draft leak), `fromFen` (arbitrary hand order, forced `alternating_drops`, uneven hand parity rejection, `> 1` General rejection, opponent in check rejection, terminal detection), `parseUci` / `toUci` / `applyUci`, and `replayMatch` (`uciMoves.length + 1` snapshots and 1 indexed `REPLAY_MOVE_FAILED`) → confirm lossless round trips and structured errors → AC-10, AC-11
- [ ] Vary `locale` (`"en"` vs `"my"`) in `formatMoveDisplay(record, locale)` across drops, quiet moves, captures, in place and diagonal promotions, check, and checkmate → confirm English (`G`, `E`, `+`, `#`) and Myanmar (`ရထား`, `စစ်ကဲ`, `ခွေ`, `ချုပ်` suppressing `ခွေ` on checkmate) output → AC-12
- [ ] Vary `viewer` (`"red"`, `"black"`, `"spectator"`) in `toPlayerView(state, viewer)` during hidden setup → confirm opponent drafts are omitted, hidden sides' `hands` are masked to `INITIAL_OFFICER_HAND`, and `placedCounts` plus `setupReady` remain accurate → AC-14

## Commands

- [ ] `pnpm --filter @sittuyin/engine test` → all 4 Vitest suites (23 tests) pass → AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-14
- [ ] `pnpm --filter @sittuyin/engine typecheck && pnpm --filter @sittuyin/engine build` → strict TypeScript check and ESM declaration build pass with zero errors → AC-1, AC-13
- [ ] `pnpm typecheck && pnpm build && pnpm test && pnpm lint` → full monorepo typecheck, build, test, and Biome lint pass cleanly → AC-1, AC-13

## Acceptance-criteria coverage

- AC-1 covered by steps 1, 2, and Commands 1 to 3 · AC-2 covered by step 3 and Command 1 · AC-3 covered by step 2 and Command 1 · AC-4 covered by steps 3, 4, and Command 1 · AC-5 covered by step 5 and Command 1 · AC-6 covered by step 5 and Command 1 · AC-7 covered by step 5 and Command 1 · AC-8 covered by step 6 and Command 1 · AC-9 covered by step 7 and Command 1 · AC-10 covered by steps 7, 8, and Command 1 · AC-11 covered by step 8 and Command 1 · AC-12 covered by step 9 and Command 1 · AC-13 covered by steps 4, 5, and Commands 1 to 3 · AC-14 covered by step 10 and Command 1

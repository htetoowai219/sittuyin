# 0001. Rationale: Pure TypeScript Sittuyin rules engine

This document holds the context, design options evaluated, reasoning, and internal defaults behind [index.md](index.md).

## Context

Your accepted monorepo stack spec (`docs/specs/_root/0001-sittuyin-tech-stack-architecture/index.md`) establishes `packages/sittuyin-engine` as a pure, zero dependency TypeScript package shared between the Cloudflare Workers web app (`apps/web`) and the Fly.io Singapore Colyseus game server (`apps/server`). Today that package contains only a small scaffold with board metadata and bilingual piece names (`BOARD_SIZE`, `Side`, `PieceRole`, `SITTUYIN_PIECE_NAMES`, `ENGINE_METADATA`), while none of the actual Burmese chess gameplay mechanics, notation formats, or engine APIs are defined yet.

Traditional Sittuyin has several intricate domain rules that diverge sharply from Western chess and even differ subtly across regional customs and digital engines. Only the 8 pawns per side start on fixed staggered squares, while all 8 officers per side are deployed dynamically behind the pawns during a setup phase (traditionally behind a curtain so neither player sees the other's formation, yet bot engines and sequential replays expect alternating drop moves). Rooks are restricted to the back rank during setup, Elephants move asymmetrically forward and diagonally, and pawns promote strictly to a single General (`စစ်ကဲ`) on a separate turn from enemy half diagonal squares (`sit ke myin`) with an exception for the last surviving pawn. Stalemating an opponent is strictly illegal rather than a draw, creating rare forced stalemate edge cases, and endgames depend on both insufficient material checks and 50 move counting rules.

Several engineering forces govern how this package must be built. First, browser legal move previews and authoritative server validation must never disagree on any rule or edge case. Second, `apps/server` feeds untrusted WebSocket messages directly into the engine, so malformed moves, out of phase actions, or invalid FEN strings must never throw uncaught errors or leak hidden setup squares to rivals or spectators. Third, completed games are saved in PostgreSQL as `initial_setup_fen` plus `moves_uci_json` and must interoperate cleanly with Fairy Stockfish and PyChess tools for future AI bots and analysis. Without pinning down every rule edge case and API contract upfront, subtle bugs in promotion timing, stalemate recursion, or replay notation will ripple across the room server, board UI, and database.

## Options considered

### Option 1: Pure zero dependency immutable functional TypeScript engine with dual setup modes and Fairy Stockfish compatible FEN and UCI

Implement `packages/sittuyin-engine` in strict ESM TypeScript with zero runtime dependencies using pure immutable functions (`createGame`, `applySetupAction`, `applyMove`, `toFen`, `fromFen`, `toPlayerView`, `replayMatch`) returning typed `Result<T, EngineError>` unions. Separate hidden simultaneous setup drafts from `board` until both players lock in while also supporting alternating visible drops, built in Myanmar opening presets, exact traditional promotion and 1 ply illegal stalemate rules, and Fairy Stockfish compatible FEN and UCI strings.

**Pros**:

- Runs identically in browser, Cloudflare Workers, Node.js 22, and Vitest with zero bundle bloat and zero async initialization.
- Immutable snapshots and typed `Result` errors prevent stale React UI bugs, simplify replay scrubbing, and keep Colyseus room handlers crash free on untrusted inputs.
- Dual setup modes honor the authentic Myanmar hidden curtain game for live humans while remaining 100% compatible with Fairy Stockfish alternating drop bots and replays.
- Complete ownership of the rule logic makes subtle traditional rules (last surviving pawn promotion anywhere, bare King 50 move countdown, `unavoidable_stalemate`, and `toPlayerView` masking) clean and trivially unit testable.

**Cons**:

- Writing and testing a custom chess variant rules engine from scratch requires disciplined unit test coverage across promotion, stalemate, and FEN validation edge cases.
- Immutable snapshots plus 1 ply stalemate lookahead are plenty fast for human gameplay and server validation, but are slower than a mutable C++ bitboard engine if you later write a deep minimax AI inside TypeScript.

### Option 2: Stateful object oriented TypeScript class (`SittuyinGame`, `chess.js` style) with alternating drops only

Expose a mutable `SittuyinGame` class holding internal board state and move history with imperative methods (`game.move(...)`, `game.undo()`, `game.fen()`), throwing exceptions on bad input and supporting only alternating visible drops during setup.

**Pros**:

- Familiar imperative API for developers coming from `chess.js`.
- Slightly simpler setup state machine by omitting hidden simultaneous draft editing, swaps, and view masking.
- Marginally fewer object allocations during repeated local move trials.

**Cons**:

- Drops the traditional Myanmar hidden curtain setup experience, forcing live players to play visible alternating drops where Black always counter picks Red's formation.
- Mutable class instances create subtle React render staleness and require defensive cloning before storing snapshots or scrubbing replays.
- Exception based validation on untrusted Colyseus payloads increases the chance of uncaught room crashes compared to forced `Result` handling.

### Option 3: Wrap Fairy Stockfish WebAssembly (`ffish-js`) for rules and move generation

Bundle `ffish-js` (the WebAssembly build of Fairy Stockfish's variant rules engine) inside `packages/sittuyin-engine` and expose thin TypeScript wrappers around its built in `sittuyin` variant for legal moves, FEN, and UCI.

**Pros**:

- Reuses a mature, battle tested C++ move generator with native Fairy Stockfish parity and very high perft speed.
- Reduces hand written move vector and FEN parsing code on day one.

**Cons**:

- Ships a multi megabyte WebAssembly binary that strains Cloudflare Workers bundle limits, slows initial mobile loads in Myanmar, and complicates synchronous React and Vitest bootstrapping with async WASM loading.
- Does not natively model hidden simultaneous setup drafts, draft swapping, `toPlayerView` masking, curated Myanmar presets, bare King 50 move countdowns, or last surviving pawn promotion anywhere without maintaining a custom C++ fork and WASM build pipeline.
- Adds native toolchain friction for a small TypeScript team every time a rule detail needs tuning.

## Rationale

Option 1 fits every force in Context cleanly while avoiding the hidden traps of Options 2 and 3. Keeping `packages/sittuyin-engine` pure, zero dependency TypeScript honors the accepted stack architecture (`docs/specs/_root/0001-sittuyin-tech-stack-architecture/index.md`), loads synchronously in both React components and Node.js 22 Colyseus rooms, and keeps browser and Workers bundles tiny for mobile players in Myanmar. Choosing immutable snapshots with typed `Result<T, EngineError>` returns over a mutable exception throwing class (Option 2) directly serves both primary consumers: React renders cleanly from immutable state snapshots and `MoveRecord` objects, while `apps/server` validates untrusted WebSocket moves without risk of uncaught exceptions crashing live matches.

Crucially, Option 1 resolves the central domain tension of Burmese chess without compromise. Traditional Myanmar play uses hidden simultaneous curtain setup, last surviving pawn promotion anywhere, and 50 move bare King endgames, while digital chess ecosystems (Fairy Stockfish and PyChess) rely on extended FEN with `[hand]` pockets and UCI drop/promotion strings (`R@a1`, `c6c6f`, `c6b5f`). Wrapping `ffish-js` (Option 3) would force you to either surrender authentic Myanmar gameplay rules or maintain a C++ WASM fork. By owning the rules in clean modular TypeScript, storing hidden drafts separately from `board` until reveal, saving the revealed 32 piece board as `initialSetupFen` in hidden setup matches, and keeping Fairy Stockfish FEN and UCI grammar exact, you get authentic Burmese chess for human players and direct engine compatibility for bots and replays.

### Internal implementation defaults decided here

- **Deterministic seeded PRNG for random and timed out setups**: use a 32 bit FNV1a string/number seed hash feeding Mulberry32 (~15 lines, zero dependencies, identical sequence across V8, Node 22, and Cloudflare Workers) inside `generateRandomSetup` and `autoCompleteSetup` (runner up: `xorshift32`, slightly weaker seed avalanche on short numeric seeds).
- **Canonical position key for threefold repetition**: use the exact FEN prefix `<board>[<hand>] <w|b>` as the key in `positionCounts` rather than 64 bit Zobrist hashing, eliminating hash collision bugs completely at negligible memory and CPU cost for human match lengths (runner up: BigInt Zobrist hashing, better suited to a dedicated AI transposition table later).
- **Strict 1 ply illegal stalemate lookahead**: evaluate whether a candidate move stalemates the opponent solely by checking if the opponent has zero base legal replies (King safe and satisfying `allowPromotionCheck`) while not in check, never recursing deeper into mutual stalemate chains; if an opponent reaches a position where every base legal reply would stalemate the first player, `unavoidable_stalemate` cleanly ends the game in a draw on their turn (runner up: bounded 2 ply recursion, slower and harder for players to understand).
- **Bare King dead position insufficient material**: automatically draw the four bare King dead positions (`K vs K`, `K+N vs K`, `K+F vs K`, `K+P vs K`) so a rare `K+S vs K` corner checkmate remains playable, while the 50 move and bare King 50 move clocks resolve both defending `K+S vs K` and rare same color `K+F vs K+F` endgames cleanly (runner up: aggressive practical cutoff drawing `K+S vs K` immediately, cuts off legal corner mates).
- **Bilingual display vs wire notation**: keep wire and storage notation strictly Fairy Stockfish compatible (`F` for General, `S` for Elephant, `w`/`b` in FEN; `c6c6f`/`c6b5f` in UCI), while `formatMoveDisplay` renders player friendly English (`G`, `E`) and Myanmar (`စစ်ကဲ`, `ဆင်`, `ရထား`, `မြင်း`, `နယ်`, `မင်းကြီး`) labels for `apps/web` move lists (runner up: leaking `F`/`S` into English UI move lists, confusing for players who know General and Elephant).

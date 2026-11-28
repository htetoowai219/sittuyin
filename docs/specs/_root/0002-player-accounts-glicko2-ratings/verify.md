# Verify: Player accounts and Glicko 2 ratings · spec 0002 · updated 2026-11-24

_Steps derived from spec 0002 acceptance criteria and Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual

- [ ] Load `/my` or `/en` as a fresh visitor with no session cookie -> confirm zero rows are inserted into `user`, `session`, or `player_profiles`, and the header shows the Sign in with Google button -> AC-6
- [ ] Click Online and create a public room -> confirm `ensureGuestSessionProfileFn` creates a Better Auth anonymous user plus `player_profiles` row with `guest_<8hex>` handle, starting rating `1500?`, and detected Paraglide locale (carrying over any legacy `sittuyin.guest.v1` `displayName` once and expiring the cookie) -> AC-6, AC-8
- [ ] Open the header account menu as an anonymous guest -> confirm `profile.displayName`, Guest badge, provisional `1500?` rating, inline display name and handle edit form, and Sign in with Google button are visible, while Sign out is hidden -> AC-9, AC-13
- [ ] Update `displayName` (Burmese and English, up to 32 chars) and `handle` (3 to 24 lowercase Latin, digits, underscores) -> confirm changes persist; submit an already taken handle -> confirm structured `HANDLE_TAKEN` message appears -> AC-9, AC-13
- [ ] Click Sign in with Google from `/my/online` -> complete Google OAuth -> confirm redirect returns to `/my/online`, guest matches are reassigned, and brand new Google account inherits guest rating, RD, volatility, stats, and customized handle/display name (while an existing Google account preserves its own rating and stats) -> AC-5, AC-7, AC-13
- [ ] Open Create Room modal -> confirm Rated is selected by default for Public Lobby and switching to Private Room locks the toggle to Normal/Unrated -> AC-4, AC-8, AC-10, AC-13
- [ ] Complete a public Rated match between two distinct players -> confirm `"match_ended"` arrives immediately, `"rating_updated"` arrives after commit, and the post match rating delta badge (`+N`, `-N`, `0`, plus `?` when provisional) updates live -> AC-10, AC-11, AC-13
- [ ] Complete a public Normal match or Private Room match -> confirm `matches.is_rated` is `false`, `rating_applied_at` is `null`, and both `player_profiles` ratings remain unchanged -> AC-10, AC-12

## Commands

- [ ] `pnpm --filter @sittuyin/db db:migrate` (with `DATABASE_URL_UNPOOLED` configured) -> confirms `user`, `session`, `account`, `verification`, `player_profiles`, and updated `matches` columns and FKs are live -> AC-1, AC-2
- [ ] `pnpm --filter @sittuyin/shared test` -> passes all Glicko 2 unit tests including Mark Glickman's 2013 worked example (`1464.06`, `151.52`, `0.05999`) and provisional bounds -> AC-3, AC-4
- [ ] `pnpm --filter @sittuyin/db test` -> passes schema, client pool, `HandleTakenError`, `linkAnonymousProfileAndMatches`, and mid match deleted user tests -> AC-1, AC-2, AC-7, AC-11, AC-12
- [ ] `pnpm --filter @sittuyin/server test` -> passes all `SittuyinRoom` lifecycle and schema cap tests -> AC-10, AC-11, AC-12
- [ ] `pnpm --filter @sittuyin/web build && pnpm --filter @sittuyin/web typecheck && pnpm --filter @sittuyin/web test` -> builds client and worker bundles cleanly, typechecks with zero errors, and passes all 41 tests -> AC-5, AC-8, AC-9, AC-13

## Acceptance-criteria coverage

- AC-1, AC-2 covered by `db:migrate` and `@sittuyin/db` tests
- AC-3, AC-4 covered by `@sittuyin/shared` tests and Create Room modal check
- AC-5, AC-6, AC-7 covered by passive SSR, lazy guest creation, and Google OAuth linking checks
- AC-8, AC-9 covered by `match-ticket` and `account` server function checks
- AC-10, AC-11, AC-12 covered by `@sittuyin/server` tests, Rated vs Normal match checks, and mid match deleted user test
- AC-13 covered by bilingual header account menu, lobby cards, Create Room modal, and live rating delta badge checks

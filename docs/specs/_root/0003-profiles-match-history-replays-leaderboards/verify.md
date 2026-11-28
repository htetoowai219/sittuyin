# Verify: Public player profiles, match history, shareable replays, and leaderboards · spec 0003 · updated 2026-11-28
_Steps derived from spec 0003 acceptance criteria and Value sourcing table. `/check verify` runs these; `/test` locks the durable ones._

## UI / manual
- [ ] Visit `/en/leaderboard` and `/my/leaderboard` with 30 established players and 2 provisional players seeded -> expect 25 established rows sorted by `rating DESC, user_id ASC`, provisional players excluded, Guest badge on anonymous players, and Load More appending the remaining 5 rows with no duplicate `userId` -> AC-5, AC-9
- [ ] Visit `/en/leaderboard` signed in as an established player, then as a provisional player -> expect pinned Your Standing banner to show exact `1 + COUNT(*)` rank for the established player and `gamesRemaining` or RD requirement for the provisional player -> AC-3, AC-5
- [ ] Visit `/en/u/$handle` as another visitor, then as the signed in owner -> expect display name, `@handle`, Guest badge (when anonymous), rounded rating with `?` when provisional, W/L/D record, and Load More match history; expect `private_room` matches with Private badge ONLY when signed in as the owner -> AC-3, AC-4, AC-6
- [ ] Visit `/en/u/$handle` for a player with a match whose opponent `user_id` is `null` -> expect historical `matches.*_display_name` rendered as plain unlinked text with no crash, and a rated match showing signed rating delta (`+14` / `-12`) -> AC-3, AC-6
- [ ] Visit `/en/u/unknown_handle_xyz` and `/my/u/unknown_handle_xyz` -> expect localized 404 Not Found card with Browse Leaderboard CTA -> AC-6
- [ ] Visit `/en/match/$matchId?ply=4` for a saved `public_lobby` match -> expect `<SittuyinMatchWorkspace>` opened at ply 4, both seated players with live `/en/u/$handle` links (or historical fallback) and rating deltas, `?ply=` updated as you scrub moves, and Copy Match Link / Copy Link at Move buttons copying exact URLs -> AC-7, AC-9
- [ ] Visit `/en/match/$matchId` (no `?ply=`), `?ply=999`, and `?ply=abc` -> expect default to final ply when omitted and safe clamping to `[0, snapshots.length - 1]` with zero errors -> AC-7
- [ ] Visit `/en/match/550e8400-e29b-41d4-a716-446655440099` (unknown UUID) -> expect localized Not Found card with working Retry Loading Match button -> AC-7
- [ ] Finish a live competitive online match and finish an aborted online match -> expect Share Replay and Open Replay buttons inside the post match banner for the completed match only, and hidden for `aborted_pre_move` and `aborted_maintenance` -> AC-8
- [ ] Check top navigation bar and account menu in both `/en` and `/my` -> expect Leaderboard link in top nav and My Profile link in account menu linking to `/$locale/u/${profile.handle}` -> AC-9
- [ ] Inspect SSR HTML `<head>` and response headers across `/en/leaderboard`, `/en/u/$guestHandle`, `/en/match/$publicId?ply=4`, and `/en/match/$privateId` -> expect dynamic `<title>`, `<meta name="description">`, `<link rel="canonical">` without `?ply=`, `og:image`, `<meta name="robots" content="noindex, nofollow">` on anonymous guest profiles and `private_room` replays, `Cache-Control: public, max-age=300, stale-while-revalidate=3600` on `public_lobby` replays, and `Cache-Control: private, no-store` on `private_room` replays, leaderboard, and profiles -> AC-4, AC-10
- [ ] Visit all three public routes in a clean browser with no session cookie -> expect zero new rows inserted in `user` or `player_profiles`, and zero `email` fields in any loader payload -> AC-3, AC-4

## Commands
- [ ] `pnpm --filter @sittuyin/db db:migrate` (with `DATABASE_URL_UNPOOLED` or `DATABASE_URL` set) -> expect migration `0002_profiles_leaderboard_history_indexes.sql` applies cleanly and `\di` / `pg_indexes` shows `player_profiles_leaderboard_idx`, `matches_red_user_ended_id_idx`, and `matches_black_user_ended_id_idx` -> AC-1
- [ ] `pnpm --filter @sittuyin/shared test` -> expect opaque base64url cursor codecs and Zod handle/UUID/limit contracts pass (14/14 tests) -> AC-2
- [ ] `pnpm --filter @sittuyin/db test` -> expect read repository unit tests pass (13/13 tests) -> AC-1, AC-3
- [ ] `pnpm typecheck && pnpm test` -> expect all 5 workspace packages typecheck and pass all 105 tests -> AC-2, AC-3, AC-4, AC-7, AC-8
- [ ] `pnpm --dir apps/web build` -> expect client and Cloudflare Workers SSR bundles build cleanly -> AC-4, AC-5, AC-6, AC-7, AC-10

## Acceptance-criteria coverage
- AC-1 covered by migration command + db tests · AC-2 covered by shared tests · AC-3 covered by db tests + leaderboard/profile manual steps · AC-4 covered by headers/no write manual steps + web build · AC-5 covered by leaderboard manual steps · AC-6 covered by profile manual steps · AC-7 covered by match replay manual steps · AC-8 covered by post match Share Replay manual step + web unit test · AC-9 covered by nav/account menu manual step · AC-10 covered by SSR `<head>` manual step + web unit test

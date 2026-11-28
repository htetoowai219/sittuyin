import type { LeaderboardEntry, LeaderboardPage } from "@sittuyin/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Award, Loader2, Medal, Swords, Trophy, User } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { type AppLocale, isAppLocale, m } from "@/i18n/locale";
import { buildSeoHead } from "@/lib/seo";
import { getLeaderboardFn } from "@/server/leaderboard";

export const Route = createFileRoute("/$locale/leaderboard")({
	loader: async (): Promise<LeaderboardPage> => {
		try {
			return await getLeaderboardFn({ data: { limit: 25 } });
		} catch {
			return {
				entries: [],
				nextCursor: null,
				viewerStanding: null,
			};
		}
	},
	head: ({ params }) => {
		const locale: AppLocale = isAppLocale(params.locale) ? params.locale : "my";
		return buildSeoHead({
			title: `${m.leaderboard_title({}, { locale })} · ${m.app_title({}, { locale })}`,
			description: m.leaderboard_subtitle({}, { locale }),
			canonicalPath: `/${locale}/leaderboard`,
		});
	},
	component: LeaderboardPageView,
});

function mergeUniqueEntries(
	existing: readonly LeaderboardEntry[],
	incoming: readonly LeaderboardEntry[],
): LeaderboardEntry[] {
	const seen = new Set(existing.map((entry) => entry.userId));
	const merged = [...existing];
	for (const entry of incoming) {
		if (!seen.has(entry.userId)) {
			seen.add(entry.userId);
			merged.push(entry);
		}
	}
	return merged;
}

function LeaderboardPageView() {
	const { locale } = Route.useParams();
	const activeLocale: AppLocale = isAppLocale(locale) ? locale : "my";
	const initialData = Route.useLoaderData();

	const [entries, setEntries] = useState<LeaderboardEntry[]>(
		initialData.entries,
	);
	const [nextCursor, setNextCursor] = useState<string | null>(
		initialData.nextCursor,
	);
	const [loadingMore, setLoadingMore] = useState(false);

	const { viewerStanding } = initialData;

	const handleLoadMore = async () => {
		if (!nextCursor || loadingMore) return;
		setLoadingMore(true);
		try {
			const page = await getLeaderboardFn({
				data: { cursor: nextCursor, limit: 25 },
			});
			setEntries((prev) => mergeUniqueEntries(prev, page.entries));
			setNextCursor(page.nextCursor);
		} finally {
			setLoadingMore(false);
		}
	};

	const renderProvisionalHint = () => {
		if (!viewerStanding || viewerStanding.qualified) return null;
		const needsGames = viewerStanding.gamesRemaining > 0;
		const needsRd = !viewerStanding.rdThresholdMet;
		if (needsGames && needsRd) {
			return m.leaderboard_your_rank_provisional_both(
				{ games: String(viewerStanding.gamesRemaining) },
				{ locale: activeLocale },
			);
		}
		if (needsGames) {
			return m.leaderboard_your_rank_provisional_games(
				{ games: String(viewerStanding.gamesRemaining) },
				{ locale: activeLocale },
			);
		}
		return m.leaderboard_your_rank_provisional_rd({}, { locale: activeLocale });
	};

	return (
		<main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
			{/* Page Header */}
			<section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center gap-2.5">
						<div className="flex size-10 items-center justify-center rounded-xl border border-sit-ke-myin/40 bg-sit-ke-myin/12 text-sit-ke-myin">
							<Trophy className="size-5" aria-hidden="true" />
						</div>
						<h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
							{m.leaderboard_title({}, { locale: activeLocale })}
						</h1>
					</div>
					<p className="max-w-2xl text-sm text-muted-foreground">
						{m.leaderboard_subtitle({}, { locale: activeLocale })}
					</p>
				</div>

				<Button asChild size="sm" className="w-fit">
					<Link to="/$locale/online" params={{ locale: activeLocale }}>
						<Swords data-icon="inline-start" />
						{m.nav_online({}, { locale: activeLocale })}
					</Link>
				</Button>
			</section>

			{/* Pinned Your Standing Banner */}
			{viewerStanding ? (
				<Card
					data-testid="leaderboard-your-rank"
					className="border-sit-ke-myin/40 bg-surface-elevated/90"
				>
					<CardContent className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center">
						<div className="flex items-start gap-3">
							<div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-sit-ke-myin/15 text-sit-ke-myin">
								<Award className="size-5" aria-hidden="true" />
							</div>
							<div className="flex flex-col gap-0.5">
								<div className="flex flex-wrap items-center gap-2">
									<span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
										{m.leaderboard_your_rank_title(
											{},
											{ locale: activeLocale },
										)}
									</span>
									{viewerStanding.isAnonymous ? (
										<Badge variant="secondary" className="text-[10px]">
											{m.account_guest_label({}, { locale: activeLocale })}
										</Badge>
									) : null}
								</div>
								{viewerStanding.qualified && viewerStanding.rank !== null ? (
									<p className="text-base font-bold text-foreground">
										{m.leaderboard_your_rank_qualified(
											{
												rank: String(viewerStanding.rank),
												rating: String(Math.round(viewerStanding.rating)),
											},
											{ locale: activeLocale },
										)}
									</p>
								) : (
									<div className="flex flex-col gap-0.5">
										<p className="text-sm font-semibold text-foreground">
											{Math.round(viewerStanding.rating)}?{" "}
											<span className="font-normal text-muted-foreground">
												({viewerStanding.wins}W / {viewerStanding.losses}L /{" "}
												{viewerStanding.draws}D)
											</span>
										</p>
										<p className="text-xs text-muted-foreground">
											{renderProvisionalHint()}
										</p>
									</div>
								)}
							</div>
						</div>

						<Button
							asChild
							variant="outline"
							size="sm"
							className="w-fit shrink-0"
						>
							<Link
								to="/$locale/u/$handle"
								params={{
									locale: activeLocale,
									handle: viewerStanding.handle,
								}}
							>
								<User data-icon="inline-start" />
								{m.account_my_profile({}, { locale: activeLocale })}
							</Link>
						</Button>
					</CardContent>
				</Card>
			) : null}

			{/* Leaderboard Table */}
			<Card className="border-border-subtle bg-card">
				<CardContent className="p-0">
					{entries.length === 0 ? (
						<div
							data-testid="leaderboard-empty"
							className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center"
						>
							<Medal
								className="size-10 text-muted-foreground/60"
								aria-hidden="true"
							/>
							<div className="flex flex-col gap-1">
								<h2 className="text-base font-semibold text-foreground">
									{m.leaderboard_empty_title({}, { locale: activeLocale })}
								</h2>
								<p className="max-w-md text-sm text-muted-foreground">
									{m.leaderboard_empty_desc({}, { locale: activeLocale })}
								</p>
							</div>
							<Button asChild variant="secondary" size="sm" className="mt-1">
								<Link to="/$locale/online" params={{ locale: activeLocale }}>
									<Swords data-icon="inline-start" />
									{m.nav_online({}, { locale: activeLocale })}
								</Link>
							</Button>
						</div>
					) : (
						<div className="overflow-x-auto">
							<table
								data-testid="leaderboard-table"
								className="w-full border-collapse text-left text-sm"
							>
								<thead>
									<tr className="border-b border-border-subtle bg-surface/60 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
										<th scope="col" className="w-16 px-4 py-3 text-center">
											{m.leaderboard_col_rank({}, { locale: activeLocale })}
										</th>
										<th scope="col" className="px-4 py-3">
											{m.leaderboard_col_player({}, { locale: activeLocale })}
										</th>
										<th scope="col" className="px-4 py-3 text-right">
											{m.leaderboard_col_rating({}, { locale: activeLocale })}
										</th>
										<th
											scope="col"
											className="hidden px-4 py-3 text-right sm:table-cell"
										>
											{m.leaderboard_col_games({}, { locale: activeLocale })}
										</th>
										<th
											scope="col"
											className="hidden px-4 py-3 text-right md:table-cell"
										>
											{m.leaderboard_col_record({}, { locale: activeLocale })}
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-border-subtle/70">
									{entries.map((entry, index) => {
										const rank = index + 1;
										const isViewer = viewerStanding?.userId === entry.userId;
										const rankTone =
											rank === 1
												? "text-amber-400 font-bold"
												: rank === 2
													? "text-slate-300 font-bold"
													: rank === 3
														? "text-amber-600 font-bold"
														: "text-muted-foreground font-mono";

										return (
											<tr
												key={entry.userId}
												data-testid={`leaderboard-row-${entry.handle}`}
												className={
													isViewer
														? "bg-sit-ke-myin/10 transition-colors hover:bg-sit-ke-myin/15"
														: "transition-colors hover:bg-surface-elevated/60"
												}
											>
												<td
													className={`px-4 py-3.5 text-center font-mono ${rankTone}`}
												>
													#{rank}
												</td>
												<td className="px-4 py-3.5">
													<div className="flex flex-wrap items-center gap-2">
														<Link
															to="/$locale/u/$handle"
															params={{
																locale: activeLocale,
																handle: entry.handle,
															}}
															className="font-semibold text-foreground underline-offset-4 hover:text-sit-ke-myin hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
														>
															{entry.displayName}
														</Link>
														<span className="font-mono text-xs text-muted-foreground">
															@{entry.handle}
														</span>
														{entry.isAnonymous ? (
															<Badge
																variant="secondary"
																className="text-[10px]"
															>
																{m.account_guest_label(
																	{},
																	{ locale: activeLocale },
																)}
															</Badge>
														) : null}
													</div>
												</td>
												<td className="px-4 py-3.5 text-right font-mono text-base font-bold text-foreground">
													{Math.round(entry.rating)}
												</td>
												<td className="hidden px-4 py-3.5 text-right font-mono text-muted-foreground sm:table-cell">
													{entry.gamesPlayed}
												</td>
												<td className="hidden px-4 py-3.5 text-right font-mono text-xs text-muted-foreground md:table-cell">
													<span className="text-emerald-500">
														{entry.wins}W
													</span>{" "}
													/{" "}
													<span className="text-rose-400">{entry.losses}L</span>{" "}
													/ <span>{entry.draws}D</span>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Load More */}
			{nextCursor ? (
				<div className="flex justify-center">
					<Button
						type="button"
						variant="outline"
						data-testid="leaderboard-load-more"
						disabled={loadingMore}
						onClick={() => {
							void handleLoadMore();
						}}
						className="min-w-44"
					>
						{loadingMore ? (
							<>
								<Loader2 className="mr-2 size-4 animate-spin" />
								{m.leaderboard_loading_more({}, { locale: activeLocale })}
							</>
						) : (
							m.leaderboard_load_more({}, { locale: activeLocale })
						)}
					</Button>
				</div>
			) : null}
		</main>
	);
}

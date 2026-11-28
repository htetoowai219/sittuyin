import {
	PlayerHandleSchema,
	type PlayerMatchHistoryItem,
	type PublicPlayerProfilePage,
	TIME_CONTROL_CONFIGS,
} from "@sittuyin/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Clock,
	History,
	Loader2,
	Lock,
	Play,
	ShieldCheck,
	Trophy,
	User,
	UserX,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { type AppLocale, isAppLocale, m } from "@/i18n/locale";
import { buildSeoHead } from "@/lib/seo";
import {
	getPlayerMatchHistoryFn,
	getPublicPlayerProfileFn,
} from "@/server/profile";

export const Route = createFileRoute("/$locale/u/$handle")({
	loader: async ({ params }): Promise<PublicPlayerProfilePage | null> => {
		const normalized = params.handle.trim().toLowerCase();
		if (!PlayerHandleSchema.safeParse(normalized).success) {
			return null;
		}
		try {
			return await getPublicPlayerProfileFn({
				data: { handle: normalized, limit: 25 },
			});
		} catch {
			return null;
		}
	},
	head: ({ params, loaderData }) => {
		const locale: AppLocale = isAppLocale(params.locale) ? params.locale : "my";
		if (!loaderData) {
			return buildSeoHead({
				title: `${m.profile_not_found_title({}, { locale })} · ${m.app_title({}, { locale })}`,
				description: m.profile_not_found_desc(
					{ handle: params.handle },
					{ locale },
				),
				canonicalPath: `/${locale}/u/${params.handle.toLowerCase()}`,
				noindex: true,
			});
		}
		const { profile } = loaderData;
		const ratingStr = `${Math.round(profile.rating)}${profile.isProvisional ? "?" : ""}`;
		return buildSeoHead({
			title: `${profile.displayName} (@${profile.handle}) · ${m.app_title({}, { locale })}`,
			description: `${profile.displayName} (@${profile.handle}) · ${ratingStr} Glicko-2 · ${profile.wins}W / ${profile.losses}L / ${profile.draws}D`,
			canonicalPath: `/${locale}/u/${profile.handle}`,
			noindex: profile.isAnonymous,
		});
	},
	component: PlayerProfilePageView,
});

function mergeUniqueMatches(
	existing: readonly PlayerMatchHistoryItem[],
	incoming: readonly PlayerMatchHistoryItem[],
): PlayerMatchHistoryItem[] {
	const seen = new Set(existing.map((item) => item.id));
	const merged = [...existing];
	for (const item of incoming) {
		if (!seen.has(item.id)) {
			seen.add(item.id);
			merged.push(item);
		}
	}
	return merged;
}

function formatEndedAt(iso: string, locale: AppLocale): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	try {
		return new Intl.DateTimeFormat(locale === "my" ? "my-MM" : "en-US", {
			month: "short",
			day: "numeric",
			year: "numeric",
		}).format(date);
	} catch {
		return date.toISOString().slice(0, 10);
	}
}

function formatRatingDelta(delta: number): string {
	return delta > 0 ? `+${delta}` : String(delta);
}

function PlayerProfilePageView() {
	const { locale, handle } = Route.useParams();
	const activeLocale: AppLocale = isAppLocale(locale) ? locale : "my";
	const initialData = Route.useLoaderData();

	const [matches, setMatches] = useState<PlayerMatchHistoryItem[]>(
		initialData?.matches ?? [],
	);
	const [nextCursor, setNextCursor] = useState<string | null>(
		initialData?.nextCursor ?? null,
	);
	const [loadingMore, setLoadingMore] = useState(false);

	useEffect(() => {
		setMatches(initialData?.matches ?? []);
		setNextCursor(initialData?.nextCursor ?? null);
	}, [initialData]);

	if (!initialData) {
		return (
			<main className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-14 sm:px-6">
				<Card
					data-testid="profile-not-found"
					className="w-full border-border-subtle bg-card text-center"
				>
					<CardContent className="flex flex-col items-center gap-4 py-12">
						<div className="flex size-12 items-center justify-center rounded-full bg-surface-elevated text-muted-foreground">
							<UserX className="size-6" aria-hidden="true" />
						</div>
						<div className="flex flex-col gap-1.5">
							<h1 className="text-xl font-bold text-foreground">
								{m.profile_not_found_title({}, { locale: activeLocale })}
							</h1>
							<p className="max-w-md text-sm text-muted-foreground">
								{m.profile_not_found_desc({ handle }, { locale: activeLocale })}
							</p>
						</div>
						<Button asChild variant="secondary" size="sm" className="mt-2">
							<Link to="/$locale/leaderboard" params={{ locale: activeLocale }}>
								<Trophy data-icon="inline-start" />
								{m.profile_back_to_leaderboard({}, { locale: activeLocale })}
							</Link>
						</Button>
					</CardContent>
				</Card>
			</main>
		);
	}

	const { profile, isOwner } = initialData;
	const ratingLabel = `${Math.round(profile.rating)}${profile.isProvisional ? "?" : ""}`;

	const handleLoadMore = async () => {
		if (!nextCursor || loadingMore) return;
		setLoadingMore(true);
		try {
			const page = await getPlayerMatchHistoryFn({
				data: { handle: profile.handle, cursor: nextCursor, limit: 25 },
			});
			if (page) {
				setMatches((prev) => mergeUniqueMatches(prev, page.matches));
				setNextCursor(page.nextCursor);
			}
		} finally {
			setLoadingMore(false);
		}
	};

	return (
		<main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
			{/* Profile Header Card */}
			<Card
				data-testid="profile-header"
				className="border-border-subtle bg-card"
			>
				<CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex items-center gap-3.5">
						<div className="flex size-14 shrink-0 items-center justify-center rounded-2xl border border-sit-ke-myin/40 bg-surface-elevated text-sit-ke-myin">
							{profile.isAnonymous ? (
								<User
									className="size-7 text-muted-foreground"
									aria-hidden="true"
								/>
							) : (
								<ShieldCheck
									className="size-7 text-emerald-500"
									aria-hidden="true"
								/>
							)}
						</div>
						<div className="flex flex-col gap-1">
							<div className="flex flex-wrap items-center gap-2">
								<h1 className="text-2xl font-bold tracking-tight text-foreground">
									{profile.displayName}
								</h1>
								{profile.isAnonymous ? (
									<Badge variant="secondary" data-testid="profile-guest-badge">
										{m.account_guest_label({}, { locale: activeLocale })}
									</Badge>
								) : null}
							</div>
							<p className="font-mono text-sm text-muted-foreground">
								@{profile.handle}
							</p>
						</div>
					</div>

					<Button asChild variant="outline" size="sm" className="w-fit">
						<Link to="/$locale/leaderboard" params={{ locale: activeLocale }}>
							<Trophy data-icon="inline-start" />
							{m.nav_leaderboard({}, { locale: activeLocale })}
						</Link>
					</Button>
				</CardHeader>

				<CardContent>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
						<div className="rounded-xl border border-border-subtle bg-surface/60 p-4">
							<p className="text-xs font-medium text-muted-foreground">
								{m.profile_rating_label({}, { locale: activeLocale })}
							</p>
							<div className="mt-1.5 flex items-baseline gap-2">
								<span
									data-testid="profile-rating-value"
									className="font-mono text-2xl font-bold text-foreground"
								>
									{ratingLabel}
								</span>
								{profile.isProvisional ? (
									<Badge
										variant="secondary"
										title={m.account_provisional_hint(
											{},
											{ locale: activeLocale },
										)}
										className="text-[10px]"
									>
										{m.profile_provisional_badge({}, { locale: activeLocale })}
									</Badge>
								) : null}
							</div>
						</div>

						<div className="rounded-xl border border-border-subtle bg-surface/60 p-4">
							<p className="text-xs font-medium text-muted-foreground">
								{m.profile_games_label({}, { locale: activeLocale })}
							</p>
							<p className="mt-1.5 font-mono text-2xl font-bold text-foreground">
								{profile.gamesPlayed}
							</p>
						</div>

						<div className="rounded-xl border border-border-subtle bg-surface/60 p-4">
							<p className="text-xs font-medium text-muted-foreground">
								{m.profile_record_label({}, { locale: activeLocale })}
							</p>
							<p
								data-testid="profile-wld-summary"
								className="mt-1.5 font-mono text-2xl font-bold text-foreground"
							>
								<span className="text-emerald-500">{profile.wins}</span>
								<span className="mx-1 text-muted-foreground">/</span>
								<span className="text-rose-400">{profile.losses}</span>
								<span className="mx-1 text-muted-foreground">/</span>
								<span className="text-muted-foreground">{profile.draws}</span>
							</p>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Match History Section */}
			<Card
				data-testid="profile-match-history"
				className="border-border-subtle bg-card"
			>
				<CardHeader className="pb-3">
					<div className="flex items-center gap-2">
						<History className="size-4 text-sit-ke-myin" aria-hidden="true" />
						<CardTitle className="text-base">
							{m.profile_match_history_title({}, { locale: activeLocale })}
						</CardTitle>
					</div>
					{isOwner ? (
						<CardDescription className="text-xs">
							{m.profile_match_history_owner_note({}, { locale: activeLocale })}
						</CardDescription>
					) : null}
				</CardHeader>

				<CardContent className="flex flex-col gap-3">
					{matches.length === 0 ? (
						<div
							data-testid="profile-match-history-empty"
							className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-subtle px-6 py-12 text-center"
						>
							<p className="text-sm font-semibold text-foreground">
								{m.profile_match_history_empty_title(
									{},
									{ locale: activeLocale },
								)}
							</p>
							<p className="max-w-sm text-xs text-muted-foreground">
								{m.profile_match_history_empty_desc(
									{},
									{ locale: activeLocale },
								)}
							</p>
						</div>
					) : (
						<ul className="divide-y divide-border-subtle/70 rounded-xl border border-border-subtle">
							{matches.map((match) => {
								const tcConfig = TIME_CONTROL_CONFIGS[match.timeControl];
								const tcLabel = tcConfig
									? `${Math.round(tcConfig.initialMs / 60_000)}+${Math.round(tcConfig.incrementMs / 1_000)}`
									: match.timeControl;
								const outcomeLabel =
									match.outcome === "win"
										? m.profile_result_win({}, { locale: activeLocale })
										: match.outcome === "loss"
											? m.profile_result_loss({}, { locale: activeLocale })
											: m.profile_result_draw({}, { locale: activeLocale });
								const outcomeClass =
									match.outcome === "win"
										? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400"
										: match.outcome === "loss"
											? "border-rose-500/40 bg-rose-500/15 text-rose-400"
											: "border-border-subtle bg-surface-elevated text-muted-foreground";

								return (
									<li
										key={match.id}
										data-testid={`match-history-row-${match.id}`}
										className="flex flex-col justify-between gap-3 p-4 transition-colors hover:bg-surface-elevated/50 sm:flex-row sm:items-center"
									>
										<div className="flex min-w-0 flex-col gap-1.5">
											<div className="flex flex-wrap items-center gap-2">
												<Badge
													variant="outline"
													className={`min-w-12 justify-center font-semibold ${outcomeClass}`}
												>
													{outcomeLabel}
												</Badge>
												<span className="text-xs text-muted-foreground">
													{m.profile_vs_prefix({}, { locale: activeLocale })}
												</span>
												{match.opponent.handle ? (
													<Link
														to="/$locale/u/$handle"
														params={{
															locale: activeLocale,
															handle: match.opponent.handle,
														}}
														className="truncate font-semibold text-foreground underline-offset-4 hover:text-sit-ke-myin hover:underline"
													>
														{match.opponent.displayName}
													</Link>
												) : (
													<span
														data-testid={`match-opponent-fallback-${match.id}`}
														className="truncate font-medium text-muted-foreground"
													>
														{match.opponent.displayName}
													</span>
												)}
											</div>

											<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
												{match.mode === "private_room" ? (
													<Badge
														variant="secondary"
														data-testid={`match-private-badge-${match.id}`}
														className="gap-1 text-[10px]"
													>
														<Lock className="size-2.5" aria-hidden="true" />
														{m.badge_private({}, { locale: activeLocale })}
													</Badge>
												) : null}
												<Badge
													variant={match.isRated ? "default" : "secondary"}
													className="text-[10px]"
												>
													{match.isRated
														? m.badge_rated({}, { locale: activeLocale })
														: m.badge_normal({}, { locale: activeLocale })}
												</Badge>
												<span className="inline-flex items-center gap-1 font-mono">
													<Clock className="size-3" aria-hidden="true" />
													{tcLabel}
												</span>
												{match.playerRatingDelta !== null ? (
													<span
														className={`font-mono font-semibold ${
															match.playerRatingDelta > 0
																? "text-emerald-500"
																: match.playerRatingDelta < 0
																	? "text-rose-400"
																	: "text-muted-foreground"
														}`}
													>
														{formatRatingDelta(match.playerRatingDelta)}
													</span>
												) : null}
												<span>·</span>
												<span>
													{formatEndedAt(match.endedAt, activeLocale)}
												</span>
											</div>
										</div>

										<Button
											asChild
											variant="outline"
											size="sm"
											className="w-fit shrink-0"
										>
											<Link
												to="/$locale/match/$matchId"
												params={{ locale: activeLocale, matchId: match.id }}
											>
												<Play data-icon="inline-start" />
												{m.profile_view_replay({}, { locale: activeLocale })}
											</Link>
										</Button>
									</li>
								);
							})}
						</ul>
					)}

					{nextCursor ? (
						<div className="flex justify-center pt-2">
							<Button
								type="button"
								variant="outline"
								data-testid="profile-load-more"
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
									m.profile_load_more_matches({}, { locale: activeLocale })
								)}
							</Button>
						</div>
					) : null}
				</CardContent>
			</Card>
		</main>
	);
}

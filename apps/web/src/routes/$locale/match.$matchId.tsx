import {
	MatchIdSchema,
	type MatchReplayPayload,
	type MatchSeatSummary,
	TIME_CONTROL_CONFIGS,
} from "@sittuyin/shared";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import {
	Clock,
	Copy,
	FileX2,
	Link2,
	Loader2,
	Lock,
	RefreshCw,
	Trophy,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { SittuyinMatchWorkspace } from "@/components/sittuyin/SittuyinMatchWorkspace";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type AppLocale, formatSideName, isAppLocale, m } from "@/i18n/locale";
import {
	createReplayAdapter,
	matchReplayToExtendedOutcome,
	parseReplaySession,
} from "@/lib/adapters/replay-adapter";
import { buildSeoHead } from "@/lib/seo";
import { getMatchReplayFn } from "@/server/replay";

export interface MatchReplaySearchParams {
	readonly ply?: number;
}

export function parseMatchReplaySearch(
	search: Record<string, unknown>,
): MatchReplaySearchParams {
	const raw = search.ply;
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return { ply: Math.trunc(raw) };
	}
	if (typeof raw === "string" && raw.trim().length > 0) {
		const parsed = Number.parseInt(raw.trim(), 10);
		if (Number.isFinite(parsed)) {
			return { ply: parsed };
		}
	}
	return {};
}

export function clampReplayPly(
	requestedPly: number | undefined,
	snapshotCount: number,
): number {
	const maxPly = Math.max(0, snapshotCount - 1);
	if (requestedPly === undefined || !Number.isFinite(requestedPly)) {
		return maxPly;
	}
	return Math.max(0, Math.min(Math.trunc(requestedPly), maxPly));
}

function formatTimeControlLabel(
	timeControl: MatchReplayPayload["timeControl"],
): string {
	const cfg = TIME_CONTROL_CONFIGS[timeControl];
	if (!cfg) return timeControl;
	return `${Math.round(cfg.initialMs / 60_000)}+${Math.round(cfg.incrementMs / 1_000)}`;
}

export const Route = createFileRoute("/$locale/match/$matchId")({
	validateSearch: parseMatchReplaySearch,
	loader: async ({ params }): Promise<MatchReplayPayload | null> => {
		if (!MatchIdSchema.safeParse(params.matchId).success) {
			return null;
		}
		try {
			return await getMatchReplayFn({ data: { matchId: params.matchId } });
		} catch {
			return null;
		}
	},
	head: ({ params, loaderData }) => {
		const locale: AppLocale = isAppLocale(params.locale) ? params.locale : "my";
		if (!loaderData) {
			return buildSeoHead({
				title: `${m.match_replay_not_found_title({}, { locale })} · ${m.app_title({}, { locale })}`,
				description: m.match_replay_not_found_desc({}, { locale }),
				canonicalPath: `/${locale}/match/${params.matchId}`,
				noindex: true,
			});
		}
		const tcLabel = formatTimeControlLabel(loaderData.timeControl);
		return buildSeoHead({
			title: `${loaderData.red.displayName} vs ${loaderData.black.displayName} · ${m.match_replay_title({}, { locale })} · ${m.app_title({}, { locale })}`,
			description: `${loaderData.red.displayName} vs ${loaderData.black.displayName} · ${tcLabel} · ${loaderData.totalPlies} plies`,
			canonicalPath: `/${locale}/match/${loaderData.id}`,
			noindex: loaderData.mode === "private_room",
		});
	},
	component: MatchReplayPageView,
});

function formatRatingDelta(delta: number): string {
	return delta > 0 ? `+${delta}` : String(delta);
}

function SeatRow({
	side,
	seat,
	locale,
	isWinner,
}: {
	readonly side: "red" | "black";
	readonly seat: MatchSeatSummary;
	readonly locale: AppLocale;
	readonly isWinner: boolean;
}) {
	const dotClass =
		side === "red"
			? "bg-red-500 ring-red-500/30"
			: "bg-slate-400 ring-slate-400/30";

	return (
		<div className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle/70 bg-surface/60 px-3 py-2 text-xs">
			<div className="flex min-w-0 items-center gap-2">
				<span
					aria-hidden="true"
					className={`size-2.5 shrink-0 rounded-full ring-2 ${dotClass}`}
				/>
				<span className="shrink-0 font-medium text-muted-foreground">
					{formatSideName(side, locale)}
				</span>
				{seat.handle ? (
					<Link
						to="/$locale/u/$handle"
						params={{ locale, handle: seat.handle }}
						data-testid={`replay-seat-link-${side}`}
						className="truncate font-semibold text-foreground underline-offset-4 hover:text-sit-ke-myin hover:underline"
					>
						{seat.displayName}
					</Link>
				) : (
					<span
						data-testid={`replay-seat-fallback-${side}`}
						className="truncate font-medium text-muted-foreground"
					>
						{seat.displayName}
					</span>
				)}
				{isWinner ? (
					<Trophy
						className="size-3.5 shrink-0 text-sit-ke-myin"
						aria-hidden="true"
					/>
				) : null}
			</div>

			{seat.ratingBefore !== null && seat.ratingAfter !== null ? (
				<div className="flex shrink-0 items-center gap-1.5 font-mono">
					<span className="text-muted-foreground">{seat.ratingAfter}</span>
					{seat.ratingDelta !== null ? (
						<span
							className={`font-semibold ${
								seat.ratingDelta > 0
									? "text-emerald-500"
									: seat.ratingDelta < 0
										? "text-rose-400"
										: "text-muted-foreground"
							}`}
						>
							({formatRatingDelta(seat.ratingDelta)})
						</span>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function MatchReplayPageView() {
	const { locale } = Route.useParams();
	const activeLocale: AppLocale = isAppLocale(locale) ? locale : "my";
	const search = Route.useSearch();
	const match = Route.useLoaderData();
	const router = useRouter();
	const [retrying, setRetrying] = useState(false);

	const handleRetry = async () => {
		if (retrying) return;
		setRetrying(true);
		try {
			await router.invalidate();
		} finally {
			setRetrying(false);
		}
	};

	if (!match) {
		return (
			<main className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-14 sm:px-6">
				<Card
					data-testid="match-replay-not-found"
					className="w-full border-border-subtle bg-card text-center"
				>
					<CardContent className="flex flex-col items-center gap-4 py-12">
						<div className="flex size-12 items-center justify-center rounded-full bg-surface-elevated text-muted-foreground">
							<FileX2 className="size-6" aria-hidden="true" />
						</div>
						<div className="flex flex-col gap-1.5">
							<h1 className="text-xl font-bold text-foreground">
								{m.match_replay_not_found_title({}, { locale: activeLocale })}
							</h1>
							<p className="max-w-md text-sm text-muted-foreground">
								{m.match_replay_not_found_desc({}, { locale: activeLocale })}
							</p>
						</div>
						<div className="mt-2 flex flex-wrap items-center justify-center gap-2">
							<Button
								type="button"
								variant="default"
								size="sm"
								data-testid="match-replay-retry-btn"
								disabled={retrying}
								onClick={() => {
									void handleRetry();
								}}
							>
								{retrying ? (
									<Loader2 className="mr-1.5 size-4 animate-spin" />
								) : (
									<RefreshCw data-icon="inline-start" />
								)}
								{m.match_replay_retry_btn({}, { locale: activeLocale })}
							</Button>
							<Button asChild variant="outline" size="sm">
								<Link
									to="/$locale/leaderboard"
									params={{ locale: activeLocale }}
								>
									<Trophy data-icon="inline-start" />
									{m.profile_back_to_leaderboard({}, { locale: activeLocale })}
								</Link>
							</Button>
						</div>
					</CardContent>
				</Card>
			</main>
		);
	}

	return (
		<LoadedMatchReplayView
			key={match.id}
			match={match}
			locale={activeLocale}
			requestedPly={search.ply}
		/>
	);
}

function LoadedMatchReplayView({
	match,
	locale,
	requestedPly,
}: {
	readonly match: MatchReplayPayload;
	readonly locale: AppLocale;
	readonly requestedPly: number | undefined;
}) {
	const session = useMemo(
		() => parseReplaySession(match.initialSetupFen, match.movesUci.join(" ")),
		[match.initialSetupFen, match.movesUci],
	);

	const initialPly = useMemo(
		() => clampReplayPly(requestedPly, session.snapshots.length),
		[requestedPly, session.snapshots.length],
	);

	const [activePly, setActivePly] = useState(initialPly);

	const handlePlyChange = useCallback((ply: number) => {
		setActivePly(ply);
		if (typeof window === "undefined") return;
		const url = new URL(window.location.href);
		url.searchParams.set("ply", String(ply));
		window.history.replaceState(
			window.history.state,
			"",
			`${url.pathname}${url.search}${url.hash}`,
		);
	}, []);

	const adapter = useMemo(
		() =>
			createReplayAdapter(session, locale, {
				players: {
					red: {
						side: "red",
						displayName: match.red.displayName,
						rating: match.red.ratingAfter ?? match.red.ratingBefore,
						connected: true,
						isLocal: false,
					},
					black: {
						side: "black",
						displayName: match.black.displayName,
						rating: match.black.ratingAfter ?? match.black.ratingBefore,
						connected: true,
						isLocal: false,
					},
				},
				outcomeOverride: matchReplayToExtendedOutcome(
					match.winnerSide,
					match.terminationReason,
				),
			}),
		[session, locale, match],
	);

	const tcLabel = formatTimeControlLabel(match.timeControl);

	const copyUrl = (withPly: boolean) => {
		const basePath = `/${locale}/match/${match.id}`;
		const suffix = withPly ? `?ply=${activePly}` : "";
		const url =
			typeof window !== "undefined"
				? `${window.location.origin}${basePath}${suffix}`
				: `${basePath}${suffix}`;
		void navigator.clipboard
			?.writeText(url)
			.then(() => {
				toast.success(
					withPly
						? m.match_replay_move_link_copied(
								{ ply: String(activePly) },
								{ locale },
							)
						: m.match_replay_link_copied({}, { locale }),
				);
			})
			.catch(() => {
				toast.info(url);
			});
	};

	const summaryCard = (
		<Card
			data-testid="match-replay-summary-card"
			className="border-border-subtle bg-card"
		>
			<CardHeader className="gap-2 pb-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<CardTitle className="text-sm font-bold">
						{m.match_replay_title({}, { locale })}
					</CardTitle>
					<div className="flex flex-wrap items-center gap-1.5">
						{match.mode === "private_room" ? (
							<Badge
								variant="secondary"
								data-testid="replay-private-badge"
								className="gap-1 text-[10px]"
							>
								<Lock className="size-2.5" aria-hidden="true" />
								{m.badge_private({}, { locale })}
							</Badge>
						) : null}
						<Badge
							variant={match.isRated ? "default" : "secondary"}
							className="text-[10px]"
						>
							{match.isRated
								? m.badge_rated({}, { locale })
								: m.badge_normal({}, { locale })}
						</Badge>
						<Badge variant="outline" className="gap-1 font-mono text-[10px]">
							<Clock className="size-2.5" aria-hidden="true" />
							{tcLabel}
						</Badge>
					</div>
				</div>
			</CardHeader>

			<CardContent className="flex flex-col gap-2.5">
				<SeatRow
					side="red"
					seat={match.red}
					locale={locale}
					isWinner={match.winnerSide === "red"}
				/>
				<SeatRow
					side="black"
					seat={match.black}
					locale={locale}
					isWinner={match.winnerSide === "black"}
				/>

				<div className="flex flex-wrap items-center gap-2 pt-1">
					<Button
						type="button"
						variant="secondary"
						size="xs"
						data-testid="copy-match-link-btn"
						onClick={() => copyUrl(false)}
						className="flex-1"
					>
						<Link2 data-icon="inline-start" />
						{m.match_replay_copy_link({}, { locale })}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="xs"
						data-testid="copy-move-link-btn"
						onClick={() => copyUrl(true)}
						className="flex-1"
					>
						<Copy data-icon="inline-start" />
						{m.match_replay_copy_move_link(
							{ ply: String(activePly) },
							{ locale },
						)}
					</Button>
				</div>
			</CardContent>
		</Card>
	);

	return (
		<SittuyinMatchWorkspace
			adapter={adapter}
			locale={locale}
			initialReplayPly={initialPly}
			onReplayPlyChange={handlePlyChange}
			railHeaderExtra={summaryCard}
		/>
	);
}

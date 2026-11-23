import { createFileRoute } from "@tanstack/react-router";
import { AlertCircle, FilePlay, Sparkles } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { SittuyinMatchWorkspace } from "@/components/sittuyin/SittuyinMatchWorkspace";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { type AppLocale, isAppLocale, m } from "@/i18n/locale";
import {
	createReplayAdapter,
	parseReplaySession,
	SAMPLE_REPLAY_FEN,
	SAMPLE_REPLAY_UCI_MOVES,
} from "@/lib/adapters/replay-adapter";

interface ReplaySearchParams {
	fen?: string;
	moves?: string;
}

function parseReplaySearch(
	search: Record<string, unknown>,
): ReplaySearchParams {
	return {
		fen: typeof search.fen === "string" ? search.fen : undefined,
		moves: typeof search.moves === "string" ? search.moves : undefined,
	};
}

export const Route = createFileRoute("/$locale/replay")({
	validateSearch: parseReplaySearch,
	component: ReplayPage,
});

function ReplayPage() {
	const { locale } = Route.useParams();
	const search = Route.useSearch();
	const activeLocale: AppLocale = isAppLocale(locale) ? locale : "my";

	const defaultFen = search.fen ?? SAMPLE_REPLAY_FEN;
	const defaultMoves = search.moves ?? SAMPLE_REPLAY_UCI_MOVES.join(" ");

	const [fenInput, setFenInput] = useState(defaultFen);
	const [uciInput, setUciInput] = useState(defaultMoves);
	const [session, setSession] = useState(() =>
		parseReplaySession(defaultFen, defaultMoves),
	);

	const adapter = useMemo(
		() => createReplayAdapter(session, activeLocale),
		[session, activeLocale],
	);

	const handleSubmit = (event: FormEvent) => {
		event.preventDefault();
		const next = parseReplaySession(fenInput, uciInput);
		setSession((prev) =>
			next.parseError !== null && prev.snapshots.length > 0
				? {
						...next,
						snapshots: prev.snapshots,
					}
				: next,
		);
	};

	const handleLoadSample = () => {
		const sampleMoves = SAMPLE_REPLAY_UCI_MOVES.join(" ");
		setFenInput(SAMPLE_REPLAY_FEN);
		setUciInput(sampleMoves);
		setSession(parseReplaySession(SAMPLE_REPLAY_FEN, sampleMoves));
	};

	const loaderPanel = (
		<Card className="border-border-subtle bg-card">
			<CardHeader className="gap-1 pb-3">
				<CardTitle className="text-base">
					{m.replay_page_title({}, { locale: activeLocale })}
				</CardTitle>
				<CardDescription className="text-xs">
					{m.replay_page_subtitle({}, { locale: activeLocale })}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form onSubmit={handleSubmit} className="flex flex-col gap-3">
					<FieldGroup className="gap-3">
						<Field>
							<FieldLabel htmlFor="replay-fen-input" className="text-xs">
								{m.replay_fen_label({}, { locale: activeLocale })}
							</FieldLabel>
							<Textarea
								id="replay-fen-input"
								data-testid="replay-fen-input"
								value={fenInput}
								onChange={(e) => setFenInput(e.target.value)}
								rows={2}
								className="font-mono text-xs"
							/>
						</Field>

						<Field>
							<FieldLabel htmlFor="replay-uci-input" className="text-xs">
								{m.replay_uci_label({}, { locale: activeLocale })}
							</FieldLabel>
							<Textarea
								id="replay-uci-input"
								data-testid="replay-uci-input"
								value={uciInput}
								onChange={(e) => setUciInput(e.target.value)}
								rows={3}
								className="font-mono text-xs"
							/>
						</Field>
					</FieldGroup>

					{session.parseError !== null ? (
						<Alert variant="destructive" data-testid="replay-error-alert">
							<AlertCircle className="size-4" />
							<AlertTitle className="text-xs font-semibold">
								{m.replay_error_title({}, { locale: activeLocale })}
							</AlertTitle>
							<AlertDescription className="text-xs">
								{session.parseError.ply !== undefined
									? m.replay_error_ply(
											{
												ply: String(session.parseError.ply),
												code: session.parseError.code,
												message: session.parseError.message,
											},
											{ locale: activeLocale },
										)
									: m.replay_error_generic(
											{
												code: session.parseError.code,
												message: session.parseError.message,
											},
											{ locale: activeLocale },
										)}
							</AlertDescription>
						</Alert>
					) : null}

					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="submit"
							size="sm"
							data-testid="replay-load-btn"
							className="flex-1"
						>
							<FilePlay data-icon="inline-start" />
							{m.replay_load_cta({}, { locale: activeLocale })}
						</Button>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							data-testid="replay-sample-btn"
							onClick={handleLoadSample}
						>
							<Sparkles data-icon="inline-start" />
							{m.replay_load_sample({}, { locale: activeLocale })}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);

	return (
		<SittuyinMatchWorkspace
			adapter={adapter}
			locale={activeLocale}
			initialReplayPly={0}
			railHeaderExtra={loaderPanel}
		/>
	);
}

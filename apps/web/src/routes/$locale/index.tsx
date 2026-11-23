import {
	applySetupAction,
	createGame,
	type PieceRole,
	SITTUYIN_PIECE_NAMES,
	toPlayerView,
} from "@sittuyin/engine";
import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, Crown, Layers, Play, Sparkles } from "lucide-react";
import { useMemo, useRef } from "react";
import { SittuyinBoard } from "@/components/sittuyin/SittuyinBoard";
import { SittuyinPieceSvg } from "@/components/sittuyin/SittuyinPieceSvg";
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
import { PIECE_SCRIPT_BADGES } from "@/lib/board-geometry";
import { useBoardPreferencesStore } from "@/stores/board-preferences";

export const Route = createFileRoute("/$locale/")({
	component: LandingHub,
});

const PIECE_ORDER: readonly PieceRole[] = [
	"king",
	"general",
	"rook",
	"elephant",
	"knight",
	"pawn",
];

function createHeroShowcaseView() {
	let state = createGame();
	const r1 = applySetupAction(state, "red", {
		kind: "apply_preset",
		presetId: "myin_cha",
	});
	if (r1.ok) state = r1.value;
	const r2 = applySetupAction(state, "red", { kind: "lock" });
	if (r2.ok) state = r2.value;
	const b1 = applySetupAction(state, "black", {
		kind: "apply_preset",
		presetId: "sin_cha",
	});
	if (b1.ok) state = b1.value;
	const b2 = applySetupAction(state, "black", { kind: "lock" });
	if (b2.ok) state = b2.value;
	return toPlayerView(state, "spectator");
}

function LandingHub() {
	const { locale } = Route.useParams();
	const activeLocale: AppLocale = isAppLocale(locale) ? locale : "my";
	const pieceScriptOverlay = useBoardPreferencesStore(
		(s) => s.pieceScriptOverlay,
	);
	const heroView = useMemo(() => createHeroShowcaseView(), []);
	const dummyRef = useRef<HTMLDivElement | null>(null);

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-8 sm:px-6 lg:py-12">
			{/* Hero Section */}
			<section className="grid items-center gap-8 lg:grid-cols-[1.1fr_0.9fr]">
				<div className="flex flex-col gap-5">
					<Badge variant="secondary" className="w-fit gap-1.5 px-3 py-1">
						<Crown className="size-3.5 text-sit-ke-myin" />
						<span>{m.landing_eyebrow({}, { locale: activeLocale })}</span>
					</Badge>

					<h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl">
						{m.landing_headline({}, { locale: activeLocale })}
					</h1>

					<p className="max-w-xl text-base text-muted-foreground">
						{m.landing_description({}, { locale: activeLocale })}
					</p>

					<div className="flex flex-wrap items-center gap-3 pt-1">
						<Button asChild size="lg">
							<Link to="/$locale/play" params={{ locale: activeLocale }}>
								<Play data-icon="inline-start" />
								{m.landing_cta_play({}, { locale: activeLocale })}
							</Link>
						</Button>

						<Button asChild variant="secondary" size="lg">
							<Link
								to="/$locale/play"
								params={{ locale: activeLocale }}
								search={{ mode: "sandbox" }}
							>
								<Layers data-icon="inline-start" />
								{m.landing_cta_sandbox({}, { locale: activeLocale })}
							</Link>
						</Button>

						<Button asChild variant="outline" size="lg">
							<Link to="/$locale/replay" params={{ locale: activeLocale }}>
								<BookOpen data-icon="inline-start" />
								{m.landing_cta_replay({}, { locale: activeLocale })}
							</Link>
						</Button>
					</div>
				</div>

				{/* Live Preview of the Uncheckered Teak Sittuyin Board */}
				<div className="mx-auto w-full max-w-md lg:max-w-lg">
					<div className="pointer-events-none">
						<SittuyinBoard
							view={heroView}
							flipped={false}
							locale={activeLocale}
							interactive={false}
							showCoordinates={true}
							showLegalHints={false}
							highlightSitKeMyin={true}
							pieceScriptOverlay={pieceScriptOverlay}
							animationSpeed="none"
							selectedSquare={null}
							focusedSquare="e4"
							legalMovesForSelection={[]}
							legalSetupSquares={[]}
							checkingSquares={[]}
							checkedKingSquare={null}
							lastMoveSquares={null}
							shakeSquare={null}
							pendingPromotion={null}
							externalDragGhost={null}
							externalHoverSquare={null}
							boardContainerRef={dummyRef}
							onFocusSquare={() => {}}
							onSquareActivate={() => {}}
							onBoardPieceDrop={() => {}}
							onCancelInteraction={() => {}}
							onCommitPromotion={() => {}}
							onCancelPromotion={() => {}}
						/>
					</div>
				</div>
			</section>

			{/* Three Core Pillar Cards */}
			<section className="grid gap-4 md:grid-cols-3">
				<Card className="border-border-subtle bg-card">
					<CardHeader className="gap-1.5">
						<CardTitle className="flex items-center gap-2 text-base">
							<Layers className="size-4 text-sit-ke-myin" />
							{m.landing_feature_setup_title({}, { locale: activeLocale })}
						</CardTitle>
						<CardDescription>
							{m.landing_feature_setup_body({}, { locale: activeLocale })}
						</CardDescription>
					</CardHeader>
				</Card>

				<Card className="border-border-subtle bg-card">
					<CardHeader className="gap-1.5">
						<CardTitle className="flex items-center gap-2 text-base">
							<Sparkles className="size-4 text-sit-ke-myin" />
							{m.landing_feature_sitkemyin_title({}, { locale: activeLocale })}
						</CardTitle>
						<CardDescription>
							{m.landing_feature_sitkemyin_body({}, { locale: activeLocale })}
						</CardDescription>
					</CardHeader>
				</Card>

				<Card className="border-border-subtle bg-card">
					<CardHeader className="gap-1.5">
						<CardTitle className="flex items-center gap-2 text-base">
							<BookOpen className="size-4 text-sit-ke-myin" />
							{m.landing_feature_replay_title({}, { locale: activeLocale })}
						</CardTitle>
						<CardDescription>
							{m.landing_feature_replay_body({}, { locale: activeLocale })}
						</CardDescription>
					</CardHeader>
				</Card>
			</section>

			{/* Six Carved Burmese Pieces Reference Grid */}
			<section className="flex flex-col gap-4">
				<div className="flex flex-col gap-1">
					<h2 className="text-xl font-bold text-foreground">
						{m.landing_pieces_heading({}, { locale: activeLocale })}
					</h2>
					<p className="text-sm text-muted-foreground">
						{m.landing_pieces_subheading({}, { locale: activeLocale })}
					</p>
				</div>

				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
					{PIECE_ORDER.map((role) => {
						const info = SITTUYIN_PIECE_NAMES[role];
						return (
							<Card
								key={role}
								className="border-border-subtle bg-card/90 transition-colors hover:border-sit-ke-myin/60"
							>
								<CardContent className="flex flex-col items-center gap-2.5 p-4 text-center">
									<div className="flex items-center justify-center gap-1.5">
										<SittuyinPieceSvg
											pieceRole={role}
											side="red"
											showScript={true}
											className="size-12"
										/>
										<SittuyinPieceSvg
											pieceRole={role}
											side="black"
											showScript={true}
											className="size-12"
										/>
									</div>
									<div className="flex flex-col gap-0.5">
										<span className="myanmar-text text-sm font-semibold text-foreground">
											{info.myanmar} ({PIECE_SCRIPT_BADGES[role]})
										</span>
										<span className="text-xs text-muted-foreground">
											{info.romanized} · {info.english}
										</span>
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			</section>
		</div>
	);
}

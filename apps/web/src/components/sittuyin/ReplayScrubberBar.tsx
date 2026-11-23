import {
	ChevronLeft,
	ChevronRight,
	ChevronsLeft,
	ChevronsRight,
	Pause,
	Play,
	Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type AppLocale, m } from "@/i18n/locale";

export type AutoPlaySpeed = 0.5 | 1 | 2;

export interface ReplayScrubberBarProps {
	readonly currentPly: number;
	readonly totalPlies: number;
	readonly isScrubbingLiveMatch: boolean;
	readonly unseenPlies: number;
	readonly isAutoPlaying: boolean;
	readonly autoPlaySpeed: AutoPlaySpeed;
	readonly locale: AppLocale;
	readonly onFirst: () => void;
	readonly onPrev: () => void;
	readonly onNext: () => void;
	readonly onLast: () => void;
	readonly onToggleAutoPlay: () => void;
	readonly onChangeSpeed: (speed: AutoPlaySpeed) => void;
	readonly onBackToLive: () => void;
}

export function ReplayScrubberBar({
	currentPly,
	totalPlies,
	isScrubbingLiveMatch,
	unseenPlies,
	isAutoPlaying,
	autoPlaySpeed,
	locale,
	onFirst,
	onPrev,
	onNext,
	onLast,
	onToggleAutoPlay,
	onChangeSpeed,
	onBackToLive,
}: ReplayScrubberBarProps) {
	const atStart = currentPly <= 0;
	const atEnd = currentPly >= totalPlies;

	return (
		<div
			data-testid="replay-scrubber"
			className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface-elevated/60 p-2.5"
		>
			{isScrubbingLiveMatch ? (
				<div className="flex items-center justify-between gap-2 rounded-lg border border-sit-ke-myin/60 bg-table/70 px-2.5 py-1.5">
					<span className="text-xs text-muted-foreground">
						{m.scrubber_readonly_banner({}, { locale })}
					</span>
					<Button
						type="button"
						size="xs"
						data-testid="back-to-live-pill"
						onClick={onBackToLive}
						className={
							unseenPlies > 0 ? "sittuyin-live-pill-pulse shrink-0" : "shrink-0"
						}
					>
						<Radio data-icon="inline-start" />
						{unseenPlies > 0
							? m.scrubber_back_to_live_unseen(
									{ count: String(unseenPlies) },
									{ locale },
								)
							: m.scrubber_back_to_live({}, { locale })}
					</Button>
				</div>
			) : null}

			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex items-center gap-1">
					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						disabled={atStart}
						data-testid="scrubber-first"
						aria-label={m.scrubber_first({}, { locale })}
						onClick={onFirst}
					>
						<ChevronsLeft />
					</Button>
					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						disabled={atStart}
						data-testid="scrubber-prev"
						aria-label={m.scrubber_prev({}, { locale })}
						onClick={onPrev}
					>
						<ChevronLeft />
					</Button>
					<Button
						type="button"
						variant={isAutoPlaying ? "default" : "secondary"}
						size="icon-sm"
						disabled={totalPlies === 0}
						data-testid="scrubber-play-pause"
						aria-label={
							isAutoPlaying
								? m.scrubber_pause({}, { locale })
								: m.scrubber_play({}, { locale })
						}
						onClick={onToggleAutoPlay}
					>
						{isAutoPlaying ? <Pause /> : <Play />}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						disabled={atEnd}
						data-testid="scrubber-next"
						aria-label={m.scrubber_next({}, { locale })}
						onClick={onNext}
					>
						<ChevronRight />
					</Button>
					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						disabled={atEnd}
						data-testid="scrubber-last"
						aria-label={m.scrubber_last({}, { locale })}
						onClick={onLast}
					>
						<ChevronsRight />
					</Button>
				</div>

				<div className="flex items-center gap-2">
					<span
						data-testid="scrubber-ply-status"
						className="text-xs font-medium text-muted-foreground tabular-nums"
					>
						{m.scrubber_ply_status(
							{ current: String(currentPly), total: String(totalPlies) },
							{ locale },
						)}
					</span>
					<ToggleGroup
						type="single"
						size="sm"
						value={String(autoPlaySpeed)}
						onValueChange={(val) => {
							if (val === "0.5") onChangeSpeed(0.5);
							else if (val === "1") onChangeSpeed(1);
							else if (val === "2") onChangeSpeed(2);
						}}
						aria-label="Replay speed"
					>
						<ToggleGroupItem value="0.5" className="px-2 text-xs">
							0.5x
						</ToggleGroupItem>
						<ToggleGroupItem value="1" className="px-2 text-xs">
							1x
						</ToggleGroupItem>
						<ToggleGroupItem value="2" className="px-2 text-xs">
							2x
						</ToggleGroupItem>
					</ToggleGroup>
				</div>
			</div>
		</div>
	);
}

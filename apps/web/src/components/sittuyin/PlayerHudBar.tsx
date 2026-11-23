import { oppositeSide, type PieceRole, type Side } from "@sittuyin/engine";
import { AlertTriangle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { type AppLocale, m } from "@/i18n/locale";
import type { MatchClockState, MatchPlayerHud } from "@/lib/adapters/types";
import { sortCapturedPieces } from "@/lib/board-geometry";
import { cn } from "@/lib/utils";
import { SittuyinPieceSvg } from "./SittuyinPieceSvg";

export interface PlayerHudBarProps {
	readonly player: MatchPlayerHud;
	readonly locale: AppLocale;
	readonly isActiveTurn: boolean;
	readonly inCheck: boolean;
	readonly capturedPieces: readonly PieceRole[];
	readonly materialAdvantage: number;
	readonly clock: MatchClockState | null;
	readonly showScript: boolean;
}

export function formatClockMs(ms: number): string {
	const clamped = Math.max(0, ms);
	if (clamped < 10_000) {
		const seconds = Math.floor(clamped / 1000);
		const tenths = Math.floor((clamped % 1000) / 100);
		return `00:0${seconds}.${tenths}`;
	}
	const totalSeconds = Math.ceil(clamped / 1000);
	const mins = Math.floor(totalSeconds / 60);
	const secs = totalSeconds % 60;
	return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function PlayerHudBar({
	player,
	locale,
	isActiveTurn,
	inCheck,
	capturedPieces,
	materialAdvantage,
	clock,
	showScript,
}: PlayerHudBarProps) {
	const side: Side = player.side;
	const capturedPieceSide: Side = oppositeSide(side);
	const capturedWithKey = (() => {
		const counts: Partial<Record<PieceRole, number>> = {};
		return sortCapturedPieces(capturedPieces).map((pieceRole) => {
			const nextCount = (counts[pieceRole] ?? 0) + 1;
			counts[pieceRole] = nextCount;
			return { pieceRole, key: `${pieceRole}-${nextCount}` };
		});
	})();

	const remainingMs = clock !== null ? clock.remainingMs[side] : null;
	const isClockActive = clock !== null && clock.activeSide === side;
	const isLow =
		clock !== null &&
		remainingMs !== null &&
		remainingMs <= clock.lowTimeThresholdMs &&
		remainingMs > clock.criticalTimeThresholdMs;
	const isCritical =
		clock !== null &&
		remainingMs !== null &&
		remainingMs <= clock.criticalTimeThresholdMs;

	return (
		<div
			data-testid={`player-hud-${side}`}
			data-active-turn={isActiveTurn ? "true" : "false"}
			className={cn(
				"flex items-center justify-between gap-2 rounded-xl border px-3 py-2 transition-colors",
				isActiveTurn
					? "border-sit-ke-myin/80 bg-surface-elevated shadow-sm"
					: "border-border-subtle bg-card/90",
			)}
		>
			{/* Identity + captured pieces */}
			<div className="flex min-w-0 flex-1 items-center gap-2.5">
				<div className="relative shrink-0">
					<SittuyinPieceSvg
						pieceRole="king"
						side={side}
						showScript={false}
						className="size-9"
					/>
					{isActiveTurn ? (
						<span
							aria-hidden="true"
							className="absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full bg-sit-ke-myin ring-2 ring-card"
						/>
					) : null}
				</div>

				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
					<div className="flex items-center gap-1.5">
						<span className="truncate text-sm font-semibold text-foreground">
							{player.displayName}
						</span>
						{player.rating !== null ? (
							<span className="text-xs text-muted-foreground tabular-nums">
								({player.rating})
							</span>
						) : null}
						{inCheck ? (
							<Badge
								variant="destructive"
								data-testid={`check-badge-${side}`}
								className="h-5 gap-1 px-1.5 text-[10px]"
							>
								<AlertTriangle className="size-3" />
								{m.check_badge({}, { locale })}
							</Badge>
						) : null}
					</div>

					{/* Captured pieces tray + material delta */}
					<div
						data-testid={`captured-tray-${side}`}
						className="flex min-h-5 flex-wrap items-center gap-0.5"
					>
						{capturedWithKey.map((item) => (
							<SittuyinPieceSvg
								key={item.key}
								pieceRole={item.pieceRole}
								side={capturedPieceSide}
								showScript={showScript}
								className="size-5 shrink-0"
							/>
						))}
						{materialAdvantage > 0 ? (
							<Badge
								variant="secondary"
								data-testid={`material-advantage-${side}`}
								className="ml-1 h-5 px-1.5 text-[11px] font-semibold tabular-nums"
							>
								+{materialAdvantage}
							</Badge>
						) : null}
					</div>
				</div>
			</div>

			{/* Digital clock */}
			<div className="shrink-0">
				{clock !== null && remainingMs !== null ? (
					<div
						data-testid={`clock-${side}`}
						data-clock-state={
							isCritical ? "critical" : isLow ? "low" : "normal"
						}
						className={cn(
							"flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-sm font-bold tabular-nums transition-colors sm:text-base",
							isCritical
								? "border-clock-critical bg-clock-critical/20 text-foreground"
								: isLow
									? "border-clock-low bg-clock-low/20 text-foreground"
									: isClockActive
										? "border-sit-ke-myin/70 bg-table text-foreground"
										: "border-border-subtle bg-table/60 text-muted-foreground",
						)}
					>
						<Clock className="size-3.5 opacity-80" aria-hidden="true" />
						<span>{formatClockMs(remainingMs)}</span>
					</div>
				) : (
					<span className="rounded-lg border border-border-subtle bg-table/50 px-2.5 py-1 text-xs font-medium text-muted-foreground">
						{m.clock_untimed({}, { locale })}
					</span>
				)}
			</div>
		</div>
	);
}

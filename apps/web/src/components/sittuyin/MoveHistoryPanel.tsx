import { formatMoveDisplay, type MoveRecord } from "@sittuyin/engine";
import { useEffect, useRef } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type AppLocale, m } from "@/i18n/locale";
import { cn } from "@/lib/utils";

export interface MoveHistoryPanelProps {
	readonly moveHistory: readonly MoveRecord[];
	readonly activePly: number;
	readonly locale: AppLocale;
	readonly onSelectPly: (ply: number) => void;
}

interface PairedRow {
	readonly moveNumber: number;
	readonly red?: MoveRecord;
	readonly black?: MoveRecord;
}

export function MoveHistoryPanel({
	moveHistory,
	activePly,
	locale,
	onSelectPly,
}: MoveHistoryPanelProps) {
	const activeRowRef = useRef<HTMLButtonElement | null>(null);

	useEffect(() => {
		if (
			activePly >= 0 &&
			moveHistory.length > 0 &&
			activeRowRef.current !== null &&
			typeof activeRowRef.current.scrollIntoView === "function"
		) {
			activeRowRef.current.scrollIntoView({
				block: "nearest",
				behavior: "smooth",
			});
		}
	}, [activePly, moveHistory.length]);

	const rows: PairedRow[] = [];
	for (let i = 0; i < moveHistory.length; i += 2) {
		rows.push({
			moveNumber: Math.floor(i / 2) + 1,
			red: moveHistory[i],
			black: moveHistory[i + 1],
		});
	}

	if (rows.length === 0) {
		return (
			<div
				data-testid="move-history-empty"
				className="flex min-h-36 items-center justify-center rounded-xl border border-dashed border-border-subtle bg-surface-elevated/30 p-4 text-center text-xs text-muted-foreground"
			>
				{m.history_empty({}, { locale })}
			</div>
		);
	}

	return (
		<ScrollArea className="h-56 rounded-xl border border-border-subtle bg-table/50 lg:h-72">
			<table
				data-testid="move-history-table"
				className="w-full border-collapse text-left text-sm"
			>
				<thead className="sticky top-0 z-10 border-b border-border-subtle bg-surface text-xs text-muted-foreground">
					<tr>
						<th scope="col" className="w-10 px-2.5 py-2 font-medium">
							{m.history_move_col({}, { locale })}
						</th>
						<th scope="col" className="px-2.5 py-2 font-medium">
							{m.history_red_col({}, { locale })}
						</th>
						<th scope="col" className="px-2.5 py-2 font-medium">
							{m.history_black_col({}, { locale })}
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => (
						<tr
							key={row.moveNumber}
							className="border-b border-border-subtle/50 last:border-b-0"
						>
							<td className="px-2.5 py-1.5 font-mono text-xs text-muted-foreground tabular-nums">
								{row.moveNumber}.
							</td>
							<td className="px-1.5 py-1">
								{row.red ? (
									<button
										ref={row.red.ply === activePly ? activeRowRef : undefined}
										type="button"
										data-testid={`ply-btn-${row.red.ply}`}
										aria-current={
											row.red.ply === activePly ? "step" : undefined
										}
										onClick={() => onSelectPly(row.red?.ply ?? 0)}
										className={cn(
											"w-full rounded-md px-2 py-1 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
											locale === "my" && "myanmar-text",
											row.red.ply === activePly
												? "bg-primary text-primary-foreground"
												: "text-foreground hover:bg-surface-elevated",
										)}
									>
										{formatMoveDisplay(row.red, locale)}
									</button>
								) : null}
							</td>
							<td className="px-1.5 py-1">
								{row.black ? (
									<button
										ref={row.black.ply === activePly ? activeRowRef : undefined}
										type="button"
										data-testid={`ply-btn-${row.black.ply}`}
										aria-current={
											row.black.ply === activePly ? "step" : undefined
										}
										onClick={() => onSelectPly(row.black?.ply ?? 0)}
										className={cn(
											"w-full rounded-md px-2 py-1 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
											locale === "my" && "myanmar-text",
											row.black.ply === activePly
												? "bg-primary text-primary-foreground"
												: "text-foreground hover:bg-surface-elevated",
										)}
									>
										{formatMoveDisplay(row.black, locale)}
									</button>
								) : null}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</ScrollArea>
	);
}

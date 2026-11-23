import type { PromoteMove, Side, Square } from "@sittuyin/engine";
import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { type AppLocale, m } from "@/i18n/locale";
import { BOARD_VIEWBOX_SIZE, squareToSvgRect } from "@/lib/board-geometry";
import { SittuyinPieceSvg } from "./SittuyinPieceSvg";

export interface PendingPromotionState {
	readonly from: Square;
	readonly preferredTarget: Square | null;
	readonly side: Side;
	readonly options: readonly PromoteMove[];
}

export interface PromotionOverlayProps {
	readonly pending: PendingPromotionState;
	readonly flipped: boolean;
	readonly locale: AppLocale;
	readonly showScript: boolean;
	readonly onCommit: (move: PromoteMove) => void;
	readonly onCancel: () => void;
}

export function PromotionOverlay({
	pending,
	flipped,
	locale,
	showScript,
	onCommit,
	onCancel,
}: PromotionOverlayProps) {
	const firstBtnRef = useRef<HTMLButtonElement | null>(null);
	const panelRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (
			pending.from &&
			(pending.preferredTarget === null || pending.preferredTarget)
		) {
			firstBtnRef.current?.focus();
		}
	}, [pending.from, pending.preferredTarget]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onCancel();
			}
		};
		const handlePointerDown = (event: PointerEvent) => {
			if (
				panelRef.current !== null &&
				event.target instanceof Node &&
				!panelRef.current.contains(event.target)
			) {
				onCancel();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("pointerdown", handlePointerDown);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("pointerdown", handlePointerDown);
		};
	}, [onCancel]);

	const anchorSquare = pending.preferredTarget ?? pending.from;
	const rect = squareToSvgRect(anchorSquare, flipped);
	const leftPct = Math.max(
		18,
		Math.min(82, (rect.cx / BOARD_VIEWBOX_SIZE) * 100),
	);
	const placeAbove = rect.row >= 4;
	const topPct = placeAbove
		? Math.max(14, (rect.y / BOARD_VIEWBOX_SIZE) * 100 - 2)
		: Math.min(86, ((rect.y + 100) / BOARD_VIEWBOX_SIZE) * 100 + 2);

	// Order preferred target first so keyboard Enter commits the clicked option immediately
	const orderedOptions = [...pending.options].sort((a, b) => {
		if (pending.preferredTarget !== null) {
			if (a.to === pending.preferredTarget) return -1;
			if (b.to === pending.preferredTarget) return 1;
		}
		if (a.from === a.to) return -1;
		if (b.from === b.to) return 1;
		return a.to.localeCompare(b.to);
	});

	return (
		<div
			ref={panelRef}
			role="dialog"
			aria-modal="true"
			aria-labelledby="sittuyin-promote-title"
			aria-describedby="sittuyin-promote-desc"
			style={{
				left: `${leftPct}%`,
				top: `${topPct}%`,
				transform: placeAbove ? "translate(-50%, -100%)" : "translate(-50%, 0)",
			}}
			className="absolute z-30 w-64 max-w-[92%] rounded-xl border border-sit-ke-myin/70 bg-popover/98 p-3 text-popover-foreground shadow-2xl backdrop-blur-sm"
		>
			<div className="flex items-start justify-between gap-2">
				<div className="flex items-center gap-2">
					<SittuyinPieceSvg
						pieceRole="general"
						side={pending.side}
						showScript={showScript}
						className="size-9 shrink-0"
					/>
					<div className="flex flex-col">
						<h3
							id="sittuyin-promote-title"
							className="text-sm font-semibold text-foreground"
						>
							{m.promote_title({}, { locale })}
						</h3>
						<p
							id="sittuyin-promote-desc"
							className="text-xs text-muted-foreground"
						>
							{m.promote_description({}, { locale })}
						</p>
					</div>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					onClick={onCancel}
					aria-label={m.promote_cancel({}, { locale })}
				>
					<X />
				</Button>
			</div>

			<div className="mt-3 flex flex-col gap-1.5">
				{orderedOptions.map((option, index) => {
					const isInPlace = option.from === option.to;
					const isPreferred =
						pending.preferredTarget !== null &&
						option.to === pending.preferredTarget;
					const label = isInPlace
						? m.promote_in_place({ square: option.to }, { locale })
						: m.promote_diagonal({ square: option.to }, { locale });
					return (
						<Button
							key={`${option.from}-${option.to}`}
							ref={index === 0 ? firstBtnRef : undefined}
							type="button"
							variant={isPreferred || index === 0 ? "default" : "secondary"}
							size="sm"
							className="w-full justify-between text-left"
							onClick={() => onCommit(option)}
						>
							<span className="truncate">{label}</span>
							<span className="font-mono text-xs opacity-80">
								{isInPlace ? `${option.from}=G` : `${option.from}→${option.to}`}
							</span>
						</Button>
					);
				})}
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="w-full text-muted-foreground"
					onClick={onCancel}
				>
					{m.promote_cancel({}, { locale })}
				</Button>
			</div>
		</div>
	);
}

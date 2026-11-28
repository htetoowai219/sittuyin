import {
	getPresetPlacements,
	INITIAL_PAWN_SQUARES,
	OFFICER_ROLES,
	type OfficerRole,
	OPENING_PRESETS,
	type OpeningPreset,
	type OpeningPresetId,
	oppositeSide,
	type PlayerGameView,
	remainingHandTotal,
	type SetupAction,
	type Side,
	type Square,
	squareToCoords,
} from "@sittuyin/engine";
import {
	BookOpen,
	CheckCircle2,
	Clock,
	Eye,
	Lock,
	Shuffle,
	Trash2,
	Unlock,
} from "lucide-react";
import {
	type PointerEvent as ReactPointerEvent,
	type RefObject,
	useCallback,
	useMemo,
	useRef,
} from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
	type AppLocale,
	formatPieceName,
	formatSideName,
	m,
} from "@/i18n/locale";
import { clientPointToSquare } from "@/lib/board-geometry";
import { cn } from "@/lib/utils";
import type { BoardDragGhost } from "./SittuyinBoard";
import { SittuyinPieceSvg } from "./SittuyinPieceSvg";

const DRAG_THRESHOLD_PX = 6;
const TOUCH_VERTICAL_LIFT_PX = 44;

function PresetMiniBoard({
	preset,
	side,
}: {
	readonly preset: OpeningPreset;
	readonly side: Side;
}) {
	const placements = useMemo(() => {
		const res = getPresetPlacements(preset.id, side);
		return res.ok ? res.value : {};
	}, [preset.id, side]);

	const flipped = side === "black";

	const toCell = (sq: Square) => {
		const { file, rank } = squareToCoords(sq);
		const col = flipped ? 7 - file : file;
		const row = flipped ? rank : 7 - rank;
		return { x: col * 10, y: row * 10 };
	};

	const pieceColor =
		side === "red" ? "var(--piece-red-fill)" : "var(--piece-black-fill)";
	const pieceAccent =
		side === "red" ? "var(--piece-red-accent)" : "var(--piece-black-accent)";

	return (
		<svg
			viewBox="0 0 80 80"
			className="size-14 shrink-0 rounded-md border border-teak-grid/70 bg-teak-base"
			aria-hidden="true"
		>
			{/* Grid */}
			{Array.from({ length: 7 }, (_, i) => {
				const p = (i + 1) * 10;
				return (
					<g
						key={p}
						stroke="var(--board-grid-line)"
						strokeWidth="0.6"
						opacity="0.55"
					>
						<line x1={p} y1="0" x2={p} y2="80" />
						<line x1="0" y1={p} x2="80" y2={p} />
					</g>
				);
			})}
			{/* Sit ke myin mini X */}
			<line
				x1="0"
				y1="0"
				x2="80"
				y2="80"
				stroke="var(--board-sit-ke-myin)"
				strokeWidth="0.9"
				opacity="0.7"
			/>
			<line
				x1="80"
				y1="0"
				x2="0"
				y2="80"
				stroke="var(--board-sit-ke-myin)"
				strokeWidth="0.9"
				opacity="0.7"
			/>
			{/* Viewer's pawns */}
			{INITIAL_PAWN_SQUARES[side].map((sq) => {
				const c = toCell(sq);
				return (
					<circle
						key={`p-${sq}`}
						cx={c.x + 5}
						cy={c.y + 5}
						r="2.4"
						fill={pieceColor}
						opacity="0.72"
					/>
				);
			})}
			{/* Preset officers */}
			{(Object.entries(placements) as [Square, OfficerRole | undefined][]).map(
				([sq, role]) => {
					if (role === undefined) return null;
					const c = toCell(sq);
					return (
						<circle
							key={`o-${sq}`}
							cx={c.x + 5}
							cy={c.y + 5}
							r="3.6"
							fill={pieceColor}
							stroke={pieceAccent}
							strokeWidth="1.2"
						/>
					);
				},
			)}
		</svg>
	);
}

export interface SetupTrayProps {
	readonly view: PlayerGameView;
	readonly locale: AppLocale;
	readonly flipped: boolean;
	readonly showScript: boolean;
	readonly selectedHandRole: OfficerRole | null;
	readonly isSandbox: boolean;
	readonly setupRemainingMs?: number | null;
	readonly boardContainerRef: RefObject<HTMLDivElement | null>;
	readonly onSelectHandRole: (role: OfficerRole | null) => void;
	readonly onDispatchSetup: (action: SetupAction) => void;
	readonly onApplyRandomSetup: () => void;
	readonly onSwitchSandboxViewer?: (side: Side) => void;
	readonly onHandDragChange: (
		ghost: BoardDragGhost | null,
		hoverSquare: Square | null,
		draggingRole: OfficerRole | null,
	) => void;
	readonly onHandDropOnBoard: (role: OfficerRole, square: Square) => void;
}

export function SetupTray({
	view,
	locale,
	flipped,
	showScript,
	selectedHandRole,
	isSandbox,
	setupRemainingMs,
	boardContainerRef,
	onSelectHandRole,
	onDispatchSetup,
	onApplyRandomSetup,
	onSwitchSandboxViewer,
	onHandDragChange,
	onHandDropOnBoard,
}: SetupTrayProps) {
	const dragRef = useRef<{
		pointerId: number;
		role: OfficerRole;
		startX: number;
		startY: number;
		isTouch: boolean;
		isDragging: boolean;
	} | null>(null);

	const viewer: Side = view.viewer === "black" ? "black" : "red";
	const opponent: Side = oppositeSide(viewer);
	const myHand = view.hands[viewer];
	const remaining = remainingHandTotal(myHand);
	const placedCount = 8 - remaining;
	const isLocked = view.setupReady[viewer];
	const opponentPlaced = view.placedCounts[opponent];
	const opponentReady = view.setupReady[opponent];

	const resolveBoardSquare = useCallback(
		(clientX: number, clientY: number, isTouch: boolean): Square | null => {
			const el = boardContainerRef.current;
			if (el === null) return null;
			const rect = el.getBoundingClientRect();
			const effectiveY = isTouch ? clientY - TOUCH_VERTICAL_LIFT_PX : clientY;
			return clientPointToSquare(rect, clientX, effectiveY, flipped);
		},
		[boardContainerRef, flipped],
	);

	const handleHandPointerDown = useCallback(
		(role: OfficerRole, event: ReactPointerEvent<HTMLButtonElement>) => {
			if (isLocked || myHand[role] <= 0 || event.button === 2) {
				return;
			}
			try {
				event.currentTarget.setPointerCapture(event.pointerId);
			} catch {
				// Ignore
			}
			dragRef.current = {
				pointerId: event.pointerId,
				role,
				startX: event.clientX,
				startY: event.clientY,
				isTouch: event.pointerType === "touch",
				isDragging: false,
			};
		},
		[isLocked, myHand],
	);

	const handleHandPointerMove = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>) => {
			const curr = dragRef.current;
			if (curr === null || curr.pointerId !== event.pointerId) {
				return;
			}
			const moved =
				curr.isDragging ||
				Math.hypot(event.clientX - curr.startX, event.clientY - curr.startY) >
					DRAG_THRESHOLD_PX;
			if (!moved) return;
			curr.isDragging = true;
			const hoverSquare = resolveBoardSquare(
				event.clientX,
				event.clientY,
				curr.isTouch,
			);
			onHandDragChange(
				{
					role: curr.role,
					side: viewer,
					clientX: event.clientX,
					clientY: event.clientY,
					isTouch: curr.isTouch,
					fromSquare: null,
				},
				hoverSquare,
				curr.role,
			);
		},
		[onHandDragChange, resolveBoardSquare, viewer],
	);

	const handleHandPointerUp = useCallback(
		(event: ReactPointerEvent<HTMLButtonElement>) => {
			const curr = dragRef.current;
			if (curr === null || curr.pointerId !== event.pointerId) {
				return;
			}
			try {
				if (event.currentTarget.hasPointerCapture(event.pointerId)) {
					event.currentTarget.releasePointerCapture(event.pointerId);
				}
			} catch {
				// Ignore
			}
			dragRef.current = null;
			onHandDragChange(null, null, null);

			if (curr.isDragging) {
				const dropSquare = resolveBoardSquare(
					event.clientX,
					event.clientY,
					curr.isTouch,
				);
				if (dropSquare !== null) {
					onHandDropOnBoard(curr.role, dropSquare);
				}
			}
		},
		[onHandDragChange, onHandDropOnBoard, resolveBoardSquare],
	);

	const handleHandPointerCancel = useCallback(() => {
		dragRef.current = null;
		onHandDragChange(null, null, null);
	}, [onHandDragChange]);

	const handlePresetPick = useCallback(
		(presetId: OpeningPresetId) => {
			onSelectHandRole(null);
			onDispatchSetup({ kind: "apply_preset", presetId });
		},
		[onDispatchSetup, onSelectHandRole],
	);

	const presetListContent = (
		<div className="flex flex-col gap-2">
			{OPENING_PRESETS.map((preset) => (
				<button
					key={preset.id}
					type="button"
					disabled={isLocked}
					data-testid={`preset-${preset.id}`}
					onClick={() => handlePresetPick(preset.id)}
					className={cn(
						"flex items-center gap-3 rounded-xl border border-border-subtle bg-surface-elevated/60 p-2.5 text-left transition-colors hover:border-sit-ke-myin/70 hover:bg-surface-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
					)}
				>
					<PresetMiniBoard preset={preset} side={viewer} />
					<div className="flex min-w-0 flex-1 flex-col gap-0.5">
						<div className="flex items-center justify-between gap-2">
							<span className="truncate text-sm font-semibold text-foreground">
								{locale === "my" ? preset.name.myanmar : preset.name.english}
							</span>
							<span className="shrink-0 text-[11px] text-muted-foreground">
								{locale === "my" ? preset.name.english : preset.name.romanized}
							</span>
						</div>
						<p className="line-clamp-2 text-xs text-muted-foreground">
							{locale === "my"
								? preset.description.myanmar
								: preset.description.english}
						</p>
					</div>
				</button>
			))}
		</div>
	);

	const setupCountdownSeconds =
		typeof setupRemainingMs === "number"
			? Math.max(0, Math.ceil(setupRemainingMs / 1000))
			: null;
	const isSetupTimeWarning =
		typeof setupRemainingMs === "number" && setupRemainingMs <= 15_000;

	if (view.viewer === "spectator") {
		return (
			<Card
				data-testid="spectator-setup-tray"
				className="border-border-subtle bg-card"
			>
				<CardHeader className="gap-2 pb-3">
					<div className="flex flex-wrap items-center justify-between gap-2">
						<CardTitle className="text-base font-semibold">
							{m.online_spectator_setup_title({}, { locale })}
						</CardTitle>
						{setupCountdownSeconds !== null ? (
							<Badge
								variant={isSetupTimeWarning ? "destructive" : "secondary"}
								data-testid="setup-countdown-badge"
								className="tabular-nums"
							>
								<Clock className="size-3" />
								{m.online_setup_countdown(
									{ seconds: String(setupCountdownSeconds) },
									{ locale },
								)}
							</Badge>
						) : null}
					</div>
					<CardDescription className="text-xs">
						{m.online_spectator_setup_desc({}, { locale })}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-2.5">
					{(["red", "black"] as const).map((side) => {
						const sideReady = view.setupReady[side];
						const sidePlaced = view.placedCounts[side];
						return (
							<div
								key={side}
								data-testid={`spectator-${side}-setup-progress`}
								className="flex items-center justify-between rounded-xl border border-border-subtle bg-surface-elevated/60 px-3 py-2"
							>
								<span className="text-sm font-medium text-foreground">
									{formatSideName(side, locale)}
								</span>
								<Badge
									variant={sideReady ? "default" : "secondary"}
									className="tabular-nums"
								>
									{sideReady
										? m.setup_opponent_ready({}, { locale })
										: m.setup_opponent_placing(
												{ count: String(sidePlaced) },
												{ locale },
											)}
								</Badge>
							</div>
						);
					})}
				</CardContent>
			</Card>
		);
	}

	return (
		<Card className="border-border-subtle bg-card">
			<CardHeader className="gap-2 pb-3">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<CardTitle className="text-base font-semibold">
						{m.setup_title({}, { locale })}
					</CardTitle>
					<div className="flex flex-wrap items-center gap-1.5">
						{setupCountdownSeconds !== null ? (
							<Badge
								variant={isSetupTimeWarning ? "destructive" : "outline"}
								data-testid="setup-countdown-badge"
								className="tabular-nums"
							>
								<Clock className="size-3" />
								{m.online_setup_countdown(
									{ seconds: String(setupCountdownSeconds) },
									{ locale },
								)}
							</Badge>
						) : null}
						<Badge
							variant={opponentReady ? "default" : "secondary"}
							data-testid="opponent-setup-progress"
							className="tabular-nums"
						>
							{m.setup_opponent_progress(
								{ side: formatSideName(opponent, locale) },
								{ locale },
							)}
							:{" "}
							{opponentReady
								? m.setup_opponent_ready({}, { locale })
								: m.setup_opponent_placing(
										{ count: String(opponentPlaced) },
										{ locale },
									)}
						</Badge>
					</div>
				</div>
				<CardDescription className="text-xs">
					{m.setup_subtitle({}, { locale })}
				</CardDescription>

				{/* Sandbox dual-side viewer switcher */}
				{isSandbox && onSwitchSandboxViewer ? (
					<div className="flex items-center justify-between gap-2 rounded-lg border border-border-subtle bg-surface-elevated/60 px-2.5 py-1.5">
						<span className="text-xs font-medium text-muted-foreground">
							{m.sandbox_viewing({}, { locale })}
						</span>
						<ToggleGroup
							type="single"
							value={viewer}
							onValueChange={(val) => {
								if (val === "red" || val === "black") {
									onSelectHandRole(null);
									onSwitchSandboxViewer(val);
								}
							}}
							size="sm"
						>
							<ToggleGroupItem value="red" data-testid="sandbox-view-red">
								{m.side_red({}, { locale })} ({view.placedCounts.red}/8)
							</ToggleGroupItem>
							<ToggleGroupItem value="black" data-testid="sandbox-view-black">
								{m.side_black({}, { locale })} ({view.placedCounts.black}/8)
							</ToggleGroupItem>
						</ToggleGroup>
					</div>
				) : null}
			</CardHeader>

			<CardContent className="flex flex-col gap-4">
				{/* Remaining officers dock */}
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span className="font-medium text-foreground">
							{m.setup_your_officers({}, { locale })} (
							{formatSideName(viewer, locale)})
						</span>
						<span className="tabular-nums">{placedCount}/8</span>
					</div>

					<div className="grid grid-cols-5 gap-1.5">
						{OFFICER_ROLES.map((role) => {
							const count = myHand[role];
							const isSelected = selectedHandRole === role;
							return (
								<button
									key={role}
									type="button"
									disabled={isLocked || count <= 0}
									data-testid={`hand-officer-${role}`}
									aria-pressed={isSelected}
									aria-label={`${formatSideName(viewer, locale)} ${formatPieceName(role, locale)} (${count})`}
									onClick={() => onSelectHandRole(isSelected ? null : role)}
									onPointerDown={(e) => handleHandPointerDown(role, e)}
									onPointerMove={handleHandPointerMove}
									onPointerUp={handleHandPointerUp}
									onPointerCancel={handleHandPointerCancel}
									className={cn(
										"relative flex min-h-16 touch-none flex-col items-center justify-center gap-1 rounded-xl border p-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40",
										isSelected
											? "border-sit-ke-myin bg-surface-elevated ring-2 ring-sit-ke-myin/60"
											: "border-border-subtle bg-surface-elevated/50 hover:border-sit-ke-myin/60",
									)}
								>
									<SittuyinPieceSvg
										pieceRole={role}
										side={viewer}
										showScript={showScript}
										className="pointer-events-none size-10"
									/>
									<span className="w-full truncate text-center text-[10px] font-medium text-muted-foreground">
										{formatPieceName(role, locale)}
									</span>
									<Badge
										variant={count > 0 ? "default" : "secondary"}
										className="absolute -top-1.5 -right-1.5 h-5 min-w-5 justify-center px-1 text-[10px] tabular-nums"
									>
										{count}
									</Badge>
								</button>
							);
						})}
					</div>
					<p className="text-[11px] text-muted-foreground">
						{m.setup_drag_hint({}, { locale })}
					</p>
				</div>

				{/* Action buttons: Random, Clear, Lock / Unlock */}
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						variant="secondary"
						size="sm"
						disabled={isLocked}
						data-testid="setup-random-btn"
						onClick={onApplyRandomSetup}
						className="flex-1"
					>
						<Shuffle data-icon="inline-start" />
						{m.setup_random({}, { locale })}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={isLocked || placedCount === 0}
						data-testid="setup-clear-btn"
						onClick={() => {
							onSelectHandRole(null);
							onDispatchSetup({ kind: "clear" });
						}}
					>
						<Trash2 data-icon="inline-start" />
						{m.setup_clear({}, { locale })}
					</Button>
				</div>

				{isLocked ? (
					<div className="flex flex-col gap-2">
						<Alert>
							<CheckCircle2 className="size-4" />
							<AlertDescription className="text-xs">
								{m.setup_locked_notice({}, { locale })}
							</AlertDescription>
						</Alert>
						<Button
							type="button"
							variant="outline"
							data-testid="setup-unlock-btn"
							onClick={() => onDispatchSetup({ kind: "unlock" })}
							className="w-full"
						>
							<Unlock data-icon="inline-start" />
							{m.setup_unlock({}, { locale })}
						</Button>
					</div>
				) : (
					<Button
						type="button"
						disabled={remaining > 0}
						data-testid="setup-lock-btn"
						onClick={() => {
							onSelectHandRole(null);
							onDispatchSetup({ kind: "lock" });
						}}
						className="w-full"
					>
						<Lock data-icon="inline-start" />
						{m.setup_lock_ready({}, { locale })} ({placedCount}/8)
					</Button>
				)}

				<Separator />

				{/* Opening presets gallery: inline on desktop, Sheet trigger on compact mobile */}
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between gap-2">
						<h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
							{m.setup_presets_heading({}, { locale })}
						</h3>
						<Sheet>
							<SheetTrigger asChild>
								<Button
									type="button"
									variant="outline"
									size="xs"
									className="lg:hidden"
									data-testid="mobile-presets-trigger"
								>
									<BookOpen data-icon="inline-start" />
									{m.setup_presets_open({}, { locale })}
								</Button>
							</SheetTrigger>
							<SheetContent
								side="bottom"
								className="max-h-[82vh] overflow-y-auto"
							>
								<SheetHeader>
									<SheetTitle>
										{m.setup_presets_heading({}, { locale })}
									</SheetTitle>
									<SheetDescription>
										{m.setup_subtitle({}, { locale })}
									</SheetDescription>
								</SheetHeader>
								<div className="px-4 pb-6">{presetListContent}</div>
							</SheetContent>
						</Sheet>
					</div>

					{/* Desktop inline gallery */}
					<div className="hidden lg:block">{presetListContent}</div>

					{/* Mobile quick wrapping pill strip (zero horizontal overflow) */}
					<div className="flex flex-wrap gap-1.5 lg:hidden">
						{OPENING_PRESETS.map((preset) => (
							<Button
								key={`chip-${preset.id}`}
								type="button"
								variant="secondary"
								size="xs"
								disabled={isLocked}
								onClick={() => handlePresetPick(preset.id)}
							>
								{locale === "my" ? preset.name.myanmar : preset.name.english}
							</Button>
						))}
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

export function SetupHandoffCurtain({
	toSide,
	locale,
	onReveal,
}: {
	readonly toSide: Side;
	readonly locale: AppLocale;
	readonly onReveal: () => void;
}) {
	const fromSide = oppositeSide(toSide);
	return (
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="handoff-curtain-title"
			data-testid="setup-handoff-curtain"
			className="absolute inset-0 z-30 flex items-center justify-center rounded-2xl bg-table/95 p-6 backdrop-blur-md"
		>
			<div className="flex max-w-sm flex-col items-center gap-4 rounded-2xl border border-sit-ke-myin/50 bg-card p-6 text-center shadow-2xl">
				<SittuyinPieceSvg pieceRole="king" side={toSide} className="size-16" />
				<div className="flex flex-col gap-1.5">
					<h2
						id="handoff-curtain-title"
						className="text-lg font-semibold text-foreground"
					>
						{m.handoff_title({}, { locale })}
					</h2>
					<p className="text-sm text-muted-foreground">
						{m.handoff_description(
							{
								fromSide: formatSideName(fromSide, locale),
								toSide: formatSideName(toSide, locale),
							},
							{ locale },
						)}
					</p>
				</div>
				<Button
					type="button"
					size="lg"
					data-testid="handoff-reveal-btn"
					onClick={onReveal}
					className="w-full"
				>
					<Eye data-icon="inline-start" />
					{m.handoff_reveal_cta(
						{ side: formatSideName(toSide, locale) },
						{ locale },
					)}
				</Button>
			</div>
		</div>
	);
}

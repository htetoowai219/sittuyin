import { oppositeSide, type Side } from "@sittuyin/engine";
import {
	AlertTriangle,
	Check,
	Eye,
	Flag,
	Handshake,
	LogOut,
	RefreshCw,
	WifiOff,
	X,
	XCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { type AppLocale, formatSideName, m } from "@/i18n/locale";
import type {
	MatchAdapter,
	OnlineRoomLifecycleState,
} from "@/lib/adapters/types";
import { formatTimeControlLabel } from "./WaitingRoomOverlay";

export interface OnlineStatusHeaderProps {
	readonly adapter: MatchAdapter;
	readonly online: OnlineRoomLifecycleState;
	readonly locale: AppLocale;
}

export function OnlineStatusHeader({
	adapter,
	online,
	locale,
}: OnlineStatusHeaderProps) {
	const viewer = adapter.view.viewer;
	const disconnectedSides: Side[] = [];

	if (online.roomPhase === "setup" || online.roomPhase === "playing") {
		if (!adapter.players.red.connected) {
			disconnectedSides.push("red");
		}
		if (!adapter.players.black.connected) {
			disconnectedSides.push("black");
		}
	}

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-card/90 px-3 py-2">
				<div className="flex min-w-0 items-center gap-2">
					<span className="truncate text-xs font-semibold text-foreground">
						{online.roomTitle}
					</span>
					<Badge variant="outline" className="text-[11px]">
						{formatTimeControlLabel(online.timeControl, locale)}
					</Badge>
					<Badge
						variant={online.isRated ? "default" : "secondary"}
						data-testid="room-rated-badge"
						className="text-[11px]"
					>
						{online.isRated
							? m.badge_rated({}, { locale })
							: m.badge_normal({}, { locale })}
					</Badge>
				</div>

				<div className="flex flex-wrap items-center gap-1.5">
					{viewer === "spectator" ? (
						<Badge
							variant="secondary"
							data-testid="viewer-spectator-badge"
							className="gap-1 text-[11px]"
						>
							<Eye className="size-3" />
							{m.side_spectator({}, { locale })}
						</Badge>
					) : null}

					{online.spectatorCount > 0 || viewer === "spectator" ? (
						<Badge
							variant="outline"
							data-testid="online-spectator-badge"
							className="gap-1 text-[11px] tabular-nums"
						>
							<Eye className="size-3" />
							{m.online_spectator_count(
								{ count: String(online.spectatorCount) },
								{ locale },
							)}
						</Badge>
					) : null}
				</div>
			</div>

			{online.ratingUpdate ? (
				<Alert
					data-testid="online-rating-updated-banner"
					className="border-emerald-500/40 bg-card py-2"
				>
					<AlertDescription className="flex flex-wrap items-center justify-between gap-2 text-xs">
						<span className="font-semibold text-foreground">
							{m.rating_updated_label({}, { locale })}
						</span>
						<div className="flex items-center gap-3 font-mono tabular-nums">
							<span>
								{formatSideName("red", locale)}:{" "}
								{online.ratingUpdate.red.ratingAfter}
								{online.ratingUpdate.red.isProvisional ? "?" : ""} (
								{online.ratingUpdate.red.delta >= 0
									? `+${online.ratingUpdate.red.delta}`
									: online.ratingUpdate.red.delta}
								)
							</span>
							<span>
								{formatSideName("black", locale)}:{" "}
								{online.ratingUpdate.black.ratingAfter}
								{online.ratingUpdate.black.isProvisional ? "?" : ""} (
								{online.ratingUpdate.black.delta >= 0
									? `+${online.ratingUpdate.black.delta}`
									: online.ratingUpdate.black.delta}
								)
							</span>
						</div>
					</AlertDescription>
				</Alert>
			) : null}

			{online.maintenanceWarning ? (
				<Alert
					variant="destructive"
					data-testid="online-maintenance-banner"
					className="py-2"
				>
					<AlertTriangle className="size-4" />
					<AlertDescription className="text-xs">
						{m.online_maintenance_banner(
							{ message: online.maintenanceWarning },
							{ locale },
						)}
					</AlertDescription>
				</Alert>
			) : null}

			{adapter.connectionStatus === "reconnecting" ? (
				<Alert data-testid="online-reconnecting-banner" className="py-2">
					<WifiOff className="size-4 text-sit-ke-myin" />
					<AlertDescription className="text-xs">
						{m.online_reconnecting_banner({}, { locale })}
					</AlertDescription>
				</Alert>
			) : null}

			{disconnectedSides.map((side) => (
				<Alert
					key={side}
					data-testid="online-opponent-disconnected-banner"
					className="border-sit-ke-myin/50 bg-surface-elevated py-2"
				>
					<WifiOff className="size-4 text-sit-ke-myin" />
					<AlertDescription className="text-xs">
						{m.online_opponent_disconnected(
							{ side: formatSideName(side, locale) },
							{ locale },
						)}
					</AlertDescription>
				</Alert>
			))}
		</div>
	);
}

export interface OnlineMatchActionBarProps {
	readonly adapter: MatchAdapter;
	readonly online: OnlineRoomLifecycleState;
	readonly locale: AppLocale;
	readonly onLeaveToLobby?: () => void;
}

export function OnlineMatchActionBar({
	adapter,
	online,
	locale,
	onLeaveToLobby,
}: OnlineMatchActionBarProps) {
	const viewer = adapter.view.viewer;

	if (viewer === "spectator") {
		return onLeaveToLobby ? (
			<Button
				type="button"
				variant="outline"
				size="sm"
				data-testid="online-back-to-lobby-btn"
				onClick={onLeaveToLobby}
				className="w-full"
			>
				<LogOut data-icon="inline-start" />
				{m.online_back_to_lobby({}, { locale })}
			</Button>
		) : null;
	}

	const opponent: Side = oppositeSide(viewer);
	const isIncomingDrawOffer =
		online.roomPhase === "playing" &&
		adapter.outcome === null &&
		online.drawOfferedBy === opponent;
	const isMyDrawOfferPending =
		online.roomPhase === "playing" &&
		adapter.outcome === null &&
		online.drawOfferedBy === viewer;

	const isFinished =
		online.roomPhase === "finished" || adapter.outcome !== null;
	const isIncomingRematch = isFinished && online.rematchOfferedBy === opponent;
	const isMyRematchPending =
		isFinished &&
		(online.rematchOfferedBy === viewer || online.rematchAcceptedByMe);

	return (
		<div className="flex w-full flex-col gap-2">
			{isIncomingDrawOffer ? (
				<Alert
					data-testid="incoming-draw-offer-banner"
					className="border-sit-ke-myin/60 bg-surface-elevated"
				>
					<Handshake className="size-4 text-sit-ke-myin" />
					<AlertTitle className="text-xs font-semibold">
						{m.online_draw_offer_incoming(
							{ side: formatSideName(opponent, locale) },
							{ locale },
						)}
					</AlertTitle>
					<AlertDescription className="mt-2 flex items-center gap-2">
						<Button
							type="button"
							variant="default"
							size="xs"
							data-testid="accept-draw-btn"
							onClick={() => adapter.respondDraw?.(true)}
							className="flex-1"
						>
							<Check data-icon="inline-start" />
							{m.online_draw_accept({}, { locale })}
						</Button>
						<Button
							type="button"
							variant="outline"
							size="xs"
							data-testid="decline-draw-btn"
							onClick={() => adapter.respondDraw?.(false)}
							className="flex-1"
						>
							<X data-icon="inline-start" />
							{m.online_draw_decline({}, { locale })}
						</Button>
					</AlertDescription>
				</Alert>
			) : null}

			{isMyDrawOfferPending ? (
				<div
					data-testid="outgoing-draw-offer-banner"
					className="rounded-lg border border-border-subtle bg-surface-elevated/70 px-3 py-1.5 text-center text-xs text-muted-foreground"
				>
					{m.online_draw_offer_pending_mine({}, { locale })}
				</div>
			) : null}

			{online.canAbort &&
			!isFinished &&
			(online.roomPhase === "setup" || online.roomPhase === "playing") ? (
				<Button
					type="button"
					variant="outline"
					size="sm"
					data-testid="abort-match-btn"
					onClick={() => adapter.abortMatch?.()}
					className="w-full"
				>
					<XCircle data-icon="inline-start" />
					{m.online_abort_match({}, { locale })}
				</Button>
			) : null}

			{online.roomPhase === "playing" && !isFinished ? (
				<div className="flex flex-wrap items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						data-testid="resign-btn"
						onClick={adapter.requestResign}
						className="flex-1"
					>
						<Flag data-icon="inline-start" />
						{m.action_resign({}, { locale })}
					</Button>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={online.drawOfferedBy !== null}
						data-testid="draw-btn"
						onClick={adapter.requestDraw}
						className="flex-1"
					>
						<Handshake data-icon="inline-start" />
						{m.action_draw({}, { locale })}
					</Button>
				</div>
			) : null}

			{isFinished ? (
				<div className="flex flex-col gap-2">
					{isIncomingRematch ? (
						<Alert
							data-testid="incoming-rematch-banner"
							className="border-sit-ke-myin/60 bg-surface-elevated"
						>
							<RefreshCw className="size-4 text-sit-ke-myin" />
							<AlertTitle className="text-xs font-semibold">
								{m.online_rematch_incoming(
									{ side: formatSideName(opponent, locale) },
									{ locale },
								)}
							</AlertTitle>
							<AlertDescription className="mt-2 flex items-center gap-2">
								<Button
									type="button"
									variant="default"
									size="xs"
									data-testid="accept-rematch-btn"
									onClick={() => adapter.respondRematch?.(true)}
									className="flex-1"
								>
									<Check data-icon="inline-start" />
									{m.online_rematch_accept({}, { locale })}
								</Button>
								<Button
									type="button"
									variant="outline"
									size="xs"
									data-testid="decline-rematch-btn"
									onClick={() => adapter.respondRematch?.(false)}
									className="flex-1"
								>
									<X data-icon="inline-start" />
									{m.online_rematch_decline({}, { locale })}
								</Button>
							</AlertDescription>
						</Alert>
					) : isMyRematchPending ? (
						<div
							data-testid="outgoing-rematch-banner"
							className="rounded-lg border border-border-subtle bg-surface-elevated/70 px-3 py-2 text-center text-xs text-muted-foreground"
						>
							{m.online_rematch_pending_mine({}, { locale })}
						</div>
					) : adapter.outcome?.reason !== "aborted_maintenance" ? (
						<Button
							type="button"
							variant="default"
							size="sm"
							data-testid="offer-rematch-btn"
							onClick={() => adapter.offerRematch?.()}
							className="w-full"
						>
							<RefreshCw data-icon="inline-start" />
							{m.online_rematch_offer({}, { locale })}
						</Button>
					) : null}

					{onLeaveToLobby ? (
						<Button
							type="button"
							variant="outline"
							size="sm"
							data-testid="online-back-to-lobby-btn"
							onClick={onLeaveToLobby}
							className="w-full"
						>
							<LogOut data-icon="inline-start" />
							{m.online_back_to_lobby({}, { locale })}
						</Button>
					) : null}
				</div>
			) : null}
		</div>
	);
}

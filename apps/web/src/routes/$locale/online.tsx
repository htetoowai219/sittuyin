import {
	INVITE_CODE_LENGTH,
	SITTUYIN_ROOM_NAME,
	type TimeControl,
	TimeControlSchema,
} from "@sittuyin/shared";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	Clock,
	Eye,
	KeyRound,
	Radio,
	RefreshCw,
	Swords,
	UserCheck,
	WifiOff,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	CreateRoomDialog,
	type CreateRoomFormValues,
} from "@/components/sittuyin/CreateRoomDialog";
import {
	formatPreferredSideLabel,
	formatTimeControlLabel,
} from "@/components/sittuyin/WaitingRoomOverlay";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type AppLocale, isAppLocale, m } from "@/i18n/locale";
import {
	createColyseusClient,
	setPendingRoomHandoff,
} from "@/lib/colyseus/client";
import {
	type LobbyRoomEntry,
	normalizeInviteCodeInput,
	type TimeControlFilter,
	useOnlineLobby,
} from "@/lib/colyseus/lobby-client";
import { saveStoredRoomReconnection } from "@/lib/colyseus/reconnect-store";
import type { GuestSessionIdentity } from "@/server/guest-cookie";
import {
	getOrCreateGuestSessionFn,
	mintMatchJoinTicketFn,
	updateGuestDisplayNameFn,
} from "@/server/match-ticket";

interface OnlineSearchParams {
	tc?: TimeControl;
}

function parseOnlineSearch(
	search: Record<string, unknown>,
): OnlineSearchParams {
	const parsed = TimeControlSchema.safeParse(search.tc);
	return parsed.success ? { tc: parsed.data } : {};
}

export const Route = createFileRoute("/$locale/online")({
	validateSearch: parseOnlineSearch,
	component: OnlineLobbyRoutePage,
});

export interface OnlineLobbyViewProps {
	readonly locale: AppLocale;
	readonly initialFilter?: TimeControlFilter;
	readonly initialGuest?: GuestSessionIdentity | null;
	readonly initialRooms?: readonly LobbyRoomEntry[];
	readonly autoConnect?: boolean;
	readonly onNavigateToRoom?: (
		roomId: string,
		role?: "player" | "spectator",
	) => void;
}

export function OnlineLobbyView({
	locale,
	initialFilter = "all",
	initialGuest = null,
	initialRooms,
	autoConnect = true,
	onNavigateToRoom,
}: OnlineLobbyViewProps) {
	const [guest, setGuest] = useState<GuestSessionIdentity | null>(initialGuest);
	const [displayNameDraft, setDisplayNameDraft] = useState(
		initialGuest?.displayName ?? "",
	);
	const [isSavingName, setIsSavingName] = useState(false);
	const [inviteCodeInput, setInviteCodeInput] = useState("");
	const [isCreatingRoom, setIsCreatingRoom] = useState(false);

	const {
		connectionStatus,
		openChallenges,
		liveMatches,
		timeControlFilter,
		setTimeControlFilter,
		errorMessage,
		reconnectLobby,
	} = useOnlineLobby({
		initialFilter,
		initialRooms,
		autoConnect,
	});

	useEffect(() => {
		if (initialGuest) {
			return;
		}
		let cancelled = false;
		getOrCreateGuestSessionFn()
			.then((session) => {
				if (cancelled) return;
				setGuest(session);
				setDisplayNameDraft(session.displayName);
			})
			.catch(() => {
				// Ignore in offline test environments
			});
		return () => {
			cancelled = true;
		};
	}, [initialGuest]);

	const handleUpdateDisplayName = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const trimmed = displayNameDraft.trim();
		if (trimmed.length < 1 || trimmed.length > 32) {
			return;
		}
		setIsSavingName(true);
		try {
			const updated = await updateGuestDisplayNameFn({
				data: { displayName: trimmed },
			});
			setGuest(updated);
			setDisplayNameDraft(updated.displayName);
			toast.success(m.online_guest_saved_toast({}, { locale }));
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : m.err_GENERIC({}, { locale }),
			);
		} finally {
			setIsSavingName(false);
		}
	};

	const handleJoinByInviteCode = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const normalized = normalizeInviteCodeInput(inviteCodeInput);
		if (normalized.length !== INVITE_CODE_LENGTH) {
			return;
		}
		onNavigateToRoom?.(normalized, "player");
	};

	const handleCreateRoom = async (values: CreateRoomFormValues) => {
		setIsCreatingRoom(true);
		try {
			const ticket = await mintMatchJoinTicketFn({
				data: {
					roomMode: values.roomMode,
					isRated: values.isRated,
					timeControl: values.timeControl,
					preferredSide: values.preferredSide,
					roomTitle: values.roomTitle || undefined,
					roleIntent: "player",
				},
			});

			setGuest(ticket.guest);
			const client = createColyseusClient(ticket.serverUrl, ticket.token);
			const room = await client.create(SITTUYIN_ROOM_NAME, {
				roomMode: values.roomMode,
				isRated: values.isRated,
				timeControl: values.timeControl,
				preferredSide: values.preferredSide,
				roomTitle: values.roomTitle || undefined,
			});

			const stateInviteCode =
				(
					room.state as { inviteCode?: string } | undefined
				)?.inviteCode?.trim() || null;
			const targetSlug =
				values.roomMode === "private_room" && stateInviteCode
					? stateInviteCode
					: room.roomId;

			saveStoredRoomReconnection({
				roomId: room.roomId,
				inviteCode: stateInviteCode,
				reconnectionToken: room.reconnectionToken,
				userId: ticket.guest.sub,
			});

			setPendingRoomHandoff({
				room,
				inviteCode: stateInviteCode,
			});

			onNavigateToRoom?.(targetSlug, "player");
		} catch (err) {
			toast.error(
				err instanceof Error ? err.message : m.err_GENERIC({}, { locale }),
			);
		} finally {
			setIsCreatingRoom(false);
		}
	};

	const statusLabel =
		connectionStatus === "connected"
			? m.online_status_connected({}, { locale })
			: connectionStatus === "connecting"
				? m.online_status_connecting({}, { locale })
				: connectionStatus === "reconnecting"
					? m.online_status_reconnecting({}, { locale })
					: m.online_status_error({}, { locale });

	return (
		<div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
			{/* Page Header */}
			<section className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex flex-col gap-1.5">
					<div className="flex flex-wrap items-center gap-2.5">
						<h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
							{m.online_page_title({}, { locale })}
						</h1>
						<Badge
							variant={
								connectionStatus === "connected"
									? "default"
									: connectionStatus === "error"
										? "destructive"
										: "secondary"
							}
							data-testid="lobby-connection-badge"
							className="gap-1.5"
						>
							<Radio className="size-3" />
							{statusLabel}
						</Badge>
					</div>
					<p className="max-w-2xl text-sm text-muted-foreground">
						{m.online_page_subtitle({}, { locale })}
					</p>
				</div>

				<CreateRoomDialog
					locale={locale}
					isSubmitting={isCreatingRoom}
					defaultTimeControl={
						timeControlFilter === "all" ? "rapid_10_5" : timeControlFilter
					}
					onCreateRoom={handleCreateRoom}
				/>
			</section>

			{connectionStatus === "error" ? (
				<Alert
					variant="destructive"
					data-testid="lobby-connection-error-banner"
					className="flex flex-wrap items-center justify-between gap-3"
				>
					<div className="flex items-center gap-2">
						<WifiOff className="size-4" />
						<AlertDescription className="text-xs">
							{errorMessage ?? m.online_status_error({}, { locale })}
						</AlertDescription>
					</div>
					<Button
						type="button"
						variant="outline"
						size="xs"
						data-testid="lobby-retry-btn"
						onClick={reconnectLobby}
					>
						<RefreshCw data-icon="inline-start" />
						{m.online_retry_cta({}, { locale })}
					</Button>
				</Alert>
			) : null}

			{/* Guest Identity & 6-Char Private Invite Code Bar */}
			<section className="grid gap-4 md:grid-cols-2">
				<Card
					data-testid="guest-identity-card"
					className="border-border-subtle bg-card"
				>
					<CardContent className="p-4">
						<form
							onSubmit={(e) => {
								void handleUpdateDisplayName(e);
							}}
							className="flex flex-col gap-2.5"
						>
							<div className="flex items-center justify-between gap-2">
								<Label
									htmlFor="guest-display-name-input"
									className="flex items-center gap-1.5 text-xs font-semibold text-foreground"
								>
									<UserCheck className="size-3.5 text-sit-ke-myin" />
									{m.online_guest_label({}, { locale })}
								</Label>
								<Badge
									variant="secondary"
									data-testid="guest-rating-badge"
									className="tabular-nums text-[11px]"
								>
									{guest?.rating ?? 1500}
								</Badge>
							</div>
							<div className="flex items-center gap-2">
								<Input
									id="guest-display-name-input"
									data-testid="guest-display-name-input"
									maxLength={32}
									value={displayNameDraft}
									onChange={(e) => setDisplayNameDraft(e.target.value)}
									placeholder={m.online_guest_edit_placeholder({}, { locale })}
									className="flex-1"
								/>
								<Button
									type="submit"
									variant="secondary"
									size="sm"
									disabled={
										isSavingName ||
										displayNameDraft.trim().length === 0 ||
										displayNameDraft.trim() === guest?.displayName
									}
									data-testid="guest-display-name-save-btn"
								>
									{m.online_guest_save({}, { locale })}
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>

				<Card
					data-testid="invite-code-card"
					className="border-border-subtle bg-card"
				>
					<CardContent className="p-4">
						<form
							onSubmit={handleJoinByInviteCode}
							className="flex flex-col gap-2.5"
						>
							<Label
								htmlFor="invite-code-input"
								className="flex items-center gap-1.5 text-xs font-semibold text-foreground"
							>
								<KeyRound className="size-3.5 text-sit-ke-myin" />
								{m.online_invite_label({}, { locale })}
							</Label>
							<div className="flex items-center gap-2">
								<Input
									id="invite-code-input"
									data-testid="invite-code-input"
									maxLength={INVITE_CODE_LENGTH}
									value={inviteCodeInput}
									onChange={(e) =>
										setInviteCodeInput(normalizeInviteCodeInput(e.target.value))
									}
									placeholder={m.online_invite_placeholder({}, { locale })}
									className="flex-1 font-mono tracking-widest uppercase"
								/>
								<Button
									type="submit"
									variant="default"
									size="sm"
									disabled={inviteCodeInput.length !== INVITE_CODE_LENGTH}
									data-testid="invite-code-join-btn"
								>
									{m.online_invite_join_cta({}, { locale })}
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			</section>

			{/* Time Control Filter Pills */}
			<section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-card/85 px-3 py-2">
				<span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
					<Clock className="size-3.5 text-sit-ke-myin" />
					{m.time_control_label({}, { locale })}
				</span>
				<ToggleGroup
					type="single"
					size="sm"
					value={timeControlFilter}
					onValueChange={(val) => {
						if (
							val === "all" ||
							val === "rapid_10_5" ||
							val === "rapid_15_10" ||
							val === "classical_30_0"
						) {
							setTimeControlFilter(val);
						}
					}}
					data-testid="lobby-tc-filter"
					aria-label={m.time_control_label({}, { locale })}
				>
					<ToggleGroupItem value="all" data-testid="filter-tc-all">
						{m.online_filter_all({}, { locale })}
					</ToggleGroupItem>
					<ToggleGroupItem
						value="rapid_10_5"
						data-testid="filter-tc-rapid_10_5"
					>
						{m.time_control_rapid_10_5({}, { locale })}
					</ToggleGroupItem>
					<ToggleGroupItem
						value="rapid_15_10"
						data-testid="filter-tc-rapid_15_10"
					>
						{m.time_control_rapid_15_10({}, { locale })}
					</ToggleGroupItem>
					<ToggleGroupItem
						value="classical_30_0"
						data-testid="filter-tc-classical_30_0"
					>
						{m.time_control_classical_30_0({}, { locale })}
					</ToggleGroupItem>
				</ToggleGroup>
			</section>

			{/* Two-Section Lobby Grid: Open Challenges & Live Matches */}
			<section className="grid gap-6 lg:grid-cols-2">
				{/* Open Challenges (phase === "waiting" && playerCount === 1) */}
				<div
					data-testid="open-challenges-section"
					className="flex flex-col gap-3"
				>
					<div className="flex items-center justify-between">
						<h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
							<Swords className="size-4 text-sit-ke-myin" />
							{m.online_open_challenges_title({}, { locale })}
						</h2>
						<Badge variant="secondary" className="tabular-nums">
							{openChallenges.length}
						</Badge>
					</div>

					{openChallenges.length === 0 ? (
						<Card
							data-testid="open-challenges-empty"
							className="border-dashed border-border-subtle bg-card/60"
						>
							<CardContent className="p-6 text-center text-sm text-muted-foreground">
								{m.online_open_challenges_empty({}, { locale })}
							</CardContent>
						</Card>
					) : (
						<div className="flex flex-col gap-2.5">
							{openChallenges.map((entry) => (
								<Card
									key={entry.roomId}
									data-testid={`open-challenge-card-${entry.roomId}`}
									className="border-border-subtle bg-card transition-colors hover:border-sit-ke-myin/60"
								>
									<CardHeader className="flex-row items-center justify-between gap-3 p-4">
										<div className="flex min-w-0 flex-1 flex-col gap-1">
											<CardTitle className="truncate text-sm font-semibold text-foreground">
												{entry.metadata.roomTitle}
											</CardTitle>
											<CardDescription className="flex flex-wrap items-center gap-2 text-xs">
												<span className="font-medium text-foreground">
													{entry.metadata.hostDisplayName}
												</span>
												<span className="tabular-nums text-muted-foreground">
													({Math.round(entry.metadata.hostRating)}
													{entry.metadata.hostIsProvisional ? "?" : ""})
												</span>
											</CardDescription>
											<div className="flex flex-wrap items-center gap-1.5 pt-1">
												<Badge
													variant={
														entry.metadata.isRated ? "default" : "outline"
													}
													className="text-[11px]"
												>
													{entry.metadata.isRated
														? m.badge_rated({}, { locale })
														: m.badge_normal({}, { locale })}
												</Badge>
												<Badge variant="secondary" className="text-[11px]">
													{formatTimeControlLabel(
														entry.metadata.timeControl,
														locale,
													)}
												</Badge>
												<Badge variant="outline" className="text-[11px]">
													{formatPreferredSideLabel(
														entry.metadata.hostPreferredSide,
														locale,
													)}
												</Badge>
											</div>
										</div>

										<Button
											type="button"
											variant="default"
											size="sm"
											data-testid={`join-challenge-btn-${entry.roomId}`}
											onClick={() => onNavigateToRoom?.(entry.roomId, "player")}
										>
											<Swords data-icon="inline-start" />
											{m.online_join_challenge_cta({}, { locale })}
										</Button>
									</CardHeader>
								</Card>
							))}
						</div>
					)}
				</div>

				{/* Live Matches (phase === "setup" || phase === "playing") */}
				<div data-testid="live-matches-section" className="flex flex-col gap-3">
					<div className="flex items-center justify-between">
						<h2 className="flex items-center gap-2 text-lg font-bold text-foreground">
							<Eye className="size-4 text-sit-ke-myin" />
							{m.online_live_matches_title({}, { locale })}
						</h2>
						<Badge variant="secondary" className="tabular-nums">
							{liveMatches.length}
						</Badge>
					</div>

					{liveMatches.length === 0 ? (
						<Card
							data-testid="live-matches-empty"
							className="border-dashed border-border-subtle bg-card/60"
						>
							<CardContent className="p-6 text-center text-sm text-muted-foreground">
								{m.online_live_matches_empty({}, { locale })}
							</CardContent>
						</Card>
					) : (
						<div className="flex flex-col gap-2.5">
							{liveMatches.map((entry) => (
								<Card
									key={entry.roomId}
									data-testid={`live-match-card-${entry.roomId}`}
									className="border-border-subtle bg-card transition-colors hover:border-sit-ke-myin/60"
								>
									<CardHeader className="flex-row items-center justify-between gap-3 p-4">
										<div className="flex min-w-0 flex-1 flex-col gap-1">
											<CardTitle className="truncate text-sm font-semibold text-foreground">
												{entry.metadata.roomTitle}
											</CardTitle>
											<CardDescription className="flex flex-wrap items-center gap-2 text-xs">
												<span className="font-medium text-foreground">
													{entry.metadata.hostDisplayName}
												</span>
												<span className="tabular-nums text-muted-foreground">
													({Math.round(entry.metadata.hostRating)}
													{entry.metadata.hostIsProvisional ? "?" : ""})
												</span>
											</CardDescription>
											<div className="flex flex-wrap items-center gap-1.5 pt-1">
												<Badge
													variant={
														entry.metadata.isRated ? "default" : "outline"
													}
													className="text-[11px]"
												>
													{entry.metadata.isRated
														? m.badge_rated({}, { locale })
														: m.badge_normal({}, { locale })}
												</Badge>
												<Badge variant="secondary" className="text-[11px]">
													{formatTimeControlLabel(
														entry.metadata.timeControl,
														locale,
													)}
												</Badge>
												<Badge variant="outline" className="text-[11px]">
													{entry.metadata.phase === "setup"
														? m.phase_setup({}, { locale })
														: m.phase_playing({}, { locale })}
												</Badge>
												<Badge
													variant="outline"
													data-testid={`spectator-count-${entry.roomId}`}
													className="gap-1 text-[11px] tabular-nums"
												>
													<Eye className="size-3" />
													{m.online_spectator_count(
														{ count: String(entry.metadata.spectatorCount) },
														{ locale },
													)}
												</Badge>
											</div>
										</div>

										<Button
											type="button"
											variant="secondary"
											size="sm"
											data-testid={`watch-live-btn-${entry.roomId}`}
											onClick={() =>
												onNavigateToRoom?.(entry.roomId, "spectator")
											}
										>
											<Eye data-icon="inline-start" />
											{m.online_watch_live_cta({}, { locale })}
										</Button>
									</CardHeader>
								</Card>
							))}
						</div>
					)}
				</div>
			</section>
		</div>
	);
}

function OnlineLobbyRoutePage() {
	const { locale } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate();
	const activeLocale: AppLocale = isAppLocale(locale) ? locale : "my";

	return (
		<OnlineLobbyView
			locale={activeLocale}
			initialFilter={search.tc ?? "all"}
			onNavigateToRoom={(targetRoomId, role) => {
				void navigate({
					to: "/$locale/room/$roomId",
					params: {
						locale: activeLocale,
						roomId: targetRoomId,
					},
					search: role === "spectator" ? { role: "spectator" } : {},
				});
			}}
		/>
	);
}

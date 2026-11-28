import {
	CUSTOM_CLOSE_CODES,
	type RoleIntent,
	RoleIntentSchema,
} from "@sittuyin/shared";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	AlertTriangle,
	ArrowLeft,
	Clock,
	Loader2,
	ShieldAlert,
	Wrench,
	XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SittuyinMatchWorkspace } from "@/components/sittuyin/SittuyinMatchWorkspace";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	type AppLocale,
	formatEngineError,
	isAppLocale,
	m,
} from "@/i18n/locale";
import {
	type ColyseusRoomLike,
	useColyseusMatchAdapter,
} from "@/lib/adapters/colyseus-match-adapter";
import {
	consumePendingRoomHandoff,
	createColyseusClient,
} from "@/lib/colyseus/client";
import {
	clearStoredRoomReconnection,
	getStoredRoomReconnection,
	type StorageLike,
	saveStoredRoomReconnection,
} from "@/lib/colyseus/reconnect-store";
import type { GuestSessionIdentity } from "@/server/guest-cookie";
import {
	getOrCreateGuestSessionFn,
	type MintMatchJoinTicketInput,
	type MintMatchJoinTicketResult,
	mintMatchJoinTicketFn,
} from "@/server/match-ticket";

interface RoomSearchParams {
	role?: RoleIntent;
}

function parseRoomSearch(search: Record<string, unknown>): RoomSearchParams {
	const parsed = RoleIntentSchema.safeParse(search.role);
	return parsed.success ? { role: parsed.data } : {};
}

export const Route = createFileRoute("/$locale/room/$roomId")({
	validateSearch: parseRoomSearch,
	component: OnlineRoomRoutePage,
});

export type OnlineRoomErrorKind =
	| "conflict_409"
	| "waiting_timeout_4012"
	| "room_aborted_4013"
	| "maintenance_503"
	| "not_found_404";

export function classifyRoomConnectionError(err: unknown): OnlineRoomErrorKind {
	const code =
		err && typeof err === "object" && "code" in err
			? Number((err as { code?: unknown }).code)
			: Number.NaN;
	const message =
		err instanceof Error
			? err.message
			: err && typeof err === "object" && "message" in err
				? String((err as { message?: unknown }).message)
				: String(err ?? "");
	const upper = message.toUpperCase();

	if (
		code === 409 ||
		upper.includes("ACTIVE_MATCH_EXISTS") ||
		upper.includes("SELF_PLAY_FORBIDDEN") ||
		upper.includes("409")
	) {
		return "conflict_409";
	}
	if (
		code === CUSTOM_CLOSE_CODES.WAITING_TIMEOUT ||
		upper.includes("WAITING_TIMEOUT") ||
		upper.includes("4012")
	) {
		return "waiting_timeout_4012";
	}
	if (
		code === CUSTOM_CLOSE_CODES.ROOM_ABORTED ||
		upper.includes("ROOM_ABORTED") ||
		upper.includes("4013")
	) {
		return "room_aborted_4013";
	}
	if (
		code === 503 ||
		code === 4001 ||
		upper.includes("SERVER_MAINTENANCE") ||
		upper.includes("503")
	) {
		return "maintenance_503";
	}
	return "not_found_404";
}

export interface RoomConnectionClientLike {
	reconnect(reconnectionToken: string): Promise<ColyseusRoomLike>;
	joinById(
		roomId: string,
		options?: Record<string, unknown>,
	): Promise<ColyseusRoomLike>;
}

export interface ConnectOrReconnectOptions {
	readonly roomId: string;
	readonly roleIntent: RoleIntent;
	readonly storage?: StorageLike | null;
	readonly nowMs?: number;
	readonly getGuestSession?: () => Promise<GuestSessionIdentity>;
	readonly mintJoinTicket?: (
		input: MintMatchJoinTicketInput,
	) => Promise<MintMatchJoinTicketResult>;
	readonly createClient?: (
		serverUrl?: string,
		authToken?: string,
	) => RoomConnectionClientLike;
}

export type ConnectOrReconnectOutcome =
	| {
			readonly status: "connected";
			readonly room: ColyseusRoomLike;
			readonly userId?: string;
	  }
	| {
			readonly status: "error";
			readonly errorKind: OnlineRoomErrorKind;
	  };

export async function connectOrReconnectOnlineRoom(
	options: ConnectOrReconnectOptions,
): Promise<ConnectOrReconnectOutcome> {
	const normalizedRoomId = options.roomId.trim().toUpperCase();
	const handoffRoom = consumePendingRoomHandoff(
		normalizedRoomId,
		options.nowMs,
	);
	if (handoffRoom) {
		return {
			status: "connected",
			room: handoffRoom as unknown as ColyseusRoomLike,
		};
	}

	const getGuest =
		options.getGuestSession ?? (() => getOrCreateGuestSessionFn());
	const mintTicket =
		options.mintJoinTicket ??
		((input: MintMatchJoinTicketInput) =>
			mintMatchJoinTicketFn({ data: input }));
	const clientFactory =
		options.createClient ??
		((serverUrl?: string, authToken?: string) =>
			createColyseusClient(
				serverUrl,
				authToken,
			) as unknown as RoomConnectionClientLike);

	try {
		const guest = await getGuest();
		const stored = getStoredRoomReconnection(normalizedRoomId, guest.sub, {
			storage: options.storage,
			nowMs: options.nowMs,
		});

		if (stored && options.roleIntent !== "spectator") {
			try {
				const reconnectClient = clientFactory();
				const reconnectedRoom = await reconnectClient.reconnect(
					stored.reconnectionToken,
				);
				if (reconnectedRoom.reconnectionToken) {
					const stateInvite =
						(reconnectedRoom.state as { inviteCode?: string } | undefined)
							?.inviteCode ?? stored.inviteCode;
					saveStoredRoomReconnection(
						{
							roomId: reconnectedRoom.roomId,
							inviteCode: stateInvite,
							reconnectionToken: reconnectedRoom.reconnectionToken,
							userId: guest.sub,
						},
						{ storage: options.storage, nowMs: options.nowMs },
					);
				}
				return {
					status: "connected",
					room: reconnectedRoom,
					userId: guest.sub,
				};
			} catch {
				clearStoredRoomReconnection(normalizedRoomId, {
					storage: options.storage,
					nowMs: options.nowMs,
				});
			}
		}

		const ticket = await mintTicket({
			roomMode: "private_room",
			timeControl: "rapid_10_5",
			roleIntent: options.roleIntent,
		});

		const joinClient = clientFactory(ticket.serverUrl, ticket.token);
		const joinedRoom = await joinClient.joinById(normalizedRoomId);

		if (options.roleIntent !== "spectator" && joinedRoom.reconnectionToken) {
			const stateInvite = (
				joinedRoom.state as { inviteCode?: string } | undefined
			)?.inviteCode;
			saveStoredRoomReconnection(
				{
					roomId: joinedRoom.roomId,
					inviteCode: stateInvite ?? normalizedRoomId,
					reconnectionToken: joinedRoom.reconnectionToken,
					userId: ticket.guest.sub,
				},
				{ storage: options.storage, nowMs: options.nowMs },
			);
		}

		return {
			status: "connected",
			room: joinedRoom,
			userId: ticket.guest.sub,
		};
	} catch (err) {
		return {
			status: "error",
			errorKind: classifyRoomConnectionError(err),
		};
	}
}

export interface OnlineRoomErrorCardProps {
	readonly errorKind: OnlineRoomErrorKind;
	readonly locale: AppLocale;
	readonly onReturnToLobby: () => void;
}

export function OnlineRoomErrorCard({
	errorKind,
	locale,
	onReturnToLobby,
}: OnlineRoomErrorCardProps) {
	const meta = (() => {
		switch (errorKind) {
			case "conflict_409":
				return {
					icon: ShieldAlert,
					title: m.room_err_conflict_title({}, { locale }),
					description: m.room_err_conflict_desc({}, { locale }),
				};
			case "waiting_timeout_4012":
				return {
					icon: Clock,
					title: m.room_err_timeout_title({}, { locale }),
					description: m.room_err_timeout_desc({}, { locale }),
				};
			case "room_aborted_4013":
				return {
					icon: XCircle,
					title: m.room_err_aborted_title({}, { locale }),
					description: m.room_err_aborted_desc({}, { locale }),
				};
			case "maintenance_503":
				return {
					icon: Wrench,
					title: m.room_err_maintenance_title({}, { locale }),
					description: m.room_err_maintenance_desc({}, { locale }),
				};
			case "not_found_404":
				return {
					icon: AlertTriangle,
					title: m.room_err_not_found_title({}, { locale }),
					description: m.room_err_not_found_desc({}, { locale }),
				};
		}
	})();

	const Icon = meta.icon;

	return (
		<div className="mx-auto flex min-h-[65vh] w-full max-w-md items-center justify-center px-4 py-10">
			<Card
				data-testid="room-error-card"
				data-error-kind={errorKind}
				className="w-full border-sit-ke-myin/50 bg-card shadow-lg"
			>
				<CardHeader className="gap-2 text-center">
					<div className="mx-auto flex size-11 items-center justify-center rounded-full border border-sit-ke-myin/40 bg-surface-elevated text-sit-ke-myin">
						<Icon className="size-5" />
					</div>
					<CardTitle className="text-lg font-bold text-foreground">
						{meta.title}
					</CardTitle>
					<CardDescription className="text-xs text-muted-foreground">
						{meta.description}
					</CardDescription>
				</CardHeader>
				<CardFooter className="justify-center pt-2">
					<Button
						type="button"
						variant="default"
						data-testid="room-return-to-lobby-btn"
						onClick={onReturnToLobby}
						className="w-full"
					>
						<ArrowLeft data-icon="inline-start" />
						{m.room_return_to_lobby({}, { locale })}
					</Button>
				</CardFooter>
			</Card>
		</div>
	);
}

function ConnectedOnlineRoomWorkspace({
	room,
	userId,
	locale,
	onLeaveToLobby,
	onTerminalError,
}: {
	readonly room: ColyseusRoomLike;
	readonly userId?: string;
	readonly locale: AppLocale;
	readonly onLeaveToLobby: () => void;
	readonly onTerminalError: (kind: OnlineRoomErrorKind) => void;
}) {
	const adapter = useColyseusMatchAdapter({
		room,
		locale,
		userId,
		onActionError: (err) => {
			toast.error(formatEngineError(err.code, locale));
		},
		onDrawDeclined: () => {
			toast.info(m.online_draw_declined_toast({}, { locale }));
		},
		onTerminalLeave: (code) => {
			if (code === CUSTOM_CLOSE_CODES.WAITING_TIMEOUT) {
				onTerminalError("waiting_timeout_4012");
			} else if (code === CUSTOM_CLOSE_CODES.ROOM_ABORTED) {
				onTerminalError("room_aborted_4013");
			} else if (code === 4001 || code === 503) {
				onTerminalError("maintenance_503");
			}
		},
	});

	return (
		<SittuyinMatchWorkspace
			adapter={adapter}
			locale={locale}
			onLeaveOnlineRoom={() => {
				adapter.leaveRoom?.();
				onLeaveToLobby();
			}}
		/>
	);
}

export interface OnlineRoomViewProps {
	readonly roomId: string;
	readonly locale: AppLocale;
	readonly roleIntent?: RoleIntent;
	readonly initialRoom?: ColyseusRoomLike | null;
	readonly initialError?: OnlineRoomErrorKind | null;
	readonly onReturnToLobby: () => void;
}

export function OnlineRoomView({
	roomId,
	locale,
	roleIntent = "player",
	initialRoom = null,
	initialError = null,
	onReturnToLobby,
}: OnlineRoomViewProps) {
	const [activeRoom, setActiveRoom] = useState<ColyseusRoomLike | null>(
		initialRoom,
	);
	const [userId, setUserId] = useState<string | undefined>(undefined);
	const [errorKind, setErrorKind] = useState<OnlineRoomErrorKind | null>(
		initialError,
	);

	useEffect(() => {
		if (initialRoom || initialError) {
			return;
		}
		let cancelled = false;
		setActiveRoom(null);
		setErrorKind(null);

		connectOrReconnectOnlineRoom({
			roomId,
			roleIntent,
		}).then((outcome) => {
			if (cancelled) {
				if (outcome.status === "connected") {
					void outcome.room.leave(true);
				}
				return;
			}
			if (outcome.status === "connected") {
				setActiveRoom(outcome.room);
				setUserId(outcome.userId);
			} else {
				setErrorKind(outcome.errorKind);
			}
		});

		return () => {
			cancelled = true;
		};
	}, [roomId, roleIntent, initialRoom, initialError]);

	if (errorKind !== null) {
		return (
			<OnlineRoomErrorCard
				errorKind={errorKind}
				locale={locale}
				onReturnToLobby={onReturnToLobby}
			/>
		);
	}

	if (activeRoom === null) {
		return (
			<div
				data-testid="room-connecting-card"
				className="mx-auto flex min-h-[65vh] w-full max-w-md items-center justify-center px-4 py-10"
			>
				<Card className="w-full border-border-subtle bg-card">
					<CardContent className="flex flex-col items-center gap-3 p-6 text-center">
						<Loader2 className="size-6 animate-spin text-sit-ke-myin" />
						<div className="flex flex-col gap-1">
							<p className="text-sm font-semibold text-foreground">
								{m.room_connecting_title({}, { locale })}
							</p>
							<p className="text-xs text-muted-foreground">
								{m.room_connecting_desc({}, { locale })}
							</p>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<ConnectedOnlineRoomWorkspace
			room={activeRoom}
			userId={userId}
			locale={locale}
			onLeaveToLobby={onReturnToLobby}
			onTerminalError={(kind) => {
				setActiveRoom(null);
				setErrorKind(kind);
			}}
		/>
	);
}

function OnlineRoomRoutePage() {
	const { locale, roomId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate();
	const activeLocale: AppLocale = isAppLocale(locale) ? locale : "my";

	return (
		<OnlineRoomView
			roomId={roomId}
			locale={activeLocale}
			roleIntent={search.role ?? "player"}
			onReturnToLobby={() => {
				void navigate({
					to: "/$locale/online",
					params: { locale: activeLocale },
				});
			}}
		/>
	);
}

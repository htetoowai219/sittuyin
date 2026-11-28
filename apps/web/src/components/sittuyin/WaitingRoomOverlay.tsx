import type { PreferredSide, TimeControl } from "@sittuyin/shared";
import { Clock, Copy, KeyRound, Link2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { type AppLocale, m } from "@/i18n/locale";
import type { OnlineRoomLifecycleState } from "@/lib/adapters/types";

export interface WaitingRoomOverlayProps {
	readonly online: OnlineRoomLifecycleState;
	readonly locale: AppLocale;
	readonly onAbortRoom: () => void;
}

export function formatTimeControlLabel(
	tc: TimeControl,
	locale: AppLocale,
): string {
	switch (tc) {
		case "rapid_10_5":
			return m.time_control_rapid_10_5({}, { locale });
		case "rapid_15_10":
			return m.time_control_rapid_15_10({}, { locale });
		case "classical_30_0":
			return m.time_control_classical_30_0({}, { locale });
	}
}

export function formatPreferredSideLabel(
	side: PreferredSide,
	locale: AppLocale,
): string {
	switch (side) {
		case "red":
			return m.online_host_side_red({}, { locale });
		case "black":
			return m.online_host_side_black({}, { locale });
		case "random":
			return m.online_host_side_random({}, { locale });
	}
}

export function WaitingRoomOverlay({
	online,
	locale,
	onAbortRoom,
}: WaitingRoomOverlayProps) {
	const shareSlug = online.inviteCode ?? online.roomId;

	const handleCopyInviteLink = async () => {
		const origin =
			typeof window !== "undefined"
				? window.location.origin
				: "http://localhost:3000";
		const url = `${origin}/${locale}/room/${shareSlug}`;
		if (
			typeof navigator !== "undefined" &&
			typeof navigator.clipboard?.writeText === "function"
		) {
			await navigator.clipboard.writeText(url);
		}
		toast.success(m.waiting_copied_link_toast({}, { locale }));
	};

	const handleCopyInviteCode = async () => {
		const code = online.inviteCode ?? online.roomId;
		if (
			typeof navigator !== "undefined" &&
			typeof navigator.clipboard?.writeText === "function"
		) {
			await navigator.clipboard.writeText(code);
		}
		toast.success(m.waiting_copied_code_toast({}, { locale }));
	};

	return (
		<div
			data-testid="waiting-room-overlay"
			className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-background/85 p-4 backdrop-blur-sm"
		>
			<Card className="w-full max-w-md border-sit-ke-myin/50 bg-card shadow-xl">
				<CardHeader className="gap-2 text-center">
					<div className="mx-auto flex size-10 items-center justify-center rounded-full border border-sit-ke-myin/40 bg-surface-elevated text-sit-ke-myin">
						<Loader2 className="size-5 animate-spin" />
					</div>
					<CardTitle className="text-lg font-bold text-foreground">
						{online.roomTitle}
					</CardTitle>
					<CardDescription className="text-xs text-muted-foreground">
						{m.waiting_overlay_subtitle({}, { locale })}
					</CardDescription>
					<div className="flex flex-wrap items-center justify-center gap-2 pt-1">
						<Badge variant="secondary" data-testid="waiting-time-control-badge">
							<Clock className="size-3" />
							{formatTimeControlLabel(online.timeControl, locale)}
						</Badge>
						<Badge variant="outline" data-testid="waiting-preferred-side-badge">
							{formatPreferredSideLabel(online.hostPreferredSide, locale)}
						</Badge>
					</div>
				</CardHeader>

				<CardContent className="flex flex-col gap-3">
					{online.inviteCode ? (
						<div className="flex flex-col items-center gap-1.5 rounded-xl border border-sit-ke-myin/40 bg-surface-elevated/80 px-4 py-3">
							<span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
								<KeyRound className="size-3 text-sit-ke-myin" />
								{m.waiting_invite_code_label({}, { locale })}
							</span>
							<span
								data-testid="waiting-invite-code"
								className="font-mono text-2xl font-bold tracking-[0.25em] text-sit-ke-myin"
							>
								{online.inviteCode}
							</span>
						</div>
					) : null}

					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							variant="default"
							size="sm"
							data-testid="waiting-copy-link-btn"
							onClick={() => {
								void handleCopyInviteLink();
							}}
							className="flex-1"
						>
							<Link2 data-icon="inline-start" />
							{m.waiting_copy_link({}, { locale })}
						</Button>

						{online.inviteCode ? (
							<Button
								type="button"
								variant="secondary"
								size="sm"
								data-testid="waiting-copy-code-btn"
								onClick={() => {
									void handleCopyInviteCode();
								}}
								className="flex-1"
							>
								<Copy data-icon="inline-start" />
								{m.waiting_copy_code({}, { locale })}
							</Button>
						) : null}
					</div>
				</CardContent>

				<CardFooter className="justify-center border-t border-border-subtle pt-3">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						data-testid="waiting-abort-room-btn"
						onClick={onAbortRoom}
						className="w-full text-destructive hover:text-destructive"
					>
						<XCircle data-icon="inline-start" />
						{m.waiting_abort_room({}, { locale })}
					</Button>
				</CardFooter>
			</Card>
		</div>
	);
}

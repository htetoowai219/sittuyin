import { Link } from "@tanstack/react-router";
import { ExternalLink, LogOut, Pencil, ShieldCheck, User } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { type AppLocale, m } from "@/i18n/locale";
import { authClient } from "@/lib/auth-client";
import {
	type AccountSessionProfile,
	getCurrentSessionProfileFn,
	updatePlayerProfileFn,
} from "@/server/account";

export interface AccountMenuProps {
	readonly locale: AppLocale;
	readonly initialAccount?: AccountSessionProfile | null;
}

export function AccountMenu({ locale, initialAccount }: AccountMenuProps) {
	const [account, setAccount] = useState<AccountSessionProfile | null>(
		initialAccount ?? null,
	);
	const [open, setOpen] = useState(false);
	const [displayName, setDisplayName] = useState(
		initialAccount?.profile.displayName ?? "",
	);
	const [handle, setHandle] = useState(initialAccount?.profile.handle ?? "");
	const [handleError, setHandleError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (initialAccount !== undefined) {
			return;
		}
		let cancelled = false;
		void getCurrentSessionProfileFn()
			.then((res) => {
				if (cancelled || !res) return;
				setAccount(res);
				setDisplayName(res.profile.displayName);
				setHandle(res.profile.handle);
			})
			.catch(() => {
				// Read-only session lookup; ignore when DB/auth is not configured locally
			});
		return () => {
			cancelled = true;
		};
	}, [initialAccount]);

	const handleGoogleSignIn = async () => {
		const callbackURL =
			typeof window !== "undefined"
				? `${window.location.pathname}${window.location.search}`
				: `/${locale}`;
		await authClient.signIn.social({
			provider: "google",
			callbackURL,
		});
	};

	const handleSignOut = async () => {
		await authClient.signOut();
		setAccount(null);
		setOpen(false);
	};

	const handleSaveProfile = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		setSaving(true);
		setHandleError(null);
		try {
			const res = await updatePlayerProfileFn({
				data: {
					displayName: displayName.trim(),
					handle: handle.trim().toLowerCase(),
				},
			});
			if (!res.ok && res.code === "HANDLE_TAKEN") {
				setHandleError(m.account_handle_taken({}, { locale }));
				return;
			}
			if (res.ok && account) {
				setAccount({ ...account, profile: res.profile });
				setDisplayName(res.profile.displayName);
				setHandle(res.profile.handle);
				toast.success(m.account_saved_toast({}, { locale }));
				setOpen(false);
			}
		} finally {
			setSaving(false);
		}
	};

	if (!account) {
		return (
			<Button
				type="button"
				variant="outline"
				size="sm"
				data-testid="header-google-signin-btn"
				onClick={() => {
					void handleGoogleSignIn();
				}}
				className="h-8 gap-1.5 px-2 text-xs sm:h-9 sm:px-3"
			>
				<User className="size-3.5" />
				<span className="hidden md:inline">
					{m.account_sign_in_google({}, { locale })}
				</span>
			</Button>
		);
	}

	const { user, profile } = account;
	const ratingLabel = `${Math.round(profile.rating)}${profile.isProvisional ? "?" : ""}`;

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					data-testid="header-account-trigger"
					className="h-8 max-w-44 gap-1.5 px-2 text-xs sm:h-9 sm:max-w-56 sm:px-3"
				>
					{user.isAnonymous ? (
						<User className="size-3.5 shrink-0 text-muted-foreground" />
					) : (
						<ShieldCheck className="size-3.5 shrink-0 text-emerald-500" />
					)}
					<span className="truncate font-medium">{profile.displayName}</span>
					<Badge
						variant="secondary"
						title={
							profile.isProvisional
								? m.account_provisional_hint({}, { locale })
								: undefined
						}
						className="px-1.5 py-0 text-[10px] font-mono"
					>
						{ratingLabel}
					</Badge>
				</Button>
			</DialogTrigger>

			<DialogContent
				data-testid="account-profile-dialog"
				className="border-border-subtle bg-card sm:max-w-md"
			>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2 text-base font-bold">
						<Pencil className="size-4" />
						{m.account_edit_profile({}, { locale })}
					</DialogTitle>
					<DialogDescription className="flex items-center gap-2 text-xs">
						<Badge variant={user.isAnonymous ? "secondary" : "default"}>
							{user.isAnonymous
								? m.account_guest_label({}, { locale })
								: m.account_google_label({}, { locale })}
						</Badge>
						<span className="font-mono text-foreground">{ratingLabel}</span>
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						void handleSaveProfile(e);
					}}
					className="flex flex-col gap-4"
				>
					<FieldGroup className="gap-3">
						<Field>
							<FieldLabel htmlFor="account-display-name-input">
								{m.account_display_name_label({}, { locale })}
							</FieldLabel>
							<Input
								id="account-display-name-input"
								data-testid="account-display-name-input"
								maxLength={32}
								value={displayName}
								onChange={(e) => setDisplayName(e.target.value)}
							/>
						</Field>

						<Field>
							<FieldLabel htmlFor="account-handle-input">
								{m.account_handle_label({}, { locale })}
							</FieldLabel>
							<Input
								id="account-handle-input"
								data-testid="account-handle-input"
								maxLength={24}
								value={handle}
								onChange={(e) => {
									setHandle(e.target.value);
									setHandleError(null);
								}}
							/>
							{handleError ? (
								<p className="text-xs text-destructive">{handleError}</p>
							) : null}
						</Field>
					</FieldGroup>

					<DialogFooter className="flex-col gap-2 sm:flex-col">
						<Button
							type="submit"
							disabled={saving}
							data-testid="account-save-btn"
							className="w-full"
						>
							{saving
								? m.account_saving({}, { locale })
								: m.account_save({}, { locale })}
						</Button>

						<Button
							asChild
							variant="secondary"
							data-testid="account-my-profile-link"
							className="w-full"
						>
							<Link
								to="/$locale/u/$handle"
								params={{ locale, handle: profile.handle }}
								onClick={() => setOpen(false)}
							>
								<ExternalLink data-icon="inline-start" />
								{m.account_my_profile({}, { locale })}
							</Link>
						</Button>

						{user.isAnonymous ? (
							<Button
								type="button"
								variant="outline"
								data-testid="account-upgrade-google-btn"
								onClick={() => {
									void handleGoogleSignIn();
								}}
								className="w-full"
							>
								{m.account_sign_in_google({}, { locale })}
							</Button>
						) : (
							<Button
								type="button"
								variant="ghost"
								data-testid="account-signout-btn"
								onClick={() => {
									void handleSignOut();
								}}
								className="w-full text-destructive hover:text-destructive"
							>
								<LogOut className="mr-1.5 size-3.5" />
								{m.account_sign_out({}, { locale })}
							</Button>
						)}
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

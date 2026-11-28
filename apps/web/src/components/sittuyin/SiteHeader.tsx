import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
	Globe,
	Moon,
	Play,
	RotateCcw,
	Sun,
	Swords,
	Trophy,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	type AppLocale,
	getOtherLocale,
	m,
	setLocaleCookie,
} from "@/i18n/locale";
import { useBoardPreferencesStore } from "@/stores/board-preferences";
import { AccountMenu } from "./AccountMenu";
import { SittuyinPieceSvg } from "./SittuyinPieceSvg";

export interface SiteHeaderProps {
	readonly locale: AppLocale;
}

export function SiteHeader({ locale }: SiteHeaderProps) {
	const theme = useBoardPreferencesStore((s) => s.theme);
	const toggleTheme = useBoardPreferencesStore((s) => s.toggleTheme);
	const location = useLocation();
	const navigate = useNavigate();

	const otherLocale = getOtherLocale(locale);

	const handleLocaleSwitch = () => {
		setLocaleCookie(otherLocale);
		const pathname = location.pathname;
		const rest = pathname.replace(/^\/(my|en)(?=\/|$)/, "");
		const targetPath = `/${otherLocale}${rest}`;
		void navigate({ to: targetPath, search: location.search });
	};

	const isPlay = location.pathname.includes("/play");
	const isOnline =
		location.pathname.includes("/online") ||
		location.pathname.includes("/room/");
	const isLeaderboard = location.pathname.includes("/leaderboard");
	const isReplay =
		location.pathname.includes("/replay") ||
		location.pathname.includes("/match/");
	const isProfile = location.pathname.includes("/u/");
	const isHome =
		!isPlay && !isOnline && !isLeaderboard && !isReplay && !isProfile;

	return (
		<header className="sticky top-0 z-20 border-b border-border-subtle/80 bg-surface/92 backdrop-blur-md">
			<div className="mx-auto flex max-w-6xl items-center justify-between gap-1.5 px-2.5 py-2 sm:gap-3 sm:px-5 sm:py-2.5">
				<Link
					to="/$locale"
					params={{ locale }}
					aria-label={m.app_title({}, { locale })}
					className="flex shrink-0 items-center gap-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<SittuyinPieceSvg
						pieceRole="king"
						side="red"
						className="size-8 shrink-0 sm:size-9"
					/>
					<div className="hidden min-w-0 flex-col sm:flex">
						<span className="truncate text-sm font-bold tracking-tight text-foreground sm:text-base">
							{m.app_title({}, { locale })}
						</span>
						<span className="truncate text-[11px] text-muted-foreground">
							{m.app_subtitle({}, { locale })}
						</span>
					</div>
				</Link>

				<nav
					aria-label="Primary"
					className="flex min-w-0 shrink items-center gap-1 sm:gap-1.5"
				>
					<Button
						asChild
						variant={isHome ? "secondary" : "ghost"}
						size="sm"
						className="hidden md:inline-flex"
					>
						<Link to="/$locale" params={{ locale }}>
							{m.nav_home({}, { locale })}
						</Link>
					</Button>
					<Button
						asChild
						variant={isOnline ? "default" : "ghost"}
						size="sm"
						className="h-8 gap-1 px-2 sm:h-9 sm:px-3"
					>
						<Link
							to="/$locale/online"
							params={{ locale }}
							data-testid="nav-online-link"
						>
							<Swords
								data-icon="inline-start"
								className="hidden min-[380px]:inline"
							/>
							<span className="text-xs sm:text-sm">
								{m.nav_online({}, { locale })}
							</span>
						</Link>
					</Button>
					<Button
						asChild
						variant={isPlay ? "default" : "ghost"}
						size="sm"
						className="h-8 gap-1 px-2 sm:h-9 sm:px-3"
					>
						<Link to="/$locale/play" params={{ locale }}>
							<Play
								data-icon="inline-start"
								className="hidden min-[380px]:inline"
							/>
							<span className="text-xs sm:text-sm">
								{m.nav_play({}, { locale })}
							</span>
						</Link>
					</Button>
					<Button
						asChild
						variant={isLeaderboard ? "secondary" : "ghost"}
						size="sm"
						className="h-8 gap-1 px-2 sm:h-9 sm:px-3"
					>
						<Link
							to="/$locale/leaderboard"
							params={{ locale }}
							data-testid="nav-leaderboard-link"
						>
							<Trophy
								data-icon="inline-start"
								className="hidden min-[380px]:inline"
							/>
							<span className="text-xs sm:text-sm">
								{m.nav_leaderboard({}, { locale })}
							</span>
						</Link>
					</Button>
					<Button
						asChild
						variant={isReplay ? "secondary" : "ghost"}
						size="sm"
						className="h-8 gap-1 px-2 sm:h-9 sm:px-3"
					>
						<Link to="/$locale/replay" params={{ locale }}>
							<RotateCcw
								data-icon="inline-start"
								className="hidden min-[380px]:inline"
							/>
							<span className="text-xs sm:text-sm">
								{m.nav_replay({}, { locale })}
							</span>
						</Link>
					</Button>

					<Button
						type="button"
						variant="outline"
						size="icon-sm"
						data-testid="header-theme-toggle"
						aria-label={
							theme === "dark"
								? m.action_theme_light({}, { locale })
								: m.action_theme_dark({}, { locale })
						}
						onClick={toggleTheme}
					>
						{theme === "dark" ? <Sun /> : <Moon />}
					</Button>

					<Button
						type="button"
						variant="outline"
						size="sm"
						data-testid="locale-switch-btn"
						aria-label={m.nav_locale_switch({}, { locale })}
						onClick={handleLocaleSwitch}
						className="h-8 px-2 sm:h-9 sm:px-3"
					>
						<Globe data-icon="inline-start" className="hidden sm:inline" />
						<span className="text-xs font-medium sm:hidden">
							{otherLocale === "en" ? "EN" : "မြန်"}
						</span>
						<span className="hidden text-xs font-medium sm:inline">
							{m.nav_locale_switch({}, { locale })}
						</span>
					</Button>

					<AccountMenu locale={locale} />
				</nav>
			</div>
		</header>
	);
}

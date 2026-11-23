import { TanStackDevtools } from "@tanstack/react-devtools";
import {
	createRootRoute,
	HeadContent,
	Scripts,
	useRouterState,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { type ReactNode, useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getActiveLocale, isAppLocale } from "@/i18n/locale";
import { useBoardPreferencesStore } from "@/stores/board-preferences";
import appCss from "../styles.css?url";

const GOOGLE_FONTS_HREF =
	"https://fonts.googleapis.com/css2?family=Noto+Sans+Myanmar:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap";

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "မြန်မာ့ စစ်တုရင် · Sittuyin",
			},
		],
		links: [
			{
				rel: "preconnect",
				href: "https://fonts.googleapis.com",
			},
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous",
			},
			{
				rel: "stylesheet",
				href: GOOGLE_FONTS_HREF,
			},
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),
	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: ReactNode }) {
	const theme = useBoardPreferencesStore((state) => state.theme);
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const firstSegment = pathname.split("/")[1];
	const activeLocale = isAppLocale(firstSegment)
		? firstSegment
		: getActiveLocale();

	useEffect(() => {
		void useBoardPreferencesStore.persist.rehydrate();
	}, []);

	useEffect(() => {
		document.documentElement.setAttribute("data-theme", theme);
	}, [theme]);

	useEffect(() => {
		document.documentElement.setAttribute("lang", activeLocale);
	}, [activeLocale]);

	return (
		<html lang={activeLocale} data-theme={theme} suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body className="min-h-screen bg-table text-text-primary antialiased">
				<TooltipProvider delayDuration={250}>
					{children}
					<Toaster position="bottom-center" richColors />
				</TooltipProvider>
				{import.meta.env.DEV ? (
					<TanStackDevtools
						config={{
							position: "bottom-right",
						}}
						plugins={[
							{
								name: "Tanstack Router",
								render: <TanStackRouterDevtoolsPanel />,
							},
						]}
					/>
				) : null}
				<Scripts />
			</body>
		</html>
	);
}

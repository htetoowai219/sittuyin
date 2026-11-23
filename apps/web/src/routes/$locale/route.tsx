import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { SiteHeader } from "@/components/sittuyin/SiteHeader";
import { DEFAULT_LOCALE, isAppLocale } from "@/i18n/locale";

export const Route = createFileRoute("/$locale")({
	beforeLoad: ({ params, location }) => {
		if (!isAppLocale(params.locale)) {
			const suffix = location.pathname.replace(/^\/[^/]+/, "");
			throw redirect({
				to: `/${DEFAULT_LOCALE}${suffix}` as "/$locale",
				params: { locale: DEFAULT_LOCALE },
			});
		}
	},
	component: LocaleLayout,
});

function LocaleLayout() {
	const { locale } = Route.useParams();
	const activeLocale = isAppLocale(locale) ? locale : DEFAULT_LOCALE;

	return (
		<div className="flex min-h-screen flex-col bg-table text-text-primary">
			<SiteHeader locale={activeLocale} />
			<main className="flex-1">
				<Outlet />
			</main>
		</div>
	);
}

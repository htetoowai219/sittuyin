import { createFileRoute, redirect } from "@tanstack/react-router";
import { getActiveLocale, readLocaleCookie } from "@/i18n/locale";

export const Route = createFileRoute("/")({
	beforeLoad: () => {
		const preferred = readLocaleCookie() ?? getActiveLocale();
		throw redirect({
			to: "/$locale",
			params: { locale: preferred },
		});
	},
	component: () => null,
});

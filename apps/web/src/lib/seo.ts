export interface SeoHeadInput {
	readonly title: string;
	readonly description: string;
	readonly canonicalPath: string;
	readonly noindex?: boolean;
}

const DEFAULT_OG_IMAGE_PATH = "/og-card.svg";

function resolveAbsoluteUrl(path: string): string {
	const base =
		typeof import.meta !== "undefined" &&
		typeof import.meta.env?.VITE_SITE_URL === "string" &&
		import.meta.env.VITE_SITE_URL.trim().length > 0
			? import.meta.env.VITE_SITE_URL.trim().replace(/\/+$/, "")
			: "";
	if (!base) {
		return path;
	}
	return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export function buildSeoHead(input: SeoHeadInput) {
	const canonicalUrl = resolveAbsoluteUrl(input.canonicalPath);
	const ogImageUrl = resolveAbsoluteUrl(DEFAULT_OG_IMAGE_PATH);

	const meta: Array<Record<string, string>> = [
		{ title: input.title },
		{ name: "description", content: input.description },
		{ property: "og:type", content: "website" },
		{ property: "og:title", content: input.title },
		{ property: "og:description", content: input.description },
		{ property: "og:url", content: canonicalUrl },
		{ property: "og:image", content: ogImageUrl },
		{ name: "twitter:card", content: "summary_large_image" },
		{ name: "twitter:title", content: input.title },
		{ name: "twitter:description", content: input.description },
		{ name: "twitter:image", content: ogImageUrl },
	];

	if (input.noindex) {
		meta.push({ name: "robots", content: "noindex, nofollow" });
	}

	return {
		meta,
		links: [
			{
				rel: "canonical",
				href: canonicalUrl,
			},
		],
	};
}

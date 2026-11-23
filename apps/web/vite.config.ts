import { cloudflare } from "@cloudflare/vite-plugin";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const config = defineConfig({
	resolve: {
		tsconfigPaths: true,
		dedupe: ["react", "react-dom"],
	},
	plugins: [
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/paraglide",
			cookieName: "sittuyin_locale",
			strategy: ["url", "cookie", "baseLocale"],
			disableAsyncLocalStorage: false,
			emitTsDeclarations: true,
			urlPatterns: [
				{
					pattern: "/:path(.*)?",
					localized: [
						["my", "/my/:path(.*)?"],
						["en", "/en/:path(.*)?"],
					],
				},
			],
		}),
		devtools(),
		cloudflare({ viteEnvironment: { name: "ssr" } }),
		tailwindcss(),
		tanstackStart(),
		viteReact(),
	],
});

export default config;

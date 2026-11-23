import { paraglideVitePlugin } from "@inlang/paraglide-js";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: { tsconfigPaths: true },
	plugins: [
		paraglideVitePlugin({
			project: "./project.inlang",
			outdir: "./src/paraglide",
			cookieName: "sittuyin_locale",
			strategy: ["url", "cookie", "baseLocale"],
			disableAsyncLocalStorage: false,
			emitTsDeclarations: true,
		}),
		viteReact(),
	],
	test: {
		passWithNoTests: true,
	},
});

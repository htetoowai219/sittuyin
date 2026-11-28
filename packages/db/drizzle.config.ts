import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "postgresql",
	schema: [
		"./src/schema/auth-schema.ts",
		"./src/schema/player-profiles.ts",
		"./src/schema/matches.ts",
	],
	out: "./drizzle",
	dbCredentials: {
		url:
			process.env.DATABASE_URL_UNPOOLED ??
			process.env.DATABASE_URL ??
			"postgresql://postgres:postgres@localhost:5432/sittuyin",
	},
});

import { timingSafeEqual } from "node:crypto";
import { ENGINE_METADATA } from "@sittuyin/engine";
import { SITTUYIN_ROOM_NAME } from "@sittuyin/shared";
import { defineRoom, defineServer, monitor, playground } from "colyseus";
import type { NextFunction, Request, Response } from "express";
import { SittuyinRoom } from "./rooms/SittuyinRoom.js";

function parseAllowedOrigins(): Set<string> {
	const raw = process.env.ALLOWED_ORIGINS ?? "http://localhost:3000";
	return new Set(
		raw
			.split(",")
			.map((origin) => origin.trim())
			.filter(Boolean),
	);
}

function createMonitorBasicAuth(secret: string) {
	const expected = Buffer.from(`admin:${secret}`, "utf8");

	return (req: Request, res: Response, next: NextFunction) => {
		const header = req.headers.authorization;
		if (!header?.startsWith("Basic ")) {
			res.setHeader("WWW-Authenticate", 'Basic realm="Colyseus Monitor"');
			res.status(401).send("Unauthorized");
			return;
		}

		const decoded = Buffer.from(header.slice(6), "base64");
		if (
			decoded.length !== expected.length ||
			!timingSafeEqual(decoded, expected)
		) {
			res.setHeader("WWW-Authenticate", 'Basic realm="Colyseus Monitor"');
			res.status(401).send("Unauthorized");
			return;
		}

		next();
	};
}

export const server = defineServer({
	rooms: {
		[SITTUYIN_ROOM_NAME]: defineRoom(SittuyinRoom),
	},

	express: (app) => {
		const allowedOrigins = parseAllowedOrigins();
		const isProduction = process.env.NODE_ENV === "production";

		app.use((req, res, next) => {
			const origin = req.headers.origin;
			if (origin && allowedOrigins.has(origin)) {
				res.setHeader("Access-Control-Allow-Origin", origin);
				res.setHeader("Vary", "Origin");
				res.setHeader(
					"Access-Control-Allow-Headers",
					"Authorization, Content-Type",
				);
				res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
			}

			if (req.method === "OPTIONS") {
				res.status(204).end();
				return;
			}

			next();
		});

		app.get("/health", (_req, res) => {
			res.status(200).json({
				ok: true,
				service: "sittuyin-server",
				engine: ENGINE_METADATA.name,
				boardSize: ENGINE_METADATA.boardSize,
			});
		});

		if (!isProduction) {
			app.use("/monitor", monitor());
			app.use("/", playground());
		} else if (process.env.MONITOR_AUTH_SECRET) {
			app.use(
				"/monitor",
				createMonitorBasicAuth(process.env.MONITOR_AUTH_SECRET),
				monitor(),
			);
		}
	},
});

export default server;

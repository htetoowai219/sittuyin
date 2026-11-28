import { timingSafeEqual } from "node:crypto";
import { ENGINE_METADATA } from "@sittuyin/engine";
import { SITTUYIN_LOBBY_ROOM_NAME, SITTUYIN_ROOM_NAME } from "@sittuyin/shared";
import {
	defineRoom,
	defineServer,
	LobbyRoom,
	monitor,
	playground,
} from "colyseus";
import express, {
	type NextFunction,
	type Request,
	type Response,
} from "express";
import { maintenanceController } from "./maintenance.js";
import { SittuyinRoom } from "./rooms/SittuyinRoom.js";

export const DEFAULT_DEV_MONITOR_SECRET = "sittuyin-dev-monitor-secret";

function parseAllowedOrigins(): Set<string> {
	const raw = process.env.ALLOWED_ORIGINS ?? "http://localhost:3000";
	return new Set(
		raw
			.split(",")
			.map((origin) => origin.trim())
			.filter(Boolean),
	);
}

export function createMonitorBasicAuth(secretResolver: () => string) {
	return (req: Request, res: Response, next: NextFunction) => {
		const secret = secretResolver();
		if (!secret) {
			res.setHeader("WWW-Authenticate", 'Basic realm="Colyseus Monitor"');
			res.status(401).send("Unauthorized");
			return;
		}

		const expected = Buffer.from(`admin:${secret}`, "utf8");
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

function resolveMonitorSecret(): string {
	const envSecret = process.env.MONITOR_AUTH_SECRET?.trim();
	if (envSecret && envSecret.length > 0) {
		return envSecret;
	}
	if (process.env.NODE_ENV === "production") {
		return "";
	}
	return DEFAULT_DEV_MONITOR_SECRET;
}

export const server = defineServer({
	rooms: {
		[SITTUYIN_ROOM_NAME]: defineRoom(SittuyinRoom).enableRealtimeListing(),
		[SITTUYIN_LOBBY_ROOM_NAME]: defineRoom(LobbyRoom),
	},

	express: (app) => {
		const isProduction = process.env.NODE_ENV === "production";
		const basicAuthMiddleware = createMonitorBasicAuth(resolveMonitorSecret);

		app.use(express.json());

		app.use((req, res, next) => {
			const allowedOrigins = parseAllowedOrigins();
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
				maintenanceLocked: maintenanceController.isMaintenanceLocked(),
				activeRooms: maintenanceController.getActiveRoomCount(),
			});
		});

		app.post(
			"/admin/maintenance",
			basicAuthMiddleware,
			(req: Request, res: Response) => {
				const body = req.body as
					| { locked?: unknown; reason?: unknown }
					| undefined;

				if (!body || typeof body.locked !== "boolean") {
					res.status(400).json({
						ok: false,
						error: "Invalid payload: expected boolean 'locked'",
					});
					return;
				}

				const reason =
					typeof body.reason === "string" && body.reason.trim().length > 0
						? body.reason.trim()
						: "Server maintenance in progress";

				const notifiedRooms = maintenanceController.setMaintenanceLock(
					body.locked,
					reason,
				);

				res.status(200).json({
					ok: true,
					maintenanceLocked: maintenanceController.isMaintenanceLocked(),
					notifiedRooms,
				});
			},
		);

		if (!isProduction) {
			app.use("/monitor", monitor());
			app.use("/", playground());
		} else {
			app.use("/monitor", basicAuthMiddleware, monitor());
		}
	},
});

export default server;

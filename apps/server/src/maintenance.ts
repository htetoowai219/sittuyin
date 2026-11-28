import { closeSharedServerDb } from "./rooms/persistence.js";

export interface MaintenanceRoomTarget {
	readonly roomId: string;
	notifyMaintenance(reason: string): void;
	handleServerShutdown(reason?: string): Promise<void>;
}

export class MaintenanceController {
	private locked = false;
	private reason = "Server maintenance in progress";
	private readonly rooms = new Map<string, MaintenanceRoomTarget>();

	isMaintenanceLocked(): boolean {
		return this.locked;
	}

	getMaintenanceReason(): string {
		return this.reason;
	}

	registerRoom(room: MaintenanceRoomTarget): void {
		this.rooms.set(room.roomId, room);
	}

	unregisterRoom(roomId: string): void {
		this.rooms.delete(roomId);
	}

	getActiveRoomCount(): number {
		return this.rooms.size;
	}

	setMaintenanceLock(
		locked: boolean,
		reason: string = "Server maintenance in progress",
	): number {
		this.locked = locked;
		this.reason = reason;

		if (!locked) {
			return 0;
		}

		let notified = 0;
		for (const room of this.rooms.values()) {
			room.notifyMaintenance(reason);
			notified++;
		}
		return notified;
	}

	async shutdownAllRooms(
		reason: string = "Server shutting down for deploy maintenance",
	): Promise<void> {
		this.locked = true;
		this.reason = reason;

		const targets = Array.from(this.rooms.values());
		await Promise.allSettled(
			targets.map((room) => room.handleServerShutdown(reason)),
		);
		await closeSharedServerDb();
	}

	reset(): void {
		this.locked = false;
		this.reason = "Server maintenance in progress";
		this.rooms.clear();
	}
}

export const maintenanceController = new MaintenanceController();

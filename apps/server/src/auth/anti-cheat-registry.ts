import type { Side } from "@sittuyin/engine";

export class UsedJtiStore {
	private readonly store = new Map<string, number>();

	consume(
		jti: string,
		expSeconds: number,
		nowMs: number = Date.now(),
	): boolean {
		this.prune(nowMs);
		const existingExpiry = this.store.get(jti);
		if (existingExpiry !== undefined && existingExpiry > nowMs) {
			return false;
		}
		const expiresAtMs = Math.max(expSeconds * 1000 + 5_000, nowMs + 60_000);
		this.store.set(jti, expiresAtMs);
		return true;
	}

	prune(nowMs: number = Date.now()): void {
		for (const [jti, expiresAtMs] of this.store.entries()) {
			if (expiresAtMs <= nowMs) {
				this.store.delete(jti);
			}
		}
	}

	size(): number {
		return this.store.size;
	}

	clear(): void {
		this.store.clear();
	}
}

export interface ActivePlayerSeat {
	readonly roomId: string;
	readonly sessionId: string;
	readonly side: Side;
}

export class ActivePlayerRoomMap {
	private readonly seats = new Map<string, ActivePlayerSeat>();

	get(userId: string): ActivePlayerSeat | undefined {
		return this.seats.get(userId);
	}

	hasOtherRoomMatch(userId: string, currentRoomId?: string): boolean {
		const existing = this.seats.get(userId);
		if (!existing) return false;
		if (currentRoomId && existing.roomId === currentRoomId) {
			return false;
		}
		return true;
	}

	claim(userId: string, seat: ActivePlayerSeat): boolean {
		const existing = this.seats.get(userId);
		if (existing && existing.roomId !== seat.roomId) {
			return false;
		}
		this.seats.set(userId, seat);
		return true;
	}

	releaseUser(userId: string, roomId?: string): void {
		const existing = this.seats.get(userId);
		if (!existing) return;
		if (!roomId || existing.roomId === roomId) {
			this.seats.delete(userId);
		}
	}

	releaseRoom(roomId: string): void {
		for (const [userId, seat] of this.seats.entries()) {
			if (seat.roomId === roomId) {
				this.seats.delete(userId);
			}
		}
	}

	size(): number {
		return this.seats.size;
	}

	clear(): void {
		this.seats.clear();
	}
}

export const usedJtiStore = new UsedJtiStore();
export const activePlayerRoomMap = new ActivePlayerRoomMap();

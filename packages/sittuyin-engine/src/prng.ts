export function hashSeed(seed: string | number): number {
	const input = String(seed);
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export function createPrng(seed: string | number): () => number {
	let state = hashSeed(seed);
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function shuffleDeterministic<T>(
	items: readonly T[],
	nextRandom: () => number,
): T[] {
	const copy = [...items];
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(nextRandom() * (i + 1));
		const tmp = copy[i];
		const swap = copy[j];
		if (tmp !== undefined && swap !== undefined) {
			copy[i] = swap;
			copy[j] = tmp;
		}
	}
	return copy;
}

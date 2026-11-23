// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BOARD_PREFS_STORAGE_KEY,
	DEFAULT_BOARD_PREFERENCES,
	getAnimationDurationMs,
	useBoardPreferencesStore,
} from "./board-preferences";

describe("useBoardPreferencesStore", () => {
	beforeEach(() => {
		window.localStorage.clear();
		useBoardPreferencesStore.setState({
			...DEFAULT_BOARD_PREFERENCES,
			hasHydrated: false,
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("starts with dark lacquer defaults and unhydrated state for SSR safety", () => {
		const state = useBoardPreferencesStore.getState();
		expect(state.theme).toBe("dark");
		expect(state.soundEnabled).toBe(true);
		expect(state.soundVolume).toBe(0.75);
		expect(state.pieceScriptOverlay).toBe(false);
		expect(state.showLegalHints).toBe(true);
		expect(state.showCoordinates).toBe(true);
		expect(state.highlightSitKeMyin).toBe(true);
		expect(state.confirmPromotion).toBe(true);
		expect(state.animationSpeed).toBe("normal");
		expect(state.hasHydrated).toBe(false);
	});

	it("persists updates under sittuyin.board.prefs.v1 and rehydrates post mount", async () => {
		useBoardPreferencesStore.getState().setTheme("light");
		useBoardPreferencesStore.getState().setSoundVolume(1.4);
		useBoardPreferencesStore.getState().toggleScriptOverlay();
		useBoardPreferencesStore.getState().setAnimationSpeed("fast");

		const raw = window.localStorage.getItem(BOARD_PREFS_STORAGE_KEY);
		expect(raw).not.toBeNull();
		const parsed = JSON.parse(raw ?? "{}") as {
			version: number;
			state: Record<string, unknown>;
		};
		expect(parsed.version).toBe(1);
		expect(parsed.state.theme).toBe("light");
		expect(parsed.state.soundVolume).toBe(1);
		expect(parsed.state.pieceScriptOverlay).toBe(true);
		expect(parsed.state.animationSpeed).toBe("fast");

		// Reset in memory, restore saved snapshot in localStorage, then rehydrate
		useBoardPreferencesStore.setState({
			...DEFAULT_BOARD_PREFERENCES,
			hasHydrated: false,
		});
		window.localStorage.setItem(BOARD_PREFS_STORAGE_KEY, raw ?? "");
		await useBoardPreferencesStore.persist.rehydrate();
		const rehydrated = useBoardPreferencesStore.getState();
		expect(rehydrated.theme).toBe("light");
		expect(rehydrated.soundVolume).toBe(1);
		expect(rehydrated.pieceScriptOverlay).toBe(true);
		expect(rehydrated.hasHydrated).toBe(true);
	});

	it("falls back safely when localStorage contains corrupt JSON", async () => {
		window.localStorage.setItem(BOARD_PREFS_STORAGE_KEY, "{bad-json");
		await expect(
			useBoardPreferencesStore.persist.rehydrate(),
		).resolves.toBeUndefined();
		const state = useBoardPreferencesStore.getState();
		expect(state.theme).toBe("dark");
		expect(state.hasHydrated).toBe(true);
	});

	it("does not throw when localStorage access is blocked", async () => {
		vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
			throw new DOMException("SecurityError");
		});
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new DOMException("QuotaExceededError");
		});

		expect(() => {
			useBoardPreferencesStore.getState().setTheme("light");
		}).not.toThrow();
		await expect(
			useBoardPreferencesStore.persist.rehydrate(),
		).resolves.toBeUndefined();
	});

	it("maps animationSpeed to millisecond durations", () => {
		expect(getAnimationDurationMs("normal")).toBe(180);
		expect(getAnimationDurationMs("fast")).toBe(100);
		expect(getAnimationDurationMs("none")).toBe(0);
	});
});

import { create } from "zustand";
import {
	createJSONStorage,
	persist,
	type StateStorage,
} from "zustand/middleware";

export type BoardTheme = "dark" | "light";
export type AnimationSpeed = "normal" | "fast" | "none";

export interface BoardPreferences {
	theme: BoardTheme;
	soundEnabled: boolean;
	soundVolume: number;
	pieceScriptOverlay: boolean;
	showLegalHints: boolean;
	showCoordinates: boolean;
	highlightSitKeMyin: boolean;
	confirmPromotion: boolean;
	animationSpeed: AnimationSpeed;
}

export interface BoardPreferencesState extends BoardPreferences {
	hasHydrated: boolean;
	setTheme: (theme: BoardTheme) => void;
	toggleTheme: () => void;
	setSoundEnabled: (enabled: boolean) => void;
	toggleSound: () => void;
	setSoundVolume: (volume: number) => void;
	setPieceScriptOverlay: (enabled: boolean) => void;
	toggleScriptOverlay: () => void;
	setShowLegalHints: (enabled: boolean) => void;
	toggleLegalHints: () => void;
	setShowCoordinates: (enabled: boolean) => void;
	toggleCoordinates: () => void;
	setHighlightSitKeMyin: (enabled: boolean) => void;
	toggleSitKeMyin: () => void;
	setConfirmPromotion: (enabled: boolean) => void;
	setAnimationSpeed: (speed: AnimationSpeed) => void;
	resetDefaults: () => void;
	_setHasHydrated: (hydrated: boolean) => void;
}

export const BOARD_PREFS_STORAGE_KEY = "sittuyin.board.prefs.v1";

export const DEFAULT_BOARD_PREFERENCES: Readonly<BoardPreferences> = {
	theme: "dark",
	soundEnabled: true,
	soundVolume: 0.75,
	pieceScriptOverlay: false,
	showLegalHints: true,
	showCoordinates: true,
	highlightSitKeMyin: true,
	confirmPromotion: true,
	animationSpeed: "normal",
};

function clampVolume(volume: number): number {
	if (!Number.isFinite(volume)) {
		return DEFAULT_BOARD_PREFERENCES.soundVolume;
	}
	return Math.max(0, Math.min(1, volume));
}

function sanitizePersistedPrefs(raw: unknown): Partial<BoardPreferences> {
	if (typeof raw !== "object" || raw === null) {
		return {};
	}
	const input = raw as Record<string, unknown>;
	const next: Partial<BoardPreferences> = {};

	if (input.theme === "dark" || input.theme === "light") {
		next.theme = input.theme;
	}
	if (typeof input.soundEnabled === "boolean") {
		next.soundEnabled = input.soundEnabled;
	}
	if (typeof input.soundVolume === "number") {
		next.soundVolume = clampVolume(input.soundVolume);
	}
	if (typeof input.pieceScriptOverlay === "boolean") {
		next.pieceScriptOverlay = input.pieceScriptOverlay;
	}
	if (typeof input.showLegalHints === "boolean") {
		next.showLegalHints = input.showLegalHints;
	}
	if (typeof input.showCoordinates === "boolean") {
		next.showCoordinates = input.showCoordinates;
	}
	if (typeof input.highlightSitKeMyin === "boolean") {
		next.highlightSitKeMyin = input.highlightSitKeMyin;
	}
	if (typeof input.confirmPromotion === "boolean") {
		next.confirmPromotion = input.confirmPromotion;
	}
	if (
		input.animationSpeed === "normal" ||
		input.animationSpeed === "fast" ||
		input.animationSpeed === "none"
	) {
		next.animationSpeed = input.animationSpeed;
	}
	return next;
}

const memoryFallback = new Map<string, string>();

const safeBrowserStorage: StateStorage = {
	getItem(name: string): string | null {
		if (typeof window === "undefined") {
			return null;
		}
		try {
			const raw = window.localStorage.getItem(name);
			if (raw === null) {
				return null;
			}
			// Guard against corrupt JSON before Zustand parses it
			JSON.parse(raw);
			return raw;
		} catch {
			return memoryFallback.get(name) ?? null;
		}
	},
	setItem(name: string, value: string): void {
		if (typeof window === "undefined") {
			return;
		}
		try {
			window.localStorage.setItem(name, value);
		} catch {
			memoryFallback.set(name, value);
		}
	},
	removeItem(name: string): void {
		if (typeof window === "undefined") {
			return;
		}
		try {
			window.localStorage.removeItem(name);
		} catch {
			memoryFallback.delete(name);
		}
	},
};

export const useBoardPreferencesStore = create<BoardPreferencesState>()(
	persist(
		(set) => ({
			...DEFAULT_BOARD_PREFERENCES,
			hasHydrated: false,
			setTheme: (theme) => set({ theme }),
			toggleTheme: () =>
				set((state) => ({
					theme: state.theme === "dark" ? "light" : "dark",
				})),
			setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
			toggleSound: () =>
				set((state) => ({ soundEnabled: !state.soundEnabled })),
			setSoundVolume: (soundVolume) =>
				set({ soundVolume: clampVolume(soundVolume) }),
			setPieceScriptOverlay: (pieceScriptOverlay) =>
				set({ pieceScriptOverlay }),
			toggleScriptOverlay: () =>
				set((state) => ({ pieceScriptOverlay: !state.pieceScriptOverlay })),
			setShowLegalHints: (showLegalHints) => set({ showLegalHints }),
			toggleLegalHints: () =>
				set((state) => ({ showLegalHints: !state.showLegalHints })),
			setShowCoordinates: (showCoordinates) => set({ showCoordinates }),
			toggleCoordinates: () =>
				set((state) => ({ showCoordinates: !state.showCoordinates })),
			setHighlightSitKeMyin: (highlightSitKeMyin) =>
				set({ highlightSitKeMyin }),
			toggleSitKeMyin: () =>
				set((state) => ({ highlightSitKeMyin: !state.highlightSitKeMyin })),
			setConfirmPromotion: (confirmPromotion) => set({ confirmPromotion }),
			setAnimationSpeed: (animationSpeed) => set({ animationSpeed }),
			resetDefaults: () => set({ ...DEFAULT_BOARD_PREFERENCES }),
			_setHasHydrated: (hasHydrated) => set({ hasHydrated }),
		}),
		{
			name: BOARD_PREFS_STORAGE_KEY,
			version: 1,
			skipHydration: true,
			storage: createJSONStorage(() => safeBrowserStorage),
			partialize: (state): BoardPreferences => ({
				theme: state.theme,
				soundEnabled: state.soundEnabled,
				soundVolume: state.soundVolume,
				pieceScriptOverlay: state.pieceScriptOverlay,
				showLegalHints: state.showLegalHints,
				showCoordinates: state.showCoordinates,
				highlightSitKeMyin: state.highlightSitKeMyin,
				confirmPromotion: state.confirmPromotion,
				animationSpeed: state.animationSpeed,
			}),
			merge: (persistedState, currentState) => ({
				...currentState,
				...sanitizePersistedPrefs(persistedState),
			}),
			onRehydrateStorage: () => (state) => {
				state?._setHasHydrated(true);
			},
		},
	),
);

export function getAnimationDurationMs(speed: AnimationSpeed): number {
	switch (speed) {
		case "fast":
			return 100;
		case "none":
			return 0;
		default:
			return 180;
	}
}

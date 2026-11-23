import {
	type DisplayLocale,
	type EngineErrorCode,
	type PieceRole,
	SITTUYIN_PIECE_NAMES,
	type Side,
	type Viewer,
} from "@sittuyin/engine";
import * as m from "@/paraglide/messages.js";
import { getLocale, setLocale } from "@/paraglide/runtime.js";

export type AppLocale = DisplayLocale;

export const DEFAULT_LOCALE: AppLocale = "my";
export const SUPPORTED_LOCALES: readonly AppLocale[] = ["my", "en"];
export const LOCALE_COOKIE_NAME = "sittuyin_locale";

export function isAppLocale(value: unknown): value is AppLocale {
	return value === "my" || value === "en";
}

export function parseAppLocale(value: unknown): AppLocale {
	return isAppLocale(value) ? value : DEFAULT_LOCALE;
}

export function getActiveLocale(): AppLocale {
	try {
		const loc = getLocale();
		return parseAppLocale(loc);
	} catch {
		return DEFAULT_LOCALE;
	}
}

export function readLocaleCookie(): AppLocale | null {
	if (typeof document === "undefined") {
		return null;
	}
	const cookies = document.cookie.split(";");
	for (const raw of cookies) {
		const [key, val] = raw.trim().split("=");
		if (key === LOCALE_COOKIE_NAME && isAppLocale(val)) {
			return val;
		}
	}
	return null;
}

export function setLocaleCookie(locale: AppLocale): void {
	if (typeof document === "undefined") {
		return;
	}
	const maxAge = 60 * 60 * 24 * 365;
	// biome-ignore lint/suspicious/noDocumentCookie: synchronous cookie fallback is required alongside Paraglide runtime across all browsers
	document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=${maxAge}; samesite=lax`;
	try {
		setLocale(locale, { reload: false });
	} catch {
		// Ignore runtime sync errors in test environments
	}
}

export function getOtherLocale(locale: AppLocale): AppLocale {
	return locale === "my" ? "en" : "my";
}

export function formatSideName(side: Viewer, locale: AppLocale): string {
	switch (side) {
		case "red":
			return m.side_red({}, { locale });
		case "black":
			return m.side_black({}, { locale });
		case "spectator":
			return m.side_spectator({}, { locale });
	}
}

export function formatPieceName(role: PieceRole, locale: AppLocale): string {
	const entry = SITTUYIN_PIECE_NAMES[role];
	return locale === "my" ? entry.myanmar : entry.english;
}

export function formatEngineError(
	code: EngineErrorCode | "GENERIC",
	locale: AppLocale,
): string {
	switch (code) {
		case "INVALID_PHASE":
			return m.err_INVALID_PHASE({}, { locale });
		case "INVALID_SETUP_MODE":
			return m.err_INVALID_SETUP_MODE({}, { locale });
		case "SIDE_ALREADY_LOCKED":
			return m.err_SIDE_ALREADY_LOCKED({}, { locale });
		case "INVALID_SQUARE":
			return m.err_INVALID_SQUARE({}, { locale });
		case "SQUARE_OCCUPIED":
			return m.err_SQUARE_OCCUPIED({}, { locale });
		case "SQUARE_EMPTY":
			return m.err_SQUARE_EMPTY({}, { locale });
		case "ROOK_MUST_BE_BACK_RANK":
			return m.err_ROOK_MUST_BE_BACK_RANK({}, { locale });
		case "OUTSIDE_SETUP_ZONE":
			return m.err_OUTSIDE_SETUP_ZONE({}, { locale });
		case "PIECE_NOT_IN_HAND":
			return m.err_PIECE_NOT_IN_HAND({}, { locale });
		case "SETUP_INCOMPLETE":
			return m.err_SETUP_INCOMPLETE({}, { locale });
		case "UNKNOWN_PRESET":
			return m.err_UNKNOWN_PRESET({}, { locale });
		case "WRONG_TURN":
			return m.err_WRONG_TURN({}, { locale });
		case "PROMOTION_NOT_ALLOWED":
			return m.err_PROMOTION_NOT_ALLOWED({}, { locale });
		case "ILLEGAL_STALEMATE":
			return m.err_ILLEGAL_STALEMATE({}, { locale });
		case "ILLEGAL_MOVE":
			return m.err_ILLEGAL_MOVE({}, { locale });
		case "INVALID_UCI":
			return m.err_INVALID_UCI({}, { locale });
		case "INVALID_FEN":
			return m.err_INVALID_FEN({}, { locale });
		case "INVALID_PIECE_COUNT":
			return m.err_INVALID_PIECE_COUNT({}, { locale });
		case "OPPONENT_IN_CHECK":
			return m.err_OPPONENT_IN_CHECK({}, { locale });
		case "REPLAY_MOVE_FAILED":
			return m.err_REPLAY_MOVE_FAILED({}, { locale });
		default:
			return m.err_GENERIC({}, { locale });
	}
}

export function getOpponentSide(side: Side): Side {
	return side === "red" ? "black" : "red";
}

export { m };

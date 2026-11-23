import { SITTUYIN_PIECE_NAMES } from "./constants.js";
import type { DisplayLocale, MoveRecord, PieceRole } from "./types.js";

const ENGLISH_ABBR: Readonly<Record<PieceRole, string>> = {
	king: "K",
	general: "G",
	rook: "R",
	elephant: "E",
	knight: "N",
	pawn: "",
};

export function formatMoveDisplay(
	record: MoveRecord,
	locale: DisplayLocale,
): string {
	const { move } = record;

	if (locale === "en") {
		let base: string;
		switch (move.kind) {
			case "drop":
				base = `${ENGLISH_ABBR[move.role]}@${move.to}`;
				break;
			case "normal": {
				const prefix = ENGLISH_ABBR[record.piece];
				const sep = record.captured !== null ? "x" : "";
				base = `${prefix}${move.from}${sep}${move.to}`;
				break;
			}
			case "promote":
				base =
					move.from === move.to ? `${move.from}=G` : `${move.from}${move.to}=G`;
				break;
		}
		const suffix = record.gaveCheckmate ? "#" : record.gaveCheck ? "+" : "";
		return `${base}${suffix}`;
	}

	// Myanmar ("my")
	let base: string;
	switch (move.kind) {
		case "drop":
			base = `${SITTUYIN_PIECE_NAMES[move.role].myanmar} ${move.to}`;
			break;
		case "normal": {
			const label = SITTUYIN_PIECE_NAMES[record.piece].myanmar;
			base =
				record.captured !== null
					? `${label} ${move.from}x${move.to}`
					: `${label} ${move.from} ${move.to}`;
			break;
		}
		case "promote": {
			const generalLabel = SITTUYIN_PIECE_NAMES.general.myanmar;
			base =
				move.from === move.to
					? `${generalLabel} ${move.from}`
					: `${generalLabel} ${move.from} ${move.to}`;
			break;
		}
	}

	const suffix = record.gaveCheckmate ? " ချုပ်" : record.gaveCheck ? " ခွေ" : "";
	return `${base}${suffix}`;
}

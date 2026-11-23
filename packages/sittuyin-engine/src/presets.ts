import { OFFICER_SETUP_SQUARES, ROOK_SETUP_SQUARES } from "./constants.js";
import { createPrng, shuffleDeterministic } from "./prng.js";
import { rotateSquare180 } from "./squares.js";
import {
	type EngineError,
	err,
	type OfficerRole,
	type OpeningPreset,
	type OpeningPresetId,
	ok,
	type Result,
	type SetupPlacements,
	type Side,
	type Square,
} from "./types.js";

export const OPENING_PRESETS: readonly OpeningPreset[] = [
	{
		id: "myin_cha",
		name: {
			myanmar: "မြင်းချ",
			romanized: "Myin cha",
			english: "Knight Vanguard",
		},
		description: {
			myanmar: "မြင်းနှစ်ရုပ်ကို ရှေ့တန်းတင်ပြီး အလယ်တိုက်စစ်ဆင်သော တပ်ဆင်ပုံ",
			english:
				"Aggressive cavalry vanguard pushing both Knights to e3 and f3 behind the right wing pawns.",
		},
		redPlacements: {
			a1: "rook",
			b1: "king",
			e1: "rook",
			c2: "elephant",
			d2: "general",
			g2: "elephant",
			e3: "knight",
			f3: "knight",
		},
	},
	{
		id: "sin_cha",
		name: {
			myanmar: "ဆင်ချ",
			romanized: "Sin cha",
			english: "Elephant Wall",
		},
		description: {
			myanmar: "ဆင်နှစ်ရုပ်ဖြင့် အလယ်ထောင့်ဖြတ်ကြောင်းများကို ခိုင်မာစွာထိန်းချုပ်သော တပ်ဆင်ပုံ",
			english:
				"Solid positional structure posting Elephants on d2 and f3 to anchor the central diagonals.",
		},
		redPlacements: {
			a1: "rook",
			c1: "king",
			f1: "rook",
			b2: "knight",
			d2: "elephant",
			e2: "general",
			g2: "knight",
			f3: "elephant",
		},
	},
	{
		id: "yahhta_cha",
		name: {
			myanmar: "ရထားချ",
			romanized: "Yahhta cha",
			english: "Central Chariots",
		},
		description: {
			myanmar: "ရထားနှစ်ရုပ်ကို အလယ်တန်း d1 နှင့် e1 တွင် စုစည်းထားသော တပ်ဆင်ပုံ",
			english:
				"Heavy central file pressure pairing both Chariots on d1 and e1 ready for central breaks.",
		},
		redPlacements: {
			b1: "king",
			c1: "general",
			d1: "rook",
			e1: "rook",
			b2: "knight",
			c2: "elephant",
			f2: "elephant",
			g3: "knight",
		},
	},
	{
		id: "khan_tat",
		name: {
			myanmar: "ခံတပ်",
			romanized: "Khan tat",
			english: "Royal Fortress",
		},
		description: {
			myanmar: "မင်းကြီးကို ဘယ်ဘက်ထောင့်တွင် စစ်ကဲနှင့် ဆင်တို့ဖြင့် လုံခြုံစွာကာကွယ်ထားသော တပ်ဆင်ပုံ",
			english:
				"Defensive cluster sheltering the King on b1 with General, Elephant, and Chariot support.",
		},
		redPlacements: {
			a1: "rook",
			b1: "king",
			h1: "rook",
			b2: "elephant",
			c2: "general",
			e2: "knight",
			f2: "elephant",
			f3: "knight",
		},
	},
	{
		id: "sit_ke_cha",
		name: {
			myanmar: "စစ်ကဲချ",
			romanized: "Sit ke cha",
			english: "General Ambush",
		},
		description: {
			myanmar: "စစ်ကဲကို အလယ်ရှေ့တန်း e3 တွင် နေရာချပြီး တန်ပြန်တိုက်စစ်ဆင်သော တပ်ဆင်ပုံ",
			english:
				"Active counterattacking setup advancing the General to e3 backed by paired Elephants and Knights.",
		},
		redPlacements: {
			b1: "king",
			d1: "rook",
			h1: "rook",
			c2: "knight",
			d2: "elephant",
			f2: "elephant",
			g2: "knight",
			e3: "general",
		},
	},
];

const PRESET_MAP: ReadonlyMap<string, OpeningPreset> = new Map(
	OPENING_PRESETS.map((preset) => [preset.id, preset]),
);

export function getPresetPlacements(
	presetId: OpeningPresetId,
	side: Side,
): Result<SetupPlacements, EngineError> {
	const preset = PRESET_MAP.get(presetId);
	if (preset === undefined) {
		return err(
			"UNKNOWN_PRESET",
			`Unknown opening preset: "${String(presetId)}".`,
		);
	}
	if (side === "red") {
		return ok({ ...preset.redPlacements });
	}
	const mirrored: Partial<Record<Square, OfficerRole>> = {};
	for (const [sq, role] of Object.entries(preset.redPlacements) as [
		Square,
		OfficerRole | undefined,
	][]) {
		if (role !== undefined) {
			mirrored[rotateSquare180(sq)] = role;
		}
	}
	return ok(mirrored);
}

const NON_ROOK_OFFICERS: readonly OfficerRole[] = [
	"king",
	"general",
	"elephant",
	"elephant",
	"knight",
	"knight",
];

export function generateRandomSetup(
	seed: string | number,
	side: Side = "red",
): SetupPlacements {
	const nextRandom = createPrng(seed);
	const placements: Partial<Record<Square, OfficerRole>> = {};

	// Place both Rooks on back rank first so back rank capacity is always guaranteed
	const backRankShuffled = shuffleDeterministic(
		ROOK_SETUP_SQUARES[side],
		nextRandom,
	);
	const rookSq1 = backRankShuffled[0];
	const rookSq2 = backRankShuffled[1];
	if (rookSq1 !== undefined && rookSq2 !== undefined) {
		placements[rookSq1] = "rook";
		placements[rookSq2] = "rook";
	}

	// Place remaining 6 officers on remaining empty squares in the legal officer zone
	const remainingZone = OFFICER_SETUP_SQUARES[side].filter(
		(sq) => placements[sq] === undefined,
	);
	const zoneShuffled = shuffleDeterministic(remainingZone, nextRandom);
	for (let i = 0; i < NON_ROOK_OFFICERS.length; i++) {
		const sq = zoneShuffled[i];
		const role = NON_ROOK_OFFICERS[i];
		if (sq !== undefined && role !== undefined) {
			placements[sq] = role;
		}
	}

	return placements;
}

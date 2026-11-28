import { randomInt } from "node:crypto";
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from "@sittuyin/shared";

export function generateInviteCode(
	pickIndex: (max: number) => number = (max) => randomInt(max),
): string {
	let code = "";
	for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
		const idx = pickIndex(INVITE_CODE_ALPHABET.length);
		code += INVITE_CODE_ALPHABET[idx] ?? INVITE_CODE_ALPHABET[0];
	}
	return code;
}

export interface GenerateUniqueInviteCodeOptions {
	readonly maxAttempts?: number;
	readonly generateFn?: () => string;
}

export async function generateUniqueInviteCode(
	checkExists: (code: string) => Promise<boolean>,
	options: GenerateUniqueInviteCodeOptions = {},
): Promise<string> {
	const maxAttempts = options.maxAttempts ?? 5;
	const generateFn = options.generateFn ?? (() => generateInviteCode());

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const candidate = generateFn();
		const exists = await checkExists(candidate);
		if (!exists) {
			return candidate;
		}
	}

	throw new Error("INVITE_CODE_COLLISION_EXHAUSTED");
}

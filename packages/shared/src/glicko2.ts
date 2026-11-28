export const GLICKO2_SCALE = 173.7178;

export const GLICKO2_DEFAULTS = {
	initialRating: 1500,
	initialRd: 350,
	initialVolatility: 0.06,
	tau: 0.5,
	rdFloor: 45,
	rdCap: 350,
	convergenceTolerance: 0.000001,
} as const;

export const PROVISIONAL_RD_THRESHOLD = 110;
export const PROVISIONAL_GAMES_THRESHOLD = 10;

export interface Glicko2RatingState {
	readonly rating: number;
	readonly ratingDeviation: number;
	readonly volatility: number;
}

export interface Glicko2MatchPlayerInput extends Glicko2RatingState {
	readonly lastRatedAt?: Date | null;
}

export interface Glicko2OpponentResult {
	readonly rating: number;
	readonly ratingDeviation: number;
	readonly score: number;
}

export interface Glicko2Options {
	readonly tau?: number;
	readonly rdFloor?: number;
	readonly rdCap?: number;
	readonly inactivePeriods?: number;
	readonly convergenceTolerance?: number;
}

export interface Glicko2MatchUpdateResult {
	readonly red: Glicko2RatingState;
	readonly black: Glicko2RatingState;
}

export function isProvisionalRating(
	ratingDeviation: number,
	gamesPlayed: number,
): boolean {
	return (
		ratingDeviation > PROVISIONAL_RD_THRESHOLD ||
		gamesPlayed < PROVISIONAL_GAMES_THRESHOLD
	);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function g(phi: number): number {
	return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expectedScore(mu: number, opponentMu: number, opponentPhi: number): number {
	return 1 / (1 + Math.exp(-g(opponentPhi) * (mu - opponentMu)));
}

export function calculateGlicko2PeriodUpdate(
	player: Glicko2RatingState,
	opponents: readonly Glicko2OpponentResult[],
	options: Glicko2Options = {},
): Glicko2RatingState {
	const tau = options.tau ?? GLICKO2_DEFAULTS.tau;
	const rdFloor = options.rdFloor ?? GLICKO2_DEFAULTS.rdFloor;
	const rdCap = options.rdCap ?? GLICKO2_DEFAULTS.rdCap;
	const epsilon =
		options.convergenceTolerance ?? GLICKO2_DEFAULTS.convergenceTolerance;
	const inactivePeriods = Math.max(0, options.inactivePeriods ?? 0);

	const mu = (player.rating - GLICKO2_DEFAULTS.initialRating) / GLICKO2_SCALE;
	let phi = player.ratingDeviation / GLICKO2_SCALE;
	const sigma = player.volatility;

	if (inactivePeriods > 0) {
		const maxPhi = rdCap / GLICKO2_SCALE;
		phi = Math.min(maxPhi, Math.sqrt(phi * phi + inactivePeriods * sigma * sigma));
	}

	if (opponents.length === 0) {
		return {
			rating: player.rating,
			ratingDeviation: clamp(phi * GLICKO2_SCALE, rdFloor, rdCap),
			volatility: sigma,
		};
	}

	let vInv = 0;
	let deltaSum = 0;

	for (const opp of opponents) {
		const oppMu = (opp.rating - GLICKO2_DEFAULTS.initialRating) / GLICKO2_SCALE;
		const oppPhi = opp.ratingDeviation / GLICKO2_SCALE;
		const gVal = g(oppPhi);
		const eVal = expectedScore(mu, oppMu, oppPhi);
		vInv += gVal * gVal * eVal * (1 - eVal);
		deltaSum += gVal * (opp.score - eVal);
	}

	const v = 1 / vInv;
	const delta = v * deltaSum;
	const phiSq = phi * phi;
	const deltaSq = delta * delta;
	const a = Math.log(sigma * sigma);

	const f = (x: number): number => {
		const expX = Math.exp(x);
		const denom = phiSq + v + expX;
		return (
			(expX * (deltaSq - phiSq - v - expX)) / (2 * denom * denom) -
			(x - a) / (tau * tau)
		);
	};

	let A = a;
	let B: number;
	if (deltaSq > phiSq + v) {
		B = Math.log(deltaSq - phiSq - v);
	} else {
		let k = 1;
		while (f(a - k * tau) < 0) {
			k += 1;
		}
		B = a - k * tau;
	}

	let fA = f(A);
	let fB = f(B);
	let iterations = 0;
	while (Math.abs(B - A) > epsilon && iterations < 100) {
		iterations += 1;
		const C = A + ((A - B) * fA) / (fB - fA);
		const fC = f(C);
		if (fC * fB <= 0) {
			A = B;
			fA = fB;
		} else {
			fA /= 2;
		}
		B = C;
		fB = fC;
	}

	const sigmaPrime = Math.exp(A / 2);
	const phiStar = Math.sqrt(phiSq + sigmaPrime * sigmaPrime);
	const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
	const muPrime = mu + phiPrime * phiPrime * deltaSum;

	return {
		rating: GLICKO2_DEFAULTS.initialRating + GLICKO2_SCALE * muPrime,
		ratingDeviation: clamp(GLICKO2_SCALE * phiPrime, rdFloor, rdCap),
		volatility: sigmaPrime,
	};
}

function computeInactiveDays(
	lastRatedAt: Date | null | undefined,
	endedAt: Date,
): number {
	if (!lastRatedAt) {
		return 0;
	}
	const elapsedDays = (endedAt.getTime() - lastRatedAt.getTime()) / 86_400_000;
	return Math.max(0, elapsedDays - 1);
}

export function calculateGlicko2MatchUpdate(
	red: Glicko2MatchPlayerInput,
	black: Glicko2MatchPlayerInput,
	scoreRed: 0 | 0.5 | 1,
	endedAt: Date,
	options: Omit<Glicko2Options, "inactivePeriods"> = {},
): Glicko2MatchUpdateResult {
	const redInactive = computeInactiveDays(red.lastRatedAt, endedAt);
	const blackInactive = computeInactiveDays(black.lastRatedAt, endedAt);

	const nextRed = calculateGlicko2PeriodUpdate(
		red,
		[
			{
				rating: black.rating,
				ratingDeviation: black.ratingDeviation,
				score: scoreRed,
			},
		],
		{ ...options, inactivePeriods: redInactive },
	);

	const nextBlack = calculateGlicko2PeriodUpdate(
		black,
		[
			{
				rating: red.rating,
				ratingDeviation: red.ratingDeviation,
				score: 1 - scoreRed,
			},
		],
		{ ...options, inactivePeriods: blackInactive },
	);

	return {
		red: nextRed,
		black: nextBlack,
	};
}

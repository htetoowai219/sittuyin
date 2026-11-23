export type SoundCue =
	| "move"
	| "capture"
	| "setup_drop"
	| "promote"
	| "check"
	| "game_over"
	| "clock_low"
	| "clock_tick";

export interface SoundPlayOptions {
	readonly enabled: boolean;
	readonly volume: number;
}

type AudioContextConstructor = new () => AudioContext;

function resolveAudioContextConstructor(): AudioContextConstructor | null {
	if (typeof window === "undefined") {
		return null;
	}
	const win = window as unknown as {
		AudioContext?: AudioContextConstructor;
		webkitAudioContext?: AudioContextConstructor;
	};
	return win.AudioContext ?? win.webkitAudioContext ?? null;
}

/**
 * Pure procedural Web Audio API synthesizer for warm teak wooden Sittuyin sound effects.
 * Zero external audio assets; unlocks cleanly on the first user gesture and degrades
 * silently if AudioContext is blocked or unavailable.
 */
export class AudioEngine {
	private ctx: AudioContext | null = null;
	private noiseBuffer: AudioBuffer | null = null;
	private unlocked = false;

	public unlock(): void {
		const ctx = this.ensureContext();
		if (ctx === null) {
			return;
		}
		if (ctx.state === "suspended") {
			void ctx.resume().catch(() => {
				// Ignore autoplay policy rejection until next gesture
			});
		}
		this.unlocked = true;
	}

	public play(cue: SoundCue, options: SoundPlayOptions): void {
		if (!options.enabled || options.volume <= 0) {
			return;
		}
		const ctx = this.ensureContext();
		if (ctx === null) {
			return;
		}
		if (ctx.state === "suspended") {
			if (!this.unlocked) {
				return;
			}
			void ctx.resume().catch(() => {
				// Degrade silently
			});
		}

		const volume = Math.max(0, Math.min(1, options.volume));
		try {
			const now = ctx.currentTime;
			switch (cue) {
				case "move":
					this.playWoodClack(ctx, now, 320, 140, 0.085, volume * 0.72);
					break;
				case "setup_drop":
					this.playWoodClack(ctx, now, 420, 220, 0.065, volume * 0.58);
					break;
				case "capture":
					this.playWoodClack(ctx, now, 210, 88, 0.125, volume * 0.9);
					this.playWoodClack(ctx, now + 0.032, 370, 155, 0.075, volume * 0.55);
					break;
				case "promote":
					this.playChime(ctx, now, [523.25, 659.25, 783.99], volume * 0.48);
					break;
				case "check":
					this.playAlertTone(ctx, now, 620, 495, 0.17, volume * 0.58);
					break;
				case "game_over":
					this.playChime(ctx, now, [440, 554.37, 659.25, 880], volume * 0.5);
					break;
				case "clock_low":
					this.playAlertTone(ctx, now, 740, 620, 0.22, volume * 0.52);
					break;
				case "clock_tick":
					this.playWoodClack(ctx, now, 880, 520, 0.035, volume * 0.42);
					break;
			}
		} catch {
			// Never throw audio exceptions into gameplay UI
		}
	}

	public dispose(): void {
		if (this.ctx !== null) {
			void this.ctx.close().catch(() => {});
			this.ctx = null;
			this.noiseBuffer = null;
			this.unlocked = false;
		}
	}

	private ensureContext(): AudioContext | null {
		if (this.ctx !== null) {
			return this.ctx;
		}
		const Ctor = resolveAudioContextConstructor();
		if (Ctor === null) {
			return null;
		}
		try {
			this.ctx = new Ctor();
			return this.ctx;
		} catch {
			return null;
		}
	}

	private getNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
		if (this.noiseBuffer !== null) {
			return this.noiseBuffer;
		}
		try {
			const sampleRate = ctx.sampleRate || 44100;
			const length = Math.max(1, Math.floor(sampleRate * 0.08));
			const buffer = ctx.createBuffer(1, length, sampleRate);
			const data = buffer.getChannelData(0);
			for (let i = 0; i < length; i++) {
				// Exponentially decaying burst for wooden impact transient
				const decay = Math.exp((-i / length) * 6);
				data[i] = (Math.random() * 2 - 1) * decay;
			}
			this.noiseBuffer = buffer;
			return buffer;
		} catch {
			return null;
		}
	}

	private playWoodClack(
		ctx: AudioContext,
		startTime: number,
		startFreq: number,
		endFreq: number,
		duration: number,
		gainLevel: number,
	): void {
		// 1. Resonant wooden body thump
		const osc = ctx.createOscillator();
		const oscGain = ctx.createGain();
		osc.type = "triangle";
		osc.frequency.setValueAtTime(startFreq, startTime);
		osc.frequency.exponentialRampToValueAtTime(
			Math.max(40, endFreq),
			startTime + duration,
		);

		oscGain.gain.setValueAtTime(0.0001, startTime);
		oscGain.gain.linearRampToValueAtTime(gainLevel, startTime + 0.004);
		oscGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

		osc.connect(oscGain);
		oscGain.connect(ctx.destination);
		osc.start(startTime);
		osc.stop(startTime + duration + 0.01);

		// 2. Crisp filtered wood-on-wood impact transient
		const noise = this.getNoiseBuffer(ctx);
		if (noise !== null && typeof ctx.createBufferSource === "function") {
			const source = ctx.createBufferSource();
			source.buffer = noise;

			const filter = ctx.createBiquadFilter();
			filter.type = "bandpass";
			filter.frequency.setValueAtTime(startFreq * 3.2, startTime);
			filter.Q.setValueAtTime(2.4, startTime);

			const noiseGain = ctx.createGain();
			noiseGain.gain.setValueAtTime(gainLevel * 0.55, startTime);
			noiseGain.gain.exponentialRampToValueAtTime(
				0.0001,
				startTime + Math.min(duration, 0.045),
			);

			source.connect(filter);
			filter.connect(noiseGain);
			noiseGain.connect(ctx.destination);
			source.start(startTime);
			source.stop(startTime + Math.min(duration, 0.05));
		}
	}

	private playChime(
		ctx: AudioContext,
		startTime: number,
		frequencies: readonly number[],
		gainLevel: number,
	): void {
		frequencies.forEach((freq, idx) => {
			const noteStart = startTime + idx * 0.075;
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = "sine";
			osc.frequency.setValueAtTime(freq, noteStart);

			gain.gain.setValueAtTime(0.0001, noteStart);
			gain.gain.linearRampToValueAtTime(gainLevel, noteStart + 0.012);
			gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.32);

			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.start(noteStart);
			osc.stop(noteStart + 0.34);
		});
	}

	private playAlertTone(
		ctx: AudioContext,
		startTime: number,
		freqA: number,
		freqB: number,
		duration: number,
		gainLevel: number,
	): void {
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.type = "sine";
		osc.frequency.setValueAtTime(freqA, startTime);
		osc.frequency.setValueAtTime(freqB, startTime + duration * 0.45);

		gain.gain.setValueAtTime(0.0001, startTime);
		gain.gain.linearRampToValueAtTime(gainLevel, startTime + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.start(startTime);
		osc.stop(startTime + duration + 0.02);
	}
}

let sharedAudioEngine: AudioEngine | null = null;

export function getAudioEngine(): AudioEngine {
	if (sharedAudioEngine === null) {
		sharedAudioEngine = new AudioEngine();
	}
	return sharedAudioEngine;
}

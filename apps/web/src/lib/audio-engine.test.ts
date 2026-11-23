// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioEngine } from "./audio-engine";

function createMockAudioContext() {
	const start = vi.fn();
	const stop = vi.fn();
	const connect = vi.fn();
	const setValueAtTime = vi.fn();
	const linearRampToValueAtTime = vi.fn();
	const exponentialRampToValueAtTime = vi.fn();
	const resume = vi.fn().mockResolvedValue(undefined);
	const close = vi.fn().mockResolvedValue(undefined);

	class MockAudioContext {
		public state: AudioContextState = "running";
		public currentTime = 0;
		public sampleRate = 44100;
		public destination = {};
		public resume = resume;
		public close = close;

		public createOscillator = vi.fn(() => ({
			type: "sine",
			frequency: {
				setValueAtTime,
				exponentialRampToValueAtTime,
			},
			connect,
			start,
			stop,
		}));

		public createGain = vi.fn(() => ({
			gain: {
				setValueAtTime,
				linearRampToValueAtTime,
				exponentialRampToValueAtTime,
			},
			connect,
		}));

		public createBuffer = vi.fn((_c: number, len: number) => ({
			getChannelData: () => new Float32Array(len),
		}));

		public createBufferSource = vi.fn(() => ({
			buffer: null,
			connect,
			start,
			stop,
		}));

		public createBiquadFilter = vi.fn(() => ({
			type: "bandpass",
			frequency: { setValueAtTime },
			Q: { setValueAtTime },
			connect,
		}));
	}

	return { MockAudioContext, start, stop, connect, resume };
}

describe("AudioEngine", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		delete (window as unknown as Record<string, unknown>).AudioContext;
	});

	it("synthesizes all wooden and alert cues when enabled", () => {
		const mock = createMockAudioContext();
		(window as unknown as Record<string, unknown>).AudioContext =
			mock.MockAudioContext;

		const engine = new AudioEngine();
		engine.unlock();

		for (const cue of [
			"move",
			"capture",
			"setup_drop",
			"promote",
			"check",
			"game_over",
			"clock_low",
			"clock_tick",
		] as const) {
			engine.play(cue, { enabled: true, volume: 0.75 });
		}

		expect(mock.start).toHaveBeenCalled();
		expect(mock.connect).toHaveBeenCalled();
		engine.dispose();
	});

	it("skips playback when muted or volume is zero", () => {
		const mock = createMockAudioContext();
		(window as unknown as Record<string, unknown>).AudioContext =
			mock.MockAudioContext;

		const engine = new AudioEngine();
		engine.unlock();
		engine.play("move", { enabled: false, volume: 0.8 });
		engine.play("move", { enabled: true, volume: 0 });
		expect(mock.start).not.toHaveBeenCalled();
	});

	it("degrades silently when AudioContext is missing or throws", () => {
		const engine = new AudioEngine();
		expect(() => {
			engine.unlock();
			engine.play("move", { enabled: true, volume: 0.8 });
		}).not.toThrow();

		(window as unknown as Record<string, unknown>).AudioContext =
			class ThrowingAudioContext {
				constructor() {
					throw new Error("Audio blocked");
				}
			};
		const throwingEngine = new AudioEngine();
		expect(() => {
			throwingEngine.unlock();
			throwingEngine.play("check", { enabled: true, volume: 0.8 });
		}).not.toThrow();
	});
});

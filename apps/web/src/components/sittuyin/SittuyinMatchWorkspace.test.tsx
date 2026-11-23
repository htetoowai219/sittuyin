// @vitest-environment jsdom
import {
	applyMove,
	createGame,
	fromFen,
	type GameState,
	toPlayerView,
} from "@sittuyin/engine";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLocalMatchAdapter } from "@/lib/adapters/local-match-adapter";
import {
	createReplayAdapter,
	parseReplaySession,
	SAMPLE_REPLAY_FEN,
	SAMPLE_REPLAY_UCI_MOVES,
} from "@/lib/adapters/replay-adapter";
import type { MatchAdapter } from "@/lib/adapters/types";
import {
	DEFAULT_BOARD_PREFERENCES,
	useBoardPreferencesStore,
} from "@/stores/board-preferences";
import { SittuyinMatchWorkspace } from "./SittuyinMatchWorkspace";

function LocalMatchHarness({
	locale = "en",
	initialState,
	mode = "local_pass_and_play",
}: {
	readonly locale?: "my" | "en";
	readonly initialState?: GameState;
	readonly mode?: "local_pass_and_play" | "local_sandbox";
}) {
	const { adapter, resetMatch } = useLocalMatchAdapter({
		mode,
		timeControl: null,
		locale,
		initialState,
	});
	return (
		<SittuyinMatchWorkspace
			adapter={adapter}
			locale={locale}
			onNewMatch={() => resetMatch()}
		/>
	);
}

function LiveFeedHarness({
	initialHistory,
}: {
	readonly initialHistory: readonly GameState[];
}) {
	const [history, setHistory] = useState<readonly GameState[]>(initialHistory);
	const head = history[history.length - 1] ?? createGame();

	const adapter: MatchAdapter = {
		mode: "online",
		view: toPlayerView(head, "red"),
		players: {
			red: {
				side: "red",
				displayName: "Red",
				rating: 1500,
				connected: true,
				isLocal: true,
			},
			black: {
				side: "black",
				displayName: "Black",
				rating: 1500,
				connected: true,
				isLocal: false,
			},
		},
		clock: null,
		historyStates: history,
		pendingRevealHandoff: null,
		connectionStatus: "connected",
		isInteractive: true,
		outcome: head.outcome,
		dispatchSetup: () => ({ ok: true, value: undefined }),
		dispatchMove: () => ({ ok: true, value: undefined }),
		applyRandomSetup: () => ({ ok: true, value: undefined }),
		requestResign: () => {},
		requestDraw: () => {},
		confirmHandoff: () => {},
	};

	const simulateIncomingMove = () => {
		const res = applyMove(head, { kind: "normal", from: "f3", to: "d4" });
		if (res.ok) {
			setHistory((prev) => [...prev, res.value]);
		}
	};

	return (
		<div>
			<button
				type="button"
				data-testid="simulate-live-move"
				onClick={simulateIncomingMove}
			>
				Push move
			</button>
			<SittuyinMatchWorkspace adapter={adapter} locale="en" />
		</div>
	);
}

describe("SittuyinMatchWorkspace", () => {
	beforeEach(() => {
		window.localStorage.clear();
		useBoardPreferencesStore.setState({
			...DEFAULT_BOARD_PREFERENCES,
			hasHydrated: true,
		});
	});

	afterEach(() => {
		cleanup();
	});

	it("renders uncheckered board, sit ke myin diagonals, coordinates, flip, and Burmese script badges", () => {
		render(<LocalMatchHarness locale="my" />);

		const board = screen.getByTestId("sittuyin-board");
		expect(board.getAttribute("data-flipped")).toBe("false");
		expect(screen.getByTestId("sit-ke-myin-diagonals")).toBeTruthy();
		expect(screen.getByTestId("board-coordinates")).toBeTruthy();

		// Flip board 180 degrees
		fireEvent.click(screen.getByTestId("flip-board-btn"));
		expect(board.getAttribute("data-flipped")).toBe("true");

		// Enable Burmese script badges
		act(() => {
			useBoardPreferencesStore.getState().setPieceScriptOverlay(true);
		});
		expect(screen.getAllByText("န").length).toBeGreaterThan(0);
	});

	it("enforces hidden simultaneous setup, back-rank Rook validation, opponent progress, and privacy handoff curtain", async () => {
		render(<LocalMatchHarness locale="en" />);

		// Opponent starts at 0/8
		expect(screen.getByTestId("opponent-setup-progress").textContent).toContain(
			"0/8",
		);

		// Select Rook and try placing on rank 2 (e2) -> should NOT be placed (back-rank only)
		fireEvent.click(screen.getByTestId("hand-officer-rook"));
		fireEvent.click(screen.getByRole("gridcell", { name: /Square e2/i }));
		expect(
			screen
				.getByRole("gridcell", { name: /Square e2/i })
				.getAttribute("data-piece"),
		).toBeNull();

		// Place Rook legally on a1
		fireEvent.click(screen.getByRole("gridcell", { name: /Square a1/i }));
		await waitFor(() => {
			expect(
				screen
					.getByRole("gridcell", { name: /Square a1/i })
					.getAttribute("data-piece"),
			).toBe("red-rook");
		});

		// Apply opening preset for Red and lock in
		fireEvent.click(screen.getByTestId("preset-myin_cha"));
		fireEvent.click(screen.getByTestId("setup-lock-btn"));

		// Privacy handoff curtain appears hiding Red's formation
		expect(screen.getByTestId("setup-handoff-curtain")).toBeTruthy();
		fireEvent.click(screen.getByTestId("handoff-reveal-btn"));

		// Now Black is viewing: Red's draft coordinates MUST NOT appear in DOM, only Red Ready progress!
		expect(screen.getByTestId("opponent-setup-progress").textContent).toContain(
			"Ready",
		);
		expect(
			screen
				.getByRole("gridcell", { name: /Square a1/i })
				.getAttribute("data-piece"),
		).toBeNull();

		// Black applies preset and locks -> transitions atomically to playing phase
		fireEvent.click(screen.getByTestId("preset-sin_cha"));
		fireEvent.click(screen.getByTestId("setup-lock-btn"));

		await waitFor(() => {
			expect(screen.getByTestId("match-phase-badge").textContent).toContain(
				"Red to move",
			);
		});
	});

	it("opens anchored General promotion overlay on in-place or diagonal target and commits promotion", async () => {
		// Red has 0 Generals, a Rook (sufficient material), and a pawn on c6 (sit ke myin square)
		const fenRes = fromFen("7k/8/2P5/8/8/8/8/R3K3 w - - 0 1");
		expect(fenRes.ok).toBe(true);
		if (!fenRes.ok) return;

		render(<LocalMatchHarness locale="en" initialState={fenRes.value} />);

		// Select promotable pawn on c6
		const c6 = screen.getByRole("gridcell", { name: /Square c6/i });
		fireEvent.click(c6);

		// c6 itself and empty diagonals (b7, d7, b5, d5) should be marked as promote hints
		expect(c6.getAttribute("data-hint")).toBe("promote");
		expect(
			screen
				.getByRole("gridcell", { name: /Square b7/i })
				.getAttribute("data-hint"),
		).toBe("promote");

		// Clicking c6 again opens confirmation overlay (confirmPromotion === true)
		fireEvent.click(c6);
		const dialog = await screen.findByRole("dialog", {
			name: /Promote to General/i,
		});
		expect(dialog).toBeTruthy();

		// Confirm in-place promotion
		fireEvent.click(
			screen.getByRole("button", { name: /Promote in place \(c6\)/i }),
		);

		await waitFor(() => {
			expect(
				screen
					.getByRole("gridcell", { name: /Square c6/i })
					.getAttribute("data-piece"),
			).toBe("red-general");
		});
	});

	it("commits General promotion directly without overlay when confirmPromotion is false", async () => {
		useBoardPreferencesStore.getState().setConfirmPromotion(false);
		const fenRes = fromFen("7k/8/2P5/8/8/8/8/R3K3 w - - 0 1");
		expect(fenRes.ok).toBe(true);
		if (!fenRes.ok) return;

		render(<LocalMatchHarness locale="en" initialState={fenRes.value} />);

		fireEvent.click(screen.getByRole("gridcell", { name: /Square c6/i }));
		fireEvent.click(screen.getByRole("gridcell", { name: /Square b7/i }));

		await waitFor(() => {
			expect(
				screen
					.getByRole("gridcell", { name: /Square b7/i })
					.getAttribute("data-piece"),
			).toBe("red-general");
		});
	});

	it("displays check halo, checker attacker highlight, and captured Rook +5 material diff", async () => {
		// Red Rook on e1 can capture Black Rook on e7 and deliver check to Black King on e8
		const fenRes = fromFen("4k3/4r3/8/8/8/8/8/4RK2 w - - 0 1");
		expect(fenRes.ok).toBe(true);
		if (!fenRes.ok) return;

		render(<LocalMatchHarness locale="en" initialState={fenRes.value} />);

		fireEvent.click(screen.getByRole("gridcell", { name: /Square e1/i }));
		fireEvent.click(screen.getByRole("gridcell", { name: /Square e7/i }));

		await waitFor(() => {
			expect(screen.getByTestId("check-king-halo")).toBeTruthy();
			expect(screen.getByTestId("checker-square-e7")).toBeTruthy();
			expect(screen.getByTestId("check-badge-black")).toBeTruthy();
			expect(screen.getByTestId("material-advantage-red").textContent).toBe(
				"+5",
			);
		});
	});

	it("renders bilingual /my and /en move history and steps cleanly across replayMatch snapshots", () => {
		const session = parseReplaySession(
			SAMPLE_REPLAY_FEN,
			SAMPLE_REPLAY_UCI_MOVES.join(" "),
		);
		expect(session.parseError).toBeNull();

		const myAdapter = createReplayAdapter(session, "my");
		const { rerender } = render(
			<SittuyinMatchWorkspace
				adapter={myAdapter}
				locale="my"
				initialReplayPly={0}
			/>,
		);

		// Myanmar move notation from formatMoveDisplay (e.g. "နယ် e4xd5")
		expect(screen.getByTestId("ply-btn-1").textContent).toContain("နယ်");
		expect(screen.getByTestId("scrubber-ply-status").textContent).toContain(
			"0 / 10",
		);

		fireEvent.click(screen.getByTestId("scrubber-next"));
		expect(screen.getByTestId("scrubber-ply-status").textContent).toContain(
			"1 / 10",
		);

		fireEvent.click(screen.getByTestId("scrubber-last"));
		expect(screen.getByTestId("scrubber-ply-status").textContent).toContain(
			"10 / 10",
		);

		// Switch to English locale
		const enAdapter = createReplayAdapter(session, "en");
		rerender(
			<SittuyinMatchWorkspace
				adapter={enAdapter}
				locale="en"
				initialReplayPly={10}
			/>,
		);
		expect(screen.getByTestId("ply-btn-1").textContent).toBe("e4xd5");
	});

	it("shows pulsing Back to live pill with unseen ply count when a live move arrives while scrubbed back", async () => {
		const baseSession = parseReplaySession(SAMPLE_REPLAY_FEN, "e4d5 c6d5");
		expect(baseSession.parseError).toBeNull();
		const initialHistory = [...baseSession.snapshots];

		render(<LiveFeedHarness initialHistory={initialHistory} />);

		// Scrub back to ply 1
		fireEvent.click(screen.getByTestId("scrubber-prev"));
		expect(screen.getByTestId("back-to-live-pill")).toBeTruthy();

		// Incoming live move arrives while scrubbed back
		fireEvent.click(screen.getByTestId("simulate-live-move"));

		await waitFor(() => {
			expect(screen.getByTestId("back-to-live-pill").textContent).toContain(
				"+1",
			);
		});

		// Clicking Back to live returns to live head (ply 3)
		fireEvent.click(screen.getByTestId("back-to-live-pill"));
		expect(screen.queryByTestId("back-to-live-pill")).toBeNull();
	});

	it("supports 64-square roving keyboard navigation and Enter move commit", async () => {
		const fenRes = fromFen("4k3/8/8/8/4P3/8/8/R3K3 w - - 0 1");
		expect(fenRes.ok).toBe(true);
		if (!fenRes.ok) return;

		render(<LocalMatchHarness locale="en" initialState={fenRes.value} />);

		const e4 = screen.getByRole("gridcell", { name: /Square e4/i });
		e4.focus();
		expect(e4.getAttribute("tabindex")).toBe("0");

		// Select Red pawn on e4 via Enter
		fireEvent.keyDown(e4, { key: "Enter" });
		expect(e4.getAttribute("aria-selected")).toBe("true");

		// ArrowUp moves roving focus to e5, Enter commits e4->e5
		fireEvent.keyDown(e4, { key: "ArrowUp" });
		const e5 = screen.getByRole("gridcell", { name: /Square e5/i });
		expect(document.activeElement).toBe(e5);
		fireEvent.keyDown(e5, { key: "Enter" });

		await waitFor(() => {
			expect(
				screen
					.getByRole("gridcell", { name: /Square e5/i })
					.getAttribute("data-piece"),
			).toBe("red-pawn");
		});
	});
});

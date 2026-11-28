// @vitest-environment jsdom

import { createGame, toPlayerView } from "@sittuyin/engine";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SittuyinMatchWorkspace } from "@/components/sittuyin/SittuyinMatchWorkspace";
import { matchReplayToExtendedOutcome } from "@/lib/adapters/replay-adapter";
import type { ExtendedOutcome, MatchAdapter } from "@/lib/adapters/types";
import { buildSeoHead } from "@/lib/seo";
import { clampReplayPly, parseMatchReplaySearch } from "./match.$matchId";

afterEach(() => {
	cleanup();
});

function createOnlineFinishedAdapter(
	outcome: ExtendedOutcome,
	matchId: string,
): MatchAdapter {
	const state = createGame();
	return {
		mode: "online",
		view: toPlayerView(state, "red"),
		players: {
			red: {
				side: "red",
				displayName: "Mg Ba",
				rating: 1620,
				connected: true,
				isLocal: true,
			},
			black: {
				side: "black",
				displayName: "Su Su",
				rating: 1590,
				connected: true,
				isLocal: false,
			},
		},
		clock: null,
		historyStates: [state],
		pendingRevealHandoff: null,
		connectionStatus: "connected",
		isInteractive: false,
		outcome,
		online: {
			roomId: "room_1",
			matchId,
			roomMode: "public_lobby",
			isRated: true,
			roomTitle: "Rapid Match",
			inviteCode: null,
			hostPreferredSide: "red",
			timeControl: "rapid_10_5",
			roomPhase: "finished",
			spectatorCount: 0,
			setupRemainingMs: null,
			setupSyncedAtMs: null,
			drawOfferedBy: null,
			rematchOfferedBy: null,
			rematchAcceptedByMe: false,
			canAbort: false,
			maintenanceWarning: null,
			ratingUpdate: null,
		},
		dispatchSetup: () => ({
			ok: false,
			error: { code: "INVALID_PHASE", message: "finished" },
		}),
		dispatchMove: () => ({
			ok: false,
			error: { code: "INVALID_PHASE", message: "finished" },
		}),
		applyRandomSetup: () => ({
			ok: false,
			error: { code: "INVALID_PHASE", message: "finished" },
		}),
		requestResign: () => {},
		requestDraw: () => {},
		confirmHandoff: () => {},
	};
}

describe("Spec 0003 public pages, replay deep linking, SEO, and Share Replay", () => {
	it("parses and safely clamps ?ply= search params", () => {
		expect(parseMatchReplaySearch({ ply: "4" })).toEqual({ ply: 4 });
		expect(parseMatchReplaySearch({ ply: 7 })).toEqual({ ply: 7 });
		expect(parseMatchReplaySearch({ ply: "abc" })).toEqual({});
		expect(parseMatchReplaySearch({})).toEqual({});

		// Default to final ply when omitted
		expect(clampReplayPly(undefined, 11)).toBe(10);
		// Explicit 0 stays 0
		expect(clampReplayPly(0, 11)).toBe(0);
		// Out-of-bounds and negative clamp cleanly
		expect(clampReplayPly(999, 11)).toBe(10);
		expect(clampReplayPly(-5, 11)).toBe(0);
	});

	it("maps persisted DB termination reasons to ExtendedOutcome", () => {
		expect(matchReplayToExtendedOutcome("red", "resign")).toEqual({
			status: "win",
			winner: "red",
			reason: "resignation",
		});
		expect(matchReplayToExtendedOutcome("black", "timeout")).toEqual({
			status: "win",
			winner: "black",
			reason: "timeout",
		});
		expect(matchReplayToExtendedOutcome(null, "draw_agreement")).toEqual({
			status: "draw",
			winner: null,
			reason: "agreed_draw",
		});
	});

	it("emits canonical, Open Graph, and conditional noindex robots metadata", () => {
		const publicHead = buildSeoHead({
			title: "Leaderboard · Sittuyin",
			description: "Top players",
			canonicalPath: "/en/leaderboard",
		});
		expect(publicHead.links).toEqual([
			{ rel: "canonical", href: "/en/leaderboard" },
		]);
		expect(publicHead.meta.some((tag) => tag.property === "og:image")).toBe(
			true,
		);
		expect(publicHead.meta.some((tag) => tag.name === "robots")).toBe(false);

		const privateHead = buildSeoHead({
			title: "Private Match · Sittuyin",
			description: "Private replay",
			canonicalPath: "/en/match/550e8400-e29b-41d4-a716-446655440000",
			noindex: true,
		});
		expect(privateHead.meta).toContainEqual({
			name: "robots",
			content: "noindex, nofollow",
		});
	});

	it("shows Share Replay button only for completed competitive online matches, never aborted ones", () => {
		const matchId = "550e8400-e29b-41d4-a716-446655440042";
		const { rerender } = render(
			<SittuyinMatchWorkspace
				adapter={createOnlineFinishedAdapter(
					{ status: "win", winner: "red", reason: "checkmate" },
					matchId,
				)}
				locale="en"
			/>,
		);
		expect(screen.getByTestId("share-replay-btn")).toBeTruthy();
		const openLink = screen.getByTestId("open-replay-link");
		expect(openLink.getAttribute("href")).toBe(`/en/match/${matchId}`);

		rerender(
			<SittuyinMatchWorkspace
				adapter={createOnlineFinishedAdapter(
					{ status: "aborted", winner: null, reason: "aborted_pre_move" },
					matchId,
				)}
				locale="en"
			/>,
		);
		expect(screen.queryByTestId("share-replay-btn")).toBeNull();
	});
});

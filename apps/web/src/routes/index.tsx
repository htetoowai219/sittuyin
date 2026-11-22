import { ENGINE_METADATA, SITTUYIN_PIECE_NAMES } from "@sittuyin/engine";
import { SITTUYIN_ROOM_NAME } from "@sittuyin/shared";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
	const pieceList = Object.entries(SITTUYIN_PIECE_NAMES);

	return (
		<main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6 py-12">
			<div className="space-y-2">
				<p className="text-sm font-medium tracking-wider text-amber-400 uppercase">
					Sittuyin · Burmese Chess
				</p>
				<h1 className="text-4xl font-bold tracking-tight text-stone-50">
					မြန်မာ့ စစ်တုရင်
				</h1>
				<p className="text-stone-300">
					Monorepo scaffold ready: {ENGINE_METADATA.boardSize}x
					{ENGINE_METADATA.boardSize} board engine linked, Colyseus room{" "}
					<code className="rounded bg-stone-800 px-1.5 py-0.5 text-amber-300">
						{SITTUYIN_ROOM_NAME}
					</code>{" "}
					configured.
				</p>
			</div>

			<section className="rounded-xl border border-stone-800 bg-stone-900/70 p-5">
				<h2 className="mb-3 text-sm font-semibold tracking-wide text-stone-400 uppercase">
					Pieces ({pieceList.length})
				</h2>
				<ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
					{pieceList.map(([role, entry]) => (
						<li
							key={role}
							className="rounded-lg border border-stone-800 bg-stone-950/60 px-3 py-2"
						>
							<div className="font-medium text-stone-100">{entry.myanmar}</div>
							<div className="text-xs text-stone-400">
								{entry.romanized} ({entry.english})
							</div>
						</li>
					))}
				</ul>
			</section>
		</main>
	);
}

import type { PieceRole, Side } from "@sittuyin/engine";
import { PIECE_SCRIPT_BADGES } from "@/lib/board-geometry";
import { cn } from "@/lib/utils";

export interface SittuyinPieceSvgProps {
	readonly pieceRole: PieceRole;
	readonly side: Side;
	readonly showScript?: boolean;
	readonly className?: string;
	readonly decorative?: boolean;
}

function PieceCarvedSilhouette({
	role,
	stroke,
}: {
	readonly role: PieceRole;
	readonly stroke: string;
}) {
	switch (role) {
		case "king":
			// Tiered Burmese royal pyatthat spire crown
			return (
				<g
					fill={stroke}
					stroke={stroke}
					strokeWidth="1.6"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					{/* Spire finial */}
					<path d="M50 18 L53 26 L47 26 Z" />
					{/* Upper tier roof */}
					<path d="M36 33 Q50 25 64 33 L60 36 L40 36 Z" />
					{/* Middle tier roof */}
					<path d="M30 44 Q50 35 70 44 L66 48 L34 48 Z" />
					{/* Lower royal tier */}
					<path d="M25 56 Q50 47 75 56 L70 61 L30 61 Z" />
					{/* Pillars and throne base */}
					<rect x="36" y="61" width="28" height="7" rx="1.5" />
					<path d="M28 73 L72 73 L69 78 L31 78 Z" />
				</g>
			);

		case "general":
			// Crested Burmese commander helmet (Sit ke) with crossed spears
			return (
				<g
					fill="none"
					stroke={stroke}
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					{/* Crossed spear shafts behind helmet */}
					<line x1="27" y1="73" x2="73" y2="27" strokeWidth="3.2" />
					<line x1="73" y1="73" x2="27" y2="27" strokeWidth="3.2" />
					{/* Spear tips */}
					<path d="M75 25 L67 27 L73 33 Z" fill={stroke} strokeWidth="1" />
					<path d="M25 25 L33 27 L27 33 Z" fill={stroke} strokeWidth="1" />
					{/* Central commander crest helmet */}
					<path
						d="M50 23 L54 31 C61 33 65 40 65 49 L65 57 L35 57 L35 49 C35 40 39 33 46 31 Z"
						fill={stroke}
						strokeWidth="1.5"
					/>
					{/* Chin / brow medallion band */}
					<path
						d="M31 61 L69 61 L65 69 L35 69 Z"
						fill={stroke}
						strokeWidth="1.5"
					/>
					{/* Shield star cutout accent */}
					<circle
						cx="50"
						cy="45"
						r="4"
						fill="var(--bg-surface)"
						stroke="none"
					/>
				</g>
			);

		case "rook":
			// Royal Burmese war chariot (Yahhta): canopy arch + spoked wheel
			return (
				<g
					fill="none"
					stroke={stroke}
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					{/* Chariot pavilion roof */}
					<path
						d="M27 38 Q50 20 73 38 L68 42 L32 42 Z"
						fill={stroke}
						strokeWidth="1.5"
					/>
					{/* Chariot frame */}
					<path d="M34 42 L34 55 L66 55 L66 42" strokeWidth="3.5" />
					<line x1="25" y1="55" x2="75" y2="55" strokeWidth="3.5" />
					{/* Spoked war wheel */}
					<circle cx="50" cy="64" r="14" strokeWidth="3.8" />
					<circle cx="50" cy="64" r="3.5" fill={stroke} strokeWidth="1" />
					<line x1="50" y1="50" x2="50" y2="78" strokeWidth="2.2" />
					<line x1="36" y1="64" x2="64" y2="64" strokeWidth="2.2" />
					<line x1="40" y1="54" x2="60" y2="74" strokeWidth="2" />
					<line x1="60" y1="54" x2="40" y2="74" strokeWidth="2" />
				</g>
			);

		case "elephant":
			// Royal Burmese war elephant (Sin) with tusk, raised trunk, and howdah
			return (
				<g
					fill={stroke}
					stroke={stroke}
					strokeWidth="1.6"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					{/* Ceremonial howdah seat */}
					<path d="M40 27 L59 27 L61 36 L38 36 Z" />
					{/* Elephant body and head */}
					<path d="M35 37 C27 37 24 44 25 54 L25 68 C25 71 29 73 33 70 C35 68 35 63 32 62 C30 61 30 57 32 54 L35 55 L35 74 L43 74 L43 62 L57 62 L57 74 L66 74 L66 46 C66 40 61 37 54 37 Z" />
					{/* Ivory tusk */}
					<path
						d="M28 53 Q21 57 20 62"
						fill="none"
						stroke={stroke}
						strokeWidth="3.2"
					/>
					{/* Tail */}
					<path
						d="M66 49 Q73 53 72 62"
						fill="none"
						stroke={stroke}
						strokeWidth="2.6"
					/>
					{/* Ear detail cutout */}
					<ellipse
						cx="40"
						cy="47"
						rx="4.5"
						ry="6"
						fill="var(--bg-surface)"
						stroke="none"
					/>
				</g>
			);

		case "knight":
			// Arched Myanmar cavalry horse head (Myin)
			return (
				<g
					fill={stroke}
					stroke={stroke}
					strokeWidth="1.6"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					<path d="M36 74 L67 74 L64 68 C67 57 68 41 59 30 C56 26 52 24 48 24 L45 20 L42 26 C35 30 29 38 26 45 C24 49 27 53 31 53 L39 51 C42 50 45 48 47 46 C46 54 41 61 36 68 Z" />
					{/* Mane ridge */}
					<path
						d="M55 28 C63 35 66 48 63 62"
						fill="none"
						stroke="var(--bg-surface)"
						strokeWidth="2.4"
					/>
					{/* Eye */}
					<circle
						cx="40"
						cy="37"
						r="2.3"
						fill="var(--bg-surface)"
						stroke="none"
					/>
				</g>
			);

		case "pawn":
			// Traditional turned conical Myanmar wooden pawn (Ne)
			return (
				<g
					fill={stroke}
					stroke={stroke}
					strokeWidth="1.6"
					strokeLinecap="round"
					strokeLinejoin="round"
				>
					{/* Finial knob */}
					<circle cx="50" cy="29" r="7.5" />
					{/* Turned collar */}
					<rect x="38" y="38" width="24" height="5" rx="2.5" />
					{/* Conical wooden stem */}
					<path d="M41 44 L59 44 L65 65 L35 65 Z" />
					{/* Stepped base */}
					<rect x="30" y="66" width="40" height="7" rx="3" />
				</g>
			);
	}
}

export function SittuyinPieceSvg({
	pieceRole,
	side,
	showScript = false,
	className,
	decorative = true,
}: SittuyinPieceSvgProps) {
	const isRed = side === "red";
	const bodyFill = isRed ? "var(--piece-red-fill)" : "var(--piece-black-fill)";
	const accentColor = isRed
		? "var(--piece-red-accent)"
		: "var(--piece-black-accent)";
	const rimShadow = isRed ? "#6E120F" : "#0B0908";
	const highlightTop = isRed
		? "rgba(255, 224, 168, 0.28)"
		: "rgba(243, 231, 209, 0.2)";

	return (
		<svg
			viewBox="0 0 100 100"
			width="100%"
			height="100%"
			className={cn("block select-none overflow-visible", className)}
			aria-hidden={decorative ? "true" : undefined}
			focusable="false"
		>
			<title>{`${side} ${pieceRole}`}</title>
			{/* Soft contact shadow on teak board */}
			<ellipse cx="50" cy="54" rx="41" ry="40" fill="rgba(12, 7, 4, 0.36)" />
			{/* Outer turned wooden rim */}
			<circle cx="50" cy="50" r="42" fill={rimShadow} />
			{/* Primary lacquer medallion body */}
			<circle cx="50" cy="48.5" r="39.5" fill={bodyFill} />
			{/* Top lacquer specular sheen */}
			<path
				d="M22 36 A33 33 0 0 1 78 36 A38 22 0 0 0 22 36 Z"
				fill={highlightTop}
			/>
			{/* Inner inlaid gold/ivory double ring */}
			<circle
				cx="50"
				cy="48.5"
				r="35"
				fill="none"
				stroke={accentColor}
				strokeWidth="2.1"
				opacity="0.9"
			/>
			<circle
				cx="50"
				cy="48.5"
				r="31.5"
				fill="none"
				stroke={accentColor}
				strokeWidth="0.9"
				opacity="0.45"
			/>
			{/* Carved Burmese silhouette */}
			<g transform="translate(0, -1)">
				<PieceCarvedSilhouette role={pieceRole} stroke={accentColor} />
			</g>
			{/* Optional compact Burmese script initial badge */}
			{showScript ? (
				<g transform="translate(74, 74)">
					<circle
						cx="0"
						cy="0"
						r="15"
						fill={rimShadow}
						stroke={accentColor}
						strokeWidth="2"
					/>
					<text
						x="0"
						y="1"
						textAnchor="middle"
						dominantBaseline="central"
						fill={accentColor}
						fontSize="14.5"
						fontWeight="700"
						fontFamily="var(--font-myanmar)"
					>
						{PIECE_SCRIPT_BADGES[pieceRole]}
					</text>
				</g>
			) : null}
		</svg>
	);
}

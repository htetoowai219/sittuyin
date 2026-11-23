import { type TimeControl, TimeControlSchema } from "@sittuyin/shared";
import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { SittuyinMatchWorkspace } from "@/components/sittuyin/SittuyinMatchWorkspace";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type AppLocale, isAppLocale, m } from "@/i18n/locale";
import {
	type LocalPlayMode,
	useLocalMatchAdapter,
} from "@/lib/adapters/local-match-adapter";

interface PlaySearchParams {
	mode?: "pass_and_play" | "sandbox";
	tc?: TimeControl | "untimed";
}

function parsePlaySearch(search: Record<string, unknown>): PlaySearchParams {
	const result: PlaySearchParams = {};
	if (search.mode === "sandbox" || search.mode === "pass_and_play") {
		result.mode = search.mode;
	}
	if (search.tc === "untimed") {
		result.tc = "untimed";
	} else {
		const parsedTc = TimeControlSchema.safeParse(search.tc);
		if (parsedTc.success) {
			result.tc = parsedTc.data;
		}
	}
	return result;
}

export const Route = createFileRoute("/$locale/play")({
	validateSearch: parsePlaySearch,
	component: PlayPage,
});

function PlayPage() {
	const { locale } = Route.useParams();
	const search = Route.useSearch();
	const activeLocale: AppLocale = isAppLocale(locale) ? locale : "my";

	const [playMode, setPlayMode] = useState<LocalPlayMode>(() =>
		search.mode === "sandbox" ? "local_sandbox" : "local_pass_and_play",
	);
	const [timeControl, setTimeControl] = useState<TimeControl | null>(() =>
		search.tc && search.tc !== "untimed" ? search.tc : null,
	);

	const { adapter, resetMatch } = useLocalMatchAdapter({
		mode: playMode,
		timeControl,
		locale: activeLocale,
	});

	const handleTimeControlChange = (val: string) => {
		const nextTc: TimeControl | null =
			val === "untimed"
				? null
				: TimeControlSchema.safeParse(val).success
					? (val as TimeControl)
					: null;
		setTimeControl(nextTc);
		resetMatch({ timeControl: nextTc });
	};

	const toolbar = (
		<div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-border-subtle bg-card/90 px-3 py-2">
			<div className="flex flex-wrap items-center gap-2">
				<ToggleGroup
					type="single"
					size="sm"
					value={playMode}
					onValueChange={(val) => {
						if (val === "local_pass_and_play" || val === "local_sandbox") {
							setPlayMode(val);
						}
					}}
					aria-label="Local play mode"
				>
					<ToggleGroupItem
						value="local_pass_and_play"
						data-testid="mode-pass-and-play"
					>
						{m.mode_pass_and_play({}, { locale: activeLocale })}
					</ToggleGroupItem>
					<ToggleGroupItem value="local_sandbox" data-testid="mode-sandbox">
						{m.mode_sandbox({}, { locale: activeLocale })}
					</ToggleGroupItem>
				</ToggleGroup>

				<Select
					value={timeControl ?? "untimed"}
					onValueChange={handleTimeControlChange}
				>
					<SelectTrigger
						className="h-8 w-44 text-xs"
						data-testid="time-control-select"
						aria-label={m.time_control_label({}, { locale: activeLocale })}
					>
						<SelectValue
							placeholder={m.time_control_untimed({}, { locale: activeLocale })}
						/>
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							<SelectItem value="untimed">
								{m.time_control_untimed({}, { locale: activeLocale })}
							</SelectItem>
							<SelectItem value="rapid_10_5">
								{m.time_control_rapid_10_5({}, { locale: activeLocale })}
							</SelectItem>
							<SelectItem value="rapid_15_10">
								{m.time_control_rapid_15_10({}, { locale: activeLocale })}
							</SelectItem>
							<SelectItem value="classical_30_0">
								{m.time_control_classical_30_0({}, { locale: activeLocale })}
							</SelectItem>
						</SelectGroup>
					</SelectContent>
				</Select>
			</div>

			<Button
				type="button"
				variant="secondary"
				size="sm"
				data-testid="toolbar-new-match-btn"
				onClick={() => resetMatch()}
			>
				<RefreshCw data-icon="inline-start" />
				{m.new_match({}, { locale: activeLocale })}
			</Button>
		</div>
	);

	return (
		<SittuyinMatchWorkspace
			adapter={adapter}
			locale={activeLocale}
			onNewMatch={() => resetMatch()}
			topToolbar={toolbar}
		/>
	);
}

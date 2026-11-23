import { RotateCcw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type AppLocale, m } from "@/i18n/locale";
import {
	type AnimationSpeed,
	type BoardTheme,
	useBoardPreferencesStore,
} from "@/stores/board-preferences";

export interface BoardPreferencesDialogProps {
	readonly locale: AppLocale;
}

export function BoardPreferencesDialog({
	locale,
}: BoardPreferencesDialogProps) {
	const theme = useBoardPreferencesStore((s) => s.theme);
	const soundEnabled = useBoardPreferencesStore((s) => s.soundEnabled);
	const soundVolume = useBoardPreferencesStore((s) => s.soundVolume);
	const pieceScriptOverlay = useBoardPreferencesStore(
		(s) => s.pieceScriptOverlay,
	);
	const showLegalHints = useBoardPreferencesStore((s) => s.showLegalHints);
	const showCoordinates = useBoardPreferencesStore((s) => s.showCoordinates);
	const highlightSitKeMyin = useBoardPreferencesStore(
		(s) => s.highlightSitKeMyin,
	);
	const confirmPromotion = useBoardPreferencesStore((s) => s.confirmPromotion);
	const animationSpeed = useBoardPreferencesStore((s) => s.animationSpeed);

	const setTheme = useBoardPreferencesStore((s) => s.setTheme);
	const setSoundEnabled = useBoardPreferencesStore((s) => s.setSoundEnabled);
	const setSoundVolume = useBoardPreferencesStore((s) => s.setSoundVolume);
	const setPieceScriptOverlay = useBoardPreferencesStore(
		(s) => s.setPieceScriptOverlay,
	);
	const setShowLegalHints = useBoardPreferencesStore(
		(s) => s.setShowLegalHints,
	);
	const setShowCoordinates = useBoardPreferencesStore(
		(s) => s.setShowCoordinates,
	);
	const setHighlightSitKeMyin = useBoardPreferencesStore(
		(s) => s.setHighlightSitKeMyin,
	);
	const setConfirmPromotion = useBoardPreferencesStore(
		(s) => s.setConfirmPromotion,
	);
	const setAnimationSpeed = useBoardPreferencesStore(
		(s) => s.setAnimationSpeed,
	);
	const resetDefaults = useBoardPreferencesStore((s) => s.resetDefaults);

	return (
		<Dialog>
			<DialogTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					data-testid="open-preferences-btn"
				>
					<Settings2 data-icon="inline-start" />
					{m.action_preferences({}, { locale })}
				</Button>
			</DialogTrigger>

			<DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{m.prefs_title({}, { locale })}</DialogTitle>
					<DialogDescription>
						{m.prefs_description({}, { locale })}
					</DialogDescription>
				</DialogHeader>

				<FieldGroup className="gap-4 py-2">
					{/* Table Theme */}
					<Field>
						<FieldLabel>{m.prefs_theme_label({}, { locale })}</FieldLabel>
						<ToggleGroup
							type="single"
							value={theme}
							onValueChange={(val) => {
								if (val === "dark" || val === "light") {
									setTheme(val as BoardTheme);
								}
							}}
							className="justify-start"
						>
							<ToggleGroupItem value="dark" data-testid="pref-theme-dark">
								{m.prefs_theme_dark({}, { locale })}
							</ToggleGroupItem>
							<ToggleGroupItem value="light" data-testid="pref-theme-light">
								{m.prefs_theme_light({}, { locale })}
							</ToggleGroupItem>
						</ToggleGroup>
					</Field>

					<Separator />

					{/* Sound toggle + volume slider */}
					<Field
						orientation="horizontal"
						className="items-center justify-between"
					>
						<FieldLabel htmlFor="pref-sound-enabled">
							{m.prefs_sound_enabled({}, { locale })}
						</FieldLabel>
						<Switch
							id="pref-sound-enabled"
							checked={soundEnabled}
							onCheckedChange={setSoundEnabled}
						/>
					</Field>

					<Field>
						<div className="flex items-center justify-between">
							<FieldLabel htmlFor="pref-sound-volume">
								{m.prefs_sound_volume({}, { locale })}
							</FieldLabel>
							<span className="text-xs text-muted-foreground tabular-nums">
								{Math.round(soundVolume * 100)}%
							</span>
						</div>
						<Slider
							id="pref-sound-volume"
							disabled={!soundEnabled}
							min={0}
							max={100}
							step={5}
							value={[Math.round(soundVolume * 100)]}
							onValueChange={(values) => {
								const v = values[0];
								if (v !== undefined) {
									setSoundVolume(v / 100);
								}
							}}
						/>
					</Field>

					<Separator />

					{/* Visual board toggles */}
					<Field
						orientation="horizontal"
						className="items-center justify-between"
					>
						<FieldLabel htmlFor="pref-script-overlay">
							{m.prefs_script_overlay({}, { locale })}
						</FieldLabel>
						<Switch
							id="pref-script-overlay"
							data-testid="pref-script-overlay"
							checked={pieceScriptOverlay}
							onCheckedChange={setPieceScriptOverlay}
						/>
					</Field>

					<Field
						orientation="horizontal"
						className="items-center justify-between"
					>
						<FieldLabel htmlFor="pref-legal-hints">
							{m.prefs_legal_hints({}, { locale })}
						</FieldLabel>
						<Switch
							id="pref-legal-hints"
							checked={showLegalHints}
							onCheckedChange={setShowLegalHints}
						/>
					</Field>

					<Field
						orientation="horizontal"
						className="items-center justify-between"
					>
						<FieldLabel htmlFor="pref-coordinates">
							{m.prefs_coordinates({}, { locale })}
						</FieldLabel>
						<Switch
							id="pref-coordinates"
							checked={showCoordinates}
							onCheckedChange={setShowCoordinates}
						/>
					</Field>

					<Field
						orientation="horizontal"
						className="items-center justify-between"
					>
						<FieldLabel htmlFor="pref-sit-ke-myin">
							{m.prefs_sit_ke_myin({}, { locale })}
						</FieldLabel>
						<Switch
							id="pref-sit-ke-myin"
							checked={highlightSitKeMyin}
							onCheckedChange={setHighlightSitKeMyin}
						/>
					</Field>

					<Field
						orientation="horizontal"
						className="items-center justify-between"
					>
						<FieldLabel htmlFor="pref-confirm-promotion">
							{m.prefs_confirm_promotion({}, { locale })}
						</FieldLabel>
						<Switch
							id="pref-confirm-promotion"
							data-testid="pref-confirm-promotion"
							checked={confirmPromotion}
							onCheckedChange={setConfirmPromotion}
						/>
					</Field>

					<Separator />

					{/* Animation Speed */}
					<Field>
						<FieldLabel>{m.prefs_animation_speed({}, { locale })}</FieldLabel>
						<ToggleGroup
							type="single"
							value={animationSpeed}
							onValueChange={(val) => {
								if (val === "normal" || val === "fast" || val === "none") {
									setAnimationSpeed(val as AnimationSpeed);
								}
							}}
							className="justify-start"
						>
							<ToggleGroupItem value="normal">
								{m.prefs_anim_normal({}, { locale })}
							</ToggleGroupItem>
							<ToggleGroupItem value="fast">
								{m.prefs_anim_fast({}, { locale })}
							</ToggleGroupItem>
							<ToggleGroupItem value="none">
								{m.prefs_anim_none({}, { locale })}
							</ToggleGroupItem>
						</ToggleGroup>
					</Field>
				</FieldGroup>

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={resetDefaults}
					>
						<RotateCcw data-icon="inline-start" />
						{m.prefs_reset({}, { locale })}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

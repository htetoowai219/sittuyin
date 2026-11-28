import type {
	CanonicalRoomMode,
	PreferredSide,
	TimeControl,
} from "@sittuyin/shared";
import { Globe, Lock, Plus, Swords } from "lucide-react";
import { type FormEvent, useState } from "react";
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
import {
	Field,
	FieldDescription,
	FieldGroup,
	FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type AppLocale, m } from "@/i18n/locale";

export interface CreateRoomFormValues {
	readonly roomMode: CanonicalRoomMode;
	readonly isRated: boolean;
	readonly timeControl: TimeControl;
	readonly preferredSide: PreferredSide;
	readonly roomTitle: string;
}

export interface CreateRoomDialogProps {
	readonly locale: AppLocale;
	readonly isSubmitting?: boolean;
	readonly defaultTimeControl?: TimeControl;
	readonly onCreateRoom: (values: CreateRoomFormValues) => Promise<void> | void;
}

export function CreateRoomDialog({
	locale,
	isSubmitting = false,
	defaultTimeControl = "rapid_10_5",
	onCreateRoom,
}: CreateRoomDialogProps) {
	const [open, setOpen] = useState(false);
	const [roomMode, setRoomMode] = useState<CanonicalRoomMode>("public_lobby");
	const [isRated, setIsRated] = useState<boolean>(true);
	const [timeControl, setTimeControl] =
		useState<TimeControl>(defaultTimeControl);
	const [preferredSide, setPreferredSide] = useState<PreferredSide>("random");
	const [roomTitle, setRoomTitle] = useState("");

	const effectiveIsRated = roomMode === "private_room" ? false : isRated;

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		await onCreateRoom({
			roomMode,
			isRated: effectiveIsRated,
			timeControl,
			preferredSide,
			roomTitle: roomTitle.trim(),
		});
	};

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					type="button"
					variant="default"
					data-testid="open-create-room-dialog-btn"
				>
					<Plus data-icon="inline-start" />
					{m.online_create_room_cta({}, { locale })}
				</Button>
			</DialogTrigger>

			<DialogContent
				data-testid="create-room-dialog"
				className="border-border-subtle bg-card sm:max-w-md"
			>
				<DialogHeader>
					<DialogTitle className="text-lg font-bold">
						{m.create_room_title({}, { locale })}
					</DialogTitle>
					<DialogDescription className="text-xs text-muted-foreground">
						{m.create_room_subtitle({}, { locale })}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						void handleSubmit(e);
					}}
					className="flex flex-col gap-5"
				>
					<FieldGroup className="gap-4">
						<Field>
							<FieldLabel>
								{m.create_room_mode_label({}, { locale })}
							</FieldLabel>
							<ToggleGroup
								type="single"
								variant="outline"
								value={roomMode}
								onValueChange={(val) => {
									if (val === "public_lobby" || val === "private_room") {
										setRoomMode(val);
									}
								}}
								className="w-full"
							>
								<ToggleGroupItem
									value="public_lobby"
									data-testid="create-mode-public"
									className="flex-1 gap-1.5"
								>
									<Globe className="size-3.5" />
									{m.create_room_mode_public({}, { locale })}
								</ToggleGroupItem>
								<ToggleGroupItem
									value="private_room"
									data-testid="create-mode-private"
									className="flex-1 gap-1.5"
								>
									<Lock className="size-3.5" />
									{m.create_room_mode_private({}, { locale })}
								</ToggleGroupItem>
							</ToggleGroup>
							<FieldDescription className="text-xs">
								{roomMode === "public_lobby"
									? m.create_room_mode_public_desc({}, { locale })
									: m.create_room_mode_private_desc({}, { locale })}
							</FieldDescription>
						</Field>

						<Field>
							<FieldLabel>
								{m.create_room_rated_label({}, { locale })}
							</FieldLabel>
							<ToggleGroup
								type="single"
								variant="outline"
								value={effectiveIsRated ? "rated" : "normal"}
								disabled={roomMode === "private_room"}
								onValueChange={(val) => {
									if (roomMode === "private_room") return;
									if (val === "rated") setIsRated(true);
									if (val === "normal") setIsRated(false);
								}}
								className="w-full"
							>
								<ToggleGroupItem
									value="rated"
									disabled={roomMode === "private_room"}
									data-testid="create-rated-toggle"
									className="flex-1 text-xs"
								>
									{m.create_room_rated({}, { locale })}
								</ToggleGroupItem>
								<ToggleGroupItem
									value="normal"
									data-testid="create-normal-toggle"
									className="flex-1 text-xs"
								>
									{m.create_room_normal({}, { locale })}
								</ToggleGroupItem>
							</ToggleGroup>
							{roomMode === "private_room" ? (
								<FieldDescription className="text-xs">
									{m.create_room_private_unrated_desc({}, { locale })}
								</FieldDescription>
							) : null}
						</Field>

						<Field>
							<FieldLabel>{m.time_control_label({}, { locale })}</FieldLabel>
							<ToggleGroup
								type="single"
								variant="outline"
								value={timeControl}
								onValueChange={(val) => {
									if (
										val === "rapid_10_5" ||
										val === "rapid_15_10" ||
										val === "classical_30_0"
									) {
										setTimeControl(val);
									}
								}}
								className="w-full"
							>
								<ToggleGroupItem
									value="rapid_10_5"
									data-testid="create-tc-rapid_10_5"
									className="flex-1 text-xs"
								>
									{m.time_control_rapid_10_5({}, { locale })}
								</ToggleGroupItem>
								<ToggleGroupItem
									value="rapid_15_10"
									data-testid="create-tc-rapid_15_10"
									className="flex-1 text-xs"
								>
									{m.time_control_rapid_15_10({}, { locale })}
								</ToggleGroupItem>
								<ToggleGroupItem
									value="classical_30_0"
									data-testid="create-tc-classical_30_0"
									className="flex-1 text-xs"
								>
									{m.time_control_classical_30_0({}, { locale })}
								</ToggleGroupItem>
							</ToggleGroup>
						</Field>

						<Field>
							<FieldLabel>
								{m.create_room_side_label({}, { locale })}
							</FieldLabel>
							<ToggleGroup
								type="single"
								variant="outline"
								value={preferredSide}
								onValueChange={(val) => {
									if (val === "random" || val === "red" || val === "black") {
										setPreferredSide(val);
									}
								}}
								className="w-full"
							>
								<ToggleGroupItem
									value="random"
									data-testid="create-side-random"
									className="flex-1 text-xs"
								>
									{m.create_room_side_random({}, { locale })}
								</ToggleGroupItem>
								<ToggleGroupItem
									value="red"
									data-testid="create-side-red"
									className="flex-1 text-xs"
								>
									{m.create_room_side_red({}, { locale })}
								</ToggleGroupItem>
								<ToggleGroupItem
									value="black"
									data-testid="create-side-black"
									className="flex-1 text-xs"
								>
									{m.create_room_side_black({}, { locale })}
								</ToggleGroupItem>
							</ToggleGroup>
						</Field>

						<Field>
							<FieldLabel htmlFor="create-room-title-input">
								{m.create_room_title_label({}, { locale })}
							</FieldLabel>
							<Input
								id="create-room-title-input"
								data-testid="create-room-title-input"
								maxLength={48}
								value={roomTitle}
								onChange={(e) => setRoomTitle(e.target.value)}
								placeholder={m.create_room_title_placeholder({}, { locale })}
							/>
						</Field>
					</FieldGroup>

					<DialogFooter>
						<Button
							type="submit"
							disabled={isSubmitting}
							data-testid="create-room-submit-btn"
							className="w-full"
						>
							<Swords data-icon="inline-start" />
							{isSubmitting
								? m.create_room_submitting({}, { locale })
								: m.create_room_submit({}, { locale })}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

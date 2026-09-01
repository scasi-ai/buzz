import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	CheckCircle2,
	Copy,
	House,
	LoaderCircle,
	LockKeyhole,
	MailPlus,
	RefreshCw,
	ShieldCheck,
	UserRound,
	UsersRound,
} from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { loadMiCasaBootstrap } from "@/features/micasa/api";
import {
	type HouseholdMembersSnapshot,
	loadHouseholdMembers,
	type ManagedInvitation,
	type ManagedMember,
	type MemberCommand,
	mutateHouseholdMembers,
	type SharedRoom,
} from "@/features/micasa/household-members";
import { Button } from "@/shared/ui/button";

function Brand() {
	return (
		<a aria-label="MiCasa home" className="flex items-center gap-3" href="/">
			<span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
				<House aria-hidden="true" className="h-5 w-5" />
			</span>
			<div>
				<p className="text-lg font-semibold tracking-tight text-slate-950">
					MiCasa
				</p>
				<p className="text-xs text-slate-500">Personal-Agent for households</p>
			</div>
		</a>
	);
}
function Shell({ children }: { children: ReactNode }) {
	return (
		<main className="min-h-dvh bg-slate-50 p-5 sm:p-8">
			<div className="mx-auto max-w-6xl">
				<Brand />
				<div className="mt-8">{children}</div>
			</div>
		</main>
	);
}
function Loading() {
	return (
		<Shell>
			<div className="rounded-3xl border border-slate-200 bg-white py-20 text-center shadow-sm">
				<LoaderCircle
					aria-hidden="true"
					className="mx-auto h-8 w-8 animate-spin text-slate-600"
				/>
				<p className="mt-3 text-sm text-slate-600">
					Loading Household Settings…
				</p>
			</div>
		</Shell>
	);
}
function Unavailable({
	retry,
	message,
}: {
	retry: () => void;
	message: string;
}) {
	return (
		<Shell>
			<div className="rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
				<ShieldCheck
					aria-hidden="true"
					className="mx-auto h-10 w-10 text-slate-700"
				/>
				<h1 className="mt-5 text-2xl font-semibold text-slate-950">
					Household Settings are unavailable
				</h1>
				<p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">
					{message} No membership change was assumed.
				</p>
				<Button
					className="mt-6 bg-slate-950 text-white hover:bg-slate-800"
					onClick={retry}
				>
					<RefreshCw aria-hidden="true" className="mr-2 h-4 w-4" />
					Try again
				</Button>
			</div>
		</Shell>
	);
}

const readinessLabels: Record<ManagedMember["personalAgentReadiness"], string> =
	{
		RESERVED: "Personal Agent reserved",
		READY: "Personal Agent ready",
		SUSPENDED: "Personal Agent suspended",
		REVOKED: "Personal Agent revoked",
	};
const lifecycleLabels: Record<ManagedMember["lifecycle"], string> = {
	PENDING: "Invitation pending",
	ACTIVE: "Active",
	SUSPENDED: "Suspended",
	DELETED: "Removed",
};

function RoomChoices({
	rooms,
	selected,
	onChange,
	disabled,
}: {
	rooms: SharedRoom[];
	selected: string[];
	onChange: (roomIds: string[]) => void;
	disabled?: boolean;
}) {
	return (
		<fieldset className="mt-4">
			<legend className="text-xs font-semibold uppercase tracking-wider text-slate-500">
				Shared rooms
			</legend>
			<div className="mt-2 flex flex-wrap gap-2">
				{rooms.map((room) => {
					const checked = selected.includes(room.roomId);
					const required = room.kind === "HOUSEHOLD";
					return (
						<label
							className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700"
							key={room.roomId}
						>
							<input
								checked={checked || required}
								disabled={disabled || required}
								onChange={(event: ChangeEvent<HTMLInputElement>) => {
									const next = event.target.checked
										? rooms
												.map((item) => item.roomId)
												.filter(
													(roomId) =>
														selected.includes(roomId) ||
														roomId === room.roomId ||
														roomId ===
															rooms.find((item) => item.kind === "HOUSEHOLD")
																?.roomId,
												)
										: selected.filter((roomId) => roomId !== room.roomId);
									onChange(next);
								}}
								type="checkbox"
							/>
							{room.displayName}
							{required && (
								<span className="text-xs text-slate-400">required</span>
							)}
						</label>
					);
				})}
			</div>
		</fieldset>
	);
}

function MemberEditor({
	member,
	rooms,
	busy,
	submit,
}: {
	member: ManagedMember;
	rooms: SharedRoom[];
	busy: boolean;
	submit: (command: MemberCommand) => void;
}) {
	const [editing, setEditing] = useState(false);
	const [displayName, setDisplayName] = useState(member.displayName);
	const [role, setRole] = useState<"ADMIN" | "MEMBER">(
		member.role === "ADMIN" ? "ADMIN" : "MEMBER",
	);
	const [selectedRooms, setSelectedRooms] = useState(
		member.configuredSharedRoomIds,
	);
	const protectedHead = member.role === "HEAD";
	const canEdit =
		!protectedHead &&
		(member.lifecycle === "ACTIVE" || member.lifecycle === "SUSPENDED");

	if (editing && canEdit) {
		return (
			<article className="rounded-2xl border border-slate-300 bg-white p-5 shadow-sm">
				<div className="grid gap-4 sm:grid-cols-2">
					<label className="text-sm font-medium text-slate-700">
						Display name
						<input
							className="mt-2 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-600"
							maxLength={120}
							onChange={(event: ChangeEvent<HTMLInputElement>) =>
								setDisplayName(event.target.value)
							}
							value={displayName}
						/>
					</label>
					<label className="text-sm font-medium text-slate-700">
						Household role
						<select
							className="mt-2 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
							onChange={(event: ChangeEvent<HTMLSelectElement>) =>
								setRole(event.target.value as "ADMIN" | "MEMBER")
							}
							value={role}
						>
							<option value="MEMBER">Member</option>
							<option value="ADMIN">Administrator</option>
						</select>
					</label>
				</div>
				<RoomChoices
					onChange={setSelectedRooms}
					rooms={rooms}
					selected={selectedRooms}
				/>
				<div className="mt-5 flex justify-end gap-2">
					<Button
						className="border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
						disabled={busy}
						onClick={() => setEditing(false)}
						type="button"
					>
						Cancel
					</Button>
					<Button
						className="bg-slate-950 text-white hover:bg-slate-800"
						disabled={busy || displayName.trim().length === 0}
						onClick={() =>
							submit({
								operation: "UPDATE_MEMBER",
								subjectId: member.memberId,
								displayName: displayName.trim(),
								role,
								configuredSharedRoomIds: selectedRooms,
							})
						}
						type="button"
					>
						Save member
					</Button>
				</div>
			</article>
		);
	}

	return (
		<article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div className="flex min-w-0 gap-3">
					<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-700">
						<UserRound aria-hidden="true" className="h-5 w-5" />
					</span>
					<div>
						<div className="flex flex-wrap items-center gap-2">
							<h3 className="font-semibold text-slate-950">
								{member.displayName}
							</h3>
							{protectedHead && (
								<span className="rounded-full bg-slate-950 px-2 py-0.5 text-xs font-medium text-white">
									Head of Household
								</span>
							)}
							{!protectedHead && (
								<span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
									{member.role === "ADMIN" ? "Administrator" : "Member"}
								</span>
							)}
						</div>
						<p className="mt-1 text-sm text-slate-500">
							{lifecycleLabels[member.lifecycle]} ·{" "}
							{readinessLabels[member.personalAgentReadiness]}
						</p>
						{member.lifecycle !== "DELETED" && (
							<p className="mt-2 text-xs text-slate-500">
								{member.configuredSharedRoomIds.length} shared room
								{member.configuredSharedRoomIds.length === 1 ? "" : "s"}
							</p>
						)}
					</div>
				</div>
				{canEdit && (
					<div className="flex flex-wrap justify-end gap-2">
						<Button
							className="border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
							disabled={busy}
							onClick={() => setEditing(true)}
							type="button"
						>
							Edit
						</Button>
						{member.lifecycle === "ACTIVE" ? (
							<Button
								className="border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
								disabled={busy}
								onClick={() =>
									submit({
										operation: "SUSPEND_MEMBER",
										subjectId: member.memberId,
									})
								}
								type="button"
							>
								Suspend
							</Button>
						) : (
							<Button
								className="border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
								disabled={busy}
								onClick={() =>
									submit({
										operation: "REACTIVATE_MEMBER",
										subjectId: member.memberId,
									})
								}
								type="button"
							>
								Reactivate
							</Button>
						)}
						<Button
							className="border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
							disabled={busy}
							onClick={() => {
								if (
									window.confirm(
										"Remove this member? Their access will be revoked, but shared conversation history will be retained.",
									)
								) {
									submit({
										operation: "REMOVE_MEMBER",
										subjectId: member.memberId,
									});
								}
							}}
							type="button"
						>
							Remove
						</Button>
					</div>
				)}
			</div>
		</article>
	);
}

function InvitationCard({
	invitation,
	busy,
	submit,
}: {
	invitation: ManagedInvitation;
	busy: boolean;
	submit: (command: MemberCommand) => void;
}) {
	return (
		<article className="rounded-2xl border border-slate-200 bg-white p-5">
			<div className="flex flex-wrap items-start justify-between gap-4">
				<div>
					<h3 className="font-semibold text-slate-950">
						{invitation.displayName}
					</h3>
					<p className="mt-1 text-sm text-slate-600">
						{invitation.recipientEmail}
					</p>
					<p className="mt-2 text-xs text-slate-500">
						{invitation.role === "ADMIN" ? "Administrator" : "Member"} ·
						Personal Agent reserved
					</p>
				</div>
				<span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
					{invitation.state === "ACTIVE" ? "Waiting to join" : invitation.state}
				</span>
			</div>
			{invitation.state === "ACTIVE" && invitation.sharePath && (
				<div className="mt-4 flex flex-wrap gap-2">
					<Button
						className="border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
						disabled={busy}
						onClick={() =>
							void navigator.clipboard.writeText(
								window.location.origin + invitation.sharePath,
							)
						}
						type="button"
					>
						<Copy aria-hidden="true" className="mr-2 h-4 w-4" />
						Copy invite
					</Button>
					<Button
						className="border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
						disabled={busy}
						onClick={() =>
							submit({
								operation: "REISSUE_INVITATION",
								subjectId: invitation.invitationId,
							})
						}
						type="button"
					>
						Reissue
					</Button>
					<Button
						className="border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
						disabled={busy}
						onClick={() => {
							if (window.confirm("Revoke this household invitation?")) {
								submit({
									operation: "REVOKE_INVITATION",
									subjectId: invitation.invitationId,
								});
							}
						}}
						type="button"
					>
						Revoke
					</Button>
				</div>
			)}
		</article>
	);
}

function InviteForm({
	snapshot,
	busy,
	submit,
}: {
	snapshot: HouseholdMembersSnapshot;
	busy: boolean;
	submit: (command: MemberCommand) => void;
}) {
	const [recipientEmail, setRecipientEmail] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [role, setRole] = useState<"ADMIN" | "MEMBER">("MEMBER");
	const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
	useEffect(() => {
		setSelectedRooms(snapshot.sharedRooms.map((room) => room.roomId));
	}, [snapshot.householdId, snapshot.sharedRooms]);

	return (
		<section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
			<div className="flex items-start gap-3">
				<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
					<MailPlus aria-hidden="true" className="h-5 w-5" />
				</span>
				<div>
					<h2 className="text-xl font-semibold text-slate-950">
						Invite a household member
					</h2>
					<p className="mt-1 text-sm leading-6 text-slate-600">
						MiCasa reserves their Personal Agent now. They activate it when they
						accept the invitation.
					</p>
				</div>
			</div>
			<div className="mt-6 grid gap-4 md:grid-cols-3">
				<label className="text-sm font-medium text-slate-700">
					Name
					<input
						autoComplete="name"
						className="mt-2 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-600"
						maxLength={120}
						onChange={(event: ChangeEvent<HTMLInputElement>) =>
							setDisplayName(event.target.value)
						}
						placeholder="Household member"
						value={displayName}
					/>
				</label>
				<label className="text-sm font-medium text-slate-700">
					Email
					<input
						autoComplete="email"
						className="mt-2 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-600"
						onChange={(event: ChangeEvent<HTMLInputElement>) =>
							setRecipientEmail(event.target.value)
						}
						placeholder="person@example.com"
						type="email"
						value={recipientEmail}
					/>
				</label>
				<label className="text-sm font-medium text-slate-700">
					Household role
					<select
						className="mt-2 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"
						onChange={(event: ChangeEvent<HTMLSelectElement>) =>
							setRole(event.target.value as "ADMIN" | "MEMBER")
						}
						value={role}
					>
						<option value="MEMBER">Member</option>
						<option value="ADMIN">Administrator</option>
					</select>
				</label>
			</div>
			<RoomChoices
				onChange={setSelectedRooms}
				rooms={snapshot.sharedRooms}
				selected={selectedRooms}
			/>
			<div className="mt-5 flex justify-end">
				<Button
					className="bg-slate-950 text-white hover:bg-slate-800"
					disabled={
						busy ||
						displayName.trim().length === 0 ||
						recipientEmail.trim().length === 0
					}
					onClick={() =>
						submit({
							operation: "INVITE",
							recipientEmail: recipientEmail.trim(),
							displayName: displayName.trim(),
							role,
							configuredSharedRoomIds: selectedRooms,
						})
					}
					type="button"
				>
					Send invitation
				</Button>
			</div>
		</section>
	);
}

function HouseholdMembersContent({
	snapshot,
	busy,
	success,
	error,
	submit,
}: {
	snapshot: HouseholdMembersSnapshot;
	busy: boolean;
	success: string | null;
	error: string | null;
	submit: (command: MemberCommand) => void;
}) {
	const activeInvitations = snapshot.invitations.filter(
		(invitation) => invitation.state === "ACTIVE",
	);
	return (
		<Shell>
			<a
				className="inline-flex items-center text-sm font-medium text-slate-600 hover:text-slate-950"
				href="/"
			>
				<ArrowLeft aria-hidden="true" className="mr-2 h-4 w-4" />
				Back to MiCasa
			</a>
			<div className="mt-4 flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
						Household Settings
					</p>
					<h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
						Members &amp; invitations
					</h1>
					<p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
						Manage who belongs to this household, their shared rooms, and their
						Personal Agent access.
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<a
						className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
						href={
							"/settings/household/agent?household=" +
							encodeURIComponent(snapshot.householdId)
						}
					>
						Household Agent
					</a>
					<a
						className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
						href={
							"/settings/household/apps?household=" +
							encodeURIComponent(snapshot.householdId)
						}
					>
						Apps &amp; Data
					</a>
					<span className="inline-flex items-center rounded-full bg-slate-950 px-3 py-1.5 text-xs font-medium text-white">
						<LockKeyhole aria-hidden="true" className="mr-2 h-3.5 w-3.5" />
						Head of Household only
					</span>
				</div>
			</div>

			<div className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm leading-6 text-indigo-900">
				<strong>Privacy boundary:</strong> you can manage membership and shared
				room access. Each adult&apos;s private agent conversations, messages,
				connected apps, and account data remain private to them.
			</div>
			{success && (
				<p
					className="mt-4 flex items-center rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800"
					role="status"
				>
					<CheckCircle2 aria-hidden="true" className="mr-2 h-4 w-4" />
					{success}
				</p>
			)}
			{error && (
				<p
					className="mt-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"
					role="alert"
				>
					{error}
				</p>
			)}

			<div className="mt-8">
				<InviteForm busy={busy} snapshot={snapshot} submit={submit} />
			</div>

			{activeInvitations.length > 0 && (
				<section className="mt-8">
					<div className="flex items-center gap-3">
						<MailPlus aria-hidden="true" className="h-5 w-5 text-slate-600" />
						<h2 className="text-xl font-semibold text-slate-950">
							Pending invitations
						</h2>
					</div>
					<div className="mt-4 grid gap-3 md:grid-cols-2">
						{activeInvitations.map((invitation) => (
							<InvitationCard
								busy={busy}
								invitation={invitation}
								key={invitation.invitationId}
								submit={submit}
							/>
						))}
					</div>
				</section>
			)}

			<section className="mt-8">
				<div className="flex items-center gap-3">
					<UsersRound aria-hidden="true" className="h-5 w-5 text-slate-600" />
					<h2 className="text-xl font-semibold text-slate-950">
						Household members
					</h2>
				</div>
				<div className="mt-4 space-y-3">
					{snapshot.members
						.filter((member) => member.lifecycle !== "PENDING")
						.map((member) => (
							<MemberEditor
								busy={busy}
								key={member.memberId + ":" + member.membershipRevision}
								member={member}
								rooms={snapshot.sharedRooms}
								submit={submit}
							/>
						))}
				</div>
			</section>
		</Shell>
	);
}

export function HouseholdMembersPage() {
	const queryClient = useQueryClient();
	const bootstrap = useQuery({
		queryKey: ["micasa", "bootstrap", "household-settings"],
		queryFn: loadMiCasaBootstrap,
		retry: false,
	});
	const householdId =
		bootstrap.data?.state === "READY"
			? bootstrap.data.activeHousehold.id
			: null;
	const members = useQuery({
		queryKey: ["micasa", "household-members", householdId],
		queryFn: () => loadHouseholdMembers(householdId as string),
		enabled: householdId !== null,
		retry: false,
	});
	const [success, setSuccess] = useState<string | null>(null);
	const mutation = useMutation({
		mutationFn: (command: MemberCommand) => {
			if (!members.data) throw new Error("Household Settings are unavailable.");
			return mutateHouseholdMembers(members.data, command);
		},
		onMutate: () => setSuccess(null),
		onSuccess: (result) => {
			queryClient.setQueryData(
				["micasa", "household-members", result.readback.householdId],
				result.readback,
			);
			setSuccess("Personal-Agent verified the Household Settings change.");
		},
	});

	if (bootstrap.isPending) return <Loading />;
	if (bootstrap.isError) {
		return (
			<Unavailable
				message="Personal-Agent did not return a current household session."
				retry={() => void bootstrap.refetch()}
			/>
		);
	}
	if (bootstrap.data.state === "UNAUTHENTICATED") {
		window.location.assign(bootstrap.data.signInPath);
		return <Loading />;
	}
	if (bootstrap.data.state === "ONBOARDING_REQUIRED") {
		window.location.assign(bootstrap.data.onboardingPath);
		return <Loading />;
	}
	if (members.isPending) return <Loading />;
	if (members.isError || !members.data) {
		return (
			<Unavailable
				message="Only a current Head of Household can open this page."
				retry={() => void members.refetch()}
			/>
		);
	}

	return (
		<HouseholdMembersContent
			busy={mutation.isPending}
			error={mutation.isError ? mutation.error.message : null}
			snapshot={members.data}
			submit={(command) => mutation.mutate(command)}
			success={success}
		/>
	);
}

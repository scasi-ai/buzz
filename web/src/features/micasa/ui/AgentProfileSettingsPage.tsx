import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowLeft,
	Bot,
	CheckCircle2,
	House,
	LoaderCircle,
	LockKeyhole,
	RefreshCw,
	ShieldCheck,
	UserRound,
} from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import {
	type AgentProfileDraft,
	type AgentProfileScope,
	type AgentProfileSettingsSnapshot,
	loadAgentProfileSettings,
	saveAgentProfileSettings,
} from "@/features/micasa/agent-profile-settings";
import { loadMiCasaBootstrap } from "@/features/micasa/api";
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
			<div className="mx-auto max-w-4xl">
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
				<p className="mt-3 text-sm text-slate-600">Loading agent profile&</p>
			</div>
		</Shell>
	);
}
function Unavailable({
	retry,
	scope,
}: {
	retry: () => void;
	scope: AgentProfileScope;
}) {
	return (
		<Shell>
			<div className="rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
				<ShieldCheck
					aria-hidden="true"
					className="mx-auto h-10 w-10 text-slate-700"
				/>
				<h1 className="mt-5 text-2xl font-semibold text-slate-950">
					Agent profile is unavailable
				</h1>
				<p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">
					{scope === "HOUSEHOLD"
						? "Only the current Head of Household can edit the Household Agent."
						: "Personal-Agent did not verify this as your own Personal Agent."}{" "}
					No profile change was assumed.
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

function AgentProfileForm({
	snapshot,
	busy,
	error,
	success,
	save,
}: {
	snapshot: AgentProfileSettingsSnapshot;
	busy: boolean;
	error: string | null;
	success: string | null;
	save: (draft: AgentProfileDraft) => void;
}) {
	const [displayName, setDisplayName] = useState("");
	const [aliases, setAliases] = useState("");
	const [avatarArtifactId, setAvatarArtifactId] = useState("");
	const [avatarAltText, setAvatarAltText] = useState("");
	const [publicBio, setPublicBio] = useState("");
	useEffect(() => {
		setDisplayName(snapshot.profile.displayName);
		setAliases(snapshot.profile.aliases.join(", "));
		setAvatarArtifactId(snapshot.profile.avatarArtifactId);
		setAvatarAltText(snapshot.profile.avatarAltText);
		setPublicBio(snapshot.profile.publicBio);
	}, [snapshot]);

	const household = snapshot.scope === "HOUSEHOLD";
	const Icon = household ? Bot : UserRound;
	const aliasValues = aliases
		.split(",")
		.map((alias) => alias.trim())
		.filter(Boolean);
	return (
		<Shell>
			<a
				className="inline-flex items-center text-sm font-medium text-slate-600 hover:text-slate-950"
				href={
					household
						? "/settings/household/members?household=" +
							encodeURIComponent(snapshot.householdId)
						: "/"
				}
			>
				<ArrowLeft aria-hidden="true" className="mr-2 h-4 w-4" />
				{household ? "Household Settings" : "Back to MiCasa"}
			</a>

			<div className="mt-4 flex flex-wrap items-end justify-between gap-4">
				<div>
					<p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
						{household ? "Household Settings" : "User Settings"}
					</p>
					<h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
						{household ? "Household Agent profile" : "My Agent profile"}
					</h1>
					<p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
						Change how this agent is presented without replacing who it is.
					</p>
				</div>
				<span className="inline-flex items-center rounded-full bg-slate-950 px-3 py-1.5 text-xs font-medium text-white">
					<LockKeyhole aria-hidden="true" className="mr-2 h-3.5 w-3.5" />
					{household ? "Head of Household only" : "Private to you"}
				</span>
			</div>

			<div className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm leading-6 text-indigo-900">
				<strong>Identity stays intact:</strong> renaming or changing an avatar
				preserves this agent&apos;s identity, signed history, conversations,
				stores, memory, rooms, connected apps, and permissions. Presentation
				changes cannot widen capabilities or edit character instructions.
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

			<section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
				<div className="flex items-center gap-3">
					<span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
						<Icon aria-hidden="true" className="h-6 w-6" />
					</span>
					<div>
						<h2 className="text-xl font-semibold text-slate-950">
							Presentation
						</h2>
						<p className="mt-1 text-xs text-slate-500">
							Stable agent ID · {snapshot.profile.agentInstanceId}
						</p>
					</div>
				</div>

				<div className="mt-6 grid gap-4 sm:grid-cols-2">
					<label className="text-sm font-medium text-slate-700">
						Agent name
						<input
							className="mt-2 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-600"
							maxLength={80}
							onChange={(event: ChangeEvent<HTMLInputElement>) =>
								setDisplayName(event.target.value)
							}
							value={displayName}
						/>
					</label>
					<label className="text-sm font-medium text-slate-700">
						Aliases
						<input
							className="mt-2 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-600"
							maxLength={320}
							onChange={(event: ChangeEvent<HTMLInputElement>) =>
								setAliases(event.target.value)
							}
							placeholder="Comma-separated"
							value={aliases}
						/>
					</label>
				</div>

				<fieldset className="mt-6">
					<legend className="text-sm font-medium text-slate-700">Avatar</legend>
					<p className="mt-1 text-xs leading-5 text-slate-500">
						Choose from uploaded or generated avatars already approved by
						Personal-Agent.
					</p>
					<div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
						{snapshot.availableAvatars.map((avatar) => {
							const selected = avatar.artifactId === avatarArtifactId;
							return (
								<button
									aria-pressed={selected}
									className={
										selected
											? "rounded-2xl border-2 border-slate-950 p-3 text-left"
											: "rounded-2xl border border-slate-200 p-3 text-left hover:border-slate-400"
									}
									key={avatar.artifactId}
									onClick={() => {
										setAvatarArtifactId(avatar.artifactId);
										setAvatarAltText(avatar.altText);
									}}
									type="button"
								>
									<img
										alt={avatar.altText}
										className="aspect-square w-full rounded-xl bg-slate-100 object-cover"
										src={avatar.contentPath}
									/>
									<span className="mt-2 block text-sm font-medium text-slate-800">
										{avatar.source === "UPLOADED" ? "Uploaded" : "Generated"}
									</span>
								</button>
							);
						})}
					</div>
				</fieldset>

				<label className="mt-6 block text-sm font-medium text-slate-700">
					Avatar description
					<input
						className="mt-2 h-10 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-slate-600"
						maxLength={200}
						onChange={(event: ChangeEvent<HTMLInputElement>) =>
							setAvatarAltText(event.target.value)
						}
						value={avatarAltText}
					/>
				</label>
				<label className="mt-4 block text-sm font-medium text-slate-700">
					Public bio
					<textarea
						className="mt-2 min-h-28 w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-slate-600"
						maxLength={500}
						onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
							setPublicBio(event.target.value)
						}
						value={publicBio}
					/>
				</label>

				<div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-5">
					<p className="text-xs text-slate-500">
						Character policy revision {snapshot.profile.characterRevision} is
						governed separately and is not editable here.
					</p>
					<Button
						className="bg-slate-950 text-white hover:bg-slate-800"
						disabled={
							busy ||
							displayName.trim().length === 0 ||
							avatarArtifactId.length === 0 ||
							avatarAltText.trim().length === 0
						}
						onClick={() =>
							save({
								displayName: displayName.trim(),
								aliases: aliasValues,
								avatarArtifactId,
								avatarAltText: avatarAltText.trim(),
								publicBio: publicBio.trim(),
							})
						}
						type="button"
					>
						{busy && (
							<LoaderCircle
								aria-hidden="true"
								className="mr-2 h-4 w-4 animate-spin"
							/>
						)}
						Save agent profile
					</Button>
				</div>
			</section>
		</Shell>
	);
}

export function AgentProfileSettingsPage({
	scope,
}: {
	scope: AgentProfileScope;
}) {
	const queryClient = useQueryClient();
	const bootstrap = useQuery({
		queryKey: ["micasa", "bootstrap", "agent-profile-settings", scope],
		queryFn: loadMiCasaBootstrap,
		retry: false,
	});
	const householdId =
		bootstrap.data?.state === "READY"
			? bootstrap.data.activeHousehold.id
			: null;
	const profile = useQuery({
		queryKey: ["micasa", "agent-profile-settings", scope, householdId],
		queryFn: () => loadAgentProfileSettings(scope, householdId as string),
		enabled: householdId !== null,
		retry: false,
	});
	const [success, setSuccess] = useState<string | null>(null);
	const mutation = useMutation({
		mutationFn: (draft: AgentProfileDraft) => {
			if (!profile.data) throw new Error("Agent profile is unavailable.");
			return saveAgentProfileSettings(profile.data, draft);
		},
		onMutate: () => setSuccess(null),
		onSuccess: (result) => {
			queryClient.setQueryData(
				[
					"micasa",
					"agent-profile-settings",
					result.readback.scope,
					result.readback.householdId,
				],
				result.readback,
			);
			setSuccess(
				"Personal-Agent verified the profile and preserved this agent's identity.",
			);
		},
	});

	if (bootstrap.isPending) return <Loading />;
	if (bootstrap.isError) {
		return <Unavailable retry={() => void bootstrap.refetch()} scope={scope} />;
	}
	if (bootstrap.data.state === "UNAUTHENTICATED") {
		window.location.assign(bootstrap.data.signInPath);
		return <Loading />;
	}
	if (bootstrap.data.state === "ONBOARDING_REQUIRED") {
		window.location.assign(bootstrap.data.onboardingPath);
		return <Loading />;
	}
	if (profile.isPending) return <Loading />;
	if (profile.isError || !profile.data) {
		return <Unavailable retry={() => void profile.refetch()} scope={scope} />;
	}
	return (
		<AgentProfileForm
			busy={mutation.isPending}
			error={mutation.isError ? mutation.error.message : null}
			save={(draft) => mutation.mutate(draft)}
			snapshot={profile.data}
			success={success}
		/>
	);
}

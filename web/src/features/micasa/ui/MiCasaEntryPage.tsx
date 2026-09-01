import { useQuery } from "@tanstack/react-query";
import {
	Bot,
	ChevronRight,
	House,
	LoaderCircle,
	LogIn,
	MessageCircle,
	RefreshCw,
	UserRound,
	Users,
} from "lucide-react";
import { loadMiCasaBootstrap } from "@/features/micasa/api";
import type {
	AgentReadiness,
	AgentSummary,
	MiCasaBootstrap,
} from "@/features/micasa/contracts";
import { MiCasaRoomTimeline } from "@/features/micasa/ui/MiCasaRoomTimeline";
import { MiCasaSignerBoundary } from "@/features/micasa/ui/MiCasaSignerBoundary";
import { Button } from "@/shared/ui/button";

const readinessLabels: Record<AgentReadiness, string> = {
	PROVISIONING: "Provisioning",
	READY: "Ready",
	UNAVAILABLE: "Unavailable",
	ERROR: "Needs attention",
};

function Brand() {
	return (
		<div className="flex items-center gap-3" aria-label="MiCasa">
			<span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
				<House aria-hidden="true" className="h-5 w-5" />
			</span>
			<div>
				<p className="text-lg font-semibold tracking-tight text-slate-950">
					MiCasa
				</p>
				<p className="text-xs text-slate-500">Personal-Agent for households</p>
			</div>
		</div>
	);
}

function AgentCard({
	agent,
	household,
}: {
	agent: AgentSummary;
	household: boolean;
}) {
	const Icon = household ? Bot : UserRound;
	return (
		<div className="rounded-2xl border border-slate-200 bg-white p-4">
			<div className="flex items-center gap-3">
				<span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
					<Icon aria-hidden="true" className="h-5 w-5" />
				</span>
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-slate-950">
						{agent.displayName}
					</p>
					<p className="text-sm text-slate-500">
						{household ? "Household Agent" : "My Agent"}
					</p>
				</div>
				<span
					className={
						agent.readiness === "READY"
							? "rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
							: "rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700"
					}
				>
					{readinessLabels[agent.readiness]}
				</span>
			</div>
		</div>
	);
}

function ReadyHousehold({
	bootstrap,
}: {
	bootstrap: Extract<MiCasaBootstrap, { state: "READY" }>;
}) {
	const { activeHousehold } = bootstrap;
	const activeRoom = activeHousehold.rooms.find(
		(room) => room.id === activeHousehold.activeRoomId,
	);

	return (
		<div className="min-h-dvh bg-slate-50 text-slate-900">
			<header className="border-b border-slate-200 bg-white px-5 py-4">
				<div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
					<Brand />
					<div className="flex items-center gap-4">
						{activeHousehold.role === "HEAD" && (
							<a
								className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
								href={
									"/settings/household/members?household=" +
									encodeURIComponent(activeHousehold.id)
								}
							>
								Household Settings
							</a>
						)}
						<a
							className="text-right"
							href={
								"/settings/user/agent?household=" +
								encodeURIComponent(activeHousehold.id)
							}
						>
							<p className="text-sm font-medium text-slate-900">
								{bootstrap.viewer.displayName}
							</p>
							<p className="text-xs text-slate-500 underline underline-offset-2">
								User Settings
							</p>
						</a>
					</div>
				</div>
			</header>

			<div className="mx-auto grid max-w-7xl gap-0 lg:grid-cols-[18rem_1fr]">
				<aside className="border-b border-slate-200 bg-white p-5 lg:min-h-[calc(100dvh-73px)] lg:border-b-0 lg:border-r">
					<p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
						Households
					</p>
					<nav aria-label="Households" className="space-y-1">
						{bootstrap.households.map((household) => (
							<a
								className={
									household.id === activeHousehold.id
										? "flex items-center justify-between rounded-xl bg-slate-950 px-3 py-2.5 text-sm font-medium text-white"
										: "flex items-center justify-between rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
								}
								href={"/?household=" + encodeURIComponent(household.id)}
								key={household.id}
							>
								<span className="truncate">{household.name}</span>
								<ChevronRight aria-hidden="true" className="h-4 w-4" />
							</a>
						))}
					</nav>

					<div className="my-5 border-t border-slate-200" />

					<p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
						Rooms
					</p>
					<nav aria-label="Rooms" className="space-y-1">
						{activeHousehold.rooms.map((room) => (
							<a
								className={
									room.id === activeHousehold.activeRoomId
										? "flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-medium text-slate-950"
										: "flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-100"
								}
								href={
									"/?household=" +
									encodeURIComponent(activeHousehold.id) +
									"&room=" +
									encodeURIComponent(room.id)
								}
								key={room.id}
							>
								{room.kind === "HOUSEHOLD" ? (
									<Users aria-hidden="true" className="h-4 w-4" />
								) : (
									<MessageCircle aria-hidden="true" className="h-4 w-4" />
								)}
								<span className="truncate">{room.name}</span>
							</a>
						))}
					</nav>
				</aside>

				<main className="p-5 sm:p-8">
					<div className="mx-auto max-w-4xl">
						<div className="mb-6">
							<p className="text-sm font-medium text-slate-500">
								{activeHousehold.name}
							</p>
							<h1 className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
								{activeRoom?.name ?? "Household"}
							</h1>
						</div>

						<div className="grid gap-4 sm:grid-cols-2">
							<AgentCard agent={activeHousehold.householdAgent} household />
							<AgentCard
								agent={activeHousehold.personalAgent}
								household={false}
							/>
						</div>

						<div className="mt-6">
							{activeRoom ? (
								<MiCasaSignerBoundary>
									{(signer) => (
										<MiCasaRoomTimeline
											participants={activeRoom.participants}
											roomId={activeRoom.id}
											roomName={activeRoom.name}
											signer={signer}
											viewerMemberId={bootstrap.viewer.id}
										/>
									)}
								</MiCasaSignerBoundary>
							) : (
								<section className="rounded-3xl border border-slate-200 bg-white p-6 text-sm leading-6 text-slate-600">
									Personal-Agent did not authorize an active room. No timeline
									or composer was opened.
								</section>
							)}
						</div>
					</div>
				</main>
			</div>
		</div>
	);
}

export function MiCasaEntryPage() {
	const bootstrap = useQuery({
		queryKey: ["micasa", "bootstrap", window.location.search],
		queryFn: loadMiCasaBootstrap,
		retry: false,
	});

	if (bootstrap.isPending) {
		return (
			<main className="flex min-h-dvh items-center justify-center bg-slate-50">
				<div className="text-center">
					<LoaderCircle
						aria-hidden="true"
						className="mx-auto h-7 w-7 animate-spin text-slate-600"
					/>
					<p className="mt-3 text-sm text-slate-600">Opening your Household&</p>
				</div>
			</main>
		);
	}

	if (bootstrap.isError) {
		return (
			<main className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
				<div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
					<Brand />
					<h1 className="mt-8 text-2xl font-semibold text-slate-950">
						MiCasa is temporarily unavailable
					</h1>
					<p className="mt-3 text-sm leading-6 text-slate-600">
						Personal-Agent did not pass its readiness check. No substitute
						workspace or demo data has been loaded.
					</p>
					<Button
						className="mt-6 gap-2 bg-slate-950 text-white hover:bg-slate-800"
						disabled={bootstrap.isFetching}
						onClick={() => void bootstrap.refetch()}
					>
						<RefreshCw aria-hidden="true" className="h-4 w-4" />
						Try again
					</Button>
				</div>
			</main>
		);
	}

	if (bootstrap.data.state === "UNAUTHENTICATED") {
		return (
			<main className="min-h-dvh bg-slate-50 p-6">
				<div className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-6xl flex-col">
					<Brand />
					<div className="my-auto max-w-3xl py-16">
						<p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
							Your household, together
						</p>
						<h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-6xl">
							Bring your Household and its agents into one private workspace.
						</h1>
						<p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
							Sign in to create or return to a Household, talk with Personal
							Agents, and manage the people, rooms, apps, and privacy that
							belong to your home.
						</p>
						<Button
							asChild
							className="mt-8 h-12 gap-2 rounded-xl bg-slate-950 px-6 text-white hover:bg-slate-800"
						>
							<a href={bootstrap.data.signInPath}>
								<LogIn aria-hidden="true" className="h-5 w-5" />
								Sign in to MiCasa
							</a>
						</Button>
					</div>
				</div>
			</main>
		);
	}

	if (bootstrap.data.state === "ONBOARDING_REQUIRED") {
		return (
			<main className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
				<div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
					<Brand />
					<p className="mt-8 text-sm font-medium text-slate-500">
						Welcome, {bootstrap.data.viewer.displayName}
					</p>
					<h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
						Finish setting up your Household
					</h1>
					<p className="mt-4 text-sm leading-6 text-slate-600">
						Continue the Personal-Agent onboarding flow to create or recover
						your Household, name its Household Agent, name My Agent, and review
						Apps &amp; Services.
					</p>
					<Button
						asChild
						className="mt-7 h-11 rounded-xl bg-slate-950 px-5 text-white hover:bg-slate-800"
					>
						<a href={bootstrap.data.onboardingPath}>Continue setup</a>
					</Button>
				</div>
			</main>
		);
	}

	return <ReadyHousehold bootstrap={bootstrap.data} />;
}

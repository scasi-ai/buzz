import { useMutation, useQuery } from "@tanstack/react-query";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import {
  Bot,
  CheckCircle2,
  House,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import {
  acknowledgeMemberHouseholdApps,
  loadMemberOnboarding,
  type MemberOnboardingSnapshot,
  saveMemberProfiles,
} from "@/features/micasa/member-onboarding";
import { AppsReviewStage } from "@/features/micasa/ui/AppsReviewStage";
import { MiCasaSignerBoundary } from "@/features/micasa/ui/MiCasaSignerBoundary";
import { Button } from "@/shared/ui/button";

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-slate-50 p-5 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-white">
            <House aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <p className="text-lg font-semibold tracking-tight text-slate-950">
              MiCasa
            </p>
            <p className="text-xs text-slate-500">
              Personal-Agent for households
            </p>
          </div>
        </div>
        <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
          {children}
        </div>
      </div>
    </main>
  );
}

function Loading() {
  return (
    <Frame>
      <div className="py-16 text-center">
        <LoaderCircle
          aria-hidden="true"
          className="mx-auto h-8 w-8 animate-spin text-slate-600"
        />
        <p className="mt-3 text-sm text-slate-600">
          Verifying your invitation setup…
        </p>
      </div>
    </Frame>
  );
}

function Failure({ retry, pending }: { retry: () => void; pending: boolean }) {
  return (
    <Frame>
      <div className="mx-auto max-w-xl py-10 text-center">
        <ShieldCheck
          aria-hidden="true"
          className="mx-auto h-9 w-9 text-amber-700"
        />
        <h1 className="mt-5 text-2xl font-semibold text-slate-950">
          Member setup is temporarily unavailable
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Personal-Agent could not verify this invitation claim. MiCasa has not
          assumed that your profile, agent, app choices, or Buzz access are
          active.
        </p>
        <Button
          className="mt-6 gap-2 bg-slate-950 text-white hover:bg-slate-800"
          disabled={pending}
          onClick={retry}
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Recheck setup
        </Button>
      </div>
    </Frame>
  );
}

function IdentityRequired({
  snapshot,
  refresh,
  pending,
}: {
  snapshot: MemberOnboardingSnapshot;
  refresh: () => void;
  pending: boolean;
}) {
  return (
    <Frame>
      <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
        Join {snapshot.householdName} · Secure identity
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
        Set up your private messaging identity
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
        {snapshot.inviterName} invited you as a {snapshot.role.toLowerCase()}.
        Your persistent Nostr signer must be bound before you name your profile
        or Personal Agent. Private key material stays encrypted in this browser.
      </p>
      <div className="mt-7">
        <MiCasaSignerBoundary>
          {() => (
            <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6">
              <div className="flex items-start gap-4">
                <KeyRound
                  aria-hidden="true"
                  className="mt-0.5 h-6 w-6 text-emerald-700"
                />
                <div>
                  <h2 className="font-semibold text-emerald-950">
                    This device has a verified signer
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-emerald-900">
                    Ask Personal-Agent to reconcile that identity with this
                    invitation claim. This does not activate Buzz early.
                  </p>
                  <Button
                    className="mt-4 bg-slate-950 text-white hover:bg-slate-800"
                    disabled={pending}
                    onClick={refresh}
                  >
                    Continue with this identity
                  </Button>
                </div>
              </div>
            </section>
          )}
        </MiCasaSignerBoundary>
      </div>
    </Frame>
  );
}

function Provisioning({
  householdName,
  finalizing = false,
}: {
  householdName: string;
  finalizing?: boolean;
}) {
  return (
    <Frame>
      <div className="mx-auto max-w-2xl py-10 text-center">
        <LoaderCircle
          aria-hidden="true"
          className="mx-auto h-8 w-8 animate-spin text-slate-700"
        />
        <h1 className="mt-5 text-3xl font-semibold text-slate-950">
          {finalizing ? "Verifying Household access" : "Creating My Agent"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Personal-Agent is{" "}
          {finalizing ? "checking the final" : "provisioning your"} membership,
          Personal Agent, rooms, Nostr authorization, relay access, connectors,
          and ACP workload for {householdName}. Buzz remains locked until every
          required effect is verified.
        </p>
        <Button
          className="mt-6 gap-2 bg-slate-950 text-white hover:bg-slate-800"
          onClick={() => window.location.reload()}
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Check progress
        </Button>
      </div>
    </Frame>
  );
}

function MemberProfiles({ snapshot }: { snapshot: MemberOnboardingSnapshot }) {
  const avatar = snapshot.generatedPersonalAgentAvatar;
  const [humanName, setHumanName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [avatarAccepted, setAvatarAccepted] = useState(false);
  const mutation = useMutation({
    mutationFn: () =>
      saveMemberProfiles(snapshot, {
        humanDisplayName: humanName,
        personalAgentDisplayName: agentName,
        avatarAccepted,
      }),
  });
  if (mutation.data)
    return <Provisioning householdName={snapshot.householdName} />;
  if (!avatar) {
    return <Failure pending={false} retry={() => window.location.reload()} />;
  }
  const complete =
    humanName.trim().length > 0 &&
    agentName.trim().length > 0 &&
    humanName.trim().toLocaleLowerCase() !==
      agentName.trim().toLocaleLowerCase() &&
    avatarAccepted;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (complete) mutation.mutate();
  }
  return (
    <Frame>
      <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
        Join {snapshot.householdName} · Your profile
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
        Name yourself and your Personal Agent
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
        These are your choices—not the Head of Household&apos;s. Your Personal
        Agent will join your personal room and rooms that include you only after
        Personal-Agent verifies every membership.
      </p>
      <form className="mt-8" onSubmit={submit}>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-800">
            Your display name
            <input
              autoComplete="name"
              className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:border-slate-600"
              maxLength={80}
              onChange={(event) => setHumanName(event.target.value)}
              placeholder="How household members know you"
              required
              value={humanName}
            />
          </label>
          <label className="text-sm font-medium text-slate-800">
            My Agent name
            <input
              autoComplete="off"
              className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:border-slate-600"
              maxLength={80}
              onChange={(event) => setAgentName(event.target.value)}
              placeholder="Choose your personal agent name"
              required
              value={agentName}
            />
          </label>
        </div>
        <section className="mt-6 rounded-2xl border border-slate-200 p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-sky-100 text-slate-700">
              <Bot aria-hidden="true" className="h-6 w-6" />
            </span>
            <div>
              <h2 className="font-semibold text-slate-950">
                Generated My Agent avatar
              </h2>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                Its content digest is verified when your profile is saved.
              </p>
              <p className="mt-2 text-xs text-slate-500">{avatar.altText}</p>
            </div>
          </div>
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            <input
              checked={avatarAccepted}
              className="mt-0.5 h-4 w-4"
              onChange={(event) => setAvatarAccepted(event.target.checked)}
              type="checkbox"
            />
            <span>Use this generated avatar for My Agent</span>
          </label>
        </section>
        <section className="mt-6 rounded-2xl bg-slate-50 p-5">
          <h2 className="font-semibold text-slate-950">What will be created</h2>
          <ul className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
            {snapshot.roomScope.map((room) => (
              <li className="flex items-center gap-2" key={room.roomId}>
                <UserRound aria-hidden="true" className="h-4 w-4" />
                {room.displayName}
              </li>
            ))}
          </ul>
          <ul className="mt-4 space-y-2 text-xs leading-5 text-slate-500">
            {snapshot.consentNotices.map((notice) => (
              <li key={notice}>• {notice}</li>
            ))}
          </ul>
        </section>
        {mutation.isError && (
          <p
            className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"
            role="alert"
          >
            {mutation.error.message}
          </p>
        )}
        <div className="mt-7 flex items-center justify-between gap-4 border-t border-slate-200 pt-6">
          <p className="max-w-xl text-xs leading-5 text-slate-500">
            Buzz access remains off until Personal-Agent verifies your member,
            agent, rooms, Nostr identity, relay authorization, and ACP workload.
          </p>
          <Button
            className="h-11 shrink-0 gap-2 rounded-xl bg-slate-950 px-5 text-white hover:bg-slate-800"
            disabled={!complete || mutation.isPending}
            type="submit"
          >
            {mutation.isPending ? (
              <LoaderCircle
                aria-hidden="true"
                className="h-4 w-4 animate-spin"
              />
            ) : (
              <Sparkles aria-hidden="true" className="h-4 w-4" />
            )}
            Save profile and create My Agent
          </Button>
        </div>
      </form>
    </Frame>
  );
}

function HouseholdAppsDisclosure({
  snapshot,
}: {
  snapshot: MemberOnboardingSnapshot;
}) {
  const mutation = useMutation({
    mutationFn: () => acknowledgeMemberHouseholdApps(snapshot),
  });
  if (mutation.data) return <AppsReviewStage tier="PRIVATE" />;
  return (
    <Frame>
      <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
        Join {snapshot.householdName} · Household Apps
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
        See what the Household shares
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
        These resource scopes were configured by the Head of Household. This
        step is read-only: you cannot connect, disconnect, or broaden a
        Household grant here.
      </p>
      <div className="mt-7 grid gap-4 md:grid-cols-2">
        {snapshot.householdApps.map((app) => (
          <article
            className="rounded-2xl border border-slate-200 p-5"
            key={app.serviceId}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-semibold text-slate-950">
                {app.displayName}
              </h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                {app.catalogStatus.replaceAll("_", " ").toLocaleLowerCase()}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              {app.dataSummary}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {app.actionSummary}
            </p>
            <p className="mt-3 text-xs text-slate-500">
              Shared with: {app.audience.join(", ")}
            </p>
          </article>
        ))}
      </div>
      {mutation.isError && (
        <p
          className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"
          role="alert"
        >
          {mutation.error.message}
        </p>
      )}
      <div className="mt-7 flex items-center justify-between gap-4 border-t border-slate-200 pt-6">
        <p className="max-w-2xl text-xs leading-5 text-slate-500">
          Continuing acknowledges this exact disclosure revision and digest.
          Your private app review comes next and remains under your authority.
        </p>
        <Button
          className="shrink-0 bg-slate-950 text-white hover:bg-slate-800"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending && (
            <LoaderCircle
              aria-hidden="true"
              className="mr-2 h-4 w-4 animate-spin"
            />
          )}
          Continue to My Apps
        </Button>
      </div>
    </Frame>
  );
}

function Ready({ snapshot }: { snapshot: MemberOnboardingSnapshot }) {
  return (
    <Frame>
      <div className="mx-auto max-w-xl py-10 text-center">
        <CheckCircle2
          aria-hidden="true"
          className="mx-auto h-10 w-10 text-emerald-600"
        />
        <h1 className="mt-5 text-3xl font-semibold text-slate-950">
          You&apos;re ready to join {snapshot.householdName}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Personal-Agent verified your identity, profile, Personal Agent, rooms,
          app reviews, realtime authorization, and ACP workload.
        </p>
        <Button
          asChild
          className="mt-6 bg-slate-950 text-white hover:bg-slate-800"
        >
          <a href={snapshot.destinationPath}>Enter Household</a>
        </Button>
      </div>
    </Frame>
  );
}

export function MemberOnboardingPage({ claimId }: { claimId: string }) {
  const onboarding = useQuery({
    queryKey: ["micasa", "member-onboarding", claimId],
    queryFn: () => loadMemberOnboarding(claimId),
    retry: false,
  });
  if (onboarding.isPending) return <Loading />;
  if (onboarding.isError) {
    return (
      <Failure
        pending={onboarding.isFetching}
        retry={() => void onboarding.refetch()}
      />
    );
  }
  const snapshot = onboarding.data;
  if (snapshot.state === "IDENTITY_REQUIRED") {
    return (
      <IdentityRequired
        pending={onboarding.isFetching}
        refresh={() => void onboarding.refetch()}
        snapshot={snapshot}
      />
    );
  }
  if (snapshot.state === "PROFILE_REQUIRED")
    return <MemberProfiles snapshot={snapshot} />;
  if (snapshot.state === "PROVISIONING") {
    return <Provisioning householdName={snapshot.householdName} />;
  }
  if (snapshot.state === "HOUSEHOLD_APPS_DISCLOSURE_REQUIRED") {
    return <HouseholdAppsDisclosure snapshot={snapshot} />;
  }
  if (snapshot.state === "PRIVATE_APPS_REQUIRED")
    return <AppsReviewStage tier="PRIVATE" />;
  if (snapshot.state === "FINALIZING") {
    return <Provisioning finalizing householdName={snapshot.householdName} />;
  }
  if (snapshot.state === "READY") return <Ready snapshot={snapshot} />;
  return (
    <Frame>
      <div className="mx-auto max-w-xl py-10 text-center">
        <ShieldCheck
          aria-hidden="true"
          className="mx-auto h-9 w-9 text-amber-700"
        />
        <h1 className="mt-5 text-3xl font-semibold text-slate-950">
          Setup needs attention
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Personal-Agent paused setup without assuming that a partial operation
          failed. Household and Buzz access remain locked until reconciliation
          completes.
        </p>
        <Button
          className="mt-6 gap-2 bg-slate-950 text-white hover:bg-slate-800"
          onClick={() => void onboarding.refetch()}
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Recheck setup
        </Button>
      </div>
    </Frame>
  );
}

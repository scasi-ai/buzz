import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  House,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import {
  type FounderOnboardingSnapshot,
  advanceFounderProvisioning,
  loadFounderOnboarding,
  saveFounderProfiles,
} from "@/features/micasa/founder-onboarding";
import type { BrowserSignerHandle } from "@/features/micasa/browser-signer-vault";
import {
  authorizeFounderAgents,
  loadFounderAgentOwnerAuthorization,
} from "@/features/micasa/founder-agent-owner-authorization";
import { AppsReviewStage } from "@/features/micasa/ui/AppsReviewStage";
import { MiCasaSignerBoundary } from "@/features/micasa/ui/MiCasaSignerBoundary";
import { Button } from "@/shared/ui/button";

function Brand() {
  return (
    <div className="flex items-center gap-3">
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
function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-slate-50 p-5 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <Brand />
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
          className="mx-auto h-7 w-7 animate-spin text-slate-600"
        />
        <p className="mt-3 text-sm text-slate-600">
          Verifying your setup with Personal-Agent…
        </p>
      </div>
    </Frame>
  );
}
function Failure({ retry, pending }: { retry: () => void; pending: boolean }) {
  return (
    <Frame>
      <div className="mx-auto max-w-xl py-8 text-center">
        <ShieldCheck
          aria-hidden="true"
          className="mx-auto h-8 w-8 text-slate-700"
        />
        <h1 className="mt-5 text-2xl font-semibold text-slate-950">
          Household setup is temporarily unavailable
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Personal-Agent could not verify the current setup authority. No
          Household, agent, or avatar change has been assumed.
        </p>
        <Button
          className="mt-6 gap-2 bg-slate-950 text-white hover:bg-slate-800"
          disabled={pending}
          onClick={retry}
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Refresh setup
        </Button>
      </div>
    </Frame>
  );
}
function AvatarChoice({
  title,
  description,
  altText,
  accepted,
  onAccepted,
  household,
}: {
  title: string;
  description: string;
  altText: string;
  accepted: boolean;
  onAccepted: (accepted: boolean) => void;
  household: boolean;
}) {
  const Icon = household ? Bot : UserRound;
  return (
    <section className="rounded-2xl border border-slate-200 p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-100 to-sky-100 text-slate-700">
          <Icon aria-hidden="true" className="h-6 w-6" />
        </span>
        <div>
          <h2 className="font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm leading-5 text-slate-600">{description}</p>
          <p className="mt-2 text-xs text-slate-500">{altText}</p>
        </div>
      </div>
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
        <input
          checked={accepted}
          className="mt-0.5 h-4 w-4"
          onChange={(event) => onAccepted(event.target.checked)}
          type="checkbox"
        />
        <span>
          Use the generated {household ? "Household Agent" : "My Agent"} avatar
        </span>
      </label>
    </section>
  );
}
function Provisioning({
  step,
  error,
  retry,
  finalizing = false,
}: {
  step: FounderOnboardingSnapshot["provisioningStep"];
  error: boolean;
  retry: () => void;
  finalizing?: boolean;
}) {
  return (
    <Frame>
      <div className="mx-auto max-w-2xl py-8 text-center">
        <LoaderCircle
          aria-hidden="true"
          className="mx-auto h-8 w-8 animate-spin text-slate-700"
        />
        <h1 className="mt-5 text-3xl font-semibold text-slate-950">
          {finalizing ? "Verifying your Household" : "Creating your Household"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {finalizing ? (
            <>
              Your app reviews are saved. Personal-Agent is checking the final
              membership, room, connector, Nostr, relay, and agent-workload
              readbacks before opening the Household.
            </>
          ) : (
            <>
              Personal-Agent verified your profile choices. It is now creating
              the Household, agent identities, rooms, realtime authorization,
              and ACP workloads.
            </>
          )}{" "}
          Refreshing resumes this operation rather than starting it again.
        </p>
        {step && (
          <p className="mt-3 text-xs font-medium text-slate-500">
            Current verified step: {step.replaceAll("_", " ").toLowerCase()}
          </p>
        )}
        {error && (
          <p className="mt-4 text-sm text-amber-700" role="alert">
            Personal-Agent paused before retrying. Your verified progress is
            saved.
          </p>
        )}
        <Button
          className="mt-6 gap-2 bg-slate-950 text-white hover:bg-slate-800"
          onClick={retry}
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Check progress
        </Button>
      </div>
    </Frame>
  );
}
function FounderProfiles({
  snapshot,
  onSaved,
}: {
  snapshot: FounderOnboardingSnapshot;
  onSaved: () => void;
}) {
  const avatars = snapshot.generatedAvatars;
  const [householdName, setHouseholdName] = useState("");
  const [humanName, setHumanName] = useState("");
  const [householdAgentName, setHouseholdAgentName] = useState("");
  const [personalAgentName, setPersonalAgentName] = useState("");
  const [householdAvatarAccepted, setHouseholdAvatarAccepted] = useState(false);
  const [personalAvatarAccepted, setPersonalAvatarAccepted] = useState(false);
  const mutation = useMutation({
    mutationFn: () => {
      if (avatars === null) {
        throw new Error("Generated avatars are unavailable.");
      }
      return saveFounderProfiles(
        {
          expectedRevision: snapshot.profileRevision,
          householdName,
          humanDisplayName: humanName,
          householdAgent: {
            displayName: householdAgentName,
            avatarArtifactId: avatars.householdAgent.artifactId,
            avatarAltText: avatars.householdAgent.altText,
            avatarAccepted: true,
          },
          personalAgent: {
            displayName: personalAgentName,
            avatarArtifactId: avatars.personalAgent.artifactId,
            avatarAltText: avatars.personalAgent.altText,
            avatarAccepted: true,
          },
        },
        snapshot,
      );
    },
    onSuccess: onSaved,
  });
  if (avatars === null) {
    return <Failure pending={false} retry={() => window.location.reload()} />;
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      householdAvatarAccepted &&
      personalAvatarAccepted &&
      householdName.trim() &&
      humanName.trim() &&
      householdAgentName.trim() &&
      personalAgentName.trim()
    ) {
      mutation.mutate();
    }
  }
  const complete =
    householdAvatarAccepted &&
    personalAvatarAccepted &&
    householdName.trim().length > 0 &&
    humanName.trim().length > 0 &&
    householdAgentName.trim().length > 0 &&
    personalAgentName.trim().length > 0;
  return (
    <Frame>
      <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
        Household setup · Profiles
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
        Name your Household and its agents
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
        You are creating this Household as its Head. Your Household Agent is
        shared with every member. My Agent is private to you unless you
        deliberately share something.
      </p>
      <form className="mt-8" onSubmit={submit}>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="text-sm font-medium text-slate-800">
            Household name
            <input
              autoComplete="organization"
              className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:border-slate-600"
              maxLength={80}
              onChange={(event) => setHouseholdName(event.target.value)}
              placeholder="Choose a household name"
              required
              value={householdName}
            />
          </label>
          <label className="text-sm font-medium text-slate-800">
            Your display name
            <input
              autoComplete="name"
              className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:border-slate-600"
              maxLength={80}
              onChange={(event) => setHumanName(event.target.value)}
              placeholder="How members know you"
              required
              value={humanName}
            />
          </label>
          <label className="text-sm font-medium text-slate-800">
            Household Agent name
            <input
              autoComplete="off"
              className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:border-slate-600"
              maxLength={80}
              onChange={(event) => setHouseholdAgentName(event.target.value)}
              placeholder="Choose a shared agent name"
              required
              value={householdAgentName}
            />
          </label>
          <label className="text-sm font-medium text-slate-800">
            My Agent name
            <input
              autoComplete="off"
              className="mt-2 h-11 w-full rounded-xl border border-slate-300 px-3 font-normal outline-none focus:border-slate-600"
              maxLength={80}
              onChange={(event) => setPersonalAgentName(event.target.value)}
              placeholder="Choose your personal agent name"
              required
              value={personalAgentName}
            />
          </label>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <AvatarChoice
            accepted={householdAvatarAccepted}
            altText={avatars.householdAgent.altText}
            description="Every active Household member will meet this agent in the Household room."
            household
            onAccepted={setHouseholdAvatarAccepted}
            title="Household Agent avatar"
          />
          <AvatarChoice
            accepted={personalAvatarAccepted}
            altText={avatars.personalAgent.altText}
            description="This avatar belongs to your Personal Agent and remains bound to your identity."
            household={false}
            onAccepted={setPersonalAvatarAccepted}
            title="My Agent avatar"
          />
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
          <p className="max-w-xl text-xs leading-5 text-slate-500">
            Names and avatar acceptance are committed only after Personal-Agent
            returns an authoritative readback. Service identifiers are created
            automatically and kept out of the Household experience.
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
            Save profiles and start provisioning
          </Button>
        </div>
      </form>
    </Frame>
  );
}
function AgentOwnerAuthorizationStage({
  signer,
  onVerified,
  continuing,
}: {
  signer: BrowserSignerHandle;
  onVerified: () => void;
  continuing: boolean;
}) {
  const authorization = useQuery({
    queryKey: ["micasa", "founder-agent-owner-authorization"],
    queryFn: loadFounderAgentOwnerAuthorization,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: async () => {
      if (!authorization.data) {
        throw new Error("Agent ownership authorization is unavailable.");
      }
      return authorizeFounderAgents(authorization.data, signer);
    },
    onSuccess: onVerified,
  });
  const continued = useRef(false);
  useEffect(() => {
    if (authorization.data?.state !== "VERIFIED" || continued.current) return;
    continued.current = true;
    onVerified();
  }, [authorization.data, onVerified]);
  if (authorization.isPending) return <Loading />;
  if (authorization.isError || !authorization.data) {
    return (
      <Failure
        pending={authorization.isFetching}
        retry={() => void authorization.refetch()}
      />
    );
  }
  return (
    <Frame>
      <div className="mx-auto max-w-2xl py-6 text-center">
        <ShieldCheck
          aria-hidden="true"
          className="mx-auto h-9 w-9 text-slate-700"
        />
        <p className="mt-5 text-sm font-semibold uppercase tracking-wider text-slate-500">
          Final identity check
        </p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-950">
          Authorize your two agents
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          This device will sign two narrowly scoped ownership proofs: one for
          your Household Agent and one for My Agent. The proofs authorize only
          their public profiles. Your private signing key stays encrypted in
          this browser.
        </p>
        <div className="mt-6 grid gap-3 text-left sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 p-4">
            <p className="font-medium text-slate-900">Household Agent</p>
            <p className="mt-1 text-xs text-slate-500">
              Shared profile · kind=0 only
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 p-4">
            <p className="font-medium text-slate-900">My Agent</p>
            <p className="mt-1 text-xs text-slate-500">
              Personal profile · kind=0 only
            </p>
          </div>
        </div>
        {mutation.isError && (
          <p className="mt-4 text-sm text-amber-700" role="alert">
            {mutation.error.message} No broader signing permission was granted.
          </p>
        )}
        <Button
          className="mt-6 bg-slate-950 text-white hover:bg-slate-800"
          disabled={mutation.isPending || continuing}
          onClick={() => mutation.mutate()}
        >
          {(mutation.isPending || continuing) && (
            <LoaderCircle
              aria-hidden="true"
              className="mr-2 h-4 w-4 animate-spin"
            />
          )}
          Authorize profiles and continue
        </Button>
      </div>
    </Frame>
  );
}

function FounderOnboardingAuthority({
  signer,
}: {
  signer: BrowserSignerHandle;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["micasa", "founder-onboarding"] as const;
  const onboarding = useQuery({
    queryKey,
    queryFn: loadFounderOnboarding,
    retry: false,
  });
  const provision = useMutation({
    mutationFn: advanceFounderProvisioning,
    onSuccess: (snapshot) => queryClient.setQueryData(queryKey, snapshot),
  });
  const snapshot = onboarding.data;
  const autoAttempt = useRef<string | null>(null);
  useEffect(() => {
    if (
      !snapshot ||
      (snapshot.state !== "PROVISIONING" && snapshot.state !== "FINALIZING") ||
      snapshot.provisioningStep ===
        "VERIFY_AUTHORITATIVE_AND_PROJECTED_READBACKS"
    ) {
      return;
    }
    const key = `${snapshot.state}:${snapshot.provisioningStep}`;
    if (autoAttempt.current === key) return;
    autoAttempt.current = key;
    const timeout = window.setTimeout(() => provision.mutate(snapshot), 350);
    return () => window.clearTimeout(timeout);
  }, [snapshot, provision.mutate]);
  if (onboarding.isPending) return <Loading />;
  if (onboarding.isError) {
    return (
      <Failure
        pending={onboarding.isFetching}
        retry={() => void onboarding.refetch()}
      />
    );
  }
  if (!snapshot) return <Loading />;
  if (snapshot.state === "PROFILE_REQUIRED") {
    return (
      <FounderProfiles
        onSaved={() => void onboarding.refetch()}
        snapshot={snapshot}
      />
    );
  }
  if (snapshot.state === "PROVISIONING") {
    return (
      <Provisioning
        error={provision.isError}
        retry={() => provision.mutate(snapshot)}
        step={snapshot.provisioningStep}
      />
    );
  }
  if (snapshot.state === "HOUSEHOLD_APPS_REQUIRED") {
    return (
      <AppsReviewStage
        continuing={provision.isPending}
        onContinue={() => provision.mutate(snapshot)}
        tier="HOUSEHOLD"
      />
    );
  }
  if (snapshot.state === "PRIVATE_APPS_REQUIRED") {
    return (
      <AppsReviewStage
        continuing={provision.isPending}
        onContinue={() => provision.mutate(snapshot)}
        tier="PRIVATE"
      />
    );
  }
  if (snapshot.state === "FINALIZING") {
    if (
      snapshot.provisioningStep ===
      "VERIFY_AUTHORITATIVE_AND_PROJECTED_READBACKS"
    ) {
      return (
        <AgentOwnerAuthorizationStage
          continuing={provision.isPending}
          onVerified={() => provision.mutate(snapshot)}
          signer={signer}
        />
      );
    }
    return (
      <Provisioning
        error={provision.isError}
        finalizing
        retry={() => provision.mutate(snapshot)}
        step={snapshot.provisioningStep}
      />
    );
  }
  if (snapshot.state === "READY") {
    return (
      <Frame>
        <div className="mx-auto max-w-xl py-8 text-center">
          <CheckCircle2
            aria-hidden="true"
            className="mx-auto h-10 w-10 text-emerald-600"
          />
          <h1 className="mt-5 text-3xl font-semibold text-slate-950">
            Your Household is ready
          </h1>
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
  return (
    <Frame>
      <div className="mx-auto max-w-xl py-8 text-center">
        <ShieldCheck
          aria-hidden="true"
          className="mx-auto h-9 w-9 text-amber-700"
        />
        <h1 className="mt-5 text-3xl font-semibold text-slate-950">
          Setup needs attention
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Personal-Agent paused setup without assuming that an incomplete
          operation failed. Refresh after the underlying service recovers.
        </p>
        <Button
          className="mt-6 gap-2 bg-slate-950 text-white hover:bg-slate-800"
          onClick={() => provision.mutate(snapshot)}
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Recheck setup
        </Button>
      </div>
    </Frame>
  );
}

function FounderSignerShell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-slate-50 p-5 sm:p-8">
      <div className="mx-auto max-w-5xl">
        <Brand />
        <div className="mt-8">{children}</div>
      </div>
    </main>
  );
}

export function FounderOnboardingPage() {
  return (
    <MiCasaSignerBoundary
      renderUnavailable={(content) => (
        <FounderSignerShell>{content}</FounderSignerShell>
      )}
    >
      {(signer) => <FounderOnboardingAuthority signer={signer} />}
    </MiCasaSignerBoundary>
  );
}

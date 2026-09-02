import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  House,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { loadMiCasaBootstrap } from "@/features/micasa/api";
import {
  type AppsCategory,
  type AppsDecision,
  type AppsReviewCard,
  type AppsTier,
  defaultReviewDecision,
  isGoogleWorkspaceService,
  matchesAppsServiceSearch,
} from "@/features/micasa/apps-onboarding";
import {
  type AppsSettingsCard,
  type AppsSettingsSnapshot,
  loadAppsSettings,
  saveAppsSettings,
} from "@/features/micasa/apps-settings";
import type { MiCasaBootstrap } from "@/features/micasa/contracts";
import { GoogleCalendarOAuthPanel } from "@/features/micasa/ui/GoogleCalendarOAuthPanel";
import { GoogleWorkspacePlanner } from "@/features/micasa/ui/GoogleWorkspacePlanner";
import { Button } from "@/shared/ui/button";

type ReadyMiCasaBootstrap = Extract<MiCasaBootstrap, { state: "READY" }>;

function readyBootstrap(
  value: MiCasaBootstrap | undefined,
): ReadyMiCasaBootstrap | null {
  if (value?.state !== "READY") return null;
  return value as ReadyMiCasaBootstrap;
}

const categoryLabels: Record<AppsCategory, string> = {
  MAIL_CALENDAR_CONTACTS_TASKS: "Mail, calendars, contacts & tasks",
  FILES_DOCUMENTS_NOTES: "Files, documents & notes",
  PHOTOS_MEDIA: "Photos, video, music & media",
  HOME_DEVICES: "Home & devices",
  HEALTH_LOCATION_FAMILY_EDUCATION: "Health, location, family & education",
  MESSAGING_SOCIAL: "Messaging & social",
  LIFE_COMMERCE_FINANCE_GAMING_VEHICLES:
    "Life administration, finance, gaming & vehicles",
};
const statusLabels: Record<AppsReviewCard["catalogStatus"], string> = {
  AVAILABLE: "Available",
  PREVIEW: "Preview",
  DEVICE_REQUIRED: "Device required",
  PLAN_REQUIRED: "Plan required",
  ADMIN_REQUIRED: "Administrator required",
  PARTNER_REVIEW_REQUIRED: "Partner review required",
  COMING_LATER: "Coming later",
  REGION_UNAVAILABLE: "Unavailable in this region",
  POLICY_BLOCKED: "Blocked by policy",
  REFUSED: "Unavailable",
};
const placementLabels: Record<AppsReviewCard["placement"], string> = {
  HOUSEHOLD: "Household",
  DEDICATED_OR_SHARED: "Dedicated or shared account only",
  PRIVATE_SHARE_ONLY: "Connect privately, then share selected data",
  PRIVATE: "Private to you",
};
const routeLabels: Record<AppsSettingsCard["routeKinds"][number], string> = {
  HOSTED_MCP: "Hosted MCP",
  DIRECT_API: "Direct provider API",
  STANDARD_PROTOCOL: "Standard protocol",
  DEVICE_BRIDGE: "Device or edge bridge",
  IMPORT: "Import",
  PROVIDER_REVIEW: "Provider review",
};
const authorizationLabels: Record<
  AppsSettingsCard["authorizationStatus"],
  string
> = {
  NOT_CONNECTED: "Not connected",
  CONSENT_REQUIRED: "Consent required",
  AUTHORIZING: "Authorization in progress",
  CALLBACK_PENDING: "Provider callback pending",
  CONNECTED: "Connected",
  REAUTH_REQUIRED: "Reauthorization required",
  REVOKING: "Revoking",
  REVOKED: "Revoked",
  OUTCOME_UNKNOWN: "Provider outcome unknown",
};
const resourceLabels: Record<AppsSettingsCard["resourceStatus"], string> = {
  SELECTION_REQUIRED: "Selection required",
  SELECTED: "Resources selected",
  SCOPE_CHANGE_PENDING: "Scope change pending",
};
const syncLabels: Record<AppsSettingsCard["syncStatus"], string> = {
  NOT_STARTED: "Not started",
  SYNCING: "Syncing",
  READY: "Ready",
  DEGRADED: "Degraded",
  STALE: "Stale",
  FAILED: "Failed",
};
const operationLabels: Record<AppsSettingsCard["operationStatus"], string> = {
  ADMITTED: "Tools admitted",
  APPROVAL_REQUIRED: "Approval required",
  BLOCKED: "Tools blocked",
  UNSUPPORTED: "Unsupported",
};

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
          Loading Apps &amp; Data Settings…
        </p>
      </div>
    </Shell>
  );
}
function Unavailable({ retry, tier }: { retry: () => void; tier: AppsTier }) {
  return (
    <Shell>
      <div className="rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
        <ShieldCheck
          aria-hidden="true"
          className="mx-auto h-10 w-10 text-slate-700"
        />
        <h1 className="mt-5 text-2xl font-semibold text-slate-950">
          Apps &amp; Data Settings are unavailable
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">
          {tier === "HOUSEHOLD"
            ? "Only the current Head of Household can edit household app decisions."
            : "Personal-Agent did not verify a private settings scope for this user."}{" "}
          No app decision, provider grant, or credential change was assumed.
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

function DecisionCard({
  card,
  decision,
  setDecision,
  snapshot,
}: {
  card: AppsSettingsCard;
  decision: AppsDecision;
  setDecision: (decision: AppsDecision) => void;
  snapshot: AppsSettingsSnapshot;
}) {
  const primary = defaultReviewDecision(card);
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-950">{card.displayName}</h3>
          <p className="mt-1 text-xs text-slate-500">
            {placementLabels[card.placement]}
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
          {statusLabels[card.catalogStatus]}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-2.5">
          <p className="text-slate-500">Authorization</p>
          <p className="mt-1 font-medium text-slate-800">
            {authorizationLabels[card.authorizationStatus]}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2.5">
          <p className="text-slate-500">Resources</p>
          <p className="mt-1 font-medium text-slate-800">
            {resourceLabels[card.resourceStatus]}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2.5">
          <p className="text-slate-500">Sync</p>
          <p className="mt-1 font-medium text-slate-800">
            {syncLabels[card.syncStatus]}
          </p>
        </div>
        <div className="rounded-xl bg-slate-50 p-2.5">
          <p className="text-slate-500">Agent tools</p>
          <p className="mt-1 font-medium text-slate-800">
            {operationLabels[card.operationStatus]}
          </p>
        </div>
      </div>
      <details className="mt-3 text-sm text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">
          Data boundary and connection route
        </summary>
        <p className="mt-2 leading-6">{card.details}</p>
        <p className="mt-2 text-xs text-slate-500">
          {card.routeKinds.map((route) => routeLabels[route]).join(" · ")}
        </p>
        {card.selectedResourceIds.length > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            {card.selectedResourceIds.length} stable resource
            {card.selectedResourceIds.length === 1 ? "" : "s"} selected
          </p>
        )}
      </details>
      <div className="mt-4 flex flex-wrap gap-2">
        {card.connectEnabled && card.serviceId !== "google-calendar" && (
          <button
            aria-pressed={decision === "CONNECT_NOW"}
            className={
              decision === "CONNECT_NOW"
                ? "rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white"
                : "rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700"
            }
            onClick={() => setDecision("CONNECT_NOW")}
            type="button"
          >
            Request connection setup
          </button>
        )}
        <button
          aria-pressed={decision === primary}
          className={
            decision === primary
              ? "rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white"
              : "rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700"
          }
          onClick={() => setDecision(primary)}
          type="button"
        >
          {primary === "ACKNOWLEDGED_UNAVAILABLE" ? "Acknowledge" : "Not now"}
        </button>
        <button
          aria-pressed={decision === "NOT_APPLICABLE"}
          className={
            decision === "NOT_APPLICABLE"
              ? "rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white"
              : "rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700"
          }
          onClick={() => setDecision("NOT_APPLICABLE")}
          type="button"
        >
          Not applicable
        </button>
      </div>
      <GoogleCalendarOAuthPanel
        card={card}
        setDecision={setDecision}
        snapshot={snapshot}
      />
    </article>
  );
}

function SettingsEditor({
  snapshot,
  busy,
  error,
  success,
  save,
}: {
  snapshot: AppsSettingsSnapshot;
  busy: boolean;
  error: string | null;
  success: string | null;
  save: (decisions: Record<string, AppsDecision>) => void;
}) {
  const [search, setSearch] = useState("");
  const [googleOnly, setGoogleOnly] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, AppsDecision>>({});
  useEffect(() => {
    setDecisions(
      Object.fromEntries(
        snapshot.cards.map((card) => [card.serviceId, card.decision]),
      ),
    );
  }, [snapshot]);
  const filtered = useMemo(() => {
    const providerCards = googleOnly
      ? snapshot.cards.filter(isGoogleWorkspaceService)
      : snapshot.cards;
    return providerCards.filter((card) =>
      matchesAppsServiceSearch(card, search, [
        categoryLabels[card.category],
        statusLabels[card.catalogStatus],
        placementLabels[card.placement],
        ...card.routeKinds.map((route) => routeLabels[route]),
        authorizationLabels[card.authorizationStatus],
        resourceLabels[card.resourceStatus],
        syncLabels[card.syncStatus],
        operationLabels[card.operationStatus],
      ]),
    );
  }, [googleOnly, search, snapshot]);
  const grouped = useMemo(
    () =>
      Object.entries(categoryLabels)
        .map(([category, label]) => ({
          category: category as AppsCategory,
          label,
          cards: filtered.filter((card) => card.category === category),
        }))
        .filter((group) => group.cards.length > 0),
    [filtered],
  );
  const original = Object.fromEntries(
    snapshot.cards.map((card) => [card.serviceId, card.decision]),
  );
  const changed = JSON.stringify(decisions) !== JSON.stringify(original);
  const household = snapshot.tier === "HOUSEHOLD";
  return (
    <Shell>
      <a
        className="inline-flex items-center text-sm font-medium text-slate-600 hover:text-slate-950"
        href={
          (household ? "/settings/household/members" : "/settings/user/agent") +
          "?household=" +
          encodeURIComponent(snapshot.householdId)
        }
      >
        <ArrowLeft aria-hidden="true" className="mr-2 h-4 w-4" />
        {household ? "Household Settings" : "User Settings"}
      </a>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            {household ? "Household Settings" : "User Settings"}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
            {household ? "Household Apps & Data" : "My Apps & Data"}
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
            Review all {snapshot.catalogTotalCards} consumer app cards and keep
            this scope&apos;s preferences current.
          </p>
        </div>
        <span className="inline-flex items-center rounded-full bg-slate-950 px-3 py-1.5 text-xs font-medium text-white">
          <LockKeyhole aria-hidden="true" className="mr-2 h-3.5 w-3.5" />
          {household ? "Head of Household only" : "Private to you"}
        </span>
      </div>
      <div className="mt-6 rounded-2xl border border-indigo-100 bg-indigo-50 p-4 text-sm leading-6 text-indigo-900">
        <strong>Preferences are not authorization:</strong> saving here never
        connects or disconnects a provider, changes OAuth grants, exposes
        credentials, or moves private data into the household scope. A separate,
        verified authorization and resource-selection flow is always required.
      </div>
      <GoogleWorkspacePlanner
        active={googleOnly}
        onToggle={() => setGoogleOnly((current) => !current)}
        serviceCount={snapshot.cards.filter(isGoogleWorkspaceService).length}
        tier={snapshot.tier}
      />
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
      <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <label className="relative block">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-3 h-4 w-4 text-slate-400"
          />
          <span className="sr-only">Search services to connect</span>
          <input
            className="h-10 w-full rounded-xl border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-slate-600"
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              setSearch(event.target.value)
            }
            placeholder="Search services to connect — Google, OAuth, MCP…"
            type="search"
            value={search}
          />
        </label>
        <p className="mt-3 text-xs text-slate-500">
          Showing {filtered.length} of {snapshot.applicableCardCount} cards ·
          catalog {snapshot.catalogVersion}
        </p>
      </div>
      <div className="mt-8 space-y-10">
        {grouped.map((group) => (
          <section key={group.category}>
            <h2 className="text-lg font-semibold text-slate-950">
              {group.label}
            </h2>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {group.cards.map((card) => (
                <DecisionCard
                  card={card}
                  decision={decisions[card.serviceId] ?? card.decision}
                  key={card.serviceId}
                  setDecision={(decision) =>
                    setDecisions((current) => ({
                      ...current,
                      [card.serviceId]: decision,
                    }))
                  }
                  snapshot={snapshot}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
      {filtered.length === 0 && (
        <div
          className="mt-8 rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center"
          role="status"
        >
          <p className="font-medium text-slate-800">No services found</p>
          <p className="mt-1 text-sm text-slate-500">
            Try a provider name, OAuth, MCP, category, or connection status.
          </p>
          <Button
            className="mt-4"
            onClick={() => {
              setSearch("");
              setGoogleOnly(false);
            }}
            type="button"
            variant="outline"
          >
            Clear search
          </Button>
        </div>
      )}
      <div className="sticky bottom-4 mt-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
        <p className="text-xs text-slate-500">
          Decision revision {snapshot.decisionRevision}
        </p>
        <div className="flex gap-2">
          <Button
            disabled={!changed || busy}
            onClick={() => setDecisions(original)}
            type="button"
            variant="outline"
          >
            Restore saved
          </Button>
          <Button
            className="bg-slate-950 text-white hover:bg-slate-800"
            disabled={!changed || busy}
            onClick={() => save(decisions)}
            type="button"
          >
            {busy && (
              <LoaderCircle
                aria-hidden="true"
                className="mr-2 h-4 w-4 animate-spin"
              />
            )}
            Save decisions
          </Button>
        </div>
      </div>
    </Shell>
  );
}

export function AppsSettingsPage({ tier }: { tier: AppsTier }) {
  const queryClient = useQueryClient();
  const bootstrap = useQuery({
    queryKey: ["micasa", "bootstrap", "apps-settings", tier],
    queryFn: loadMiCasaBootstrap,
    retry: false,
  });
  const ready = readyBootstrap(bootstrap.data);
  const householdId = ready?.activeHousehold.id ?? null;
  const authorized =
    tier === "PRIVATE" || ready?.activeHousehold.role === "HEAD";
  const settings = useQuery({
    queryKey: ["micasa", "apps-settings", tier, householdId],
    queryFn: () => loadAppsSettings(tier, householdId as string),
    enabled: householdId !== null && authorized,
    retry: false,
  });
  const [success, setSuccess] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (decisions: Record<string, AppsDecision>) => {
      if (!settings.data)
        throw new Error("Apps & Data Settings are unavailable.");
      return saveAppsSettings(settings.data, decisions);
    },
    onMutate: () => setSuccess(null),
    onSuccess: (result) => {
      queryClient.setQueryData(
        ["micasa", "apps-settings", result.tier, result.readback.householdId],
        result.readback,
      );
      setSuccess(
        "Personal-Agent verified every decision and confirmed that grants and credentials were unchanged.",
      );
    },
  });

  if (bootstrap.isPending) return <Loading />;
  if (bootstrap.isError) {
    return <Unavailable retry={() => void bootstrap.refetch()} tier={tier} />;
  }
  if (bootstrap.data.state === "UNAUTHENTICATED") {
    window.location.assign(bootstrap.data.signInPath);
    return <Loading />;
  }
  if (bootstrap.data.state === "ONBOARDING_REQUIRED") {
    window.location.assign(bootstrap.data.onboardingPath);
    return <Loading />;
  }
  if (!authorized) {
    return <Unavailable retry={() => window.location.reload()} tier={tier} />;
  }
  if (settings.isPending) return <Loading />;
  if (settings.isError || !settings.data) {
    return <Unavailable retry={() => void settings.refetch()} tier={tier} />;
  }
  return (
    <SettingsEditor
      busy={mutation.isPending}
      error={mutation.isError ? mutation.error.message : null}
      save={(decisions) => mutation.mutate(decisions)}
      snapshot={settings.data}
      success={success}
    />
  );
}

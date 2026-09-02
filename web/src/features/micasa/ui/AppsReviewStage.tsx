import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  House,
  LoaderCircle,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  type AppsCategory,
  type AppsDecision,
  type AppsReviewCard,
  type AppsTier,
  defaultReviewDecision,
  isGoogleWorkspaceService,
  loadAppsReview,
  matchesAppsServiceSearch,
  saveAppsReview,
} from "@/features/micasa/apps-onboarding";
import { GoogleWorkspacePlanner } from "@/features/micasa/ui/GoogleWorkspacePlanner";
import { Button } from "@/shared/ui/button";

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
function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-slate-50 p-5 sm:p-8">
      <div className="mx-auto max-w-6xl">
        <Brand />
        <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          {children}
        </div>
      </div>
    </main>
  );
}
function Completed({
  tier,
  onContinue,
  continuing,
}: {
  tier: AppsTier;
  onContinue?: () => void;
  continuing: boolean;
}) {
  return (
    <Shell>
      <div className="mx-auto max-w-xl py-12 text-center">
        <CheckCircle2
          aria-hidden="true"
          className="mx-auto h-10 w-10 text-emerald-600"
        />
        <h1 className="mt-5 text-3xl font-semibold text-slate-950">
          {tier === "HOUSEHOLD" ? "Household" : "My"} Apps &amp; Services
          reviewed
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Personal-Agent verified a decision for every applicable card. No
          provider was connected without a separate authorization and resource
          selection flow.
        </p>
        <Button
          className="mt-6 bg-slate-950 text-white hover:bg-slate-800"
          disabled={continuing}
          onClick={onContinue ?? (() => window.location.reload())}
        >
          {continuing ? "Continuing…" : "Continue setup"}
        </Button>
      </div>
    </Shell>
  );
}
function Card({
  card,
  decision,
  setDecision,
}: {
  card: AppsReviewCard;
  decision: AppsDecision;
  setDecision: (decision: AppsDecision) => void;
}) {
  const primary = defaultReviewDecision(card);
  return (
    <article className="rounded-2xl border border-slate-200 p-4">
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
      <details className="mt-3 text-sm text-slate-600">
        <summary className="cursor-pointer font-medium text-slate-700">
          What this covers
        </summary>
        <p className="mt-2 leading-6">{card.details}</p>
      </details>
      <div className="mt-4 flex flex-wrap gap-2">
        {card.connectEnabled && (
          <button
            className={
              decision === "CONNECT_NOW"
                ? "rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white"
                : "rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700"
            }
            onClick={() => setDecision("CONNECT_NOW")}
            type="button"
          >
            Connect
          </button>
        )}
        <button
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
    </article>
  );
}

export function AppsReviewStage({
  tier,
  onContinue,
  continuing = false,
}: {
  tier: AppsTier;
  onContinue?: () => void;
  continuing?: boolean;
}) {
  const review = useQuery({
    queryKey: ["micasa", "apps-review", tier],
    queryFn: () => loadAppsReview(tier),
    retry: false,
  });
  const [search, setSearch] = useState("");
  const [googleOnly, setGoogleOnly] = useState(false);
  const [decisions, setDecisions] = useState<Record<string, AppsDecision>>({});
  useEffect(() => {
    if (review.data) {
      setDecisions(
        Object.fromEntries(
          review.data.cards.map((card) => [card.serviceId, card.decision]),
        ),
      );
    }
  }, [review.data]);
  const mutation = useMutation({
    mutationFn: () => {
      if (!review.data) throw new Error("The app catalog is unavailable.");
      return saveAppsReview(review.data, decisions);
    },
  });

  const filtered = useMemo(() => {
    if (!review.data) return [];
    const providerCards = googleOnly
      ? review.data.cards.filter(isGoogleWorkspaceService)
      : review.data.cards;
    return providerCards.filter((card) =>
      matchesAppsServiceSearch(card, search, [
        categoryLabels[card.category],
        statusLabels[card.catalogStatus],
        placementLabels[card.placement],
      ]),
    );
  }, [googleOnly, review.data, search]);
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

  if (review.isPending) {
    return (
      <Shell>
        <div className="py-16 text-center">
          <LoaderCircle
            aria-hidden="true"
            className="mx-auto h-8 w-8 animate-spin text-slate-600"
          />
          <p className="mt-3 text-sm text-slate-600">
            Loading the complete Apps &amp; Services catalog…
          </p>
        </div>
      </Shell>
    );
  }
  if (review.isError) {
    return (
      <Shell>
        <div className="mx-auto max-w-xl py-12 text-center">
          <ShieldCheck
            aria-hidden="true"
            className="mx-auto h-9 w-9 text-slate-700"
          />
          <h1 className="mt-5 text-2xl font-semibold text-slate-950">
            Apps &amp; Services are temporarily unavailable
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Personal-Agent did not return a complete, current catalog. No
            decisions or provider connections were assumed.
          </p>
          <Button
            className="mt-6 bg-slate-950 text-white hover:bg-slate-800"
            onClick={() => void review.refetch()}
          >
            Refresh catalog
          </Button>
        </div>
      </Shell>
    );
  }
  if (mutation.data || review.data.state === "REVIEWED") {
    return (
      <Completed continuing={continuing} onContinue={onContinue} tier={tier} />
    );
  }

  const remaining = review.data.cards.filter(
    (card) => (decisions[card.serviceId] ?? "UNREVIEWED") === "UNREVIEWED",
  ).length;
  function fillCards(cards: AppsReviewCard[]) {
    setDecisions((current) => ({
      ...current,
      ...Object.fromEntries(
        cards.map((card) => [card.serviceId, defaultReviewDecision(card)]),
      ),
    }));
  }

  return (
    <Shell>
      <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">
        Household setup · {tier === "HOUSEHOLD" ? "Household" : "My"} Apps &amp;
        Services
      </p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
        Review {tier === "HOUSEHOLD" ? "Household" : "My"} Apps &amp; Services
      </h1>
      <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
        Every applicable service stays visible even when it is preview,
        device-gated, coming later, or blocked. Reviewing is required;
        connecting an optional provider is not.
      </p>
      <GoogleWorkspacePlanner
        active={googleOnly}
        onToggle={() => setGoogleOnly((current) => !current)}
        serviceCount={review.data.cards.filter(isGoogleWorkspaceService).length}
        tier={tier}
      />
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <label className="relative flex-1">
          <Search
            aria-hidden="true"
            className="absolute left-3 top-3 h-4 w-4 text-slate-400"
          />
          <span className="sr-only">Search services to connect</span>
          <input
            className="h-10 w-full rounded-xl border border-slate-300 pl-9 pr-3 text-sm outline-none focus:border-slate-600"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search services to connect — Google, OAuth, MCP…"
            type="search"
            value={search}
          />
        </label>
        <Button
          className="border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
          onClick={() => fillCards(review.data.cards)}
          type="button"
        >
          Review all as not now
        </Button>
      </div>
      <p className="mt-3 text-sm text-slate-600" aria-live="polite">
        {remaining === 0
          ? "Every applicable card has a decision."
          : `${remaining} cards still need a decision.`}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Showing {filtered.length} of {review.data.applicableCardCount} services
      </p>

      <div className="mt-7 space-y-8">
        {grouped.map((group) => (
          <section key={group.category}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-slate-950">
                {group.label}
              </h2>
              <button
                className="text-xs font-medium text-slate-600 underline underline-offset-4"
                onClick={() => fillCards(group.cards)}
                type="button"
              >
                Not now for category
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {group.cards.map((card) => (
                <Card
                  card={card}
                  decision={decisions[card.serviceId] ?? "UNREVIEWED"}
                  key={card.serviceId}
                  setDecision={(decision) =>
                    setDecisions((current) => ({
                      ...current,
                      [card.serviceId]: decision,
                    }))
                  }
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {filtered.length === 0 && (
        <div
          className="mt-7 rounded-2xl border border-dashed border-slate-300 px-5 py-10 text-center"
          role="status"
        >
          <p className="font-medium text-slate-800">No services found</p>
          <p className="mt-1 text-sm text-slate-500">
            Try a provider name, OAuth, MCP, category, or availability status.
          </p>
          <Button
            className="mt-4 border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
            onClick={() => {
              setSearch("");
              setGoogleOnly(false);
            }}
            type="button"
          >
            Clear search
          </Button>
        </div>
      )}

      {mutation.isError && (
        <p
          className="mt-6 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"
          role="alert"
        >
          {mutation.error.message}
        </p>
      )}
      <div className="sticky bottom-3 mt-8 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
        <p className="text-sm text-slate-600">
          {review.data.applicableCardCount} applicable cards · catalog version{" "}
          {review.data.catalogVersion}
        </p>
        <Button
          className="bg-slate-950 text-white hover:bg-slate-800"
          disabled={remaining !== 0 || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending && (
            <LoaderCircle
              aria-hidden="true"
              className="mr-2 h-4 w-4 animate-spin"
            />
          )}
          Save {tier === "HOUSEHOLD" ? "Household" : "My"} app decisions
        </Button>
      </div>
    </Shell>
  );
}

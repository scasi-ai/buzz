export class AppsOnboardingContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppsOnboardingContractError";
  }
}

export type AppsTier = "HOUSEHOLD" | "PRIVATE";
export type AppsReviewState = "REVIEW_REQUIRED" | "REVIEWED";
export type AppsDecision =
  | "UNREVIEWED"
  | "CONNECT_NOW"
  | "NOT_NOW"
  | "NOT_APPLICABLE"
  | "ACKNOWLEDGED_UNAVAILABLE";
export type AppsCatalogStatus =
  | "AVAILABLE"
  | "PREVIEW"
  | "DEVICE_REQUIRED"
  | "PLAN_REQUIRED"
  | "ADMIN_REQUIRED"
  | "PARTNER_REVIEW_REQUIRED"
  | "COMING_LATER"
  | "REGION_UNAVAILABLE"
  | "POLICY_BLOCKED"
  | "REFUSED";
export type AppsCategory =
  | "MAIL_CALENDAR_CONTACTS_TASKS"
  | "FILES_DOCUMENTS_NOTES"
  | "PHOTOS_MEDIA"
  | "HOME_DEVICES"
  | "HEALTH_LOCATION_FAMILY_EDUCATION"
  | "MESSAGING_SOCIAL"
  | "LIFE_COMMERCE_FINANCE_GAMING_VEHICLES";
export type AppsPlacement =
  | "HOUSEHOLD"
  | "DEDICATED_OR_SHARED"
  | "PRIVATE_SHARE_ONLY"
  | "PRIVATE";

export type AppsReviewCard = {
  serviceId: string;
  displayName: string;
  category: AppsCategory;
  placement: AppsPlacement;
  catalogStatus: AppsCatalogStatus;
  connectEnabled: boolean;
  decision: AppsDecision;
  details: string;
};
export type AppsReviewSnapshot = {
  state: AppsReviewState;
  tier: AppsTier;
  catalogVersion: string;
  catalogDigest: string;
  catalogTotalCards: 83;
  applicableCardCount: number;
  decisionRevision: number;
  csrfToken: string;
  cards: AppsReviewCard[];
};
export type AppsReviewMutation = {
  state: "REVIEWED";
  tier: AppsTier;
  decisionRevision: number;
  operation: {
    operationId: string;
    idempotencyKey: string;
    state: "VERIFIED";
    retrySafe: true;
    mutationPossible: false;
    nextAction: "REVIEW_PRIVATE_APPS" | "VERIFY_HOUSEHOLD_READINESS";
    policyRevision: number;
    readbackAt: number;
  };
  decisions: Array<{
    serviceId: string;
    decision: Exclude<AppsDecision, "UNREVIEWED">;
  }>;
};

type JsonObject = Record<string, unknown>;
const API_PREFIX = "/api/micasa/v1";
const APPS_PATH = API_PREFIX + "/onboarding/apps";
const REQUEST_TIMEOUT_MS = 15_000;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SERVICE_ID = /^[a-z0-9][a-z0-9-]{0,95}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const CSRF = /^[A-Za-z0-9_-]{32,256}$/;
const CATEGORIES: AppsCategory[] = [
  "MAIL_CALENDAR_CONTACTS_TASKS",
  "FILES_DOCUMENTS_NOTES",
  "PHOTOS_MEDIA",
  "HOME_DEVICES",
  "HEALTH_LOCATION_FAMILY_EDUCATION",
  "MESSAGING_SOCIAL",
  "LIFE_COMMERCE_FINANCE_GAMING_VEHICLES",
];
const STATUSES: AppsCatalogStatus[] = [
  "AVAILABLE",
  "PREVIEW",
  "DEVICE_REQUIRED",
  "PLAN_REQUIRED",
  "ADMIN_REQUIRED",
  "PARTNER_REVIEW_REQUIRED",
  "COMING_LATER",
  "REGION_UNAVAILABLE",
  "POLICY_BLOCKED",
  "REFUSED",
];
const DECISIONS: AppsDecision[] = [
  "UNREVIEWED",
  "CONNECT_NOW",
  "NOT_NOW",
  "NOT_APPLICABLE",
  "ACKNOWLEDGED_UNAVAILABLE",
];
const ACK_REQUIRED = new Set<AppsCatalogStatus>([
  "COMING_LATER",
  "REGION_UNAVAILABLE",
  "POLICY_BLOCKED",
  "REFUSED",
]);
const NOT_NOW_ALLOWED = new Set<AppsCatalogStatus>([
  "AVAILABLE",
  "PREVIEW",
  "DEVICE_REQUIRED",
  "PLAN_REQUIRED",
  "ADMIN_REQUIRED",
  "PARTNER_REVIEW_REQUIRED",
]);

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppsOnboardingContractError(label + " must be an object.");
  }
  return value as JsonObject;
}
function exact(record: JsonObject, fields: readonly string[], label: string) {
  const actual = Object.keys(record).sort();
  const expected = [...fields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new AppsOnboardingContractError(
      label + " has an unsupported field.",
    );
  }
}
function text(
  record: JsonObject,
  key: string,
  label: string,
  maximum = 256,
): string {
  const value = record[key];
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maximum
  ) {
    throw new AppsOnboardingContractError(
      label + "." + key + " must be text.",
    );
  }
  return value;
}
function positiveInteger(record: JsonObject, key: string, label: string) {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new AppsOnboardingContractError(
      label + "." + key + " must be a positive integer.",
    );
  }
  return value as number;
}
function choice<T extends string>(
  value: unknown,
  choices: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    throw new AppsOnboardingContractError(label + " is unsupported.");
  }
  return value as T;
}
function parseTier(value: unknown): AppsTier {
  return choice(value, ["HOUSEHOLD", "PRIVATE"] as const, "apps.tier");
}
function parseDecision(value: unknown, label: string): AppsDecision {
  return choice(value, DECISIONS, label);
}
function parseCard(
  value: unknown,
  tier: AppsTier,
  index: number,
): AppsReviewCard {
  const label = "apps.cards[" + index + "]";
  const record = object(value, label);
  exact(
    record,
    [
      "serviceId",
      "displayName",
      "category",
      "placement",
      "catalogStatus",
      "connectEnabled",
      "decision",
      "details",
    ],
    label,
  );
  const serviceId = text(record, "serviceId", label, 96);
  if (!SERVICE_ID.test(serviceId)) {
    throw new AppsOnboardingContractError(label + ".serviceId is invalid.");
  }
  const placement = choice(
    record.placement,
    tier === "HOUSEHOLD"
      ? ([
          "HOUSEHOLD",
          "DEDICATED_OR_SHARED",
          "PRIVATE_SHARE_ONLY",
        ] as const)
      : (["PRIVATE"] as const),
    label + ".placement",
  );
  const catalogStatus = choice(
    record.catalogStatus,
    STATUSES,
    label + ".catalogStatus",
  );
  if (
    typeof record.connectEnabled !== "boolean" ||
    record.connectEnabled !== (catalogStatus === "AVAILABLE")
  ) {
    throw new AppsOnboardingContractError(
      label + ".connectEnabled claims false readiness.",
    );
  }
  return {
    serviceId,
    displayName: text(record, "displayName", label, 120),
    category: choice(record.category, CATEGORIES, label + ".category"),
    placement,
    catalogStatus,
    connectEnabled: record.connectEnabled,
    decision: parseDecision(record.decision, label + ".decision"),
    details: text(record, "details", label, 1_200),
  };
}

export function parseAppsReviewSnapshot(value: unknown): AppsReviewSnapshot {
  const record = object(value, "apps");
  exact(
    record,
    [
      "state",
      "tier",
      "catalogVersion",
      "catalogDigest",
      "catalogTotalCards",
      "applicableCardCount",
      "decisionRevision",
      "csrfToken",
      "cards",
    ],
    "apps",
  );
  const tier = parseTier(record.tier);
  const state = choice(
    record.state,
    ["REVIEW_REQUIRED", "REVIEWED"] as const,
    "apps.state",
  );
  const digest = text(record, "catalogDigest", "apps", 64);
  const csrfToken = text(record, "csrfToken", "apps");
  if (!DIGEST.test(digest) || !CSRF.test(csrfToken)) {
    throw new AppsOnboardingContractError(
      "The catalog authority is invalid.",
    );
  }
  if (record.catalogTotalCards !== 83 || !Array.isArray(record.cards)) {
    throw new AppsOnboardingContractError(
      "The locked catalog is incomplete.",
    );
  }
  const cards = record.cards.map((card, index) =>
    parseCard(card, tier, index),
  );
  const applicableCardCount = positiveInteger(
    record,
    "applicableCardCount",
    "apps",
  );
  if (
    cards.length !== applicableCardCount ||
    new Set(cards.map((card) => card.serviceId)).size !== cards.length ||
    new Set(cards.map((card) => card.displayName)).size !== cards.length
  ) {
    throw new AppsOnboardingContractError(
      "The applicable catalog is incomplete or duplicated.",
    );
  }
  const hasUnreviewed = cards.some(
    (card) => card.decision === "UNREVIEWED",
  );
  if (
    (state === "REVIEW_REQUIRED") !== hasUnreviewed ||
    cards.some(
      (card) =>
        card.decision !== "UNREVIEWED" &&
        !decisionAllowed(card, card.decision),
    )
  ) {
    throw new AppsOnboardingContractError(
      "The app review state contradicts its decisions.",
    );
  }
  return {
    state,
    tier,
    catalogVersion: text(record, "catalogVersion", "apps", 32),
    catalogDigest: digest,
    catalogTotalCards: 83,
    applicableCardCount,
    decisionRevision: positiveInteger(record, "decisionRevision", "apps"),
    csrfToken,
    cards,
  };
}

export function defaultReviewDecision(
  card: AppsReviewCard,
): Exclude<AppsDecision, "UNREVIEWED" | "CONNECT_NOW"> {
  return ACK_REQUIRED.has(card.catalogStatus)
    ? "ACKNOWLEDGED_UNAVAILABLE"
    : "NOT_NOW";
}
export function decisionAllowed(
  card: AppsReviewCard,
  decision: AppsDecision,
): boolean {
  if (decision === "UNREVIEWED") return true;
  if (decision === "NOT_APPLICABLE") return true;
  if (decision === "CONNECT_NOW") {
    return card.connectEnabled && card.catalogStatus === "AVAILABLE";
  }
  if (decision === "NOT_NOW") {
    return NOT_NOW_ALLOWED.has(card.catalogStatus);
  }
  return (
    decision === "ACKNOWLEDGED_UNAVAILABLE" &&
    !card.connectEnabled &&
    card.catalogStatus !== "AVAILABLE"
  );
}
export function buildAppsDecisionPayload(
  snapshot: AppsReviewSnapshot,
  decisions: Readonly<Record<string, AppsDecision>>,
) {
  return {
    expectedRevision: snapshot.decisionRevision,
    decisions: snapshot.cards.map((card) => {
      const decision = decisions[card.serviceId];
      if (
        !decision ||
        decision === "UNREVIEWED" ||
        !decisionAllowed(card, decision)
      ) {
        throw new AppsOnboardingContractError(
          card.displayName + " still needs a valid decision.",
        );
      }
      return { serviceId: card.serviceId, decision };
    }),
  };
}

function parseMutationDecision(value: unknown, index: number) {
  const label = "appsMutation.decisions[" + index + "]";
  const record = object(value, label);
  exact(record, ["serviceId", "decision"], label);
  const serviceId = text(record, "serviceId", label, 96);
  const decision = parseDecision(record.decision, label + ".decision");
  if (!SERVICE_ID.test(serviceId) || decision === "UNREVIEWED") {
    throw new AppsOnboardingContractError(label + " is invalid.");
  }
  return {
    serviceId,
    decision: decision as Exclude<AppsDecision, "UNREVIEWED">,
  };
}
export function parseAppsReviewMutation(
  value: unknown,
): AppsReviewMutation {
  const record = object(value, "appsMutation");
  exact(
    record,
    ["state", "tier", "decisionRevision", "operation", "decisions"],
    "appsMutation",
  );
  if (record.state !== "REVIEWED" || !Array.isArray(record.decisions)) {
    throw new AppsOnboardingContractError(
      "The apps mutation was not reviewed.",
    );
  }
  const operation = object(record.operation, "appsMutation.operation");
  exact(
    operation,
    [
      "operationId",
      "idempotencyKey",
      "state",
      "retrySafe",
      "mutationPossible",
      "nextAction",
      "policyRevision",
      "readbackAt",
    ],
    "appsMutation.operation",
  );
  const operationId = text(
    operation,
    "operationId",
    "appsMutation.operation",
  );
  const idempotencyKey = text(
    operation,
    "idempotencyKey",
    "appsMutation.operation",
  );
  if (
    !REF.test(operationId) ||
    !REF.test(idempotencyKey) ||
    operation.state !== "VERIFIED" ||
    operation.retrySafe !== true ||
    operation.mutationPossible !== false ||
    !["REVIEW_PRIVATE_APPS", "VERIFY_HOUSEHOLD_READINESS"].includes(
      String(operation.nextAction),
    )
  ) {
    throw new AppsOnboardingContractError(
      "The apps mutation lacks verified readback.",
    );
  }
  return {
    state: "REVIEWED",
    tier: parseTier(record.tier),
    decisionRevision: positiveInteger(
      record,
      "decisionRevision",
      "appsMutation",
    ),
    operation: {
      operationId,
      idempotencyKey,
      state: "VERIFIED",
      retrySafe: true,
      mutationPossible: false,
      nextAction: operation.nextAction as
        | "REVIEW_PRIVATE_APPS"
        | "VERIFY_HOUSEHOLD_READINESS",
      policyRevision: positiveInteger(
        operation,
        "policyRevision",
        "appsMutation.operation",
      ),
      readbackAt: positiveInteger(
        operation,
        "readbackAt",
        "appsMutation.operation",
      ),
    },
    decisions: record.decisions.map(parseMutationDecision),
  };
}

function apiBase(): URL {
  const configured = import.meta.env.VITE_PA_BFF_ORIGIN?.trim();
  const base = new URL(configured || window.location.origin);
  if (import.meta.env.PROD && base.protocol !== "https:") {
    throw new AppsOnboardingContractError(
      "The production Personal-Agent BFF origin must use HTTPS.",
    );
  }
  return base;
}
function endpoint(tier: AppsTier): URL {
  const url = new URL(APPS_PATH, apiBase());
  url.searchParams.set("tier", tier);
  return url;
}
async function requestJson<T>(
  tier: AppsTier,
  parse: (value: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(endpoint(tier), {
    ...init,
    credentials: "include",
    cache: "no-store",
    headers: { Accept: "application/json", ...init?.headers },
    signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      response.status === 409
        ? "These app decisions changed. Refresh before continuing."
        : response.status === 401
          ? "Your MiCasa session has expired."
          : "Personal-Agent could not verify Apps & Services.",
    );
  }
  return parse(body);
}
export function loadAppsReview(
  tier: AppsTier,
): Promise<AppsReviewSnapshot> {
  return requestJson(tier, parseAppsReviewSnapshot);
}
export function saveAppsReview(
  snapshot: AppsReviewSnapshot,
  decisions: Readonly<Record<string, AppsDecision>>,
): Promise<AppsReviewMutation> {
  return requestJson(snapshot.tier, parseAppsReviewMutation, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": snapshot.csrfToken,
    },
    body: JSON.stringify(buildAppsDecisionPayload(snapshot, decisions)),
  });
}

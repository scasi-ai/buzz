import {
  type AppsDecision,
  AppsOnboardingContractError,
  type AppsReviewCard,
  type AppsReviewSnapshot,
  type AppsTier,
  buildAppsDecisionPayload,
  parseAppsReviewSnapshot,
} from "./apps-onboarding.ts";
import { isAllowedMiCasaOrigin } from "./origin-policy.ts";

export type { AppsDecision } from "./apps-onboarding.ts";

export class AppsSettingsContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppsSettingsContractError";
  }
}

export type AppsConnectorRouteKind =
  | "HOSTED_MCP"
  | "DIRECT_API"
  | "STANDARD_PROTOCOL"
  | "DEVICE_BRIDGE"
  | "IMPORT"
  | "PROVIDER_REVIEW";
export type AppsAuthorizationStatus =
  | "NOT_CONNECTED"
  | "CONSENT_REQUIRED"
  | "AUTHORIZING"
  | "CALLBACK_PENDING"
  | "CONNECTED"
  | "REAUTH_REQUIRED"
  | "REVOKING"
  | "REVOKED"
  | "OUTCOME_UNKNOWN";
export type AppsResourceStatus =
  | "SELECTION_REQUIRED"
  | "SELECTED"
  | "SCOPE_CHANGE_PENDING";
export type AppsSyncStatus =
  | "NOT_STARTED"
  | "SYNCING"
  | "READY"
  | "DEGRADED"
  | "STALE"
  | "FAILED";
export type AppsOperationStatus =
  | "ADMITTED"
  | "APPROVAL_REQUIRED"
  | "BLOCKED"
  | "UNSUPPORTED";
export type AppsSettingsCard = AppsReviewCard & {
  routeKinds: AppsConnectorRouteKind[];
  authorizationStatus: AppsAuthorizationStatus;
  resourceStatus: AppsResourceStatus;
  syncStatus: AppsSyncStatus;
  operationStatus: AppsOperationStatus;
  providerConnectionId: string | null;
  serviceGrantId: string | null;
  consentReceiptId: string | null;
  audience: Array<"HOUSEHOLD" | "SELF">;
  selectedResourceIds: string[];
};
export type AppsSettingsSnapshot = Omit<
  AppsReviewSnapshot,
  "state" | "cards"
> & {
  state: "EDITABLE";
  surface: "SETTINGS";
  householdId: string;
  cards: AppsSettingsCard[];
};
export type AppsSettingsMutation = {
  state: "UPDATED";
  surface: "SETTINGS";
  tier: AppsTier;
  operation: {
    operationId: string;
    idempotencyKey: string;
    operation:
      | "UPDATE_HOUSEHOLD_APPS_SETTINGS"
      | "UPDATE_PRIVATE_APPS_SETTINGS";
    retrySafe: true;
    mutationPossible: false;
    nextAction: "REFRESH_APPS_SETTINGS";
    policyRevision: number;
    readbackAt: number;
    effects: string[];
  };
  readback: AppsSettingsSnapshot;
};

type JsonObject = Record<string, unknown>;
const API_PREFIX = "/api/micasa/v1";
const PATHS: Record<AppsTier, string> = {
  HOUSEHOLD: `${API_PREFIX}/settings/household/apps`,
  PRIVATE: `${API_PREFIX}/settings/user/apps`,
};
const OPERATIONS: Record<
  AppsTier,
  AppsSettingsMutation["operation"]["operation"]
> = {
  HOUSEHOLD: "UPDATE_HOUSEHOLD_APPS_SETTINGS",
  PRIVATE: "UPDATE_PRIVATE_APPS_SETTINGS",
};
const EFFECTS = [
  "DECISIONS_UPDATED",
  "SERVICE_GRANTS_UNCHANGED",
  "CREDENTIALS_UNCHANGED",
  "HOUSEHOLD_PRIVATE_BOUNDARY_PRESERVED",
] as const;
const ROUTES: AppsConnectorRouteKind[] = [
  "HOSTED_MCP",
  "DIRECT_API",
  "STANDARD_PROTOCOL",
  "DEVICE_BRIDGE",
  "IMPORT",
  "PROVIDER_REVIEW",
];
const AUTHORIZATION: AppsAuthorizationStatus[] = [
  "NOT_CONNECTED",
  "CONSENT_REQUIRED",
  "AUTHORIZING",
  "CALLBACK_PENDING",
  "CONNECTED",
  "REAUTH_REQUIRED",
  "REVOKING",
  "REVOKED",
  "OUTCOME_UNKNOWN",
];
const RESOURCES: AppsResourceStatus[] = [
  "SELECTION_REQUIRED",
  "SELECTED",
  "SCOPE_CHANGE_PENDING",
];
const SYNC: AppsSyncStatus[] = [
  "NOT_STARTED",
  "SYNCING",
  "READY",
  "DEGRADED",
  "STALE",
  "FAILED",
];
const OPERATION_STATES: AppsOperationStatus[] = [
  "ADMITTED",
  "APPROVAL_REQUIRED",
  "BLOCKED",
  "UNSUPPORTED",
];
const REVIEW_CARD_FIELDS = [
  "serviceId",
  "displayName",
  "category",
  "placement",
  "catalogStatus",
  "connectEnabled",
  "decision",
  "details",
] as const;
const SETTINGS_CARD_FIELDS = [
  ...REVIEW_CARD_FIELDS,
  "routeKinds",
  "authorizationStatus",
  "resourceStatus",
  "syncStatus",
  "operationStatus",
  "providerConnectionId",
  "serviceGrantId",
  "consentReceiptId",
  "audience",
  "selectedResourceIds",
] as const;
const REQUEST_TIMEOUT_MS = 15_000;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function fail(message: string): never {
  throw new AppsSettingsContractError(message);
}
function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} must be an object.`);
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
    fail(`${label} has an unsupported field.`);
  }
}
function ref(record: JsonObject, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || !REF.test(value)) {
    fail(`${label}.${key} is invalid.`);
  }
  return value;
}
function optionalRef(
  record: JsonObject,
  key: string,
  label: string,
): string | null {
  if (record[key] === null) return null;
  return ref(record, key, label);
}
function positive(record: JsonObject, key: string, label: string): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail(`${label}.${key} must be a positive integer.`);
  }
  return value as number;
}
function choice<T extends string>(
  value: unknown,
  choices: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !choices.includes(value as T)) {
    fail(`${label} is unsupported.`);
  }
  return value as T;
}
function stringList(
  value: unknown,
  label: string,
  choices?: readonly string[],
): string[] {
  if (
    !Array.isArray(value) ||
    new Set(value).size !== value.length ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        !REF.test(item) ||
        (choices !== undefined && !choices.includes(item)),
    )
  ) {
    fail(`${label} is invalid.`);
  }
  return value as string[];
}
function parseTier(value: unknown): AppsTier {
  return choice(value, ["HOUSEHOLD", "PRIVATE"] as const, "appsSettings.tier");
}
function reviewedProjection(record: JsonObject): AppsReviewSnapshot {
  if (!Array.isArray(record.cards)) {
    fail("Apps Settings cards are invalid.");
  }
  const cards = record.cards.map((value, index) => {
    const raw = object(value, `appsSettings.cards[${index}]`);
    return Object.fromEntries(
      REVIEW_CARD_FIELDS.map((field) => [field, raw[field]]),
    );
  });
  try {
    return parseAppsReviewSnapshot({
      state: "REVIEWED",
      tier: record.tier,
      catalogVersion: record.catalogVersion,
      catalogDigest: record.catalogDigest,
      catalogTotalCards: record.catalogTotalCards,
      applicableCardCount: record.applicableCardCount,
      decisionRevision: record.decisionRevision,
      csrfToken: record.csrfToken,
      cards,
    });
  } catch (error) {
    if (error instanceof AppsOnboardingContractError) {
      fail(error.message);
    }
    throw error;
  }
}
function parseSettingsCard(
  value: unknown,
  reviewed: AppsReviewCard,
  tier: AppsTier,
  index: number,
): AppsSettingsCard {
  const label = `appsSettings.cards[${index}]`;
  const record = object(value, label);
  exact(record, SETTINGS_CARD_FIELDS, label);
  const routeKinds = stringList(
    record.routeKinds,
    `${label}.routeKinds`,
    ROUTES,
  );
  if (routeKinds.length === 0) fail(`${label}.routeKinds is empty.`);
  const authorizationStatus = choice(
    record.authorizationStatus,
    AUTHORIZATION,
    `${label}.authorizationStatus`,
  );
  const resourceStatus = choice(
    record.resourceStatus,
    RESOURCES,
    `${label}.resourceStatus`,
  );
  const syncStatus = choice(record.syncStatus, SYNC, `${label}.syncStatus`);
  const operationStatus = choice(
    record.operationStatus,
    OPERATION_STATES,
    `${label}.operationStatus`,
  );
  const providerConnectionId = optionalRef(
    record,
    "providerConnectionId",
    label,
  );
  const serviceGrantId = optionalRef(record, "serviceGrantId", label);
  const consentReceiptId = optionalRef(record, "consentReceiptId", label);
  const audience = stringList(record.audience, `${label}.audience`, [
    "HOUSEHOLD",
    "SELF",
  ]) as Array<"HOUSEHOLD" | "SELF">;
  const selectedResourceIds = stringList(
    record.selectedResourceIds,
    `${label}.selectedResourceIds`,
  );
  const expectedAudience = tier === "HOUSEHOLD" ? "HOUSEHOLD" : "SELF";
  const connected = [
    "CONNECTED",
    "REAUTH_REQUIRED",
    "REVOKING",
    "OUTCOME_UNKNOWN",
  ].includes(authorizationStatus);
  if (
    audience.length !== 1 ||
    audience[0] !== expectedAudience ||
    (connected &&
      (!reviewed.connectEnabled ||
        providerConnectionId === null ||
        serviceGrantId === null ||
        consentReceiptId === null ||
        resourceStatus === "SELECTION_REQUIRED" ||
        selectedResourceIds.length === 0 ||
        syncStatus === "NOT_STARTED")) ||
    (!connected &&
      (authorizationStatus !== "NOT_CONNECTED" ||
        providerConnectionId !== null ||
        serviceGrantId !== null ||
        consentReceiptId !== null ||
        resourceStatus !== "SELECTION_REQUIRED" ||
        syncStatus !== "NOT_STARTED" ||
        operationStatus !== "BLOCKED" ||
        selectedResourceIds.length !== 0))
  ) {
    fail(`${label} claims an invalid connector boundary.`);
  }
  return {
    ...reviewed,
    routeKinds: routeKinds as AppsConnectorRouteKind[],
    authorizationStatus,
    resourceStatus,
    syncStatus,
    operationStatus,
    providerConnectionId,
    serviceGrantId,
    consentReceiptId,
    audience,
    selectedResourceIds,
  };
}

export function parseAppsSettingsSnapshot(
  value: unknown,
): AppsSettingsSnapshot {
  const record = object(value, "appsSettings");
  exact(
    record,
    [
      "state",
      "surface",
      "tier",
      "householdId",
      "catalogVersion",
      "catalogDigest",
      "catalogTotalCards",
      "applicableCardCount",
      "decisionRevision",
      "csrfToken",
      "cards",
    ],
    "appsSettings",
  );
  if (record.state !== "EDITABLE" || record.surface !== "SETTINGS") {
    fail("Apps Settings is not editable.");
  }
  const tier = parseTier(record.tier);
  const reviewed = reviewedProjection(record);
  return {
    ...reviewed,
    state: "EDITABLE",
    surface: "SETTINGS",
    householdId: ref(record, "householdId", "appsSettings"),
    cards: reviewed.cards.map((card, index) =>
      parseSettingsCard((record.cards as unknown[])[index], card, tier, index),
    ),
  };
}

export function buildAppsSettingsPayload(
  snapshot: AppsSettingsSnapshot,
  decisions: Readonly<Record<string, AppsDecision>>,
) {
  return buildAppsDecisionPayload(
    {
      ...snapshot,
      state: "REVIEWED",
    },
    decisions,
  );
}

function parseOperation(
  value: unknown,
  tier: AppsTier,
): AppsSettingsMutation["operation"] {
  const label = "appsSettingsMutation.operation";
  const record = object(value, label);
  exact(
    record,
    [
      "operationId",
      "idempotencyKey",
      "operation",
      "retrySafe",
      "mutationPossible",
      "nextAction",
      "policyRevision",
      "readbackAt",
      "effects",
    ],
    label,
  );
  if (
    record.operation !== OPERATIONS[tier] ||
    record.retrySafe !== true ||
    record.mutationPossible !== false ||
    record.nextAction !== "REFRESH_APPS_SETTINGS" ||
    !Array.isArray(record.effects)
  ) {
    fail("Apps Settings mutation lacks verified readback.");
  }
  const effects = record.effects;
  const expected = [...EFFECTS].sort();
  if (
    effects.some((effect) => typeof effect !== "string") ||
    new Set(effects).size !== effects.length ||
    [...effects].sort().some((effect, index) => effect !== expected[index]) ||
    effects.length !== expected.length
  ) {
    fail("Apps Settings mutation changed an unapproved grant boundary.");
  }
  return {
    operationId: ref(record, "operationId", label),
    idempotencyKey: ref(record, "idempotencyKey", label),
    operation: OPERATIONS[tier],
    retrySafe: true,
    mutationPossible: false,
    nextAction: "REFRESH_APPS_SETTINGS",
    policyRevision: positive(record, "policyRevision", label),
    readbackAt: positive(record, "readbackAt", label),
    effects: effects as string[],
  };
}
function connectorFingerprint(card: AppsSettingsCard) {
  return {
    serviceId: card.serviceId,
    routeKinds: card.routeKinds,
    authorizationStatus: card.authorizationStatus,
    resourceStatus: card.resourceStatus,
    syncStatus: card.syncStatus,
    operationStatus: card.operationStatus,
    providerConnectionId: card.providerConnectionId,
    serviceGrantId: card.serviceGrantId,
    consentReceiptId: card.consentReceiptId,
    audience: card.audience,
    selectedResourceIds: card.selectedResourceIds,
  };
}

export function parseAppsSettingsMutation(
  value: unknown,
  before: AppsSettingsSnapshot,
  decisions: Readonly<Record<string, AppsDecision>>,
): AppsSettingsMutation {
  const record = object(value, "appsSettingsMutation");
  exact(
    record,
    ["state", "surface", "tier", "operation", "readback"],
    "appsSettingsMutation",
  );
  const tier = parseTier(record.tier);
  if (
    record.state !== "UPDATED" ||
    record.surface !== "SETTINGS" ||
    tier !== before.tier
  ) {
    fail("Apps Settings mutation changed scope or is unverified.");
  }
  const operation = parseOperation(record.operation, tier);
  const readback = parseAppsSettingsSnapshot(record.readback);
  const requested = buildAppsSettingsPayload(before, decisions).decisions;
  if (
    readback.householdId !== before.householdId ||
    readback.tier !== before.tier ||
    readback.catalogDigest !== before.catalogDigest ||
    readback.decisionRevision !== before.decisionRevision + 1 ||
    JSON.stringify(
      readback.cards.map((card: AppsReviewCard) => ({
        serviceId: card.serviceId,
        decision: card.decision,
      })),
    ) !== JSON.stringify(requested) ||
    JSON.stringify(readback.cards.map(connectorFingerprint)) !==
      JSON.stringify(before.cards.map(connectorFingerprint))
  ) {
    fail("Apps Settings mutation lacks exact catalog decision readback.");
  }
  return {
    state: "UPDATED",
    surface: "SETTINGS",
    tier,
    operation,
    readback,
  };
}

function apiBase(): URL {
  const configured = import.meta.env.VITE_PA_BFF_ORIGIN?.trim();
  const base = new URL(configured || window.location.origin);
  if (!isAllowedMiCasaOrigin(base, import.meta.env.PROD)) {
    fail("The production Personal-Agent BFF origin must use HTTPS.");
  }
  return base;
}
function endpoint(tier: AppsTier, householdId: string): URL {
  if (!REF.test(householdId)) fail("The Household identifier is invalid.");
  const url = new URL(PATHS[tier], apiBase());
  url.searchParams.set("household", householdId);
  return url;
}
async function requestJson<T>(
  url: URL,
  parser: (value: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
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
        ? "These app decisions changed. Refresh before saving."
        : response.status === 401
          ? "Your MiCasa session has expired."
          : response.status === 403
            ? "You are not allowed to edit these Apps & Data decisions."
            : "Personal-Agent could not verify Apps & Data Settings.",
    );
  }
  return parser(body);
}
export function loadAppsSettings(
  tier: AppsTier,
  householdId: string,
): Promise<AppsSettingsSnapshot> {
  return requestJson(endpoint(tier, householdId), parseAppsSettingsSnapshot);
}
export function saveAppsSettings(
  snapshot: AppsSettingsSnapshot,
  decisions: Readonly<Record<string, AppsDecision>>,
): Promise<AppsSettingsMutation> {
  return requestJson(
    endpoint(snapshot.tier, snapshot.householdId),
    (value) => parseAppsSettingsMutation(value, snapshot, decisions),
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": snapshot.csrfToken,
      },
      body: JSON.stringify(buildAppsSettingsPayload(snapshot, decisions)),
    },
  );
}

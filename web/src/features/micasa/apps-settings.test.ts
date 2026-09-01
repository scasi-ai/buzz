import assert from "node:assert/strict";
import test from "node:test";
import {
  type AppsDecision,
  AppsSettingsContractError,
  buildAppsSettingsPayload,
  parseAppsSettingsMutation,
  parseAppsSettingsSnapshot,
} from "./apps-settings.ts";

const csrfToken = `csrf_${"a".repeat(40)}`;
const catalogDigest = "b".repeat(64);
const effects = [
  "DECISIONS_UPDATED",
  "SERVICE_GRANTS_UNCHANGED",
  "CREDENTIALS_UNCHANGED",
  "HOUSEHOLD_PRIVATE_BOUNDARY_PRESERVED",
];

function cards(tier = "HOUSEHOLD") {
  return [
    {
      serviceId: "google-calendar",
      displayName: "Google Calendar",
      category: "MAIL_CALENDAR_CONTACTS_TASKS",
      placement: tier === "HOUSEHOLD" ? "DEDICATED_OR_SHARED" : "PRIVATE",
      catalogStatus: "PREVIEW",
      routeKinds: ["HOSTED_MCP", "DIRECT_API"],
      connectEnabled: false,
      decision: "NOT_NOW",
      authorizationStatus: "NOT_CONNECTED",
      resourceStatus: "SELECTION_REQUIRED",
      syncStatus: "NOT_STARTED",
      operationStatus: "BLOCKED",
      providerConnectionId: null,
      serviceGrantId: null,
      consentReceiptId: null,
      audience: [tier === "HOUSEHOLD" ? "HOUSEHOLD" : "SELF"],
      selectedResourceIds: [],
      details: "Calendar access is reviewed separately from this preference.",
    },
    {
      serviceId: "apple-home",
      displayName: "Apple Home",
      category: "HOME_DEVICES",
      placement: tier === "HOUSEHOLD" ? "HOUSEHOLD" : "PRIVATE",
      catalogStatus: "COMING_LATER",
      routeKinds: ["DEVICE_BRIDGE"],
      connectEnabled: false,
      decision: "ACKNOWLEDGED_UNAVAILABLE",
      authorizationStatus: "NOT_CONNECTED",
      resourceStatus: "SELECTION_REQUIRED",
      syncStatus: "NOT_STARTED",
      operationStatus: "BLOCKED",
      providerConnectionId: null,
      serviceGrantId: null,
      consentReceiptId: null,
      audience: [tier === "HOUSEHOLD" ? "HOUSEHOLD" : "SELF"],
      selectedResourceIds: [],
      details: "This integration is not available yet.",
    },
  ];
}
function snapshot(tier = "HOUSEHOLD", overrides = {}) {
  return {
    state: "EDITABLE",
    surface: "SETTINGS",
    tier,
    householdId: "household-one",
    catalogVersion: "1.0.0",
    catalogDigest,
    catalogTotalCards: 83,
    applicableCardCount: 2,
    decisionRevision: 4,
    csrfToken,
    cards: cards(tier),
    ...overrides,
  };
}
function decisions(overrides = {}) {
  return {
    "google-calendar": "NOT_APPLICABLE",
    "apple-home": "ACKNOWLEDGED_UNAVAILABLE",
    ...overrides,
  };
}
function mutation(before, requested, overrides = {}) {
  return {
    state: "UPDATED",
    surface: "SETTINGS",
    tier: before.tier,
    operation: {
      operationId: "operation-app-settings",
      idempotencyKey: `micasa-app-settings:${"c".repeat(64)}`,
      operation:
        before.tier === "HOUSEHOLD"
          ? "UPDATE_HOUSEHOLD_APPS_SETTINGS"
          : "UPDATE_PRIVATE_APPS_SETTINGS",
      retrySafe: true,
      mutationPossible: false,
      nextAction: "REFRESH_APPS_SETTINGS",
      policyRevision: 8,
      readbackAt: 1000,
      effects,
    },
    readback: {
      ...before,
      decisionRevision: before.decisionRevision + 1,
      cards: before.cards.map((card) => ({
        ...card,
        decision: requested[card.serviceId],
      })),
    },
    ...overrides,
  };
}

test("parses reviewed household decisions on the settings surface", () => {
  const parsed = parseAppsSettingsSnapshot(snapshot());
  assert.equal(parsed.surface, "SETTINGS");
  assert.equal(parsed.tier, "HOUSEHOLD");
  assert.equal(parsed.catalogTotalCards, 83);
  assert.deepEqual(
    parsed.cards.map((card) => card.serviceId),
    ["google-calendar", "apple-home"],
  );
});
test("parses private settings only with private card placement", () => {
  const parsed = parseAppsSettingsSnapshot(snapshot("PRIVATE"));
  assert.equal(parsed.tier, "PRIVATE");
  assert.ok(parsed.cards.every((card) => card.placement === "PRIVATE"));
});
test("projects explicit connector maturity and blocked runtime state", () => {
  const parsed = parseAppsSettingsSnapshot(snapshot());
  assert.deepEqual(parsed.cards[0].routeKinds, ["HOSTED_MCP", "DIRECT_API"]);
  assert.equal(parsed.cards[0].authorizationStatus, "NOT_CONNECTED");
  assert.equal(parsed.cards[0].resourceStatus, "SELECTION_REQUIRED");
  assert.equal(parsed.cards[0].syncStatus, "NOT_STARTED");
  assert.equal(parsed.cards[0].operationStatus, "BLOCKED");
  assert.deepEqual(parsed.cards[0].audience, ["HOUSEHOLD"]);
  assert.equal(parsed.cards[0].serviceGrantId, null);
});
test("rejects fake grants and readiness on unavailable cards", () => {
  const value = snapshot();
  value.cards[0] = {
    ...value.cards[0],
    authorizationStatus: "CONNECTED",
    resourceStatus: "SELECTED",
    syncStatus: "READY",
    operationStatus: "ADMITTED",
    providerConnectionId: "connection-one",
    serviceGrantId: "grant-one",
    consentReceiptId: "receipt-one",
    selectedResourceIds: ["calendar-one"],
  };
  assert.throws(
    () => parseAppsSettingsSnapshot(value),
    AppsSettingsContractError,
  );
});
test("rejects Household audience in private connector state", () => {
  const value = snapshot("PRIVATE");
  value.cards[0] = { ...value.cards[0], audience: ["HOUSEHOLD"] };
  assert.throws(
    () => parseAppsSettingsSnapshot(value),
    AppsSettingsContractError,
  );
});
test("rejects relay, operator, grant, and credential fields", () => {
  for (const field of [
    "relayHostname",
    "operatorToken",
    "serviceGrants",
    "credentials",
  ]) {
    assert.throws(
      () => parseAppsSettingsSnapshot({ ...snapshot(), [field]: "secret" }),
      AppsSettingsContractError,
    );
  }
});
test("rejects onboarding and unreviewed states from settings", () => {
  assert.throws(
    () =>
      parseAppsSettingsSnapshot({ ...snapshot(), state: "REVIEW_REQUIRED" }),
    AppsSettingsContractError,
  );
  const value = snapshot();
  value.cards = cards().map((card, index) => ({
    ...card,
    decision: index === 0 ? "UNREVIEWED" : card.decision,
  }));
  assert.throws(
    () => parseAppsSettingsSnapshot(value),
    AppsSettingsContractError,
  );
});
test("rejects tier substitution and incomplete catalog authority", () => {
  assert.throws(
    () =>
      parseAppsSettingsSnapshot({
        ...snapshot("HOUSEHOLD"),
        tier: "PRIVATE",
      }),
    AppsSettingsContractError,
  );
  assert.throws(
    () =>
      parseAppsSettingsSnapshot({
        ...snapshot(),
        catalogTotalCards: 82,
      }),
    AppsSettingsContractError,
  );
});
test("builds an exact revision-bound decision-only payload", () => {
  const before = parseAppsSettingsSnapshot(snapshot());
  assert.deepEqual(buildAppsSettingsPayload(before, decisions()), {
    expectedRevision: 4,
    decisions: [
      { serviceId: "google-calendar", decision: "NOT_APPLICABLE" },
      {
        serviceId: "apple-home",
        decision: "ACKNOWLEDGED_UNAVAILABLE",
      },
    ],
  });
});
test("refuses unsupported Connect Now and unreviewed decisions", () => {
  const before = parseAppsSettingsSnapshot(snapshot());
  for (const value of ["CONNECT_NOW", "UNREVIEWED"] as AppsDecision[]) {
    assert.throws(
      () =>
        buildAppsSettingsPayload(
          before,
          decisions({ "google-calendar": value }),
        ),
      Error,
    );
  }
});
test("accepts exact Household Apps & Data verified readback", () => {
  const before = parseAppsSettingsSnapshot(snapshot());
  const requested = decisions();
  const parsed = parseAppsSettingsMutation(
    mutation(before, requested),
    before,
    requested,
  );
  assert.equal(parsed.operation.operation, "UPDATE_HOUSEHOLD_APPS_SETTINGS");
  assert.equal(parsed.operation.mutationPossible, false);
});
test("accepts exact private Apps & Data verified readback", () => {
  const before = parseAppsSettingsSnapshot(snapshot("PRIVATE"));
  const requested = decisions();
  const parsed = parseAppsSettingsMutation(
    mutation(before, requested),
    before,
    requested,
  );
  assert.equal(parsed.operation.operation, "UPDATE_PRIVATE_APPS_SETTINGS");
  assert.equal(parsed.readback.tier, "PRIVATE");
});
test("rejects an uncertain operation or changed grant boundary", () => {
  const before = parseAppsSettingsSnapshot(snapshot());
  const requested = decisions();
  for (const operationPatch of [
    { mutationPossible: true },
    { nextAction: "CONNECT_SERVICE" },
    { effects: effects.slice(0, -1) },
    { effects: [...effects, "SERVICE_CONNECTED"] },
  ]) {
    const value = mutation(before, requested);
    value.operation = { ...value.operation, ...operationPatch };
    assert.throws(
      () => parseAppsSettingsMutation(value, before, requested),
      AppsSettingsContractError,
    );
  }
});
test("rejects scope, household, catalog, and revision drift", () => {
  const before = parseAppsSettingsSnapshot(snapshot());
  const requested = decisions();
  const mutations = [
    { ...mutation(before, requested), tier: "PRIVATE" },
    {
      ...mutation(before, requested),
      readback: {
        ...mutation(before, requested).readback,
        householdId: "household-two",
      },
    },
    {
      ...mutation(before, requested),
      readback: {
        ...mutation(before, requested).readback,
        catalogDigest: "d".repeat(64),
      },
    },
    {
      ...mutation(before, requested),
      readback: {
        ...mutation(before, requested).readback,
        decisionRevision: before.decisionRevision + 2,
      },
    },
  ];
  for (const value of mutations) {
    assert.throws(
      () => parseAppsSettingsMutation(value, before, requested),
      AppsSettingsContractError,
    );
  }
});
test("rejects connector-state drift during a decision-only mutation", () => {
  const before = parseAppsSettingsSnapshot(snapshot());
  const requested = decisions();
  const changed = mutation(before, requested);
  changed.readback.cards[0] = {
    ...changed.readback.cards[0],
    routeKinds: ["DIRECT_API"],
  };
  assert.throws(
    () => parseAppsSettingsMutation(changed, before, requested),
    AppsSettingsContractError,
  );
});
test("rejects card order or decision readback drift", () => {
  const before = parseAppsSettingsSnapshot(snapshot());
  const requested = decisions();
  const reversed = mutation(before, requested);
  reversed.readback.cards = [...reversed.readback.cards].reverse();
  assert.throws(
    () => parseAppsSettingsMutation(reversed, before, requested),
    AppsSettingsContractError,
  );
  const changed = mutation(before, requested);
  changed.readback.cards[0] = {
    ...changed.readback.cards[0],
    decision: "NOT_NOW",
  };
  assert.throws(
    () => parseAppsSettingsMutation(changed, before, requested),
    AppsSettingsContractError,
  );
});
test("rejects extra mutation fields", () => {
  const before = parseAppsSettingsSnapshot(snapshot());
  const requested = decisions();
  assert.throws(
    () =>
      parseAppsSettingsMutation(
        { ...mutation(before, requested), accessToken: "secret" },
        before,
        requested,
      ),
    AppsSettingsContractError,
  );
});

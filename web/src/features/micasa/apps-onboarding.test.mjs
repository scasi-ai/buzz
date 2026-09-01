import assert from "node:assert/strict";
import test from "node:test";
import {
  AppsOnboardingContractError,
  buildAppsDecisionPayload,
  defaultReviewDecision,
  parseAppsReviewMutation,
  parseAppsReviewSnapshot,
} from "./apps-onboarding.ts";

const csrfToken = `csrf_${"a".repeat(40)}`;
function card(overrides = {}) {
  return {
    serviceId: "gmail",
    displayName: "Gmail",
    category: "MAIL_CALENDAR_CONTACTS_TASKS",
    placement: "DEDICATED_OR_SHARED",
    catalogStatus: "PREVIEW",
    connectEnabled: false,
    decision: "UNREVIEWED",
    details: "Mail actions remain independently scoped.",
    ...overrides,
  };
}
function snapshot(overrides = {}) {
  return {
    state: "REVIEW_REQUIRED",
    tier: "HOUSEHOLD",
    catalogVersion: "1.0",
    catalogDigest: "a".repeat(64),
    catalogTotalCards: 83,
    applicableCardCount: 2,
    decisionRevision: 4,
    csrfToken,
    cards: [
      card(),
      card({
        serviceId: "finance",
        displayName: "Financial aggregators",
        category: "LIFE_COMMERCE_FINANCE_GAMING_VEHICLES",
        placement: "PRIVATE_SHARE_ONLY",
        catalogStatus: "POLICY_BLOCKED",
        details: "Read-only evidence remains blocked pending review.",
      }),
    ],
    ...overrides,
  };
}
test("parses a complete applicable review projection", () => {
  const parsed = parseAppsReviewSnapshot(snapshot());
  assert.equal(parsed.catalogTotalCards, 83);
  assert.equal(parsed.cards.length, 2);
});
test("refuses transport and operator fields", () => {
  assert.throws(
    () => parseAppsReviewSnapshot({ ...snapshot(), relayUrl: "wss://hidden" }),
    AppsOnboardingContractError,
  );
  const value = snapshot();
  value.cards[0] = { ...value.cards[0], routeKinds: ["HOSTED_MCP"] };
  assert.throws(
    () => parseAppsReviewSnapshot(value),
    AppsOnboardingContractError,
  );
});
test("requires review state to match card decisions", () => {
  const value = snapshot({ state: "REVIEWED" });
  assert.throws(
    () => parseAppsReviewSnapshot(value),
    AppsOnboardingContractError,
  );
});
test("builds every decision in authoritative card order", () => {
  const parsed = parseAppsReviewSnapshot(snapshot());
  const payload = buildAppsDecisionPayload(parsed, {
    gmail: "NOT_NOW",
    finance: "ACKNOWLEDGED_UNAVAILABLE",
  });
  assert.deepEqual(payload.decisions, [
    { serviceId: "gmail", decision: "NOT_NOW" },
    { serviceId: "finance", decision: "ACKNOWLEDGED_UNAVAILABLE" },
  ]);
  assert.throws(
    () =>
      buildAppsDecisionPayload(parsed, {
        gmail: "CONNECT_NOW",
        finance: "ACKNOWLEDGED_UNAVAILABLE",
      }),
    AppsOnboardingContractError,
  );
});
test("chooses truthful category-level defaults", () => {
  const parsed = parseAppsReviewSnapshot(snapshot());
  assert.equal(defaultReviewDecision(parsed.cards[0]), "NOT_NOW");
  assert.equal(
    defaultReviewDecision(parsed.cards[1]),
    "ACKNOWLEDGED_UNAVAILABLE",
  );
});
test("accepts only verified decision readback", () => {
  const value = {
    state: "REVIEWED",
    tier: "HOUSEHOLD",
    decisionRevision: 5,
    operation: {
      operationId: "operation:apps",
      idempotencyKey: `micasa-apps-review:${"b".repeat(64)}`,
      state: "VERIFIED",
      retrySafe: true,
      mutationPossible: false,
      nextAction: "REVIEW_PRIVATE_APPS",
      policyRevision: 9,
      readbackAt: 2000,
    },
    decisions: [
      { serviceId: "gmail", decision: "NOT_NOW" },
      { serviceId: "finance", decision: "ACKNOWLEDGED_UNAVAILABLE" },
    ],
  };
  assert.equal(parseAppsReviewMutation(value).operation.state, "VERIFIED");
  value.operation.mutationPossible = true;
  assert.throws(
    () => parseAppsReviewMutation(value),
    AppsOnboardingContractError,
  );
});

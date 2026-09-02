import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGroupHouseholdAgentMutationRequest,
  groupHouseholdAgentPath,
} from "./group-household-agent.ts";
import { MiCasaContractError } from "./contracts.ts";

function settings(overrides = {}) {
  return {
    state: "READY",
    householdId: `tenant:${"1".repeat(64)}`,
    roomId: `conversation:group:${"2".repeat(64)}`,
    householdAgent: {
      id: `agent-instance:${"3".repeat(64)}`,
      displayName: "Hearth",
      avatarPath: "/api/micasa/v1/media/hearth",
    },
    included: false,
    canManage: true,
    membershipRevision: 8,
    policyRevision: 13,
    authorityDigest: "a".repeat(64),
    csrfToken: `csrf_${"b".repeat(48)}`,
    observedAt: 1_788_278_400,
    expiresAt: 1_788_278_520,
    ...overrides,
  };
}

test("builds canonical fail-closed add request", () => {
  const value = settings();
  const request = buildGroupHouseholdAgentMutationRequest(
    value,
    true,
    "group-agent-operation-0001",
  );
  assert.equal(request.method, "PUT");
  assert.equal(
    request.path,
    "/api/micasa/v1/households/" +
      value.householdId +
      "/rooms/" +
      value.roomId +
      "/household-agent",
  );
  assert.deepEqual(request.headers, {
    "Content-Type": "application/json",
    "X-CSRF-Token": value.csrfToken,
  });
  assert.equal(
    request.body,
    JSON.stringify({
      expectedAuthorityDigest: "a".repeat(64),
      expectedMembershipRevision: 8,
      expectedPolicyRevision: 13,
      idempotencyKey: "group-agent-operation-0001",
      policyAcknowledged: true,
    }),
  );
});

test("builds canonical removal request with retained-history acknowledgement", () => {
  const request = buildGroupHouseholdAgentMutationRequest(
    settings({ included: true }),
    false,
    "group-agent-operation-0002",
  );
  assert.equal(request.method, "DELETE");
  assert.equal(
    request.body,
    JSON.stringify({
      expectedAuthorityDigest: "a".repeat(64),
      expectedMembershipRevision: 8,
      expectedPolicyRevision: 13,
      historyBoundaryAcknowledged: true,
      idempotencyKey: "group-agent-operation-0002",
    }),
  );
});

test("refuses unauthorized, no-op, invalid route, and invalid operation requests", () => {
  for (const action of [
    () =>
      buildGroupHouseholdAgentMutationRequest(
        settings({ canManage: false }),
        true,
        "group-agent-operation-0001",
      ),
    () =>
      buildGroupHouseholdAgentMutationRequest(
        settings(),
        false,
        "group-agent-operation-0001",
      ),
    () => buildGroupHouseholdAgentMutationRequest(settings(), true, "short"),
    () => groupHouseholdAgentPath("../tenant", "room:valid"),
  ]) {
    assert.throws(action, MiCasaContractError);
  }
});

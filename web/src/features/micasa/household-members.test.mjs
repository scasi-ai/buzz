import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMemberCommandRequest,
  HouseholdMembersContractError,
  parseHouseholdMembersMutation,
  parseHouseholdMembersSnapshot,
} from "./household-members.ts";

const csrfToken = `csrf_${"a".repeat(40)}`;
function member(overrides = {}) {
  return {
    memberId: "member-active",
    displayName: "Alice",
    role: "MEMBER",
    lifecycle: "ACTIVE",
    personalAgentReadiness: "READY",
    configuredSharedRoomIds: ["room-household", "room-photos"],
    activeSharedRoomCount: 2,
    membershipRevision: 3,
    ...overrides,
  };
}
function snapshot(overrides = {}) {
  return {
    householdId: "household-one",
    policyRevision: 10,
    csrfToken,
    sharedRooms: [
      {
        roomId: "room-household",
        displayName: "Our household",
        kind: "HOUSEHOLD",
      },
      {
        roomId: "room-photos",
        displayName: "Photo planning",
        kind: "SHARED",
      },
    ],
    members: [
      member({
        memberId: "member-head",
        displayName: "Head",
        role: "HEAD",
        membershipRevision: 1,
      }),
      member(),
      member({
        memberId: "member-suspended",
        displayName: "Bob",
        role: "ADMIN",
        lifecycle: "SUSPENDED",
        personalAgentReadiness: "SUSPENDED",
        configuredSharedRoomIds: ["room-household"],
        activeSharedRoomCount: 0,
        membershipRevision: 4,
      }),
      member({
        memberId: "member-pending",
        displayName: "Pending",
        lifecycle: "PENDING",
        personalAgentReadiness: "RESERVED",
        configuredSharedRoomIds: ["room-household"],
        activeSharedRoomCount: 0,
        membershipRevision: 1,
      }),
    ],
    invitations: [
      {
        invitationId: "invite-current",
        pendingMemberId: "member-pending",
        recipientEmail: "pending@example.com",
        displayName: "Pending",
        role: "MEMBER",
        state: "ACTIVE",
        configuredSharedRoomIds: ["room-household"],
        personalAgentReserved: true,
        expiresAt: 2000,
        invitationRevision: 1,
        sharePath: "/invite/AbCdEfGhIjKlMnOp",
      },
    ],
    ...overrides,
  };
}
const effects = {
  SUSPEND_MEMBER: [
    "DIRECTORY_REVOKED",
    "RELAY_REVOKED",
    "ROOMS_REVOKED",
    "SESSIONS_REVOKED",
    "ACP_REVOKED",
    "CONNECTORS_BLOCKED",
    "HISTORY_RETAINED",
  ],
  REMOVE_MEMBER: [
    "DIRECTORY_REVOKED",
    "RELAY_REVOKED",
    "ROOMS_REVOKED",
    "SESSIONS_REVOKED",
    "ACP_REVOKED",
    "CONNECTORS_REVOKED",
    "DERIVED_ROSTERS_REMOVED",
    "HISTORY_RETAINED",
  ],
};
function mutation(operation = "SUSPEND_MEMBER", overrides = {}) {
  return {
    state: "VERIFIED",
    operation: {
      operationId: "operation-members",
      idempotencyKey: `micasa-members:${"b".repeat(64)}`,
      operation,
      retrySafe: true,
      mutationPossible: false,
      nextAction: "REFRESH_HOUSEHOLD_SETTINGS",
      policyRevision: 10,
      readbackAt: 1000,
      effects: effects[operation],
    },
    subjectId: "member-active",
    readback: snapshot(),
    ...overrides,
  };
}

test("parses the exact Head-safe Household Settings projection", () => {
  const parsed = parseHouseholdMembersSnapshot(snapshot());
  assert.equal(parsed.members.length, 4);
  assert.equal(parsed.invitations[0].personalAgentReserved, true);
});
test("refuses transport and another user's private-agent fields", () => {
  assert.throws(
    () =>
      parseHouseholdMembersSnapshot({
        ...snapshot(),
        relayUrl: "wss://hidden",
      }),
    HouseholdMembersContractError,
  );
  const value = snapshot();
  value.members[1] = { ...value.members[1], agentName: "private" };
  assert.throws(
    () => parseHouseholdMembersSnapshot(value),
    HouseholdMembersContractError,
  );
});
test("requires exactly one active Head of Household", () => {
  const value = snapshot();
  value.members[0] = { ...value.members[0], role: "ADMIN" };
  assert.throws(
    () => parseHouseholdMembersSnapshot(value),
    HouseholdMembersContractError,
  );
});
test("requires lifecycle and Personal Agent readiness to agree", () => {
  const value = snapshot();
  value.members[1] = {
    ...value.members[1],
    lifecycle: "SUSPENDED",
    personalAgentReadiness: "READY",
    activeSharedRoomCount: 0,
  };
  assert.throws(
    () => parseHouseholdMembersSnapshot(value),
    HouseholdMembersContractError,
  );
});
test("requires an active invitation to match its pending member", () => {
  const value = snapshot();
  value.invitations[0] = {
    ...value.invitations[0],
    displayName: "Different",
  };
  assert.throws(
    () => parseHouseholdMembersSnapshot(value),
    HouseholdMembersContractError,
  );
});
test("requires claim paths only for active invitations", () => {
  const value = snapshot();
  value.invitations[0] = {
    ...value.invitations[0],
    state: "REVOKED",
  };
  assert.throws(
    () => parseHouseholdMembersSnapshot(value),
    HouseholdMembersContractError,
  );
});
test("builds the Head-only invitation command with every shared room", () => {
  const parsed = parseHouseholdMembersSnapshot(snapshot());
  assert.deepEqual(
    buildMemberCommandRequest(parsed, {
      operation: "INVITE",
      recipientEmail: "new@example.com",
      displayName: "New member",
      role: "MEMBER",
      configuredSharedRoomIds: ["room-household", "room-photos"],
    }),
    {
      method: "POST",
      path: "/api/micasa/v1/settings/household/invitations",
      body: {
        expectedRevision: 10,
        recipientEmail: "new@example.com",
        displayName: "New member",
        role: "MEMBER",
        configuredSharedRoomIds: ["room-household", "room-photos"],
      },
    },
  );
});
test("builds update and lifecycle routes from authoritative revisions", () => {
  const parsed = parseHouseholdMembersSnapshot(snapshot());
  const update = buildMemberCommandRequest(parsed, {
    operation: "UPDATE_MEMBER",
    subjectId: "member-active",
    displayName: "Alice updated",
    role: "ADMIN",
    configuredSharedRoomIds: ["room-household"],
  });
  assert.equal(update.method, "PATCH");
  assert.equal(
    update.path,
    "/api/micasa/v1/settings/household/members/member-active",
  );
  assert.equal(update.body.expectedRevision, 3);
  const remove = buildMemberCommandRequest(parsed, {
    operation: "REMOVE_MEMBER",
    subjectId: "member-suspended",
  });
  assert.equal(
    remove.path,
    "/api/micasa/v1/settings/household/members/member-suspended/remove",
  );
  assert.equal(remove.body.expectedRevision, 4);
});
test("protects the Head from member mutation commands", () => {
  const parsed = parseHouseholdMembersSnapshot(snapshot());
  assert.throws(
    () =>
      buildMemberCommandRequest(parsed, {
        operation: "SUSPEND_MEMBER",
        subjectId: "member-head",
      }),
    HouseholdMembersContractError,
  );
});
test("accepts only complete verified lifecycle readback", () => {
  assert.equal(
    parseHouseholdMembersMutation(mutation()).operation.operation,
    "SUSPEND_MEMBER",
  );
  const incomplete = mutation();
  incomplete.operation.effects = incomplete.operation.effects.filter(
    (effect) => effect !== "ACP_REVOKED",
  );
  assert.throws(
    () => parseHouseholdMembersMutation(incomplete),
    HouseholdMembersContractError,
  );
});
test("refuses mutation-possible results and policy revision drift", () => {
  const uncertain = mutation();
  uncertain.operation.mutationPossible = true;
  assert.throws(
    () => parseHouseholdMembersMutation(uncertain),
    HouseholdMembersContractError,
  );
  const drift = mutation();
  drift.operation.policyRevision = 11;
  assert.throws(
    () => parseHouseholdMembersMutation(drift),
    HouseholdMembersContractError,
  );
});
test("accepts removed members only after rooms and agent are revoked", () => {
  const value = snapshot();
  value.members[1] = {
    ...value.members[1],
    lifecycle: "DELETED",
    personalAgentReadiness: "REVOKED",
    configuredSharedRoomIds: [],
    activeSharedRoomCount: 0,
    membershipRevision: 4,
  };
  const parsed = parseHouseholdMembersSnapshot(value);
  assert.equal(parsed.members[1].lifecycle, "DELETED");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  MiCasaContractError,
  parseGroupHouseholdAgentMutation,
  parseGroupHouseholdAgentSettings,
  parseMiCasaBootstrap,
  parseMiCasaLogout,
} from "./contracts.ts";

const viewerId = `tenant-member:${"1".repeat(64)}`;

function participant({
  subjectId,
  memberId,
  kind,
  displayName,
  nostrPubkey,
  avatarPath = null,
}) {
  return {
    subjectId,
    memberId,
    kind,
    displayName,
    nostrPubkey,
    avatarPath,
  };
}

const alex = participant({
  subjectId: viewerId,
  memberId: viewerId,
  kind: "HUMAN",
  displayName: "Alex",
  nostrPubkey: "a".repeat(64),
  avatarPath: "/api/micasa/v1/media/alex",
});
const juniper = participant({
  subjectId: "agent:personal",
  memberId: viewerId,
  kind: "PERSONAL_AGENT",
  displayName: "Juniper",
  nostrPubkey: "b".repeat(64),
  avatarPath: "/api/micasa/v1/media/juniper",
});
const mayaId = `tenant-member:${"2".repeat(64)}`;
const maya = participant({
  subjectId: mayaId,
  memberId: mayaId,
  kind: "HUMAN",
  displayName: "Maya",
  nostrPubkey: "c".repeat(64),
});
const spruce = participant({
  subjectId: "agent:maya",
  memberId: mayaId,
  kind: "PERSONAL_AGENT",
  displayName: "Spruce",
  nostrPubkey: "d".repeat(64),
});
const rowanId = `tenant-member:${"3".repeat(64)}`;
const rowan = participant({
  subjectId: rowanId,
  memberId: rowanId,
  kind: "HUMAN",
  displayName: "Rowan",
  nostrPubkey: "e".repeat(64),
});
const maple = participant({
  subjectId: "agent:rowan",
  memberId: rowanId,
  kind: "PERSONAL_AGENT",
  displayName: "Maple",
  nostrPubkey: "f".repeat(64),
});
const hearth = participant({
  subjectId: "agent:household",
  memberId: null,
  kind: "HOUSEHOLD_AGENT",
  displayName: "Hearth",
  nostrPubkey: "0".repeat(64),
  avatarPath: "/api/micasa/v1/media/hearth",
});

function ready() {
  const household = {
    id: `tenant:${"4".repeat(64)}`,
    name: "River House",
    role: "HEAD",
  };
  return {
    state: "READY",
    viewer: { id: viewerId, displayName: "Alex" },
    csrfToken: `csrf_${"a".repeat(48)}`,
    households: [household],
    activeHousehold: {
      ...household,
      rooms: [
        {
          id: "room:household",
          name: "Household",
          kind: "HOUSEHOLD",
          participants: [alex, juniper, maya, spruce, rowan, maple, hearth],
          householdAgentExplicitlyAdded: false,
        },
        {
          id: "room:my-agent",
          name: "My Agent",
          kind: "PERSONAL_AGENT",
          participants: [alex, juniper],
          householdAgentExplicitlyAdded: false,
        },
        {
          id: "room:family",
          name: "Family",
          kind: "GROUP",
          participants: [alex, juniper, maya, spruce, rowan, maple],
          householdAgentExplicitlyAdded: false,
        },
      ],
      activeRoomId: "room:family",
      householdAgent: {
        id: "agent:household",
        displayName: "Hearth",
        readiness: "READY",
        avatarPath: "/api/micasa/v1/media/hearth",
      },
      personalAgent: {
        id: "agent:personal",
        displayName: "Juniper",
        readiness: "READY",
        avatarPath: "/api/micasa/v1/media/juniper",
      },
    },
  };
}

test("parses tenant-chosen human, personal-agent, and household-agent profiles", () => {
  const parsed = parseMiCasaBootstrap(ready());
  assert.equal(parsed.state, "READY");
  const room = parsed.activeHousehold.rooms[2];
  assert.deepEqual(
    room.participants.map((item) => [item.displayName, item.kind]),
    [
      ["Alex", "HUMAN"],
      ["Juniper", "PERSONAL_AGENT"],
      ["Maya", "HUMAN"],
      ["Spruce", "PERSONAL_AGENT"],
      ["Rowan", "HUMAN"],
      ["Maple", "PERSONAL_AGENT"],
    ],
  );
  assert.equal(room.participants[0].avatarPath, "/api/micasa/v1/media/alex");
  assert.equal(parsed.csrfToken, `csrf_${"a".repeat(48)}`);
});

test("READY bootstrap requires a shaped sign-out CSRF token", () => {
  for (const csrfToken of [undefined, "short", "csrf contains spaces"]) {
    const value = ready();
    value.csrfToken = csrfToken;
    assert.throws(() => parseMiCasaBootstrap(value), MiCasaContractError);
  }
});

test("parses exact, reconciled logout readbacks", () => {
  assert.deepEqual(
    parseMiCasaLogout({
      state: "SIGNED_OUT",
      serverSessionState: "ABSENT",
      operationId: null,
      destinationPath: "/",
    }),
    {
      state: "SIGNED_OUT",
      serverSessionState: "ABSENT",
      operationId: null,
      destinationPath: "/",
    },
  );
  assert.equal(
    parseMiCasaLogout({
      state: "SIGNED_OUT",
      serverSessionState: "REVOKED",
      operationId: "session-logout-operation",
      destinationPath: "/",
    }).operationId,
    "session-logout-operation",
  );
});

test("refuses contradictory, unsafe, or over-broad logout readbacks", () => {
  for (const value of [
    {
      state: "SIGNED_OUT",
      serverSessionState: "ABSENT",
      operationId: "unexpected-operation",
      destinationPath: "/",
    },
    {
      state: "SIGNED_OUT",
      serverSessionState: "REVOKED",
      operationId: null,
      destinationPath: "/",
    },
    {
      state: "SIGNED_OUT",
      serverSessionState: "ABSENT",
      operationId: null,
      destinationPath: "https://attacker.example/",
    },
    {
      state: "SIGNED_OUT",
      serverSessionState: "ABSENT",
      operationId: null,
      destinationPath: "/",
      sessionSecret: "must-never-cross-the-boundary",
    },
  ]) {
    assert.throws(() => parseMiCasaLogout(value), MiCasaContractError);
  }
});

test("groups require at least three humans and one Personal Agent per human", () => {
  for (const participants of [
    [alex, juniper, maya, spruce],
    [alex, juniper, maya, spruce, rowan],
  ]) {
    const value = ready();
    value.activeHousehold.rooms[2].participants = participants;
    assert.throws(() => parseMiCasaBootstrap(value), MiCasaContractError);
  }
});

test("DMs require exactly two humans and both Personal Agents", () => {
  const value = ready();
  value.activeHousehold.rooms[2] = {
    id: "room:dm",
    name: "Alex and Maya",
    kind: "DM",
    participants: [alex, juniper, maya, spruce],
    householdAgentExplicitlyAdded: false,
  };
  value.activeHousehold.activeRoomId = "room:dm";
  assert.doesNotThrow(() => parseMiCasaBootstrap(value));
  value.activeHousehold.rooms[2].participants.pop();
  assert.throws(() => parseMiCasaBootstrap(value), MiCasaContractError);
});

test("duplicate signed identities and unproven Household Agents are refused", () => {
  const duplicate = ready();
  duplicate.activeHousehold.rooms[2].participants[5] = {
    ...maple,
    nostrPubkey: juniper.nostrPubkey,
  };
  assert.throws(() => parseMiCasaBootstrap(duplicate), MiCasaContractError);

  const householdAgent = ready();
  householdAgent.activeHousehold.rooms[2].participants.push(hearth);
  assert.throws(
    () => parseMiCasaBootstrap(householdAgent),
    MiCasaContractError,
  );
});

test("a group accepts one explicitly authorized Household Agent", () => {
  const value = ready();
  value.activeHousehold.rooms[2].participants.push(hearth);
  value.activeHousehold.rooms[2].householdAgentExplicitlyAdded = true;
  const parsed = parseMiCasaBootstrap(value);
  assert.equal(
    parsed.activeHousehold.rooms[2].participants.at(-1)?.displayName,
    "Hearth",
  );

  const missingAgent = ready();
  missingAgent.activeHousehold.rooms[2].householdAgentExplicitlyAdded = true;
  assert.throws(() => parseMiCasaBootstrap(missingAgent), MiCasaContractError);
});

test("every visible room must contain the viewer and the viewer's Personal Agent", () => {
  const value = ready();
  value.activeHousehold.rooms[2].participants = [
    maya,
    spruce,
    rowan,
    maple,
    participant({
      subjectId: `tenant-member:${"5".repeat(64)}`,
      memberId: `tenant-member:${"5".repeat(64)}`,
      kind: "HUMAN",
      displayName: "Taylor",
      nostrPubkey: "5".repeat(64),
    }),
    participant({
      subjectId: "agent:taylor",
      memberId: `tenant-member:${"5".repeat(64)}`,
      kind: "PERSONAL_AGENT",
      displayName: "Cedar",
      nostrPubkey: "6".repeat(64),
    }),
  ];
  assert.throws(() => parseMiCasaBootstrap(value), MiCasaContractError);
});

test("room agent names must match the authoritative profile summaries", () => {
  for (const mutate of [
    (value) => {
      value.activeHousehold.personalAgent.displayName = "Wrong Personal Name";
    },
    (value) => {
      value.activeHousehold.householdAgent.displayName = "Wrong Household Name";
    },
  ]) {
    const value = ready();
    mutate(value);
    assert.throws(() => parseMiCasaBootstrap(value), MiCasaContractError);
  }
});

test("participant avatars are same-origin MiCasa media paths only", () => {
  for (const avatarPath of [
    "https://tracker.example/avatar.png",
    "//tracker.example/avatar.png",
    "/other/avatar.png",
  ]) {
    const value = ready();
    value.activeHousehold.rooms[2].participants[0] = {
      ...alex,
      avatarPath,
    };
    assert.throws(() => parseMiCasaBootstrap(value), MiCasaContractError);
  }
});

test("a pending human signer may be null but every agent key is mandatory", () => {
  const pendingHuman = ready();
  for (const room of pendingHuman.activeHousehold.rooms) {
    room.participants = room.participants.map((item) =>
      item.subjectId === viewerId ? { ...item, nostrPubkey: null } : item,
    );
  }
  assert.doesNotThrow(() => parseMiCasaBootstrap(pendingHuman));

  const missingAgent = ready();
  missingAgent.activeHousehold.rooms[2].participants[5] = {
    ...maple,
    nostrPubkey: null,
  };
  assert.throws(() => parseMiCasaBootstrap(missingAgent), MiCasaContractError);
});

test("agent summary avatars are safe and must match the room profile", () => {
  const unsafe = ready();
  unsafe.activeHousehold.personalAgent.avatarPath =
    "https://tracker.example/juniper.png";
  assert.throws(() => parseMiCasaBootstrap(unsafe), MiCasaContractError);

  const drift = ready();
  drift.activeHousehold.personalAgent.avatarPath =
    "/api/micasa/v1/media/different";
  assert.throws(() => parseMiCasaBootstrap(drift), MiCasaContractError);
});

function groupHouseholdAgentSettings(overrides = {}) {
  return {
    state: "READY",
    householdId: `tenant:${"4".repeat(64)}`,
    roomId: `conversation:group:${"5".repeat(64)}`,
    householdAgent: {
      id: `agent-instance:${"6".repeat(64)}`,
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

function groupHouseholdAgentMutation(overrides = {}) {
  const readback = groupHouseholdAgentSettings({
    included: true,
    membershipRevision: 9,
    authorityDigest: "c".repeat(64),
  });
  return {
    state: "VERIFIED",
    operation: {
      operationId: `operation:${"7".repeat(64)}`,
      operation: "ADD_HOUSEHOLD_AGENT",
      idempotencyKey: "group-agent-operation-0001",
      auditEventId: `audit-event:${"8".repeat(64)}`,
      effects: [
        "ACP_ROOM_AUTHORITY_REVISED",
        "AUDIT_EVENT_APPENDED",
        "BOOTSTRAP_READ_MODEL_REBUILT",
        "BUZZ_CHANNEL_MEMBERSHIP_RECONCILED",
        "HOUSEHOLD_AGENT_ADDED",
        "NOSTR_ROOM_AUTHORITY_REVISED",
        "PA_ROOM_MEMBERSHIP_COMMITTED",
      ],
      retrySafe: true,
      mutationPossible: false,
    },
    readback,
    ...overrides,
  };
}

test("parses safe Group Household Agent controls", () => {
  const parsed = parseGroupHouseholdAgentSettings(
    groupHouseholdAgentSettings(),
  );
  assert.equal(parsed.householdAgent.displayName, "Hearth");
  assert.equal(parsed.included, false);
  assert.equal(parsed.canManage, true);
  assert.equal(parsed.membershipRevision, 8);
});

test("Group Household Agent controls reject stale or unsafe authority", () => {
  for (const value of [
    groupHouseholdAgentSettings({ expiresAt: 1_788_278_400 }),
    groupHouseholdAgentSettings({ authorityDigest: "not-a-digest" }),
    groupHouseholdAgentSettings({ csrfToken: "short" }),
    groupHouseholdAgentSettings({
      householdAgent: {
        id: `agent-instance:${"6".repeat(64)}`,
        displayName: "Hearth",
        avatarPath: "https://internal.example/avatar",
      },
    }),
  ]) {
    assert.throws(
      () => parseGroupHouseholdAgentSettings(value),
      MiCasaContractError,
    );
  }
});

test("parses verified group mutation and rejects incomplete or contradictory receipts", () => {
  const parsed = parseGroupHouseholdAgentMutation(
    groupHouseholdAgentMutation(),
  );
  assert.equal(parsed.operation.operation, "ADD_HOUSEHOLD_AGENT");
  assert.equal(parsed.readback.included, true);

  const missingEffect = groupHouseholdAgentMutation();
  missingEffect.operation.effects.pop();
  assert.throws(
    () => parseGroupHouseholdAgentMutation(missingEffect),
    MiCasaContractError,
  );

  const contradictory = groupHouseholdAgentMutation({
    readback: groupHouseholdAgentSettings({ included: false }),
  });
  assert.throws(
    () => parseGroupHouseholdAgentMutation(contradictory),
    MiCasaContractError,
  );
});

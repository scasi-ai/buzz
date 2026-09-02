import { isAllowedMiCasaOrigin } from "./origin-policy.ts";

export class HouseholdMembersContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HouseholdMembersContractError";
  }
}

export type ManagedMemberRole = "HEAD" | "ADMIN" | "MEMBER";
export type MemberLifecycle = "PENDING" | "ACTIVE" | "SUSPENDED" | "DELETED";
export type PersonalAgentReadiness =
  | "RESERVED"
  | "READY"
  | "SUSPENDED"
  | "REVOKED";
export type SharedRoom = {
  roomId: string;
  displayName: string;
  kind: "HOUSEHOLD" | "GROUP";
};
export type SharedCapability = {
  capabilityId: string;
  displayName: string;
};
export type ManagedMember = {
  memberId: string;
  displayName: string;
  role: ManagedMemberRole;
  lifecycle: MemberLifecycle;
  personalAgentReadiness: PersonalAgentReadiness;
  configuredSharedRoomIds: string[];
  activeSharedRoomCount: number;
  configuredCapabilityIds: string[];
  activeCapabilityCount: number;
  membershipRevision: number;
};
export type ManagedInvitation = {
  invitationId: string;
  pendingMemberId: string;
  recipientEmail: string;
  displayName: string;
  role: Exclude<ManagedMemberRole, "HEAD">;
  state: "ACTIVE" | "CLAIMED" | "EXPIRED" | "REVOKED";
  configuredSharedRoomIds: string[];
  configuredCapabilityIds: string[];
  personalAgentReserved: true;
  expiresAt: number;
  invitationRevision: number;
  sharePath?: string;
};
export type HouseholdMembersSnapshot = {
  householdId: string;
  policyRevision: number;
  csrfToken: string;
  sharedRooms: SharedRoom[];
  sharedCapabilities: SharedCapability[];
  members: ManagedMember[];
  invitations: ManagedInvitation[];
};
export type MemberOperation =
  | "INVITE"
  | "REISSUE_INVITATION"
  | "REVOKE_INVITATION"
  | "UPDATE_MEMBER"
  | "SUSPEND_MEMBER"
  | "REACTIVATE_MEMBER"
  | "REMOVE_MEMBER";
export type HouseholdMembersMutation = {
  state: "VERIFIED";
  operation: {
    operationId: string;
    idempotencyKey: string;
    operation: MemberOperation;
    retrySafe: true;
    mutationPossible: false;
    nextAction: "REFRESH_HOUSEHOLD_SETTINGS";
    policyRevision: number;
    readbackAt: number;
    effects: string[];
  };
  subjectId: string;
  readback: HouseholdMembersSnapshot;
};

export type MemberCommand =
  | {
      operation: "INVITE";
      recipientEmail: string;
      displayName: string;
      role: "ADMIN" | "MEMBER";
      configuredSharedRoomIds: string[];
      configuredCapabilityIds: string[];
    }
  | {
      operation: "UPDATE_MEMBER";
      subjectId: string;
      displayName: string;
      role: "ADMIN" | "MEMBER";
      configuredSharedRoomIds: string[];
      configuredCapabilityIds: string[];
    }
  | {
      operation:
        | "REISSUE_INVITATION"
        | "REVOKE_INVITATION"
        | "SUSPEND_MEMBER"
        | "REACTIVATE_MEMBER"
        | "REMOVE_MEMBER";
      subjectId: string;
    };

type JsonObject = Record<string, unknown>;
const API_PREFIX = "/api/micasa/v1";
const MEMBERS_PATH = `${API_PREFIX}/settings/household/members`;
const INVITATIONS_PATH = `${API_PREFIX}/settings/household/invitations`;
const REQUEST_TIMEOUT_MS = 15_000;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const CSRF = /^[A-Za-z0-9_-]{32,256}$/;
const EMAIL =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const OPERATIONS: MemberOperation[] = [
  "INVITE",
  "REISSUE_INVITATION",
  "REVOKE_INVITATION",
  "UPDATE_MEMBER",
  "SUSPEND_MEMBER",
  "REACTIVATE_MEMBER",
  "REMOVE_MEMBER",
];
const EFFECTS: Record<MemberOperation, readonly string[]> = {
  INVITE: [
    "PENDING_MEMBERSHIP_CREATED",
    "PERSONAL_AGENT_RESERVED",
    "INVITATION_ACTIVE",
  ],
  REISSUE_INVITATION: ["PRIOR_CLAIM_REVOKED", "INVITATION_REISSUED"],
  REVOKE_INVITATION: [
    "INVITATION_REVOKED",
    "PENDING_MEMBERSHIP_TOMBSTONED",
    "PERSONAL_AGENT_RESERVATION_REVOKED",
  ],
  UPDATE_MEMBER: ["MEMBERSHIP_POLICY_UPDATED", "DERIVED_ROSTERS_RECONCILED"],
  SUSPEND_MEMBER: [
    "DIRECTORY_REVOKED",
    "RELAY_REVOKED",
    "ROOMS_REVOKED",
    "SESSIONS_REVOKED",
    "ACP_REVOKED",
    "CONNECTORS_BLOCKED",
    "HISTORY_RETAINED",
  ],
  REACTIVATE_MEMBER: [
    "DIRECTORY_RESTORED",
    "RELAY_REAUTHORIZED",
    "ROOMS_RESTORED",
    "SESSIONS_REQUIRE_REAUTH",
    "ACP_RESTORED",
    "CONNECTORS_REQUIRE_REAUTH",
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

function fail(message: string): never {
  throw new HouseholdMembersContractError(message);
}
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
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
function text(
  record: JsonObject,
  key: string,
  label: string,
  maximum = 256,
): string {
  const value = record[key];
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.trim() ||
    hasControlCharacter(value)
  ) {
    fail(`${label}.${key} must be safe text.`);
  }
  return value;
}
function ref(record: JsonObject, key: string, label: string): string {
  const value = text(record, key, label);
  if (!REF.test(value)) fail(`${label}.${key} is invalid.`);
  return value;
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
function refs(
  value: unknown,
  available: readonly string[],
  label: string,
  requireHousehold: string | null,
): string[] {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  if (
    value.some((item) => typeof item !== "string") ||
    new Set(value).size !== value.length ||
    value.some((item) => !available.includes(item as string))
  ) {
    fail(`${label} is invalid.`);
  }
  const result = value as string[];
  if (
    result.some(
      (item, index) =>
        item !== available.filter((id) => result.includes(id))[index],
    ) ||
    (requireHousehold !== null && !result.includes(requireHousehold))
  ) {
    fail(`${label} is not in authoritative room order.`);
  }
  return result;
}
function safePath(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/invite/") ||
    value.startsWith("//") ||
    value.includes("#") ||
    value.includes("\\")
  ) {
    fail(`${label} is unsafe.`);
  }
  return value;
}
function parseRoom(value: unknown, index: number): SharedRoom {
  const label = `members.sharedRooms[${index}]`;
  const record = object(value, label);
  exact(record, ["roomId", "displayName", "kind"], label);
  return {
    roomId: ref(record, "roomId", label),
    displayName: text(record, "displayName", label, 120),
    kind: choice(record.kind, ["HOUSEHOLD", "GROUP"] as const, `${label}.kind`),
  };
}
function parseCapability(value: unknown, index: number): SharedCapability {
  const label = `members.sharedCapabilities[${index}]`;
  const record = object(value, label);
  exact(record, ["capabilityId", "displayName"], label);
  return {
    capabilityId: ref(record, "capabilityId", label),
    displayName: text(record, "displayName", label, 120),
  };
}
function capabilityRefs(
  value: unknown,
  capabilities: SharedCapability[],
  label: string,
  requireNonempty: boolean,
): string[] {
  const result = refs(
    value,
    capabilities.map((capability) => capability.capabilityId),
    label,
    null,
  );
  if (requireNonempty && result.length === 0) {
    fail(`${label} must include at least one capability.`);
  }
  return result;
}
function parseMember(
  value: unknown,
  index: number,
  rooms: SharedRoom[],
  capabilities: SharedCapability[],
  householdRoomId: string,
): ManagedMember {
  const label = `members.members[${index}]`;
  const record = object(value, label);
  exact(
    record,
    [
      "memberId",
      "displayName",
      "role",
      "lifecycle",
      "personalAgentReadiness",
      "configuredSharedRoomIds",
      "activeSharedRoomCount",
      "configuredCapabilityIds",
      "activeCapabilityCount",
      "membershipRevision",
    ],
    label,
  );
  const lifecycle = choice(
    record.lifecycle,
    ["PENDING", "ACTIVE", "SUSPENDED", "DELETED"] as const,
    `${label}.lifecycle`,
  );
  const readiness = choice(
    record.personalAgentReadiness,
    ["RESERVED", "READY", "SUSPENDED", "REVOKED"] as const,
    `${label}.personalAgentReadiness`,
  );
  const expectedReadiness: Record<MemberLifecycle, PersonalAgentReadiness> = {
    PENDING: "RESERVED",
    ACTIVE: "READY",
    SUSPENDED: "SUSPENDED",
    DELETED: "REVOKED",
  };
  if (readiness !== expectedReadiness[lifecycle]) {
    fail(`${label} has contradictory Personal Agent readiness.`);
  }
  const available = rooms.map((room) => room.roomId);
  const configured = refs(
    record.configuredSharedRoomIds,
    available,
    `${label}.configuredSharedRoomIds`,
    lifecycle === "DELETED" ? null : householdRoomId,
  );
  const activeCount = record.activeSharedRoomCount;
  if (
    !Number.isSafeInteger(activeCount) ||
    (activeCount as number) < 0 ||
    (activeCount as number) > configured.length ||
    (lifecycle === "ACTIVE" && activeCount !== configured.length) ||
    (lifecycle !== "ACTIVE" && activeCount !== 0)
  ) {
    fail(`${label} has contradictory active room membership.`);
  }
  const configuredCapabilities = capabilityRefs(
    record.configuredCapabilityIds,
    capabilities,
    `${label}.configuredCapabilityIds`,
    lifecycle !== "DELETED",
  );
  const activeCapabilityCount = record.activeCapabilityCount;
  if (
    !Number.isSafeInteger(activeCapabilityCount) ||
    (activeCapabilityCount as number) < 0 ||
    (activeCapabilityCount as number) > configuredCapabilities.length ||
    (lifecycle === "ACTIVE" &&
      activeCapabilityCount !== configuredCapabilities.length) ||
    (lifecycle !== "ACTIVE" && activeCapabilityCount !== 0)
  ) {
    fail(`${label} has contradictory active capability access.`);
  }
  if (lifecycle === "DELETED" && configured.length !== 0) {
    fail(`${label} retains rooms after removal.`);
  }
  if (lifecycle === "DELETED" && configuredCapabilities.length !== 0) {
    fail(`${label} retains capabilities after removal.`);
  }
  return {
    memberId: ref(record, "memberId", label),
    displayName: text(record, "displayName", label, 120),
    role: choice(
      record.role,
      ["HEAD", "ADMIN", "MEMBER"] as const,
      `${label}.role`,
    ),
    lifecycle,
    personalAgentReadiness: readiness,
    configuredSharedRoomIds: configured,
    activeSharedRoomCount: activeCount as number,
    configuredCapabilityIds: configuredCapabilities,
    activeCapabilityCount: activeCapabilityCount as number,
    membershipRevision: positive(record, "membershipRevision", label),
  };
}
function parseInvitation(
  value: unknown,
  index: number,
  rooms: SharedRoom[],
  capabilities: SharedCapability[],
  householdRoomId: string,
  members: ManagedMember[],
): ManagedInvitation {
  const label = `members.invitations[${index}]`;
  const record = object(value, label);
  const hasPath = Object.hasOwn(record, "sharePath");
  exact(
    record,
    [
      "invitationId",
      "pendingMemberId",
      "recipientEmail",
      "displayName",
      "role",
      "state",
      "configuredSharedRoomIds",
      "configuredCapabilityIds",
      "personalAgentReserved",
      "expiresAt",
      "invitationRevision",
      ...(hasPath ? ["sharePath"] : []),
    ],
    label,
  );
  const state = choice(
    record.state,
    ["ACTIVE", "CLAIMED", "EXPIRED", "REVOKED"] as const,
    `${label}.state`,
  );
  if (record.personalAgentReserved !== true) {
    fail(`${label} must reserve a Personal Agent.`);
  }
  const recipientEmail = text(record, "recipientEmail", label, 320);
  if (!EMAIL.test(recipientEmail)) fail(`${label}.recipientEmail is invalid.`);
  const configured = refs(
    record.configuredSharedRoomIds,
    rooms.map((room) => room.roomId),
    `${label}.configuredSharedRoomIds`,
    householdRoomId,
  );
  const pendingMemberId = ref(record, "pendingMemberId", label);
  const configuredCapabilities = capabilityRefs(
    record.configuredCapabilityIds,
    capabilities,
    `${label}.configuredCapabilityIds`,
    true,
  );
  const displayName = text(record, "displayName", label, 120);
  const role = choice(
    record.role,
    ["ADMIN", "MEMBER"] as const,
    `${label}.role`,
  );
  const pending = members.find((member) => member.memberId === pendingMemberId);
  if (
    state === "ACTIVE" &&
    (pending?.lifecycle !== "PENDING" ||
      pending.displayName !== displayName ||
      pending.role !== role ||
      JSON.stringify(pending.configuredSharedRoomIds) !==
        JSON.stringify(configured) ||
      JSON.stringify(pending.configuredCapabilityIds) !==
        JSON.stringify(configuredCapabilities))
  ) {
    fail(`${label} does not match its pending household member.`);
  }
  const sharePath = hasPath
    ? safePath(record.sharePath, `${label}.sharePath`)
    : undefined;
  if ((state === "ACTIVE") !== (sharePath !== undefined)) {
    fail(`${label} has contradictory claim-path state.`);
  }
  return {
    invitationId: ref(record, "invitationId", label),
    pendingMemberId,
    recipientEmail,
    displayName,
    role,
    state,
    configuredSharedRoomIds: configured,
    configuredCapabilityIds: configuredCapabilities,
    personalAgentReserved: true,
    expiresAt: positive(record, "expiresAt", label),
    invitationRevision: positive(record, "invitationRevision", label),
    ...(sharePath ? { sharePath } : {}),
  };
}

export function parseHouseholdMembersSnapshot(
  value: unknown,
): HouseholdMembersSnapshot {
  const record = object(value, "members");
  exact(
    record,
    [
      "householdId",
      "policyRevision",
      "csrfToken",
      "sharedRooms",
      "sharedCapabilities",
      "members",
      "invitations",
    ],
    "members",
  );
  if (
    !Array.isArray(record.sharedRooms) ||
    !Array.isArray(record.sharedCapabilities) ||
    !Array.isArray(record.members) ||
    !Array.isArray(record.invitations)
  ) {
    fail("Household Settings lists are invalid.");
  }
  const csrfToken = text(record, "csrfToken", "members");
  if (!CSRF.test(csrfToken)) fail("members.csrfToken is invalid.");
  const sharedRooms = record.sharedRooms.map(parseRoom);
  const sharedCapabilities = record.sharedCapabilities.map(parseCapability);
  const householdRooms = sharedRooms.filter(
    (room) => room.kind === "HOUSEHOLD",
  );
  if (
    householdRooms.length !== 1 ||
    new Set(sharedRooms.map((room) => room.roomId)).size !==
      sharedRooms.length ||
    new Set(sharedRooms.map((room) => room.displayName.toLocaleLowerCase()))
      .size !== sharedRooms.length
  ) {
    fail("Household Settings room authority is inconsistent.");
  }
  if (
    sharedCapabilities.length < 1 ||
    sharedCapabilities.length > 128 ||
    new Set(sharedCapabilities.map(({ capabilityId }) => capabilityId)).size !==
      sharedCapabilities.length ||
    new Set(
      sharedCapabilities.map(({ displayName }) =>
        displayName.toLocaleLowerCase(),
      ),
    ).size !== sharedCapabilities.length
  ) {
    fail("Household Settings capability authority is inconsistent.");
  }
  const members = record.members.map((item, index) =>
    parseMember(
      item,
      index,
      sharedRooms,
      sharedCapabilities,
      householdRooms[0].roomId,
    ),
  );
  if (
    members.length < 1 ||
    new Set(members.map((member) => member.memberId)).size !== members.length ||
    members.filter(
      (member) => member.role === "HEAD" && member.lifecycle === "ACTIVE",
    ).length !== 1
  ) {
    fail("Household Settings must contain exactly one active Head.");
  }
  const invitations = record.invitations.map((item, index) =>
    parseInvitation(
      item,
      index,
      sharedRooms,
      sharedCapabilities,
      householdRooms[0].roomId,
      members,
    ),
  );
  if (
    new Set(invitations.map((item) => item.invitationId)).size !==
      invitations.length ||
    new Set(
      invitations
        .filter((item) => item.state === "ACTIVE")
        .map((item) => item.recipientEmail),
    ).size !== invitations.filter((item) => item.state === "ACTIVE").length
  ) {
    fail("Household invitations are duplicated.");
  }
  return {
    householdId: ref(record, "householdId", "members"),
    policyRevision: positive(record, "policyRevision", "members"),
    csrfToken,
    sharedRooms,
    sharedCapabilities,
    members,
    invitations,
  };
}

function parseOperation(value: unknown): HouseholdMembersMutation["operation"] {
  const record = object(value, "membersMutation.operation");
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
    "membersMutation.operation",
  );
  const operation = choice(
    record.operation,
    OPERATIONS,
    "membersMutation.operation.operation",
  );
  if (
    record.retrySafe !== true ||
    record.mutationPossible !== false ||
    record.nextAction !== "REFRESH_HOUSEHOLD_SETTINGS" ||
    !Array.isArray(record.effects)
  ) {
    fail("The member mutation lacks verified readback.");
  }
  const effects = record.effects;
  const expected = [...EFFECTS[operation]].sort();
  if (
    effects.some((effect) => typeof effect !== "string") ||
    new Set(effects).size !== effects.length ||
    [...effects].sort().some((effect, index) => effect !== expected[index]) ||
    effects.length !== expected.length
  ) {
    fail("The member mutation is missing required lifecycle effects.");
  }
  return {
    operationId: ref(record, "operationId", "membersMutation.operation"),
    idempotencyKey: ref(record, "idempotencyKey", "membersMutation.operation"),
    operation,
    retrySafe: true,
    mutationPossible: false,
    nextAction: "REFRESH_HOUSEHOLD_SETTINGS",
    policyRevision: positive(
      record,
      "policyRevision",
      "membersMutation.operation",
    ),
    readbackAt: positive(record, "readbackAt", "membersMutation.operation"),
    effects: effects as string[],
  };
}

export function parseHouseholdMembersMutation(
  value: unknown,
): HouseholdMembersMutation {
  const record = object(value, "membersMutation");
  exact(
    record,
    ["state", "operation", "subjectId", "readback"],
    "membersMutation",
  );
  if (record.state !== "VERIFIED") fail("The member mutation is unverified.");
  const operation = parseOperation(record.operation);
  const readback = parseHouseholdMembersSnapshot(record.readback);
  if (readback.policyRevision !== operation.policyRevision) {
    fail("The member mutation revision was not read back.");
  }
  return {
    state: "VERIFIED",
    operation,
    subjectId: ref(record, "subjectId", "membersMutation"),
    readback,
  };
}

function findMember(snapshot: HouseholdMembersSnapshot, subjectId: string) {
  const member = snapshot.members.find((item) => item.memberId === subjectId);
  if (!member) fail("The selected household member no longer exists.");
  if (member.role === "HEAD") fail("The Head of Household is protected.");
  return member;
}
function findInvitation(snapshot: HouseholdMembersSnapshot, subjectId: string) {
  const invitation = snapshot.invitations.find(
    (item) => item.invitationId === subjectId,
  );
  if (!invitation) fail("The selected invitation no longer exists.");
  return invitation;
}
function requestPath(path: string, subjectId?: string): string {
  if (subjectId && !REF.test(subjectId))
    fail("The selected subject is invalid.");
  return subjectId ? `${path}/${encodeURIComponent(subjectId)}` : path;
}
export function buildMemberCommandRequest(
  snapshot: HouseholdMembersSnapshot,
  command: MemberCommand,
): { method: "POST" | "PATCH"; path: string; body: JsonObject } {
  if (command.operation === "INVITE") {
    if (
      !EMAIL.test(command.recipientEmail) ||
      !command.displayName.trim() ||
      command.displayName !== command.displayName.trim()
    ) {
      fail("The invitation details are invalid.");
    }
    refs(
      command.configuredSharedRoomIds,
      snapshot.sharedRooms.map((room) => room.roomId),
      "invitation.configuredSharedRoomIds",
      snapshot.sharedRooms.find((room) => room.kind === "HOUSEHOLD")?.roomId ??
        null,
    );
    capabilityRefs(
      command.configuredCapabilityIds,
      snapshot.sharedCapabilities,
      "invitation.configuredCapabilityIds",
      true,
    );
    return {
      method: "POST",
      path: INVITATIONS_PATH,
      body: {
        expectedRevision: snapshot.policyRevision,
        recipientEmail: command.recipientEmail,
        displayName: command.displayName,
        role: command.role,
        configuredSharedRoomIds: command.configuredSharedRoomIds,
        configuredCapabilityIds: command.configuredCapabilityIds,
      },
    };
  }
  if (
    command.operation === "REISSUE_INVITATION" ||
    command.operation === "REVOKE_INVITATION"
  ) {
    const invitation = findInvitation(snapshot, command.subjectId);
    return {
      method: "POST",
      path:
        requestPath(INVITATIONS_PATH, invitation.invitationId) +
        (command.operation === "REISSUE_INVITATION" ? "/reissue" : "/revoke"),
      body: { expectedRevision: invitation.invitationRevision },
    };
  }
  const member = findMember(snapshot, command.subjectId);
  if (command.operation === "UPDATE_MEMBER") {
    refs(
      command.configuredSharedRoomIds,
      snapshot.sharedRooms.map((room) => room.roomId),
      "member.configuredSharedRoomIds",
      snapshot.sharedRooms.find((room) => room.kind === "HOUSEHOLD")?.roomId ??
        null,
    );
    capabilityRefs(
      command.configuredCapabilityIds,
      snapshot.sharedCapabilities,
      "member.configuredCapabilityIds",
      true,
    );
    return {
      method: "PATCH",
      path: requestPath(MEMBERS_PATH, member.memberId),
      body: {
        expectedRevision: member.membershipRevision,
        displayName: command.displayName,
        role: command.role,
        configuredSharedRoomIds: command.configuredSharedRoomIds,
        configuredCapabilityIds: command.configuredCapabilityIds,
      },
    };
  }
  const action = {
    SUSPEND_MEMBER: "suspend",
    REACTIVATE_MEMBER: "reactivate",
    REMOVE_MEMBER: "remove",
  }[command.operation];
  return {
    method: "POST",
    path: `${requestPath(MEMBERS_PATH, member.memberId)}/${action}`,
    body: { expectedRevision: member.membershipRevision },
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
function endpoint(path: string, householdId: string): URL {
  if (!path.startsWith(`${API_PREFIX}/`) || !REF.test(householdId)) {
    fail("Refusing a non-MiCasa Household Settings endpoint.");
  }
  const url = new URL(path, apiBase());
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
        ? "Household Settings changed. Refresh before trying again."
        : response.status === 401
          ? "Your MiCasa session has expired."
          : response.status === 403
            ? "Only the Head of Household can manage household members."
            : "Personal-Agent could not verify this Household Settings request.",
    );
  }
  return parser(body);
}
export function loadHouseholdMembers(
  householdId: string,
): Promise<HouseholdMembersSnapshot> {
  return requestJson(
    endpoint(MEMBERS_PATH, householdId),
    parseHouseholdMembersSnapshot,
  );
}
export function mutateHouseholdMembers(
  snapshot: HouseholdMembersSnapshot,
  command: MemberCommand,
): Promise<HouseholdMembersMutation> {
  const request = buildMemberCommandRequest(snapshot, command);
  return requestJson(
    endpoint(request.path, snapshot.householdId),
    parseHouseholdMembersMutation,
    {
      method: request.method,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": snapshot.csrfToken,
      },
      body: JSON.stringify(request.body),
    },
  );
}

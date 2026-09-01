export class MiCasaContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MiCasaContractError";
  }
}

export type HouseholdRole = "HEAD" | "ADMIN" | "MEMBER";
export type RoomKind = "HOUSEHOLD" | "PERSONAL_AGENT" | "DM" | "GROUP";
export type RoomParticipantKind =
  | "HUMAN"
  | "PERSONAL_AGENT"
  | "HOUSEHOLD_AGENT";
export type AgentReadiness = "PROVISIONING" | "READY" | "UNAVAILABLE" | "ERROR";

export type Viewer = {
  id: string;
  displayName: string;
};

export type HouseholdSummary = {
  id: string;
  name: string;
  role: HouseholdRole;
};

export type RoomParticipantSummary = {
  subjectId: string;
  memberId: string | null;
  kind: RoomParticipantKind;
  displayName: string;
  nostrPubkey: string | null;
  avatarPath: string | null;
};

export type RoomSummary = {
  id: string;
  name: string;
  kind: RoomKind;
  participants: RoomParticipantSummary[];
  householdAgentExplicitlyAdded: boolean;
};

export type AgentSummary = {
  id: string;
  displayName: string;
  readiness: AgentReadiness;
  avatarPath: string | null;
};

export type ActiveHousehold = HouseholdSummary & {
  rooms: RoomSummary[];
  activeRoomId: string;
  householdAgent: AgentSummary;
  personalAgent: AgentSummary;
};

export type MiCasaBootstrap =
  | {
      state: "UNAUTHENTICATED";
      signInPath: string;
    }
  | {
      state: "ONBOARDING_REQUIRED";
      viewer: Viewer;
      onboardingPath: string;
    }
  | {
      state: "READY";
      viewer: Viewer;
      csrfToken: string;
      households: HouseholdSummary[];
      activeHousehold: ActiveHousehold;
    };

export type MiCasaLogout = {
  state: "SIGNED_OUT";
  serverSessionState: "ABSENT" | "REVOKED" | "REPLAYED";
  operationId: string | null;
  destinationPath: string;
};

export type HouseholdInvitationState =
  | "UNAUTHENTICATED"
  | "CLAIMABLE"
  | "ALREADY_MEMBER"
  | "EXPIRED"
  | "REVOKED";

export type HouseholdInvitation = {
  state: HouseholdInvitationState;
  householdName: string;
  inviterName: string;
  role: HouseholdRole;
  expiresAt: string;
  personalAgentRequired: true;
  signInPath?: string;
  csrfToken?: string;
};

export type GroupHouseholdAgentSettings = {
  state: "READY";
  householdId: string;
  roomId: string;
  householdAgent: {
    id: string;
    displayName: string;
    avatarPath: string | null;
  };
  included: boolean;
  canManage: boolean;
  membershipRevision: number;
  policyRevision: number;
  authorityDigest: string;
  csrfToken: string;
  observedAt: number;
  expiresAt: number;
};

export type GroupHouseholdAgentMutation = {
  state: "VERIFIED" | "REPLAYED";
  operation: {
    operationId: string;
    operation: "ADD_HOUSEHOLD_AGENT" | "REMOVE_HOUSEHOLD_AGENT";
    idempotencyKey: string;
    auditEventId: string;
    effects: string[];
    retrySafe: true;
    mutationPossible: false;
  };
  readback: GroupHouseholdAgentSettings;
};

type JsonObject = Record<string, unknown>;

const PUBLIC_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const HEX_64 = /^[0-9a-f]{64}$/;
const MAX_ROOM_PARTICIPANTS = 1_025;
const CSRF_TOKEN = /^[A-Za-z0-9_-]{32,256}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,191}$/;

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MiCasaContractError(`${label} must be an object.`);
  }
  return value as JsonObject;
}

function text(record: JsonObject, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MiCasaContractError(`${label}.${key} must be a string.`);
  }
  return value;
}

function boolean(record: JsonObject, key: string, label: string): boolean {
  const value = record[key];
  if (typeof value !== "boolean") {
    throw new MiCasaContractError(`${label}.${key} must be a boolean.`);
  }
  return value;
}

function optionalText(
  record: JsonObject,
  key: string,
  label: string,
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MiCasaContractError(`${label}.${key} must be a string.`);
  }
  return value;
}

function publicReference(
  record: JsonObject,
  key: string,
  label: string,
): string {
  const value = text(record, key, label);
  if (!PUBLIC_REF.test(value)) {
    throw new MiCasaContractError(
      `${label}.${key} must be a public reference.`,
    );
  }
  return value;
}

function nullablePublicReference(
  record: JsonObject,
  key: string,
  label: string,
): string | null {
  const value = record[key];
  if (value === null) return null;
  if (typeof value !== "string" || !PUBLIC_REF.test(value)) {
    throw new MiCasaContractError(
      `${label}.${key} must be a public reference or null.`,
    );
  }
  return value;
}

function nullableMediaPath(
  record: JsonObject,
  key: string,
  label: string,
): string | null {
  const value = record[key];
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !value.startsWith("/api/micasa/v1/media/") ||
    value.startsWith("//")
  ) {
    throw new MiCasaContractError(
      `${label}.${key} must be a MiCasa media path or null.`,
    );
  }
  return value;
}

function path(record: JsonObject, key: string, label: string): string {
  const value = text(record, key, label);
  if (!value.startsWith("/") || value.startsWith("//")) {
    throw new MiCasaContractError(`${label}.${key} must be a safe path.`);
  }
  return value;
}

function optionalPath(
  record: JsonObject,
  key: string,
  label: string,
): string | undefined {
  const value = optionalText(record, key, label);
  if (value === undefined) return undefined;
  if (!value.startsWith("/") || value.startsWith("//")) {
    throw new MiCasaContractError(`${label}.${key} must be a safe path.`);
  }
  return value;
}

function choice<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new MiCasaContractError(`${label} has an unsupported value.`);
  }
  return value as Values[number];
}

function positiveInteger(
  record: JsonObject,
  key: string,
  label: string,
): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new MiCasaContractError(
      `${label}.${key} must be a positive integer.`,
    );
  }
  return value as number;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new MiCasaContractError(`${label} must be an array.`);
  }
  return value;
}

function parseViewer(value: unknown): Viewer {
  const record = object(value, "viewer");
  return {
    id: text(record, "id", "viewer"),
    displayName: text(record, "displayName", "viewer"),
  };
}

function parseRole(value: unknown, label: string): HouseholdRole {
  return choice(value, ["HEAD", "ADMIN", "MEMBER"] as const, label);
}

function parseHousehold(value: unknown, label: string): HouseholdSummary {
  const record = object(value, label);
  return {
    id: text(record, "id", label),
    name: text(record, "name", label),
    role: parseRole(record.role, `${label}.role`),
  };
}

function parseRoomParticipant(
  value: unknown,
  label: string,
): RoomParticipantSummary {
  const record = object(value, label);
  const kind = choice(
    record.kind,
    ["HUMAN", "PERSONAL_AGENT", "HOUSEHOLD_AGENT"] as const,
    `${label}.kind`,
  );
  const subjectId = publicReference(record, "subjectId", label);
  const memberId = nullablePublicReference(record, "memberId", label);
  if (
    (kind === "HUMAN" && memberId !== subjectId) ||
    (kind === "PERSONAL_AGENT" &&
      (memberId === null || memberId === subjectId)) ||
    (kind === "HOUSEHOLD_AGENT" && memberId !== null)
  ) {
    throw new MiCasaContractError(`${label} has an invalid owner binding.`);
  }
  const rawNostrPubkey = record.nostrPubkey;
  const nostrPubkey =
    rawNostrPubkey === null
      ? null
      : typeof rawNostrPubkey === "string" && HEX_64.test(rawNostrPubkey)
        ? rawNostrPubkey
        : undefined;
  if (nostrPubkey === undefined || (nostrPubkey === null && kind !== "HUMAN")) {
    throw new MiCasaContractError(
      label +
        ".nostrPubkey must be a public Nostr key, or null for a pending human signer.",
    );
  }
  return {
    subjectId,
    memberId,
    kind,
    displayName: text(record, "displayName", label),
    nostrPubkey,
    avatarPath: nullableMediaPath(record, "avatarPath", label),
  };
}

function parseRoom(
  value: unknown,
  label: string,
  viewerMemberId: string,
): RoomSummary {
  const record = object(value, label);
  const kind = choice(
    record.kind,
    ["HOUSEHOLD", "PERSONAL_AGENT", "DM", "GROUP"] as const,
    `${label}.kind`,
  );
  const rawParticipants = array(record.participants, `${label}.participants`);
  if (
    rawParticipants.length < 2 ||
    rawParticipants.length > MAX_ROOM_PARTICIPANTS
  ) {
    throw new MiCasaContractError(`${label}.participants has an invalid size.`);
  }
  const participants = rawParticipants.map((participant, index) =>
    parseRoomParticipant(participant, `${label}.participants[${index}]`),
  );
  const subjectIds = participants.map((item) => item.subjectId);
  const pubkeys = participants
    .map((item) => item.nostrPubkey)
    .filter((value): value is string => value !== null);
  const humans = new Set(
    participants
      .filter((item) => item.kind === "HUMAN")
      .map((item) => item.memberId as string),
  );
  const personalOwners = participants
    .filter((item) => item.kind === "PERSONAL_AGENT")
    .map((item) => item.memberId as string);
  const householdAgents = participants.filter(
    (item) => item.kind === "HOUSEHOLD_AGENT",
  );
  const householdAgentExplicitlyAdded = boolean(
    record,
    "householdAgentExplicitlyAdded",
    label,
  );
  const fixedHumanCount =
    kind === "PERSONAL_AGENT" ? 1 : kind === "DM" ? 2 : null;
  if (
    new Set(subjectIds).size !== subjectIds.length ||
    new Set(pubkeys).size !== pubkeys.length ||
    new Set(personalOwners).size !== personalOwners.length ||
    personalOwners.length !== humans.size ||
    personalOwners.some((memberId) => !humans.has(memberId)) ||
    !humans.has(viewerMemberId) ||
    (fixedHumanCount !== null && humans.size !== fixedHumanCount) ||
    (kind === "GROUP" && humans.size < 3) ||
    (kind === "HOUSEHOLD" &&
      (humans.size < 1 ||
        householdAgents.length !== 1 ||
        householdAgentExplicitlyAdded)) ||
    (kind === "GROUP" &&
      (householdAgents.length > 1 ||
        (householdAgents.length === 1) !== householdAgentExplicitlyAdded)) ||
    ((kind === "PERSONAL_AGENT" || kind === "DM") &&
      (householdAgents.length !== 0 || householdAgentExplicitlyAdded))
  ) {
    throw new MiCasaContractError(
      `${label}.participants violates MiCasa room topology.`,
    );
  }
  return {
    id: publicReference(record, "id", label),
    name: text(record, "name", label),
    kind,
    participants,
    householdAgentExplicitlyAdded,
  };
}

function parseAgent(value: unknown, label: string): AgentSummary {
  const record = object(value, label);
  return {
    id: text(record, "id", label),
    displayName: text(record, "displayName", label),
    readiness: choice(
      record.readiness,
      ["PROVISIONING", "READY", "UNAVAILABLE", "ERROR"] as const,
      `${label}.readiness`,
    ),
    avatarPath: nullableMediaPath(record, "avatarPath", label),
  };
}

function parseActiveHousehold(
  value: unknown,
  viewerMemberId: string,
): ActiveHousehold {
  const record = object(value, "activeHousehold");
  const household = parseHousehold(record, "activeHousehold");
  const rooms = array(record.rooms, "activeHousehold.rooms").map(
    (room, index) =>
      parseRoom(room, `activeHousehold.rooms[${index}]`, viewerMemberId),
  );
  const activeRoomId = publicReference(
    record,
    "activeRoomId",
    "activeHousehold",
  );
  if (!rooms.some((room) => room.id === activeRoomId)) {
    throw new MiCasaContractError(
      "activeHousehold.activeRoomId must identify a visible room.",
    );
  }
  const householdAgent = parseAgent(
    record.householdAgent,
    "activeHousehold.householdAgent",
  );
  const personalAgent = parseAgent(
    record.personalAgent,
    "activeHousehold.personalAgent",
  );
  for (const room of rooms) {
    const viewerAgents = room.participants.filter(
      (item) =>
        item.kind === "PERSONAL_AGENT" && item.memberId === viewerMemberId,
    );
    if (
      viewerAgents.length !== 1 ||
      viewerAgents[0].subjectId !== personalAgent.id ||
      viewerAgents[0].displayName !== personalAgent.displayName ||
      viewerAgents[0].avatarPath !== personalAgent.avatarPath
    ) {
      throw new MiCasaContractError(
        `${room.id} does not carry the authoritative Personal Agent profile.`,
      );
    }
    if (room.kind === "HOUSEHOLD") {
      const projected = room.participants.filter(
        (item) => item.kind === "HOUSEHOLD_AGENT",
      );
      if (
        projected.length !== 1 ||
        projected[0].subjectId !== householdAgent.id ||
        projected[0].displayName !== householdAgent.displayName ||
        projected[0].avatarPath !== householdAgent.avatarPath
      ) {
        throw new MiCasaContractError(
          room.id +
            " does not carry the authoritative Household Agent profile.",
        );
      }
    }
  }
  return {
    ...household,
    rooms,
    activeRoomId,
    householdAgent,
    personalAgent,
  };
}

export function parseMiCasaBootstrap(value: unknown): MiCasaBootstrap {
  const record = object(value, "bootstrap");
  const state = choice(
    record.state,
    ["UNAUTHENTICATED", "ONBOARDING_REQUIRED", "READY"] as const,
    "bootstrap.state",
  );

  if (state === "UNAUTHENTICATED") {
    return { state, signInPath: path(record, "signInPath", "bootstrap") };
  }
  if (state === "ONBOARDING_REQUIRED") {
    return {
      state,
      viewer: parseViewer(record.viewer),
      onboardingPath: path(record, "onboardingPath", "bootstrap"),
    };
  }

  const viewer = parseViewer(record.viewer);
  const csrfToken = text(record, "csrfToken", "bootstrap");
  if (!CSRF_TOKEN.test(csrfToken)) {
    throw new MiCasaContractError("bootstrap.csrfToken is invalid.");
  }
  const households = array(record.households, "bootstrap.households").map(
    (household, index) =>
      parseHousehold(household, `bootstrap.households[${index}]`),
  );
  const activeHousehold = parseActiveHousehold(
    record.activeHousehold,
    viewer.id,
  );
  if (!households.some((household) => household.id === activeHousehold.id)) {
    throw new MiCasaContractError(
      "The active Household must exist in the viewer directory.",
    );
  }
  return {
    state,
    viewer,
    csrfToken,
    households,
    activeHousehold,
  };
}

export function parseMiCasaLogout(value: unknown): MiCasaLogout {
  const record = object(value, "logout");
  const expected = [
    "destinationPath",
    "operationId",
    "serverSessionState",
    "state",
  ];
  const actual = Object.keys(record).sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new MiCasaContractError("logout has an unsupported field.");
  }
  if (record.state !== "SIGNED_OUT") {
    throw new MiCasaContractError("logout.state must be SIGNED_OUT.");
  }
  const serverSessionState = choice(
    record.serverSessionState,
    ["ABSENT", "REVOKED", "REPLAYED"] as const,
    "logout.serverSessionState",
  );
  const operationId = nullablePublicReference(record, "operationId", "logout");
  if (
    (serverSessionState === "ABSENT" && operationId !== null) ||
    (serverSessionState !== "ABSENT" && operationId === null)
  ) {
    throw new MiCasaContractError(
      "logout operation readback contradicts the session state.",
    );
  }
  return {
    state: "SIGNED_OUT",
    serverSessionState,
    operationId,
    destinationPath: path(record, "destinationPath", "logout"),
  };
}

export function parseHouseholdInvitation(value: unknown): HouseholdInvitation {
  const record = object(value, "invitation");
  const state = choice(
    record.state,
    [
      "UNAUTHENTICATED",
      "CLAIMABLE",
      "ALREADY_MEMBER",
      "EXPIRED",
      "REVOKED",
    ] as const,
    "invitation.state",
  );
  if (record.personalAgentRequired !== true) {
    throw new MiCasaContractError(
      "A Household invitation must require a Personal Agent.",
    );
  }
  const expiresAt = text(record, "expiresAt", "invitation");
  if (Number.isNaN(Date.parse(expiresAt))) {
    throw new MiCasaContractError(
      "invitation.expiresAt must be an ISO date-time.",
    );
  }

  const invitation: HouseholdInvitation = {
    state,
    householdName: text(record, "householdName", "invitation"),
    inviterName: text(record, "inviterName", "invitation"),
    role: parseRole(record.role, "invitation.role"),
    expiresAt,
    personalAgentRequired: true,
    signInPath: optionalPath(record, "signInPath", "invitation"),
    csrfToken: optionalText(record, "csrfToken", "invitation"),
  };

  if (state === "UNAUTHENTICATED" && !invitation.signInPath) {
    throw new MiCasaContractError(
      "An unauthenticated invitation requires a sign-in path.",
    );
  }
  if (state === "CLAIMABLE" && !invitation.csrfToken) {
    throw new MiCasaContractError(
      "A claimable invitation requires a CSRF token.",
    );
  }
  return invitation;
}

export function parseGroupHouseholdAgentSettings(
  value: unknown,
  label = "groupHouseholdAgent",
): GroupHouseholdAgentSettings {
  const record = object(value, label);
  if (record.state !== "READY") {
    throw new MiCasaContractError(`${label}.state must be READY.`);
  }
  const agent = object(record.householdAgent, `${label}.householdAgent`);
  const authorityDigest = text(record, "authorityDigest", label);
  const csrfToken = text(record, "csrfToken", label);
  const observedAt = positiveInteger(record, "observedAt", label);
  const expiresAt = positiveInteger(record, "expiresAt", label);
  if (!HEX_64.test(authorityDigest)) {
    throw new MiCasaContractError(`${label}.authorityDigest is invalid.`);
  }
  if (!CSRF_TOKEN.test(csrfToken)) {
    throw new MiCasaContractError(`${label}.csrfToken is invalid.`);
  }
  if (observedAt >= expiresAt) {
    throw new MiCasaContractError(`${label} has an invalid authority window.`);
  }
  return {
    state: "READY",
    householdId: publicReference(record, "householdId", label),
    roomId: publicReference(record, "roomId", label),
    householdAgent: {
      id: publicReference(agent, "id", `${label}.householdAgent`),
      displayName: text(agent, "displayName", `${label}.householdAgent`),
      avatarPath: nullableMediaPath(
        agent,
        "avatarPath",
        `${label}.householdAgent`,
      ),
    },
    included: boolean(record, "included", label),
    canManage: boolean(record, "canManage", label),
    membershipRevision: positiveInteger(record, "membershipRevision", label),
    policyRevision: positiveInteger(record, "policyRevision", label),
    authorityDigest,
    csrfToken,
    observedAt,
    expiresAt,
  };
}

export function parseGroupHouseholdAgentMutation(
  value: unknown,
): GroupHouseholdAgentMutation {
  const record = object(value, "groupHouseholdAgentMutation");
  const state = choice(
    record.state,
    ["VERIFIED", "REPLAYED"] as const,
    "groupHouseholdAgentMutation.state",
  );
  const operationRecord = object(
    record.operation,
    "groupHouseholdAgentMutation.operation",
  );
  const operation = choice(
    operationRecord.operation,
    ["ADD_HOUSEHOLD_AGENT", "REMOVE_HOUSEHOLD_AGENT"] as const,
    "groupHouseholdAgentMutation.operation.operation",
  );
  const idempotencyKey = text(
    operationRecord,
    "idempotencyKey",
    "groupHouseholdAgentMutation.operation",
  );
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw new MiCasaContractError(
      "groupHouseholdAgentMutation.operation.idempotencyKey is invalid.",
    );
  }
  const effects = array(
    operationRecord.effects,
    "groupHouseholdAgentMutation.operation.effects",
  ).map((effect, index) => {
    if (typeof effect !== "string" || !PUBLIC_REF.test(effect)) {
      throw new MiCasaContractError(
        "groupHouseholdAgentMutation.operation.effects[" +
          index +
          "] is invalid.",
      );
    }
    return effect;
  });
  const required = new Set([
    "PA_ROOM_MEMBERSHIP_COMMITTED",
    "BUZZ_CHANNEL_MEMBERSHIP_RECONCILED",
    "NOSTR_ROOM_AUTHORITY_REVISED",
    "ACP_ROOM_AUTHORITY_REVISED",
    "BOOTSTRAP_READ_MODEL_REBUILT",
    "AUDIT_EVENT_APPENDED",
    operation === "ADD_HOUSEHOLD_AGENT"
      ? "HOUSEHOLD_AGENT_ADDED"
      : "HOUSEHOLD_AGENT_REMOVED",
  ]);
  if (
    new Set(effects).size !== required.size ||
    effects.some((effect) => !required.has(effect))
  ) {
    throw new MiCasaContractError(
      "groupHouseholdAgentMutation.operation.effects is incomplete.",
    );
  }
  if (
    operationRecord.retrySafe !== true ||
    operationRecord.mutationPossible !== false
  ) {
    throw new MiCasaContractError(
      "groupHouseholdAgentMutation.operation has unsafe retry metadata.",
    );
  }
  const readback = parseGroupHouseholdAgentSettings(
    record.readback,
    "groupHouseholdAgentMutation.readback",
  );
  if (readback.included !== (operation === "ADD_HOUSEHOLD_AGENT")) {
    throw new MiCasaContractError(
      "groupHouseholdAgentMutation readback contradicts the operation.",
    );
  }
  return {
    state,
    operation: {
      operationId: publicReference(
        operationRecord,
        "operationId",
        "groupHouseholdAgentMutation.operation",
      ),
      operation,
      idempotencyKey,
      auditEventId: publicReference(
        operationRecord,
        "auditEventId",
        "groupHouseholdAgentMutation.operation",
      ),
      effects,
      retrySafe: true,
      mutationPossible: false,
    },
    readback,
  };
}

export function parseInvitationAcceptance(value: unknown): {
  destinationPath: string;
} {
  const record = object(value, "invitationAcceptance");
  return {
    destinationPath: path(record, "destinationPath", "invitationAcceptance"),
  };
}

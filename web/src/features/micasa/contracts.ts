export class MiCasaContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MiCasaContractError";
  }
}

export type HouseholdRole = "HEAD" | "ADMIN" | "MEMBER";
export type RoomKind = "HOUSEHOLD" | "PERSONAL_AGENT" | "DM" | "GROUP";
export type AgentReadiness =
  | "PROVISIONING"
  | "READY"
  | "UNAVAILABLE"
  | "ERROR";

export type Viewer = {
  id: string;
  displayName: string;
};

export type HouseholdSummary = {
  id: string;
  name: string;
  role: HouseholdRole;
};

export type RoomSummary = {
  id: string;
  name: string;
  kind: RoomKind;
};

export type AgentSummary = {
  id: string;
  displayName: string;
  readiness: AgentReadiness;
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
      households: HouseholdSummary[];
      activeHousehold: ActiveHousehold;
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

type JsonObject = Record<string, unknown>;

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new MiCasaContractError(label + " must be an object.");
  }
  return value as JsonObject;
}

function text(record: JsonObject, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new MiCasaContractError(label + "." + key + " must be a string.");
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
    throw new MiCasaContractError(label + "." + key + " must be a string.");
  }
  return value;
}

function path(record: JsonObject, key: string, label: string): string {
  const value = text(record, key, label);
  if (!value.startsWith("/") || value.startsWith("//")) {
    throw new MiCasaContractError(label + "." + key + " must be a safe path.");
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
    throw new MiCasaContractError(label + "." + key + " must be a safe path.");
  }
  return value;
}

function choice<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  label: string,
): Values[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new MiCasaContractError(label + " has an unsupported value.");
  }
  return value as Values[number];
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new MiCasaContractError(label + " must be an array.");
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
    role: parseRole(record.role, label + ".role"),
  };
}

function parseRoom(value: unknown, label: string): RoomSummary {
  const record = object(value, label);
  return {
    id: text(record, "id", label),
    name: text(record, "name", label),
    kind: choice(
      record.kind,
      ["HOUSEHOLD", "PERSONAL_AGENT", "DM", "GROUP"] as const,
      label + ".kind",
    ),
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
      label + ".readiness",
    ),
  };
}

function parseActiveHousehold(value: unknown): ActiveHousehold {
  const record = object(value, "activeHousehold");
  const household = parseHousehold(record, "activeHousehold");
  const rooms = array(record.rooms, "activeHousehold.rooms").map(
    (room, index) => parseRoom(room, "activeHousehold.rooms[" + index + "]"),
  );
  const activeRoomId = text(record, "activeRoomId", "activeHousehold");
  if (!rooms.some((room) => room.id === activeRoomId)) {
    throw new MiCasaContractError(
      "activeHousehold.activeRoomId must identify a visible room.",
    );
  }
  return {
    ...household,
    rooms,
    activeRoomId,
    householdAgent: parseAgent(
      record.householdAgent,
      "activeHousehold.householdAgent",
    ),
    personalAgent: parseAgent(
      record.personalAgent,
      "activeHousehold.personalAgent",
    ),
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

  const households = array(record.households, "bootstrap.households").map(
    (household, index) =>
      parseHousehold(household, "bootstrap.households[" + index + "]"),
  );
  const activeHousehold = parseActiveHousehold(record.activeHousehold);
  if (!households.some((household) => household.id === activeHousehold.id)) {
    throw new MiCasaContractError(
      "The active Household must exist in the viewer directory.",
    );
  }
  return {
    state,
    viewer: parseViewer(record.viewer),
    households,
    activeHousehold,
  };
}

export function parseHouseholdInvitation(
  value: unknown,
): HouseholdInvitation {
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

export function parseInvitationAcceptance(value: unknown): {
  destinationPath: string;
} {
  const record = object(value, "invitationAcceptance");
  return {
    destinationPath: path(
      record,
      "destinationPath",
      "invitationAcceptance",
    ),
  };
}

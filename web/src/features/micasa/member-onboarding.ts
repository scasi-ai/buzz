import { isAllowedMiCasaOrigin } from "./origin-policy.ts";

export class MemberOnboardingContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemberOnboardingContractError";
  }
}

export type MemberOnboardingState =
  | "IDENTITY_REQUIRED"
  | "PROFILE_REQUIRED"
  | "PROVISIONING"
  | "HOUSEHOLD_APPS_DISCLOSURE_REQUIRED"
  | "PRIVATE_APPS_REQUIRED"
  | "FINALIZING"
  | "READY"
  | "BLOCKED";
export type MemberAvatar = {
  artifactId: string;
  mediaType: "image/avif" | "image/jpeg" | "image/png" | "image/webp";
  altText: string;
  contentSha256: string;
};
export type MemberRoomDisclosure = {
  roomId: string;
  displayName: string;
  kind: "HOUSEHOLD" | "PERSONAL_AGENT" | "DM" | "GROUP";
};
export type MemberHouseholdAppDisclosure = {
  serviceId: string;
  displayName: string;
  catalogStatus:
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
  audience: string[];
  dataSummary: string;
  actionSummary: string;
};
export type MemberOnboardingSnapshot = {
  state: MemberOnboardingState;
  claimId: string;
  householdId: string;
  householdName: string;
  inviterName: string;
  role: "ADMIN" | "MEMBER";
  identityBound: boolean;
  profileRevision: number;
  roomScope: MemberRoomDisclosure[];
  capabilityScope: string[];
  consentNotices: string[];
  householdApps: MemberHouseholdAppDisclosure[];
  householdAppsDisclosureRevision: number;
  householdAppsDisclosureDigest: string | null;
  householdAppsAcknowledged: boolean;
  csrfToken: string;
  generatedPersonalAgentAvatar?: MemberAvatar;
  blockedCode?: string;
  destinationPath?: "/household";
};
export type MemberProfileMutation = {
  state: "PROVISIONING";
  operationId: string;
  idempotencyKey: string;
  profileRevision: number;
};
export type MemberHouseholdAppsAck = {
  state: "VERIFIED";
  operationId: string;
  idempotencyKey: string;
  readback: MemberOnboardingSnapshot & {
    state: "PRIVATE_APPS_REQUIRED";
    householdAppsAcknowledged: true;
  };
};

type JsonObject = Record<string, unknown>;
const API_PREFIX = "/api/micasa/v1/onboarding/member/";
const REQUEST_TIMEOUT_MS = 15_000;
const CLAIM = /^member-onboarding:[0-9a-f]{64}$/;
const TENANT = /^tenant:[0-9a-f]{64}$/;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const CSRF = /^[A-Za-z0-9_-]{32,256}$/;
const BLOCKED_CODE = /^[A-Z][A-Z0-9_]{2,95}$/;
const STATES: MemberOnboardingState[] = [
  "IDENTITY_REQUIRED",
  "PROFILE_REQUIRED",
  "PROVISIONING",
  "HOUSEHOLD_APPS_DISCLOSURE_REQUIRED",
  "PRIVATE_APPS_REQUIRED",
  "FINALIZING",
  "READY",
  "BLOCKED",
];
const ROOM_KINDS: MemberRoomDisclosure["kind"][] = [
  "HOUSEHOLD",
  "PERSONAL_AGENT",
  "DM",
  "GROUP",
];
const APP_STATUSES: MemberHouseholdAppDisclosure["catalogStatus"][] = [
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
const DISCLOSURE_STATES = new Set<MemberOnboardingState>([
  "HOUSEHOLD_APPS_DISCLOSURE_REQUIRED",
  "PRIVATE_APPS_REQUIRED",
  "FINALIZING",
  "READY",
]);
const ACKNOWLEDGED_STATES = new Set<MemberOnboardingState>([
  "PRIVATE_APPS_REQUIRED",
  "FINALIZING",
  "READY",
]);

function fail(message: string): never {
  throw new MemberOnboardingContractError(message);
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
function text(value: unknown, label: string, maximum = 256): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    value.length < 1 ||
    value.length > maximum ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127;
    })
  ) {
    fail(`${label} must be safe text.`);
  }
  return value;
}
function reference(value: unknown, label: string): string {
  const result = text(value, label);
  if (!REF.test(result)) fail(`${label} is invalid.`);
  return result;
}
function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    fail(`${label} must be a positive integer.`);
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
function stringArray(value: unknown, label: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    fail(`${label} is incomplete.`);
  }
  const result = value.map((item, index) =>
    text(item, `${label}[${index}]`, 500),
  );
  if (new Set(result).size !== result.length) fail(`${label} is duplicated.`);
  return result;
}
function parseAvatar(value: unknown): MemberAvatar {
  const record = object(value, "member.generatedPersonalAgentAvatar");
  exact(
    record,
    ["artifactId", "mediaType", "altText", "contentSha256"],
    "member.generatedPersonalAgentAvatar",
  );
  const digest = text(
    record.contentSha256,
    "member.generatedPersonalAgentAvatar.contentSha256",
    64,
  );
  if (!HEX64.test(digest)) fail("The generated avatar digest is invalid.");
  return {
    artifactId: reference(
      record.artifactId,
      "member.generatedPersonalAgentAvatar.artifactId",
    ),
    mediaType: choice(
      record.mediaType,
      ["image/avif", "image/jpeg", "image/png", "image/webp"] as const,
      "member.generatedPersonalAgentAvatar.mediaType",
    ),
    altText: text(
      record.altText,
      "member.generatedPersonalAgentAvatar.altText",
      200,
    ),
    contentSha256: digest,
  };
}
function parseRoom(value: unknown, index: number): MemberRoomDisclosure {
  const label = `member.roomScope[${index}]`;
  const record = object(value, label);
  exact(record, ["roomId", "displayName", "kind"], label);
  return {
    roomId: reference(record.roomId, `${label}.roomId`),
    displayName: text(record.displayName, `${label}.displayName`, 120),
    kind: choice(record.kind, ROOM_KINDS, `${label}.kind`),
  };
}
function parseHouseholdApp(
  value: unknown,
  index: number,
): MemberHouseholdAppDisclosure {
  const label = `member.householdApps[${index}]`;
  const record = object(value, label);
  exact(
    record,
    [
      "serviceId",
      "displayName",
      "catalogStatus",
      "audience",
      "dataSummary",
      "actionSummary",
    ],
    label,
  );
  const audience = stringArray(record.audience, `${label}.audience`, 32);
  if (audience.some((item) => !REF.test(item))) {
    fail(`${label}.audience is invalid.`);
  }
  return {
    serviceId: reference(record.serviceId, `${label}.serviceId`),
    displayName: text(record.displayName, `${label}.displayName`, 120),
    catalogStatus: choice(
      record.catalogStatus,
      APP_STATUSES,
      `${label}.catalogStatus`,
    ),
    audience,
    dataSummary: text(record.dataSummary, `${label}.dataSummary`, 500),
    actionSummary: text(record.actionSummary, `${label}.actionSummary`, 500),
  };
}

export function parseMemberOnboardingSnapshot(
  value: unknown,
): MemberOnboardingSnapshot {
  const record = object(value, "member");
  const state = choice(record.state, STATES, "member.state");
  const fields = [
    "state",
    "claimId",
    "householdId",
    "householdName",
    "inviterName",
    "role",
    "identityBound",
    "profileRevision",
    "roomScope",
    "capabilityScope",
    "consentNotices",
    "householdApps",
    "householdAppsDisclosureRevision",
    "householdAppsDisclosureDigest",
    "householdAppsAcknowledged",
    "csrfToken",
  ];
  if (state === "PROFILE_REQUIRED") fields.push("generatedPersonalAgentAvatar");
  if (state === "BLOCKED") fields.push("blockedCode");
  if (state === "READY") fields.push("destinationPath");
  exact(record, fields, "member");
  const claimId = text(record.claimId, "member.claimId");
  const householdId = text(record.householdId, "member.householdId");
  const csrfToken = text(record.csrfToken, "member.csrfToken");
  if (
    !CLAIM.test(claimId) ||
    !TENANT.test(householdId) ||
    !CSRF.test(csrfToken)
  ) {
    fail("The member onboarding authority is invalid.");
  }
  if (
    !Array.isArray(record.roomScope) ||
    record.roomScope.length < 1 ||
    record.roomScope.length > 64
  ) {
    fail("The room disclosure is incomplete.");
  }
  const roomScope = record.roomScope.map(parseRoom);
  if (new Set(roomScope.map((room) => room.roomId)).size !== roomScope.length) {
    fail("The room disclosure is duplicated.");
  }
  const capabilityScope = stringArray(
    record.capabilityScope,
    "member.capabilityScope",
    128,
  );
  if (capabilityScope.some((item) => !REF.test(item))) {
    fail("The capability disclosure is invalid.");
  }
  const consentNotices = stringArray(
    record.consentNotices,
    "member.consentNotices",
    32,
  );
  if (
    !Array.isArray(record.householdApps) ||
    record.householdApps.length > 512
  ) {
    fail("The Household Apps disclosure is invalid.");
  }
  const householdApps = record.householdApps.map(parseHouseholdApp);
  if (
    new Set(householdApps.map((app) => app.serviceId)).size !==
    householdApps.length
  ) {
    fail("The Household Apps disclosure is duplicated.");
  }
  const disclosureDigest = record.householdAppsDisclosureDigest;
  const disclosed = DISCLOSURE_STATES.has(state);
  if (
    disclosed !==
      (householdApps.length > 0 &&
        typeof disclosureDigest === "string" &&
        HEX64.test(disclosureDigest)) ||
    (!disclosed && disclosureDigest !== null)
  ) {
    fail("The Household Apps disclosure contradicts its state.");
  }
  const acknowledged = ACKNOWLEDGED_STATES.has(state);
  if (record.householdAppsAcknowledged !== acknowledged) {
    fail("The Household Apps acknowledgement contradicts its state.");
  }
  const identityBound = state !== "IDENTITY_REQUIRED";
  if (record.identityBound !== identityBound) {
    fail("The signer state contradicts member onboarding.");
  }
  const generatedPersonalAgentAvatar =
    state === "PROFILE_REQUIRED"
      ? parseAvatar(record.generatedPersonalAgentAvatar)
      : undefined;
  const blockedCode =
    state === "BLOCKED"
      ? text(record.blockedCode, "member.blockedCode", 96)
      : undefined;
  if (blockedCode !== undefined && !BLOCKED_CODE.test(blockedCode)) {
    fail("The blocked reason is invalid.");
  }
  if (state === "READY" && record.destinationPath !== "/household") {
    fail("The ready destination is invalid.");
  }
  return {
    state,
    claimId,
    householdId,
    householdName: text(record.householdName, "member.householdName", 120),
    inviterName: text(record.inviterName, "member.inviterName", 120),
    role: choice(record.role, ["ADMIN", "MEMBER"] as const, "member.role"),
    identityBound,
    profileRevision: positive(record.profileRevision, "member.profileRevision"),
    roomScope,
    capabilityScope,
    consentNotices,
    householdApps,
    householdAppsDisclosureRevision: positive(
      record.householdAppsDisclosureRevision,
      "member.householdAppsDisclosureRevision",
    ),
    householdAppsDisclosureDigest:
      typeof disclosureDigest === "string" ? disclosureDigest : null,
    householdAppsAcknowledged: acknowledged,
    csrfToken,
    ...(generatedPersonalAgentAvatar ? { generatedPersonalAgentAvatar } : {}),
    ...(blockedCode ? { blockedCode } : {}),
    ...(state === "READY" ? { destinationPath: "/household" as const } : {}),
  };
}

export function parseMemberProfileMutation(
  value: unknown,
): MemberProfileMutation {
  const record = object(value, "memberProfileMutation");
  exact(
    record,
    ["state", "operationId", "idempotencyKey", "profileRevision"],
    "memberProfileMutation",
  );
  if (record.state !== "PROVISIONING") {
    fail("The member profile was not authoritatively accepted.");
  }
  return {
    state: "PROVISIONING",
    operationId: reference(
      record.operationId,
      "memberProfileMutation.operationId",
    ),
    idempotencyKey: reference(
      record.idempotencyKey,
      "memberProfileMutation.idempotencyKey",
    ),
    profileRevision: positive(
      record.profileRevision,
      "memberProfileMutation.profileRevision",
    ),
  };
}
export function parseMemberHouseholdAppsAck(
  value: unknown,
): MemberHouseholdAppsAck {
  const record = object(value, "memberHouseholdAppsAck");
  exact(
    record,
    ["state", "operationId", "idempotencyKey", "readback"],
    "memberHouseholdAppsAck",
  );
  const readback = parseMemberOnboardingSnapshot(record.readback);
  if (
    record.state !== "VERIFIED" ||
    readback.state !== "PRIVATE_APPS_REQUIRED" ||
    readback.householdAppsAcknowledged !== true
  ) {
    fail("The Household Apps acknowledgement lacks verified readback.");
  }
  return {
    state: "VERIFIED",
    operationId: reference(
      record.operationId,
      "memberHouseholdAppsAck.operationId",
    ),
    idempotencyKey: reference(
      record.idempotencyKey,
      "memberHouseholdAppsAck.idempotencyKey",
    ),
    readback: readback as MemberHouseholdAppsAck["readback"],
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
function endpoint(claimId: string, suffix = ""): URL {
  if (!CLAIM.test(claimId)) fail("The invitation claim is invalid.");
  return new URL(`${API_PREFIX}${claimId}${suffix}`, apiBase());
}
async function requestJson<T>(
  url: URL,
  parse: (value: unknown) => T,
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
    throw new MemberOnboardingContractError(
      response.status === 409
        ? "This onboarding step changed. Refresh before continuing."
        : response.status === 401
          ? "Your MiCasa session has expired."
          : "Personal-Agent could not verify member onboarding.",
    );
  }
  return parse(body);
}
export function loadMemberOnboarding(
  claimId: string,
): Promise<MemberOnboardingSnapshot> {
  return requestJson(endpoint(claimId), parseMemberOnboardingSnapshot);
}
export function saveMemberProfiles(
  snapshot: MemberOnboardingSnapshot,
  input: {
    humanDisplayName: string;
    personalAgentDisplayName: string;
    avatarAccepted: boolean;
  },
): Promise<MemberProfileMutation> {
  if (
    snapshot.state !== "PROFILE_REQUIRED" ||
    !snapshot.generatedPersonalAgentAvatar ||
    input.avatarAccepted !== true
  ) {
    fail("The generated Personal Agent avatar must be explicitly accepted.");
  }
  const avatar = snapshot.generatedPersonalAgentAvatar;
  return requestJson(
    endpoint(snapshot.claimId, "/profiles"),
    parseMemberProfileMutation,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": snapshot.csrfToken,
      },
      body: JSON.stringify({
        expectedRevision: snapshot.profileRevision,
        humanDisplayName: input.humanDisplayName,
        personalAgent: {
          displayName: input.personalAgentDisplayName,
          avatarArtifactId: avatar.artifactId,
          avatarAltText: avatar.altText,
          avatarAccepted: true,
        },
      }),
    },
  );
}
export function acknowledgeMemberHouseholdApps(
  snapshot: MemberOnboardingSnapshot,
): Promise<MemberHouseholdAppsAck> {
  if (
    snapshot.state !== "HOUSEHOLD_APPS_DISCLOSURE_REQUIRED" ||
    !snapshot.householdAppsDisclosureDigest
  ) {
    fail("Household Apps are not ready for acknowledgement.");
  }
  return requestJson(
    endpoint(snapshot.claimId, "/household-apps/ack"),
    parseMemberHouseholdAppsAck,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": snapshot.csrfToken,
      },
      body: JSON.stringify({
        expectedDisclosureRevision: snapshot.householdAppsDisclosureRevision,
        disclosureDigest: snapshot.householdAppsDisclosureDigest,
      }),
    },
  );
}

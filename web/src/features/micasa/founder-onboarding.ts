import { isAllowedMiCasaOrigin } from "./origin-policy.ts";

export class FounderOnboardingContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FounderOnboardingContractError";
  }
}

export type FounderOnboardingState =
  | "PROFILE_REQUIRED"
  | "PROVISIONING"
  | "HOUSEHOLD_APPS_REQUIRED"
  | "PRIVATE_APPS_REQUIRED"
  | "FINALIZING"
  | "READY"
  | "BLOCKED";
export type FounderOnboardingStep =
  | "PROFILES"
  | "PROVISIONING"
  | "HOUSEHOLD_APPS"
  | "PRIVATE_APPS";
export type FounderProvisioningStep =
  | "CREATE_PA_HOUSEHOLD_TENANT"
  | "ESTABLISH_HEAD_MEMBERSHIP"
  | "BIND_HEAD_ACCOUNT_AND_NOSTR_IDENTITY"
  | "PERSIST_PRESENTATION_PROFILES_AND_AVATARS"
  | "CREATE_BUILDERLAB_BUZZ_COMMUNITY"
  | "VERIFY_ONE_TO_ONE_COMMUNITY_MAPPING"
  | "CREATE_PA_DEFINED_ROOMS"
  | "PROJECT_AUTHORIZED_BUZZ_CHANNELS"
  | "CREATE_DISTINCT_NOSTR_IDENTITIES"
  | "PROVISION_HOUSEHOLD_AGENT"
  | "PROVISION_HEAD_PERSONAL_AGENT"
  | "CREATE_REQUIRED_HOUSEHOLD_AND_PERSONAL_ROOMS"
  | "DERIVE_HUMAN_AND_AGENT_ROSTERS"
  | "START_CHANNEL_SCOPED_ACP_WORKLOADS"
  | "APPLY_MEMBERSHIPS_AND_ACP_ALLOWLISTS"
  | "ISSUE_VERSIONED_CONSUMER_APPS_CATALOG"
  | "PERSIST_HOUSEHOLD_APPS_DECISIONS"
  | "PERSIST_PRIVATE_APPS_DECISIONS"
  | "VERIFY_NO_UNCONSENTED_PROVIDER_GRANTS"
  | "VERIFY_AUTHORITATIVE_AND_PROJECTED_READBACKS"
  | "ISSUE_WORKSPACE_DESTINATION";
export type GeneratedAvatar = {
  artifactId: string;
  mediaType: "image/jpeg" | "image/png" | "image/webp";
  altText: string;
};
export type FounderOnboardingSnapshot = {
  state: FounderOnboardingState;
  profileRevision: number;
  completedSteps: FounderOnboardingStep[];
  csrfToken: string;
  provisioningStep: FounderProvisioningStep | null;
  generatedAvatars: {
    householdAgent: GeneratedAvatar;
    personalAgent: GeneratedAvatar;
  } | null;
  blockedCode?: string;
  destinationPath?: string;
};
export type FounderProfileSelection = {
  expectedRevision: number;
  householdName: string;
  humanDisplayName: string;
  householdAgent: {
    displayName: string;
    avatarArtifactId: string;
    avatarAltText: string;
    avatarAccepted: true;
  };
  personalAgent: {
    displayName: string;
    avatarArtifactId: string;
    avatarAltText: string;
    avatarAccepted: true;
  };
};
export type FounderProfileMutation = {
  state: "PROVISIONING";
  profileRevision: number;
  operation: {
    operationId: string;
    idempotencyKey: string;
    state: "VERIFIED";
    retrySafe: true;
    mutationPossible: false;
    nextAction: "WAIT_FOR_PROVISIONING";
    policyRevision: number;
    readbackAt: number;
  };
  readback: {
    householdName: string;
    humanDisplayName: string;
    householdAgent: {
      id: string;
      displayName: string;
      avatarArtifactId: string;
    };
    personalAgent: {
      id: string;
      displayName: string;
      avatarArtifactId: string;
    };
  };
};

type JsonObject = Record<string, unknown>;
const API_PREFIX = "/api/micasa/v1";
const ONBOARDING_PATH = `${API_PREFIX}/onboarding`;
const PROVISION_PATH = `${ONBOARDING_PATH}/provision`;
const REQUEST_TIMEOUT_MS = 15_000;
const PUBLIC_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const CSRF = /^[A-Za-z0-9_-]{32,256}$/;
const BLOCKED_CODE = /^[A-Z][A-Z0-9_]{2,95}$/;
const RESERVED_NAMES = new Set(["fizz", "honey", "pollen"]);
const STEPS = [
  "PROFILES",
  "PROVISIONING",
  "HOUSEHOLD_APPS",
  "PRIVATE_APPS",
] as const;
const PROVISIONING_STEPS = [
  "CREATE_PA_HOUSEHOLD_TENANT",
  "ESTABLISH_HEAD_MEMBERSHIP",
  "BIND_HEAD_ACCOUNT_AND_NOSTR_IDENTITY",
  "PERSIST_PRESENTATION_PROFILES_AND_AVATARS",
  "CREATE_BUILDERLAB_BUZZ_COMMUNITY",
  "VERIFY_ONE_TO_ONE_COMMUNITY_MAPPING",
  "CREATE_PA_DEFINED_ROOMS",
  "PROJECT_AUTHORIZED_BUZZ_CHANNELS",
  "CREATE_DISTINCT_NOSTR_IDENTITIES",
  "PROVISION_HOUSEHOLD_AGENT",
  "PROVISION_HEAD_PERSONAL_AGENT",
  "CREATE_REQUIRED_HOUSEHOLD_AND_PERSONAL_ROOMS",
  "DERIVE_HUMAN_AND_AGENT_ROSTERS",
  "START_CHANNEL_SCOPED_ACP_WORKLOADS",
  "APPLY_MEMBERSHIPS_AND_ACP_ALLOWLISTS",
  "ISSUE_VERSIONED_CONSUMER_APPS_CATALOG",
  "PERSIST_HOUSEHOLD_APPS_DECISIONS",
  "PERSIST_PRIVATE_APPS_DECISIONS",
  "VERIFY_NO_UNCONSENTED_PROVIDER_GRANTS",
  "VERIFY_AUTHORITATIVE_AND_PROJECTED_READBACKS",
  "ISSUE_WORKSPACE_DESTINATION",
] as const;

function object(value: unknown, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FounderOnboardingContractError(`${label} must be an object.`);
  }
  return value as JsonObject;
}
function exact(record: JsonObject, keys: readonly string[], label: string) {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new FounderOnboardingContractError(
      `${label} has an unsupported field.`,
    );
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
    value.trim().length === 0 ||
    value.length > maximum
  ) {
    throw new FounderOnboardingContractError(`${label}.${key} must be text.`);
  }
  return value;
}
function ref(record: JsonObject, key: string, label: string): string {
  const value = text(record, key, label);
  if (!PUBLIC_REF.test(value)) {
    throw new FounderOnboardingContractError(
      `${label}.${key} must be an opaque reference.`,
    );
  }
  return value;
}
function positiveInteger(
  record: JsonObject,
  key: string,
  label: string,
): number {
  const value = record[key];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new FounderOnboardingContractError(
      `${label}.${key} must be a positive integer.`,
    );
  }
  return value as number;
}
function safePath(record: JsonObject, key: string, label: string): string {
  const value = text(record, key, label);
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    throw new FounderOnboardingContractError(
      `${label}.${key} must be a safe path.`,
    );
  }
  return value;
}
function parseState(value: unknown): FounderOnboardingState {
  const states: FounderOnboardingState[] = [
    "PROFILE_REQUIRED",
    "PROVISIONING",
    "HOUSEHOLD_APPS_REQUIRED",
    "PRIVATE_APPS_REQUIRED",
    "FINALIZING",
    "READY",
    "BLOCKED",
  ];
  if (
    typeof value !== "string" ||
    !states.includes(value as FounderOnboardingState)
  ) {
    throw new FounderOnboardingContractError(
      "onboarding.state has an unsupported value.",
    );
  }
  return value as FounderOnboardingState;
}
function parseSteps(value: unknown): FounderOnboardingStep[] {
  if (!Array.isArray(value)) {
    throw new FounderOnboardingContractError(
      "onboarding.completedSteps must be an array.",
    );
  }
  return value.map((step, index) => {
    if (
      typeof step !== "string" ||
      !STEPS.includes(step as FounderOnboardingStep)
    ) {
      throw new FounderOnboardingContractError(
        `onboarding.completedSteps[${index}] is invalid.`,
      );
    }
    return step as FounderOnboardingStep;
  });
}
function parseAvatar(value: unknown, label: string): GeneratedAvatar {
  const record = object(value, label);
  exact(record, ["artifactId", "mediaType", "altText"], label);
  const mediaType = text(record, "mediaType", label);
  if (!["image/jpeg", "image/png", "image/webp"].includes(mediaType)) {
    throw new FounderOnboardingContractError(
      `${label}.mediaType is unsupported.`,
    );
  }
  return {
    artifactId: ref(record, "artifactId", label),
    mediaType: mediaType as GeneratedAvatar["mediaType"],
    altText: text(record, "altText", label, 160),
  };
}
function expectedPrefix(
  state: FounderOnboardingState,
): FounderOnboardingStep[] | null {
  if (state === "PROFILE_REQUIRED") return [];
  if (state === "PROVISIONING") return ["PROFILES"];
  if (state === "HOUSEHOLD_APPS_REQUIRED") {
    return ["PROFILES", "PROVISIONING"];
  }
  if (state === "PRIVATE_APPS_REQUIRED") {
    return ["PROFILES", "PROVISIONING", "HOUSEHOLD_APPS"];
  }
  if (state === "FINALIZING") return [...STEPS];
  if (state === "READY") return [...STEPS];
  return null;
}

export function parseFounderOnboarding(
  value: unknown,
): FounderOnboardingSnapshot {
  const record = object(value, "onboarding");
  const state = parseState(record.state);
  const keys = [
    "state",
    "profileRevision",
    "completedSteps",
    "csrfToken",
    "generatedAvatars",
    "provisioningStep",
  ];
  if (state === "BLOCKED") keys.push("blockedCode");
  if (state === "READY") keys.push("destinationPath");
  exact(record, keys, "onboarding");
  const csrfToken = text(record, "csrfToken", "onboarding");
  if (!CSRF.test(csrfToken)) {
    throw new FounderOnboardingContractError(
      "onboarding.csrfToken is invalid.",
    );
  }
  const completedSteps = parseSteps(record.completedSteps);
  const provisioningStep =
    record.provisioningStep === null
      ? null
      : typeof record.provisioningStep === "string" &&
          PROVISIONING_STEPS.includes(
            record.provisioningStep as FounderProvisioningStep,
          )
        ? (record.provisioningStep as FounderProvisioningStep)
        : (() => {
            throw new FounderOnboardingContractError(
              "onboarding.provisioningStep is invalid.",
            );
          })();
  if (
    ((state === "PROFILE_REQUIRED" || state === "READY") &&
      provisioningStep !== null) ||
    (state !== "PROFILE_REQUIRED" &&
      state !== "READY" &&
      provisioningStep === null)
  ) {
    throw new FounderOnboardingContractError(
      "onboarding.provisioningStep contradicts its state.",
    );
  }
  const prefix = expectedPrefix(state);
  if (
    prefix !== null &&
    (completedSteps.length !== prefix.length ||
      completedSteps.some((step, index) => step !== prefix[index]))
  ) {
    throw new FounderOnboardingContractError(
      "onboarding.completedSteps is not the required prefix.",
    );
  }
  if (
    prefix === null &&
    !STEPS.slice(0, completedSteps.length).every(
      (step, index) => step === completedSteps[index],
    )
  ) {
    throw new FounderOnboardingContractError(
      "onboarding.completedSteps is not a valid prefix.",
    );
  }
  let generatedAvatars: FounderOnboardingSnapshot["generatedAvatars"] = null;
  if (state === "PROFILE_REQUIRED") {
    const avatars = object(record.generatedAvatars, "generatedAvatars");
    exact(avatars, ["householdAgent", "personalAgent"], "generatedAvatars");
    generatedAvatars = {
      householdAgent: parseAvatar(
        avatars.householdAgent,
        "generatedAvatars.householdAgent",
      ),
      personalAgent: parseAvatar(
        avatars.personalAgent,
        "generatedAvatars.personalAgent",
      ),
    };
    if (
      generatedAvatars.householdAgent.artifactId ===
      generatedAvatars.personalAgent.artifactId
    ) {
      throw new FounderOnboardingContractError(
        "Generated avatars must be distinct artifacts.",
      );
    }
  } else if (record.generatedAvatars !== null) {
    throw new FounderOnboardingContractError(
      "Generated avatars are only valid during profile selection.",
    );
  }
  const result: FounderOnboardingSnapshot = {
    state,
    profileRevision: positiveInteger(record, "profileRevision", "onboarding"),
    completedSteps,
    csrfToken,
    provisioningStep,
    generatedAvatars,
  };
  if (state === "BLOCKED") {
    const blockedCode = text(record, "blockedCode", "onboarding", 96);
    if (!BLOCKED_CODE.test(blockedCode)) {
      throw new FounderOnboardingContractError(
        "onboarding.blockedCode is invalid.",
      );
    }
    result.blockedCode = blockedCode;
  }
  if (state === "READY") {
    result.destinationPath = safePath(record, "destinationPath", "onboarding");
  }
  return result;
}

function parseReadbackAgent(value: unknown, label: string) {
  const record = object(value, label);
  exact(record, ["id", "displayName", "avatarArtifactId"], label);
  return {
    id: ref(record, "id", label),
    displayName: text(record, "displayName", label, 80),
    avatarArtifactId: ref(record, "avatarArtifactId", label),
  };
}
export function parseFounderProfileMutation(
  value: unknown,
): FounderProfileMutation {
  const record = object(value, "founderProfileMutation");
  exact(
    record,
    ["state", "profileRevision", "operation", "readback"],
    "founderProfileMutation",
  );
  if (record.state !== "PROVISIONING") {
    throw new FounderOnboardingContractError(
      "founderProfileMutation.state is invalid.",
    );
  }
  const operation = object(
    record.operation,
    "founderProfileMutation.operation",
  );
  exact(
    operation,
    [
      "operationId",
      "idempotencyKey",
      "state",
      "retrySafe",
      "mutationPossible",
      "nextAction",
      "policyRevision",
      "readbackAt",
    ],
    "founderProfileMutation.operation",
  );
  if (
    operation.state !== "VERIFIED" ||
    operation.retrySafe !== true ||
    operation.mutationPossible !== false ||
    operation.nextAction !== "WAIT_FOR_PROVISIONING"
  ) {
    throw new FounderOnboardingContractError(
      "founderProfileMutation.operation is not a verified readback.",
    );
  }
  const readback = object(record.readback, "founderProfileMutation.readback");
  exact(
    readback,
    ["householdName", "humanDisplayName", "householdAgent", "personalAgent"],
    "founderProfileMutation.readback",
  );
  return {
    state: "PROVISIONING",
    profileRevision: positiveInteger(
      record,
      "profileRevision",
      "founderProfileMutation",
    ),
    operation: {
      operationId: ref(
        operation,
        "operationId",
        "founderProfileMutation.operation",
      ),
      idempotencyKey: ref(
        operation,
        "idempotencyKey",
        "founderProfileMutation.operation",
      ),
      state: "VERIFIED",
      retrySafe: true,
      mutationPossible: false,
      nextAction: "WAIT_FOR_PROVISIONING",
      policyRevision: positiveInteger(
        operation,
        "policyRevision",
        "founderProfileMutation.operation",
      ),
      readbackAt: positiveInteger(
        operation,
        "readbackAt",
        "founderProfileMutation.operation",
      ),
    },
    readback: {
      householdName: text(
        readback,
        "householdName",
        "founderProfileMutation.readback",
        80,
      ),
      humanDisplayName: text(
        readback,
        "humanDisplayName",
        "founderProfileMutation.readback",
        80,
      ),
      householdAgent: parseReadbackAgent(
        readback.householdAgent,
        "founderProfileMutation.readback.householdAgent",
      ),
      personalAgent: parseReadbackAgent(
        readback.personalAgent,
        "founderProfileMutation.readback.personalAgent",
      ),
    },
  };
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

function normalizedName(value: string, label: string): string {
  const normalized = value.normalize("NFC").trim();
  if (
    normalized.length < 1 ||
    normalized.length > 80 ||
    hasControlCharacter(normalized) ||
    normalized.includes("://")
  ) {
    throw new FounderOnboardingContractError(`${label} is invalid.`);
  }
  if (RESERVED_NAMES.has(normalized.toLocaleLowerCase())) {
    throw new FounderOnboardingContractError(`${label} is reserved.`);
  }
  return normalized;
}
export function validateFounderProfileSelection(
  value: FounderProfileSelection,
  snapshot: FounderOnboardingSnapshot,
): FounderProfileSelection {
  if (
    snapshot.state !== "PROFILE_REQUIRED" ||
    snapshot.generatedAvatars === null ||
    value.expectedRevision !== snapshot.profileRevision
  ) {
    throw new FounderOnboardingContractError(
      "The founder profile authority is stale.",
    );
  }
  const householdName = normalizedName(value.householdName, "Household name");
  const humanDisplayName = normalizedName(
    value.humanDisplayName,
    "Human display name",
  );
  const householdAgentName = normalizedName(
    value.householdAgent.displayName,
    "Household Agent name",
  );
  const personalAgentName = normalizedName(
    value.personalAgent.displayName,
    "My Agent name",
  );
  if (
    new Set(
      [humanDisplayName, householdAgentName, personalAgentName].map((name) =>
        name.toLocaleLowerCase(),
      ),
    ).size !== 3
  ) {
    throw new FounderOnboardingContractError(
      "Human and agent names must be unique in this Household.",
    );
  }
  if (
    value.householdAgent.avatarAccepted !== true ||
    value.personalAgent.avatarAccepted !== true
  ) {
    throw new FounderOnboardingContractError(
      "Both generated agent avatars require explicit acceptance.",
    );
  }
  if (
    value.householdAgent.avatarArtifactId !==
      snapshot.generatedAvatars.householdAgent.artifactId ||
    value.personalAgent.avatarArtifactId !==
      snapshot.generatedAvatars.personalAgent.artifactId
  ) {
    throw new FounderOnboardingContractError(
      "The generated avatar authority has changed.",
    );
  }
  return {
    expectedRevision: value.expectedRevision,
    householdName,
    humanDisplayName,
    householdAgent: {
      displayName: householdAgentName,
      avatarArtifactId: value.householdAgent.avatarArtifactId,
      avatarAltText: snapshot.generatedAvatars.householdAgent.altText,
      avatarAccepted: true,
    },
    personalAgent: {
      displayName: personalAgentName,
      avatarArtifactId: value.personalAgent.avatarArtifactId,
      avatarAltText: snapshot.generatedAvatars.personalAgent.altText,
      avatarAccepted: true,
    },
  };
}

function apiBase(): URL {
  const configured = import.meta.env.VITE_PA_BFF_ORIGIN?.trim();
  const base = new URL(configured || window.location.origin);
  if (!isAllowedMiCasaOrigin(base, import.meta.env.PROD)) {
    throw new FounderOnboardingContractError(
      "The production Personal-Agent BFF origin must use HTTPS.",
    );
  }
  return base;
}
function endpoint(path: string): URL {
  if (!path.startsWith(`${API_PREFIX}/`)) {
    throw new FounderOnboardingContractError("Refusing a non-MiCasa API path.");
  }
  return new URL(path, apiBase());
}
async function requestJson<T>(
  path: string,
  parse: (value: unknown) => T,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(endpoint(path), {
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
        ? "This setup step changed. Refresh before continuing."
        : response.status === 401
          ? "Your MiCasa session has expired."
          : "Personal-Agent could not verify this setup step.",
    );
  }
  return parse(body);
}
export function loadFounderOnboarding(): Promise<FounderOnboardingSnapshot> {
  return requestJson(ONBOARDING_PATH, parseFounderOnboarding);
}
export function advanceFounderProvisioning(
  snapshot: FounderOnboardingSnapshot,
): Promise<FounderOnboardingSnapshot> {
  if (snapshot.state === "PROFILE_REQUIRED") {
    throw new FounderOnboardingContractError(
      "Founder profiles must be saved before provisioning.",
    );
  }
  return requestJson(PROVISION_PATH, parseFounderOnboarding, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": snapshot.csrfToken,
    },
    body: JSON.stringify({ expectedRevision: snapshot.profileRevision }),
  });
}
export function saveFounderProfiles(
  selection: FounderProfileSelection,
  snapshot: FounderOnboardingSnapshot,
): Promise<FounderProfileMutation> {
  const body = validateFounderProfileSelection(selection, snapshot);
  return requestJson(
    `${ONBOARDING_PATH}/profiles`,
    parseFounderProfileMutation,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": snapshot.csrfToken,
      },
      body: JSON.stringify(body),
    },
  );
}

import { isAllowedMiCasaOrigin } from "./origin-policy.ts";

export class AgentProfileSettingsContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentProfileSettingsContractError";
  }
}

export type AgentProfileScope = "HOUSEHOLD" | "PRIVATE";
export type AvatarOption = {
  artifactId: string;
  mediaType: "image/avif" | "image/jpeg" | "image/png" | "image/webp";
  altText: string;
  source: "GENERATED" | "UPLOADED";
  contentPath: string;
};
export type AgentPresentation = {
  agentInstanceId: string;
  displayName: string;
  aliases: string[];
  avatarArtifactId: string;
  avatarAltText: string;
  publicBio: string;
  profileRevision: number;
  characterRevision: number;
};
export type AgentProfileSettingsSnapshot = {
  scope: AgentProfileScope;
  householdId: string;
  csrfToken: string;
  profile: AgentPresentation;
  availableAvatars: AvatarOption[];
};
export type AgentProfileDraft = {
  displayName: string;
  aliases: string[];
  avatarArtifactId: string;
  avatarAltText: string;
  publicBio: string;
};
export type AgentProfileMutation = {
  state: "VERIFIED";
  operation: {
    operationId: string;
    idempotencyKey: string;
    operation:
      | "UPDATE_HOUSEHOLD_AGENT_PROFILE"
      | "UPDATE_PERSONAL_AGENT_PROFILE";
    retrySafe: true;
    mutationPossible: false;
    nextAction: "REFRESH_AGENT_SETTINGS";
    policyRevision: number;
    readbackAt: number;
    effects: string[];
  };
  readback: AgentProfileSettingsSnapshot;
};

type JsonObject = Record<string, unknown>;
const API_PREFIX = "/api/micasa/v1";
const PATHS: Record<AgentProfileScope, string> = {
  HOUSEHOLD: `${API_PREFIX}/settings/household/agent-profile`,
  PRIVATE: `${API_PREFIX}/settings/user/agent-profile`,
};
const OPERATIONS: Record<
  AgentProfileScope,
  AgentProfileMutation["operation"]["operation"]
> = {
  HOUSEHOLD: "UPDATE_HOUSEHOLD_AGENT_PROFILE",
  PRIVATE: "UPDATE_PERSONAL_AGENT_PROFILE",
};
const EFFECTS = [
  "PRESENTATION_UPDATED",
  "TENANT_NAMES_RECONCILED",
  "NOSTR_PROFILE_PROJECTED",
  "ACP_PROFILE_READBACK",
  "CACHE_INVALIDATED",
  "IDENTITY_PRESERVED",
  "STATE_PRESERVED",
  "CAPABILITIES_UNCHANGED",
] as const;
const REQUEST_TIMEOUT_MS = 15_000;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const CSRF = /^[A-Za-z0-9_-]{32,256}$/;
const MEDIA_TYPES = [
  "image/avif",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;
const RESERVED_NAMES = new Set(["fizz", "honey", "pollen"]);
const CREDENTIAL_MARKERS =
  /(?:access[_ -]?key|api[_ -]?key|bearer|credential|nsec|password|private[_ -]?key|refresh[_ -]?token|secret|session[_ -]?token|setup[_ -]?token)\s*[:=]/i;

function fail(message: string): never {
  throw new AgentProfileSettingsContractError(message);
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
  maximum: number,
  allowEmpty = false,
): string {
  const value = record[key];
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (!allowEmpty && value.length < 1) ||
    value !== value.trim() ||
    hasControlCharacter(value) ||
    CREDENTIAL_MARKERS.test(value)
  ) {
    fail(`${label}.${key} must be safe text.`);
  }
  return value;
}
function ref(record: JsonObject, key: string, label: string): string {
  const value = text(record, key, label, 256);
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
function normalizedName(value: string, label: string): string {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  if (!normalized || RESERVED_NAMES.has(normalized)) {
    fail(`${label} is reserved or invalid.`);
  }
  return normalized;
}
function names(
  displayName: string,
  aliases: string[],
  label: string,
): { displayName: string; aliases: string[] } {
  if (
    displayName.length < 1 ||
    displayName.length > 80 ||
    displayName !== displayName.trim() ||
    aliases.length > 8 ||
    aliases.some(
      (alias) =>
        typeof alias !== "string" ||
        alias.length < 1 ||
        alias.length > 80 ||
        alias !== alias.trim(),
    )
  ) {
    fail(`${label} contains an invalid name.`);
  }
  const displayNormalized = normalizedName(displayName, `${label}.displayName`);
  const aliasNormalized = aliases.map((alias, index) =>
    normalizedName(alias, `${label}.aliases[${index}]`),
  );
  if (
    new Set(aliasNormalized).size !== aliasNormalized.length ||
    aliasNormalized.includes(displayNormalized)
  ) {
    fail(`${label} contains duplicate names.`);
  }
  return { displayName, aliases };
}
function safeContentPath(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/api/micasa/v1/media/") ||
    value.startsWith("//") ||
    value.includes("?") ||
    value.includes("#") ||
    value.includes("\\")
  ) {
    fail(`${label} must be a same-origin media path.`);
  }
  return value;
}
function parseAvatar(value: unknown, index: number): AvatarOption {
  const label = `agentProfile.availableAvatars[${index}]`;
  const record = object(value, label);
  exact(
    record,
    ["artifactId", "mediaType", "altText", "source", "contentPath"],
    label,
  );
  return {
    artifactId: ref(record, "artifactId", label),
    mediaType: choice(record.mediaType, MEDIA_TYPES, `${label}.mediaType`),
    altText: text(record, "altText", label, 200),
    source: choice(
      record.source,
      ["GENERATED", "UPLOADED"] as const,
      `${label}.source`,
    ),
    contentPath: safeContentPath(record.contentPath, `${label}.contentPath`),
  };
}
function parseProfile(value: unknown): AgentPresentation {
  const label = "agentProfile.profile";
  const record = object(value, label);
  exact(
    record,
    [
      "agentInstanceId",
      "displayName",
      "aliases",
      "avatarArtifactId",
      "avatarAltText",
      "publicBio",
      "profileRevision",
      "characterRevision",
    ],
    label,
  );
  if (!Array.isArray(record.aliases))
    fail(`${label}.aliases must be an array.`);
  const displayName = text(record, "displayName", label, 80);
  const aliases = record.aliases.map((alias, index) => {
    if (typeof alias !== "string") {
      fail(`${label}.aliases[${index}] must be text.`);
    }
    return alias;
  });
  names(displayName, aliases, label);
  return {
    agentInstanceId: ref(record, "agentInstanceId", label),
    displayName,
    aliases,
    avatarArtifactId: ref(record, "avatarArtifactId", label),
    avatarAltText: text(record, "avatarAltText", label, 200),
    publicBio: text(record, "publicBio", label, 500, true),
    profileRevision: positive(record, "profileRevision", label),
    characterRevision: positive(record, "characterRevision", label),
  };
}

export function parseAgentProfileSettings(
  value: unknown,
): AgentProfileSettingsSnapshot {
  const record = object(value, "agentProfile");
  exact(
    record,
    ["scope", "householdId", "csrfToken", "profile", "availableAvatars"],
    "agentProfile",
  );
  const csrfToken = text(record, "csrfToken", "agentProfile", 256);
  if (!CSRF.test(csrfToken)) fail("agentProfile.csrfToken is invalid.");
  if (!Array.isArray(record.availableAvatars)) {
    fail("agentProfile.availableAvatars must be an array.");
  }
  const availableAvatars = record.availableAvatars.map(parseAvatar);
  const profile = parseProfile(record.profile);
  if (
    availableAvatars.length < 1 ||
    new Set(availableAvatars.map((avatar) => avatar.artifactId)).size !==
      availableAvatars.length ||
    !availableAvatars.some(
      (avatar) => avatar.artifactId === profile.avatarArtifactId,
    )
  ) {
    fail("Agent avatar authority is incomplete.");
  }
  return {
    scope: choice(
      record.scope,
      ["HOUSEHOLD", "PRIVATE"] as const,
      "agentProfile.scope",
    ),
    householdId: ref(record, "householdId", "agentProfile"),
    csrfToken,
    profile,
    availableAvatars,
  };
}

export function buildAgentProfilePayload(
  snapshot: AgentProfileSettingsSnapshot,
  draft: AgentProfileDraft,
): JsonObject {
  if (!Array.isArray(draft.aliases)) {
    fail("agentProfileDraft.aliases must be an array.");
  }
  const parsedNames = names(
    draft.displayName,
    draft.aliases,
    "agentProfileDraft",
  );
  if (
    !snapshot.availableAvatars.some(
      (avatar) => avatar.artifactId === draft.avatarArtifactId,
    )
  ) {
    fail("Choose an avatar approved by Personal-Agent.");
  }
  const synthetic = {
    avatarAltText: draft.avatarAltText,
    publicBio: draft.publicBio,
  };
  text(synthetic, "avatarAltText", "agentProfileDraft", 200);
  text(synthetic, "publicBio", "agentProfileDraft", 500, true);
  return {
    expectedRevision: snapshot.profile.profileRevision,
    displayName: parsedNames.displayName,
    aliases: parsedNames.aliases,
    avatarArtifactId: draft.avatarArtifactId,
    avatarAltText: draft.avatarAltText,
    publicBio: draft.publicBio,
  };
}

function parseOperation(
  value: unknown,
  scope: AgentProfileScope,
): AgentProfileMutation["operation"] {
  const label = "agentProfileMutation.operation";
  const record = object(value, label);
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
    label,
  );
  if (
    record.operation !== OPERATIONS[scope] ||
    record.retrySafe !== true ||
    record.mutationPossible !== false ||
    record.nextAction !== "REFRESH_AGENT_SETTINGS" ||
    !Array.isArray(record.effects)
  ) {
    fail("The agent-profile mutation lacks verified readback.");
  }
  const effects = record.effects;
  const expected = [...EFFECTS].sort();
  if (
    effects.some((effect) => typeof effect !== "string") ||
    new Set(effects).size !== effects.length ||
    [...effects].sort().some((effect, index) => effect !== expected[index]) ||
    effects.length !== expected.length
  ) {
    fail("The agent-profile mutation is missing continuity effects.");
  }
  return {
    operationId: ref(record, "operationId", label),
    idempotencyKey: ref(record, "idempotencyKey", label),
    operation: OPERATIONS[scope],
    retrySafe: true,
    mutationPossible: false,
    nextAction: "REFRESH_AGENT_SETTINGS",
    policyRevision: positive(record, "policyRevision", label),
    readbackAt: positive(record, "readbackAt", label),
    effects: effects as string[],
  };
}

export function parseAgentProfileMutation(
  value: unknown,
  before: AgentProfileSettingsSnapshot,
  draft: AgentProfileDraft,
): AgentProfileMutation {
  const record = object(value, "agentProfileMutation");
  exact(record, ["state", "operation", "readback"], "agentProfileMutation");
  if (record.state !== "VERIFIED") {
    fail("The agent-profile mutation is unverified.");
  }
  const operation = parseOperation(record.operation, before.scope);
  const readback = parseAgentProfileSettings(record.readback);
  const expected = buildAgentProfilePayload(before, draft);
  if (
    readback.scope !== before.scope ||
    readback.householdId !== before.householdId ||
    readback.profile.agentInstanceId !== before.profile.agentInstanceId ||
    readback.profile.profileRevision !== before.profile.profileRevision + 1 ||
    readback.profile.characterRevision !== before.profile.characterRevision ||
    readback.profile.displayName !== expected.displayName ||
    JSON.stringify(readback.profile.aliases) !==
      JSON.stringify(expected.aliases) ||
    readback.profile.avatarArtifactId !== expected.avatarArtifactId ||
    readback.profile.avatarAltText !== expected.avatarAltText ||
    readback.profile.publicBio !== expected.publicBio
  ) {
    fail(
      "The agent-profile mutation changed identity or lacks exact readback.",
    );
  }
  return { state: "VERIFIED", operation, readback };
}

function apiBase(): URL {
  const configured = import.meta.env.VITE_PA_BFF_ORIGIN?.trim();
  const base = new URL(configured || window.location.origin);
  if (!isAllowedMiCasaOrigin(base, import.meta.env.PROD)) {
    fail("The production Personal-Agent BFF origin must use HTTPS.");
  }
  return base;
}
function endpoint(scope: AgentProfileScope, householdId: string): URL {
  if (!REF.test(householdId)) fail("The Household identifier is invalid.");
  const url = new URL(PATHS[scope], apiBase());
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
        ? "This agent profile changed. Refresh before saving."
        : response.status === 401
          ? "Your MiCasa session has expired."
          : response.status === 403
            ? "You are not allowed to edit this agent profile."
            : "Personal-Agent could not verify this agent profile.",
    );
  }
  return parser(body);
}
export function loadAgentProfileSettings(
  scope: AgentProfileScope,
  householdId: string,
): Promise<AgentProfileSettingsSnapshot> {
  return requestJson(endpoint(scope, householdId), parseAgentProfileSettings);
}
export function saveAgentProfileSettings(
  snapshot: AgentProfileSettingsSnapshot,
  draft: AgentProfileDraft,
): Promise<AgentProfileMutation> {
  return requestJson(
    endpoint(snapshot.scope, snapshot.householdId),
    (value) => parseAgentProfileMutation(value, snapshot, draft),
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": snapshot.csrfToken,
      },
      body: JSON.stringify(buildAgentProfilePayload(snapshot, draft)),
    },
  );
}

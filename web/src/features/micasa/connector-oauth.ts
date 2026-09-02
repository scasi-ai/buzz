import type { AppsTier } from "./apps-onboarding.ts";
import { isAllowedMiCasaOrigin } from "./origin-policy.ts";

export class ConnectorOAuthContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorOAuthContractError";
  }
}

export type ConnectorOAuthState =
  | "AUTHORIZING"
  | "CALLBACK_PENDING"
  | "FINALIZING"
  | "CONNECTED"
  | "DENIED"
  | "EXPIRED"
  | "OUTCOME_UNKNOWN";

export type ConnectorOAuthSnapshot = {
  schema: "micasa.connector_oauth_response.v1";
  oauthRef: string;
  householdRef: string;
  tier: AppsTier;
  serviceId: string;
  state: ConnectorOAuthState;
  returnPath: string;
  observedAt: string;
  expiresAt: string;
};

export type ConnectorOAuthStart = ConnectorOAuthSnapshot & {
  authorizationUrl: string;
};

export type ConnectorOAuthResource = {
  resourceRef: string;
  displayName: string;
  primary: boolean;
  accessRole:
    | "freeBusyReader"
    | "reader"
    | "writer"
    | "writerWithoutPrivateAccess"
    | "owner";
  providerSelected: boolean;
  providerHidden: boolean;
};

export type ConnectorOAuthResources = {
  schema: "micasa.connector_oauth_resources.v1";
  oauthRef: string;
  householdRef: string;
  tier: AppsTier;
  resources: ConnectorOAuthResource[];
  selectedResourceRefs: string[];
  revision: number;
  observedAt: string;
  expiresAt: string;
};

export type ConnectorOAuthContext = {
  householdRef: string;
  tier: AppsTier;
  serviceId: string;
  returnPath: string;
};

export type ConnectorOAuthResume = ConnectorOAuthContext & {
  schema: "micasa.connector_oauth_resume.v1";
  oauthRef: string;
  expiresAt: string;
};

type JsonObject = Record<string, unknown>;

const API_PREFIX = "/api/micasa/v1";
const RESPONSE_SCHEMA = "micasa.connector_oauth_response.v1";
const RESOURCES_SCHEMA = "micasa.connector_oauth_resources.v1";
const RESUME_SCHEMA = "micasa.connector_oauth_resume.v1";
const REQUEST_TIMEOUT_MS = 15_000;
const TENANT = /^tenant:[0-9a-f]{64}$/;
const OAUTH = /^connector-oauth:[0-9a-f]{64}$/;
const RESOURCE = /^provider-resource:[0-9a-f]{64}$/;
const SERVICE = /^[a-z][a-z0-9-]{0,47}$/;
const CSRF = /^[A-Za-z0-9_-]{32,256}$/;
const RFC3339_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const STATES: ConnectorOAuthState[] = [
  "AUTHORIZING",
  "CALLBACK_PENDING",
  "FINALIZING",
  "CONNECTED",
  "DENIED",
  "EXPIRED",
  "OUTCOME_UNKNOWN",
];
const ACCESS_ROLES: ConnectorOAuthResource["accessRole"][] = [
  "freeBusyReader",
  "reader",
  "writer",
  "writerWithoutPrivateAccess",
  "owner",
];

function fail(message: string): never {
  throw new ConnectorOAuthContractError(message);
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

function text(value: unknown, pattern: RegExp, label: string): string {
  if (typeof value !== "string" || !pattern.test(value))
    fail(`${label} is invalid.`);
  return value as string;
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

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
}

function safePath(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 512 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("#") ||
    value.includes("\\") ||
    hasControlCharacters(value)
  ) {
    fail(`${label} is invalid.`);
  }
  const parsed = new URL(value, "https://micasa.invalid");
  if (parsed.origin !== "https://micasa.invalid") fail(`${label} is invalid.`);
  return value;
}

function timestamp(
  value: unknown,
  label: string,
): { text: string; epoch: number } {
  if (typeof value !== "string" || !RFC3339_SECONDS.test(value)) {
    fail(`${label} is invalid.`);
  }
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) fail(`${label} is invalid.`);
  return { text: value, epoch };
}

function timestamps(
  observedValue: unknown,
  expiresValue: unknown,
  maximumLifetimeSeconds: number,
  label: string,
) {
  const observed = timestamp(observedValue, `${label}.observedAt`);
  const expires = timestamp(expiresValue, `${label}.expiresAt`);
  if (
    expires.epoch <= observed.epoch ||
    expires.epoch - observed.epoch > maximumLifetimeSeconds * 1_000
  ) {
    fail(`${label} has an invalid authority lifetime.`);
  }
  return { observedAt: observed.text, expiresAt: expires.text };
}

function validateContext(context: ConnectorOAuthContext) {
  text(context.householdRef, TENANT, "connectorOAuth.householdRef");
  choice(
    context.tier,
    ["HOUSEHOLD", "PRIVATE"] as const,
    "connectorOAuth.tier",
  );
  text(context.serviceId, SERVICE, "connectorOAuth.serviceId");
  safePath(context.returnPath, "connectorOAuth.returnPath");
}

function parseSnapshot(
  value: unknown,
  expected?: ConnectorOAuthContext & { oauthRef?: string },
): ConnectorOAuthSnapshot {
  const record = object(value, "connectorOAuth");
  exact(
    record,
    [
      "schema",
      "oauthRef",
      "householdRef",
      "tier",
      "serviceId",
      "state",
      "returnPath",
      "observedAt",
      "expiresAt",
    ],
    "connectorOAuth",
  );
  if (record.schema !== RESPONSE_SCHEMA)
    fail("Connector OAuth schema is unsupported.");
  const result: ConnectorOAuthSnapshot = {
    schema: RESPONSE_SCHEMA,
    oauthRef: text(record.oauthRef, OAUTH, "connectorOAuth.oauthRef"),
    householdRef: text(
      record.householdRef,
      TENANT,
      "connectorOAuth.householdRef",
    ),
    tier: choice(
      record.tier,
      ["HOUSEHOLD", "PRIVATE"] as const,
      "connectorOAuth.tier",
    ),
    serviceId: text(record.serviceId, SERVICE, "connectorOAuth.serviceId"),
    state: choice(record.state, STATES, "connectorOAuth.state"),
    returnPath: safePath(record.returnPath, "connectorOAuth.returnPath"),
    ...timestamps(record.observedAt, record.expiresAt, 600, "connectorOAuth"),
  };
  if (
    expected &&
    (result.householdRef !== expected.householdRef ||
      result.tier !== expected.tier ||
      result.serviceId !== expected.serviceId ||
      result.returnPath !== expected.returnPath ||
      (expected.oauthRef !== undefined &&
        result.oauthRef !== expected.oauthRef))
  ) {
    fail("Connector OAuth readback changed its Household or service boundary.");
  }
  return result;
}

export function parseConnectorOAuthStatus(
  value: unknown,
  expected?: ConnectorOAuthContext & { oauthRef?: string },
): ConnectorOAuthSnapshot {
  return parseSnapshot(value, expected);
}

export function parseConnectorOAuthStart(
  value: unknown,
  expected: ConnectorOAuthContext,
): ConnectorOAuthStart {
  const record = object(value, "connectorOAuthStart");
  exact(
    record,
    [
      "schema",
      "oauthRef",
      "householdRef",
      "tier",
      "serviceId",
      "state",
      "returnPath",
      "observedAt",
      "expiresAt",
      "authorizationUrl",
    ],
    "connectorOAuthStart",
  );
  const { authorizationUrl, ...snapshotValue } = record;
  const snapshot = parseSnapshot(snapshotValue, expected);
  if (
    snapshot.state !== "AUTHORIZING" ||
    typeof authorizationUrl !== "string"
  ) {
    fail("Connector OAuth did not start in the authorizing state.");
  }
  let destination: URL;
  try {
    destination = new URL(authorizationUrl);
  } catch {
    fail("Connector OAuth returned an unsafe authorization destination.");
  }
  if (
    destination.protocol !== "https:" ||
    destination.hostname !== "accounts.google.com" ||
    destination.port !== "" ||
    destination.username !== "" ||
    destination.password !== "" ||
    destination.pathname !== "/o/oauth2/v2/auth" ||
    destination.search.length < 2 ||
    destination.hash !== ""
  ) {
    fail("Connector OAuth returned an unsafe authorization destination.");
  }
  return { ...snapshot, authorizationUrl: destination.toString() };
}

function parseResource(value: unknown, index: number): ConnectorOAuthResource {
  const label = `connectorOAuthResources.resources[${index}]`;
  const record = object(value, label);
  exact(
    record,
    [
      "resourceRef",
      "displayName",
      "primary",
      "accessRole",
      "providerSelected",
      "providerHidden",
    ],
    label,
  );
  if (
    typeof record.displayName !== "string" ||
    record.displayName.length < 1 ||
    record.displayName.length > 256 ||
    hasControlCharacters(record.displayName) ||
    typeof record.primary !== "boolean" ||
    typeof record.providerSelected !== "boolean" ||
    typeof record.providerHidden !== "boolean"
  ) {
    fail(`${label} is invalid.`);
  }
  return {
    resourceRef: text(record.resourceRef, RESOURCE, `${label}.resourceRef`),
    displayName: record.displayName,
    primary: record.primary,
    accessRole: choice(record.accessRole, ACCESS_ROLES, `${label}.accessRole`),
    providerSelected: record.providerSelected,
    providerHidden: record.providerHidden,
  };
}

export function parseConnectorOAuthResources(
  value: unknown,
  expected: Pick<ConnectorOAuthResume, "oauthRef" | "householdRef" | "tier">,
): ConnectorOAuthResources {
  const record = object(value, "connectorOAuthResources");
  exact(
    record,
    [
      "schema",
      "oauthRef",
      "householdRef",
      "tier",
      "resources",
      "selectedResourceRefs",
      "revision",
      "observedAt",
      "expiresAt",
    ],
    "connectorOAuthResources",
  );
  if (
    record.schema !== RESOURCES_SCHEMA ||
    !Array.isArray(record.resources) ||
    record.resources.length < 1 ||
    record.resources.length > 256 ||
    !Array.isArray(record.selectedResourceRefs) ||
    !Number.isSafeInteger(record.revision) ||
    (record.revision as number) < 1
  ) {
    fail("Connector OAuth resources are invalid.");
  }
  const oauthRef = text(
    record.oauthRef,
    OAUTH,
    "connectorOAuthResources.oauthRef",
  );
  const householdRef = text(
    record.householdRef,
    TENANT,
    "connectorOAuthResources.householdRef",
  );
  const tier = choice(
    record.tier,
    ["HOUSEHOLD", "PRIVATE"] as const,
    "connectorOAuthResources.tier",
  );
  const resources = record.resources.map(parseResource);
  const resourceRefs = resources.map((resource) => resource.resourceRef);
  const selectedResourceRefs = record.selectedResourceRefs.map((item, index) =>
    text(
      item,
      RESOURCE,
      `connectorOAuthResources.selectedResourceRefs[${index}]`,
    ),
  );
  if (
    oauthRef !== expected.oauthRef ||
    householdRef !== expected.householdRef ||
    tier !== expected.tier ||
    resourceRefs.join("\n") !== [...new Set(resourceRefs)].sort().join("\n") ||
    selectedResourceRefs.join("\n") !==
      [...new Set(selectedResourceRefs)].sort().join("\n") ||
    selectedResourceRefs.some((item) => !resourceRefs.includes(item)) ||
    resources.filter((resource) => resource.primary).length > 1
  ) {
    fail("Connector OAuth resources changed their authority boundary.");
  }
  return {
    schema: RESOURCES_SCHEMA,
    oauthRef,
    householdRef,
    tier,
    resources,
    selectedResourceRefs,
    revision: record.revision as number,
    ...timestamps(
      record.observedAt,
      record.expiresAt,
      300,
      "connectorOAuthResources",
    ),
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

function endpoint(path: string): URL {
  if (!path.startsWith(`${API_PREFIX}/`))
    fail("Refusing a non-MiCasa API path.");
  return new URL(path, apiBase());
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
        ? "This calendar selection changed. Refresh the calendars before saving."
        : response.status === 401
          ? "Your MiCasa session has expired."
          : response.status === 403
            ? "Personal-Agent refused this connector action for the current user."
            : "Personal-Agent could not verify the Google Calendar connection.",
    );
  }
  return parser(body);
}

export function connectorOAuthReturnPath(
  tier: AppsTier,
  householdRef: string,
): string {
  text(householdRef, TENANT, "connectorOAuth.householdRef");
  const path =
    tier === "HOUSEHOLD" ? "/settings/household/apps" : "/settings/user/apps";
  return `${path}?household=${encodeURIComponent(householdRef)}`;
}

function startIdempotencyKey(): string {
  if (typeof crypto.randomUUID !== "function") {
    fail("This browser cannot create a secure connector operation identifier.");
  }
  return `connector-oauth-start:${crypto.randomUUID()}`;
}

export function startConnectorOAuth(
  context: ConnectorOAuthContext,
  csrfToken: string,
): Promise<ConnectorOAuthStart> {
  validateContext(context);
  text(csrfToken, CSRF, "connectorOAuth.csrfToken");
  return requestJson(
    endpoint(`${API_PREFIX}/connectors/oauth/start`),
    (value) => parseConnectorOAuthStart(value, context),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({
        householdRef: context.householdRef,
        tier: context.tier,
        serviceId: context.serviceId,
        returnPath: context.returnPath,
        idempotencyKey: startIdempotencyKey(),
      }),
    },
  );
}

export function readConnectorOAuthStatus(
  resume: ConnectorOAuthResume,
): Promise<ConnectorOAuthSnapshot> {
  return requestJson(
    endpoint(
      `${API_PREFIX}/connectors/oauth/${encodeURIComponent(resume.oauthRef)}`,
    ),
    (value) => parseConnectorOAuthStatus(value, resume),
  );
}

export function discoverConnectorOAuthResources(
  resume: ConnectorOAuthResume,
  csrfToken: string,
): Promise<ConnectorOAuthResources> {
  text(csrfToken, CSRF, "connectorOAuth.csrfToken");
  return requestJson(
    endpoint(
      `${API_PREFIX}/connectors/oauth/${encodeURIComponent(resume.oauthRef)}/resources/discover`,
    ),
    (value) => parseConnectorOAuthResources(value, resume),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: "{}",
    },
  );
}

export function selectConnectorOAuthResources(
  resume: ConnectorOAuthResume,
  csrfToken: string,
  before: ConnectorOAuthResources,
  resourceRefs: readonly string[],
): Promise<ConnectorOAuthResources> {
  text(csrfToken, CSRF, "connectorOAuth.csrfToken");
  const selected = resourceRefs.map((item, index) =>
    text(item, RESOURCE, `connectorOAuth.resourceRefs[${index}]`),
  );
  const sorted = [...new Set(selected)].sort();
  if (
    sorted.length < 1 ||
    sorted.length !== selected.length ||
    selected.join("\n") !== sorted.join("\n") ||
    selected.some(
      (item) =>
        !before.resources.some((resource) => resource.resourceRef === item),
    )
  ) {
    fail("Choose at least one calendar from the verified discovery result.");
  }
  return requestJson(
    endpoint(
      `${API_PREFIX}/connectors/oauth/${encodeURIComponent(resume.oauthRef)}/resources`,
    ),
    (value) => parseConnectorOAuthResources(value, resume),
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrfToken,
      },
      body: JSON.stringify({
        expectedRevision: before.revision,
        resourceRefs: selected,
      }),
    },
  );
}

function resumeKey(context: ConnectorOAuthContext): string {
  validateContext(context);
  return `micasa.connector-oauth.resume.v1:${context.tier}:${context.householdRef}:${context.serviceId}`;
}

export function saveConnectorOAuthResume(
  storage: Storage,
  snapshot: ConnectorOAuthSnapshot,
): ConnectorOAuthResume {
  validateContext(snapshot);
  if (snapshot.schema !== RESPONSE_SCHEMA) {
    fail("Connector OAuth schema is unsupported.");
  }
  text(snapshot.oauthRef, OAUTH, "connectorOAuth.oauthRef");
  choice(snapshot.state, STATES, "connectorOAuth.state");
  timestamps(snapshot.observedAt, snapshot.expiresAt, 600, "connectorOAuth");
  const resume: ConnectorOAuthResume = {
    schema: RESUME_SCHEMA,
    oauthRef: snapshot.oauthRef,
    householdRef: snapshot.householdRef,
    tier: snapshot.tier,
    serviceId: snapshot.serviceId,
    returnPath: snapshot.returnPath,
    expiresAt: snapshot.expiresAt,
  };
  storage.setItem(resumeKey(resume), JSON.stringify(resume));
  return resume;
}

export function loadConnectorOAuthResume(
  storage: Storage,
  context: ConnectorOAuthContext,
  now = Date.now(),
): ConnectorOAuthResume | null {
  const key = resumeKey(context);
  const serialized = storage.getItem(key);
  if (serialized === null) return null;
  try {
    const record = object(JSON.parse(serialized), "connectorOAuthResume");
    exact(
      record,
      [
        "schema",
        "oauthRef",
        "householdRef",
        "tier",
        "serviceId",
        "returnPath",
        "expiresAt",
      ],
      "connectorOAuthResume",
    );
    const expires = timestamp(
      record.expiresAt,
      "connectorOAuthResume.expiresAt",
    );
    const resume: ConnectorOAuthResume = {
      schema:
        record.schema === RESUME_SCHEMA
          ? RESUME_SCHEMA
          : fail("Connector OAuth resume schema is unsupported."),
      oauthRef: text(record.oauthRef, OAUTH, "connectorOAuthResume.oauthRef"),
      householdRef: text(
        record.householdRef,
        TENANT,
        "connectorOAuthResume.householdRef",
      ),
      tier: choice(
        record.tier,
        ["HOUSEHOLD", "PRIVATE"] as const,
        "connectorOAuthResume.tier",
      ),
      serviceId: text(
        record.serviceId,
        SERVICE,
        "connectorOAuthResume.serviceId",
      ),
      returnPath: safePath(
        record.returnPath,
        "connectorOAuthResume.returnPath",
      ),
      expiresAt: expires.text,
    };
    if (
      expires.epoch <= now ||
      resume.householdRef !== context.householdRef ||
      resume.tier !== context.tier ||
      resume.serviceId !== context.serviceId ||
      resume.returnPath !== context.returnPath
    ) {
      fail("Connector OAuth resume boundary is stale or invalid.");
    }
    return resume;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function clearConnectorOAuthResume(
  storage: Storage,
  context: ConnectorOAuthContext,
) {
  storage.removeItem(resumeKey(context));
}

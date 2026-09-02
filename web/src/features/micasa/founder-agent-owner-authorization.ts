import type { BrowserSignerHandle } from "./browser-signer-vault.ts";
import { isAllowedMiCasaOrigin } from "./origin-policy.ts";

const API_PREFIX = "/api/micasa/v1";
const PATH = `${API_PREFIX}/onboarding/agent-owner-authorization`;
const REQUEST_TIMEOUT_MS = 15_000;
const HEX64 = /^[0-9a-f]{64}$/;
const CONDITIONS = "kind=0" as const;

export class FounderAgentOwnerAuthorizationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FounderAgentOwnerAuthorizationContractError";
  }
}

export type FounderAgentOwnerAuthorizationSnapshot = {
  state: "AUTHORIZATION_REQUIRED" | "VERIFIED";
  authorizationRevision: 1 | 2;
  ownerPublicKey: string;
  conditions: typeof CONDITIONS;
  agents: {
    household: { role: "HOUSEHOLD_AGENT"; publicKey: string };
    personal: { role: "PERSONAL_AGENT"; publicKey: string };
  };
  csrfToken: string;
};

function fail(message: string): never {
  throw new FounderAgentOwnerAuthorizationContractError(message);
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(`${label} is invalid.`);
  }
  return value as Record<string, unknown>;
}
function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} has an unexpected shape.`);
  }
}
function publicKey(value: unknown, label: string): string {
  if (typeof value !== "string" || !HEX64.test(value)) {
    fail(`${label} is invalid.`);
  }
  return value;
}
function agent<Role extends "HOUSEHOLD_AGENT" | "PERSONAL_AGENT">(
  value: unknown,
  role: Role,
  label: string,
): { role: Role; publicKey: string } {
  const record = object(value, label);
  exact(record, ["role", "publicKey"], label);
  if (record.role !== role) fail(`${label} has the wrong role.`);
  return { role, publicKey: publicKey(record.publicKey, `${label}.publicKey`) };
}

export function parseFounderAgentOwnerAuthorization(
  value: unknown,
): FounderAgentOwnerAuthorizationSnapshot {
  const record = object(value, "agentOwnerAuthorization");
  exact(
    record,
    [
      "state",
      "authorizationRevision",
      "ownerPublicKey",
      "conditions",
      "agents",
      "csrfToken",
    ],
    "agentOwnerAuthorization",
  );
  if (
    record.state !== "AUTHORIZATION_REQUIRED" &&
    record.state !== "VERIFIED"
  ) {
    fail("The Agent ownership authorization state is invalid.");
  }
  const expectedRevision = record.state === "VERIFIED" ? 2 : 1;
  if (record.authorizationRevision !== expectedRevision) {
    fail("The Agent ownership authorization revision is invalid.");
  }
  if (record.conditions !== CONDITIONS) {
    fail("The Agent ownership authorization scope is invalid.");
  }
  if (
    typeof record.csrfToken !== "string" ||
    !/^[A-Za-z0-9_-]{32,256}$/.test(record.csrfToken)
  ) {
    fail("The Agent ownership authorization session is invalid.");
  }
  const agents = object(record.agents, "agentOwnerAuthorization.agents");
  exact(agents, ["household", "personal"], "agentOwnerAuthorization.agents");
  const household = agent(
    agents.household,
    "HOUSEHOLD_AGENT",
    "agentOwnerAuthorization.agents.household",
  );
  const personal = agent(
    agents.personal,
    "PERSONAL_AGENT",
    "agentOwnerAuthorization.agents.personal",
  );
  if (household.publicKey === personal.publicKey) {
    fail("The two Agent ownership identities are not distinct.");
  }
  return {
    state: record.state,
    authorizationRevision: expectedRevision,
    ownerPublicKey: publicKey(
      record.ownerPublicKey,
      "agentOwnerAuthorization.ownerPublicKey",
    ),
    conditions: CONDITIONS,
    agents: { household, personal },
    csrfToken: record.csrfToken,
  };
}

function endpoint(): URL {
  const configured = import.meta.env?.VITE_PA_BFF_ORIGIN?.trim();
  const base = new URL(configured || window.location.origin);
  if (!isAllowedMiCasaOrigin(base, import.meta.env?.PROD === true)) {
    fail("The production Personal-Agent BFF origin must use HTTPS.");
  }
  return new URL(PATH, base);
}

async function request(init?: RequestInit) {
  const response = await fetch(endpoint(), {
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
        ? "This authorization checkpoint changed. Refresh before continuing."
        : response.status === 401
          ? "Your MiCasa session has expired."
          : "Personal-Agent could not verify Agent ownership authorization.",
    );
  }
  return parseFounderAgentOwnerAuthorization(body);
}

export function loadFounderAgentOwnerAuthorization() {
  return request();
}

export async function authorizeFounderAgents(
  snapshot: FounderAgentOwnerAuthorizationSnapshot,
  signer: BrowserSignerHandle,
): Promise<FounderAgentOwnerAuthorizationSnapshot> {
  if (
    snapshot.state !== "AUTHORIZATION_REQUIRED" ||
    snapshot.authorizationRevision !== 1
  ) {
    fail("Agent ownership authorization is not currently required.");
  }
  if ((await signer.getPublicKey()) !== snapshot.ownerPublicKey) {
    fail("This device holds a different Household owner identity.");
  }
  const [householdSignature, personalSignature] = await Promise.all([
    signer.signAgentAuthorization(
      snapshot.agents.household.publicKey,
      CONDITIONS,
    ),
    signer.signAgentAuthorization(
      snapshot.agents.personal.publicKey,
      CONDITIONS,
    ),
  ]);
  const result = await request({
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": snapshot.csrfToken,
    },
    body: JSON.stringify({
      expectedAuthorizationRevision: snapshot.authorizationRevision,
      householdSignature,
      personalSignature,
    }),
  });
  if (
    result.state !== "VERIFIED" ||
    result.authorizationRevision !== 2 ||
    result.ownerPublicKey !== snapshot.ownerPublicKey ||
    result.agents.household.publicKey !== snapshot.agents.household.publicKey ||
    result.agents.personal.publicKey !== snapshot.agents.personal.publicKey
  ) {
    fail("Personal-Agent returned a different Agent ownership authorization.");
  }
  return result;
}

export { CONDITIONS as FOUNDER_AGENT_OWNER_AUTHORIZATION_CONDITIONS };

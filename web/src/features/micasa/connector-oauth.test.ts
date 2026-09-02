import assert from "node:assert/strict";
import test from "node:test";
import {
  clearConnectorOAuthResume,
  connectorOAuthReturnPath,
  ConnectorOAuthContractError,
  loadConnectorOAuthResume,
  parseConnectorOAuthResources,
  parseConnectorOAuthStart,
  parseConnectorOAuthStatus,
  saveConnectorOAuthResume,
  type ConnectorOAuthContext,
} from "./connector-oauth.ts";

const tenant = `tenant:${"a".repeat(64)}`;
const oauthRef = `connector-oauth:${"b".repeat(64)}`;
const resourceOne = `provider-resource:${"c".repeat(64)}`;
const resourceTwo = `provider-resource:${"d".repeat(64)}`;
const context: ConnectorOAuthContext = {
  householdRef: tenant,
  tier: "PRIVATE",
  serviceId: "google-calendar",
  returnPath: `/settings/user/apps?household=${encodeURIComponent(tenant)}`,
};

function snapshot(overrides = {}) {
  return {
    schema: "micasa.connector_oauth_response.v1",
    oauthRef,
    householdRef: tenant,
    tier: "PRIVATE",
    serviceId: "google-calendar",
    state: "FINALIZING",
    returnPath: context.returnPath,
    observedAt: "2099-09-01T11:00:00Z",
    expiresAt: "2099-09-01T11:05:00Z",
    ...overrides,
  };
}

function start(overrides = {}) {
  return {
    ...snapshot({ state: "AUTHORIZING" }),
    authorizationUrl:
      "https://accounts.google.com/o/oauth2/v2/auth?client_id=client.apps.googleusercontent.com&state=opaque",
    ...overrides,
  };
}

function resources(overrides = {}) {
  return {
    schema: "micasa.connector_oauth_resources.v1",
    oauthRef,
    householdRef: tenant,
    tier: "PRIVATE",
    resources: [
      {
        resourceRef: resourceOne,
        displayName: "Family",
        primary: true,
        accessRole: "owner",
        providerSelected: true,
        providerHidden: false,
      },
      {
        resourceRef: resourceTwo,
        displayName: "School",
        primary: false,
        accessRole: "reader",
        providerSelected: false,
        providerHidden: true,
      },
    ],
    selectedResourceRefs: [],
    revision: 1,
    observedAt: "2099-09-01T11:00:00Z",
    expiresAt: "2099-09-01T11:05:00Z",
    ...overrides,
  };
}

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test("accepts only a boundary-bound Google authorization destination", () => {
  const parsed = parseConnectorOAuthStart(start(), context);
  assert.equal(parsed.state, "AUTHORIZING");
  assert.equal(parsed.oauthRef, oauthRef);
  assert.match(parsed.authorizationUrl, /^https:\/\/accounts\.google\.com\//);

  for (const value of [
    start({ authorizationUrl: "https://evil.invalid/oauth?state=x" }),
    start({ authorizationUrl: "not-a-url" }),
    start({ householdRef: `tenant:${"f".repeat(64)}` }),
    start({ tier: "HOUSEHOLD" }),
    start({ credential: "secret" }),
  ]) {
    assert.throws(
      () => parseConnectorOAuthStart(value, context),
      ConnectorOAuthContractError,
    );
  }
});

test("parses every durable public state without accepting secret fields", () => {
  for (const state of [
    "AUTHORIZING",
    "CALLBACK_PENDING",
    "FINALIZING",
    "CONNECTED",
    "DENIED",
    "EXPIRED",
    "OUTCOME_UNKNOWN",
  ]) {
    assert.equal(
      parseConnectorOAuthStatus(snapshot({ state }), {
        ...context,
        oauthRef,
      }).state,
      state,
    );
  }
  assert.throws(
    () =>
      parseConnectorOAuthStatus(
        { ...snapshot(), providerConnectionId: "provider-private-id" },
        context,
      ),
    ConnectorOAuthContractError,
  );
});

test("accepts only sorted opaque calendar references and safe labels", () => {
  const parsed = parseConnectorOAuthResources(resources(), {
    oauthRef,
    householdRef: tenant,
    tier: "PRIVATE",
  });
  assert.deepEqual(
    parsed.resources.map((resource) => resource.displayName),
    ["Family", "School"],
  );
  assert.deepEqual(parsed.selectedResourceRefs, []);
  for (const value of [
    resources({
      resources: [...resources().resources].reverse(),
    }),
    resources({ selectedResourceRefs: ["calendar@provider.example"] }),
    resources({ credentialRef: `vault-credential:${"e".repeat(64)}` }),
    resources({
      resources: [
        { ...resources().resources[0], displayName: "Family\nInjected" },
      ],
    }),
  ]) {
    assert.throws(
      () =>
        parseConnectorOAuthResources(value, {
          oauthRef,
          householdRef: tenant,
          tier: "PRIVATE",
        }),
      ConnectorOAuthContractError,
    );
  }
});

test("persists only an opaque, expiring resume record", () => {
  const storage = new MemoryStorage();
  const parsed = parseConnectorOAuthStart(start(), context);
  const saved = saveConnectorOAuthResume(storage, parsed);
  assert.equal(saved.oauthRef, oauthRef);
  assert.equal(storage.length, 1);
  const serialized = [...storage.values.values()][0];
  assert.ok(serialized.includes(oauthRef));
  for (const forbidden of [
    "authorizationUrl",
    "accounts.google.com",
    "credential",
    "providerConnection",
    "state=",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.deepEqual(
    loadConnectorOAuthResume(
      storage,
      context,
      Date.parse("2099-09-01T11:01:00Z"),
    ),
    saved,
  );
  assert.equal(
    loadConnectorOAuthResume(
      storage,
      context,
      Date.parse("2099-09-01T11:06:00Z"),
    ),
    null,
  );
  assert.equal(storage.length, 0);
});

test("resume records are isolated by Household, tier and service", () => {
  const storage = new MemoryStorage();
  const parsed = parseConnectorOAuthStart(start(), context);
  saveConnectorOAuthResume(storage, parsed);
  assert.equal(
    loadConnectorOAuthResume(
      storage,
      { ...context, tier: "HOUSEHOLD" },
      Date.parse("2099-09-01T11:01:00Z"),
    ),
    null,
  );
  clearConnectorOAuthResume(storage, context);
  assert.equal(storage.length, 0);
});

test("builds only settings-local return paths for strict tenant references", () => {
  assert.equal(
    connectorOAuthReturnPath("HOUSEHOLD", tenant),
    `/settings/household/apps?household=${encodeURIComponent(tenant)}`,
  );
  assert.equal(
    connectorOAuthReturnPath("PRIVATE", tenant),
    `/settings/user/apps?household=${encodeURIComponent(tenant)}`,
  );
  assert.throws(
    () => connectorOAuthReturnPath("PRIVATE", "household-1"),
    ConnectorOAuthContractError,
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeFounderAgents,
  FounderAgentOwnerAuthorizationContractError,
  parseFounderAgentOwnerAuthorization,
} from "./founder-agent-owner-authorization.ts";

const csrfToken = `csrf_${"a".repeat(40)}`;
const ownerPublicKey = "1".repeat(64);
const householdPublicKey = "2".repeat(64);
const personalPublicKey = "3".repeat(64);

function snapshot(state = "AUTHORIZATION_REQUIRED") {
  return {
    state,
    authorizationRevision: state === "VERIFIED" ? 2 : 1,
    ownerPublicKey,
    conditions: "kind=0",
    agents: {
      household: {
        role: "HOUSEHOLD_AGENT",
        publicKey: householdPublicKey,
      },
      personal: {
        role: "PERSONAL_AGENT",
        publicKey: personalPublicKey,
      },
    },
    csrfToken,
  };
}

test("parses only the minimal fixed Agent authorization contract", () => {
  const parsed = parseFounderAgentOwnerAuthorization(snapshot());
  assert.equal(parsed.state, "AUTHORIZATION_REQUIRED");
  assert.equal(parsed.agents.household.publicKey, householdPublicKey);
  assert.throws(
    () =>
      parseFounderAgentOwnerAuthorization({
        ...snapshot(),
        tenantId: "tenant:must-not-cross-the-browser-boundary",
      }),
    FounderAgentOwnerAuthorizationContractError,
  );
  assert.throws(
    () =>
      parseFounderAgentOwnerAuthorization({
        ...snapshot(),
        agents: {
          household: snapshot().agents.personal,
          personal: snapshot().agents.household,
        },
      }),
    FounderAgentOwnerAuthorizationContractError,
  );
  assert.throws(
    () =>
      parseFounderAgentOwnerAuthorization({
        ...snapshot(),
        agents: {
          ...snapshot().agents,
          personal: {
            role: "PERSONAL_AGENT",
            publicKey: householdPublicKey,
          },
        },
      }),
    FounderAgentOwnerAuthorizationContractError,
  );
});

test("signs exactly two fixed kind=0 messages and posts only signatures", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  const calls = [];
  const signingCalls = [];
  globalThis.window = { location: { origin: "https://micasa.example" } };
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => snapshot("VERIFIED"),
    };
  };
  const signer = {
    bindingId: "binding-one",
    publicKey: ownerPublicKey,
    getPublicKey: async () => ownerPublicKey,
    signEvent: async () => {
      throw new Error("event signing must not run");
    },
    signAgentAuthorization: async (agentPublicKey, conditions) => {
      signingCalls.push([agentPublicKey, conditions]);
      return agentPublicKey === householdPublicKey
        ? "4".repeat(128)
        : "5".repeat(128);
    },
    lock() {},
  };
  try {
    const result = await authorizeFounderAgents(
      parseFounderAgentOwnerAuthorization(snapshot()),
      signer,
    );
    assert.equal(result.state, "VERIFIED");
    assert.deepEqual(signingCalls, [
      [householdPublicKey, "kind=0"],
      [personalPublicKey, "kind=0"],
    ]);
    assert.equal(
      calls[0].url,
      "https://micasa.example/api/micasa/v1/onboarding/agent-owner-authorization",
    );
    assert.equal(calls[0].init.method, "POST");
    assert.equal(calls[0].init.headers["X-CSRF-Token"], csrfToken);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      expectedAuthorizationRevision: 1,
      householdSignature: "4".repeat(128),
      personalSignature: "5".repeat(128),
    });
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

test("refuses a different browser-custodied owner identity before signing", async () => {
  let signingCalls = 0;
  const signer = {
    getPublicKey: async () => "9".repeat(64),
    signAgentAuthorization: async () => {
      signingCalls += 1;
      return "4".repeat(128);
    },
  };
  await assert.rejects(
    authorizeFounderAgents(
      parseFounderAgentOwnerAuthorization(snapshot()),
      signer,
    ),
    FounderAgentOwnerAuthorizationContractError,
  );
  assert.equal(signingCalls, 0);
});

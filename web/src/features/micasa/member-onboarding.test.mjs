import assert from "node:assert/strict";
import test from "node:test";
import {
  parseMemberHouseholdAppsAck,
  parseMemberOnboardingSnapshot,
  parseMemberProfileMutation,
} from "./member-onboarding.ts";

const claimId = `member-onboarding:${"1".repeat(64)}`;
const digest = "2".repeat(64);
const common = {
  claimId,
  householdId: `tenant:${"3".repeat(64)}`,
  householdName: "The Rivera Home",
  inviterName: "Alex Rivera",
  role: "MEMBER",
  profileRevision: 4,
  roomScope: [
    { roomId: "room:household", displayName: "Household", kind: "HOUSEHOLD" },
    {
      roomId: "room:my-agent",
      displayName: "My Agent",
      kind: "PERSONAL_AGENT",
    },
  ],
  capabilityScope: ["messaging", "personal-agent"],
  consentNotices: ["Your Personal Agent joins rooms that include you."],
  householdAppsDisclosureRevision: 2,
  csrfToken: `csrf_${"4".repeat(48)}`,
};
const app = {
  serviceId: "google-photos",
  displayName: "Google Photos",
  catalogStatus: "AVAILABLE",
  audience: ["household"],
  dataSummary: "Shared albums selected for this Household.",
  actionSummary: "Your Personal Agent may search shared albums.",
};
function snapshot(state, overrides = {}) {
  const disclosed = [
    "HOUSEHOLD_APPS_DISCLOSURE_REQUIRED",
    "PRIVATE_APPS_REQUIRED",
    "FINALIZING",
    "READY",
  ].includes(state);
  const acknowledged = [
    "PRIVATE_APPS_REQUIRED",
    "FINALIZING",
    "READY",
  ].includes(state);
  return {
    state,
    ...common,
    identityBound: state !== "IDENTITY_REQUIRED",
    householdApps: disclosed ? [app] : [],
    householdAppsDisclosureDigest: disclosed ? digest : null,
    householdAppsAcknowledged: acknowledged,
    ...(state === "PROFILE_REQUIRED"
      ? {
          generatedPersonalAgentAvatar: {
            artifactId: "avatar:generated",
            mediaType: "image/webp",
            altText: "Blue constellation",
            contentSha256: "5".repeat(64),
          },
        }
      : {}),
    ...(state === "READY" ? { destinationPath: "/household" } : {}),
    ...overrides,
  };
}

test("parses the member profile state without transport authority", () => {
  const parsed = parseMemberOnboardingSnapshot(snapshot("PROFILE_REQUIRED"));
  assert.equal(parsed.state, "PROFILE_REQUIRED");
  assert.equal(
    parsed.generatedPersonalAgentAvatar.artifactId,
    "avatar:generated",
  );
  assert.equal("destinationPath" in parsed, false);
});

test("rejects Buzz preactivation and hidden relay fields", () => {
  assert.throws(() =>
    parseMemberOnboardingSnapshot(
      snapshot("PROVISIONING", { destinationPath: "/household" }),
    ),
  );
  assert.throws(() =>
    parseMemberOnboardingSnapshot(
      snapshot("PROVISIONING", { relayHostname: "relay.example" }),
    ),
  );
});

test("requires exact Household Apps disclosure state", () => {
  const parsed = parseMemberOnboardingSnapshot(
    snapshot("HOUSEHOLD_APPS_DISCLOSURE_REQUIRED"),
  );
  assert.equal(parsed.householdApps.length, 1);
  assert.equal(parsed.householdAppsAcknowledged, false);
  assert.throws(() =>
    parseMemberOnboardingSnapshot(
      snapshot("HOUSEHOLD_APPS_DISCLOSURE_REQUIRED", {
        householdAppsAcknowledged: true,
      }),
    ),
  );
});

test("parses only verified profile and disclosure mutations", () => {
  assert.deepEqual(
    parseMemberProfileMutation({
      state: "PROVISIONING",
      operationId: "operation:profile",
      idempotencyKey: "member-profiles:accepted",
      profileRevision: 5,
    }).state,
    "PROVISIONING",
  );
  const readback = snapshot("PRIVATE_APPS_REQUIRED");
  assert.equal(
    parseMemberHouseholdAppsAck({
      state: "VERIFIED",
      operationId: "operation:ack",
      idempotencyKey: "member-household-apps-ack:accepted",
      readback,
    }).readback.state,
    "PRIVATE_APPS_REQUIRED",
  );
  assert.throws(() =>
    parseMemberHouseholdAppsAck({
      state: "VERIFIED",
      operationId: "operation:ack",
      idempotencyKey: "member-household-apps-ack:accepted",
      readback: snapshot("READY"),
    }),
  );
});

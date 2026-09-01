import assert from "node:assert/strict";
import test from "node:test";
import {
  FounderOnboardingContractError,
  parseFounderOnboarding,
  parseFounderProfileMutation,
  validateFounderProfileSelection,
} from "./founder-onboarding.ts";

const csrfToken = "csrf_" + "a".repeat(40);
function profileSnapshot() {
  return {
    state: "PROFILE_REQUIRED",
    profileRevision: 7,
    completedSteps: [],
    csrfToken,
    generatedAvatars: {
      householdAgent: {
        artifactId: "avatar:household-generated",
        mediaType: "image/webp",
        altText: "Generated Household Agent avatar",
      },
      personalAgent: {
        artifactId: "avatar:personal-generated",
        mediaType: "image/webp",
        altText: "Generated Personal Agent avatar",
      },
    },
  };
}
test("parses the exact founder profile authority", () => {
  const parsed = parseFounderOnboarding(profileSnapshot());
  assert.equal(parsed.state, "PROFILE_REQUIRED");
  assert.equal(
    parsed.generatedAvatars.householdAgent.artifactId,
    "avatar:household-generated",
  );
});
test("refuses transport fields in the browser projection", () => {
  assert.throws(
    () =>
      parseFounderOnboarding({
        ...profileSnapshot(),
        relayUrl: "wss://internal",
      }),
    FounderOnboardingContractError,
  );
});
test("requires explicit acceptance of both generated avatars", () => {
  const snapshot = parseFounderOnboarding(profileSnapshot());
  assert.throws(
    () =>
      validateFounderProfileSelection(
        {
          expectedRevision: 7,
          householdName: "River House",
          humanDisplayName: "Alex",
          householdAgent: {
            displayName: "Hearth",
            avatarArtifactId: "avatar:household-generated",
            avatarAltText: "ignored",
            avatarAccepted: false,
          },
          personalAgent: {
            displayName: "Juniper",
            avatarArtifactId: "avatar:personal-generated",
            avatarAltText: "ignored",
            avatarAccepted: true,
          },
        },
        snapshot,
      ),
    FounderOnboardingContractError,
  );
});
test("refuses prototype identities and normalized name collisions", () => {
  const snapshot = parseFounderOnboarding(profileSnapshot());
  const base = {
    expectedRevision: 7,
    householdName: "River House",
    humanDisplayName: "Alex",
    householdAgent: {
      displayName: "Hearth",
      avatarArtifactId: "avatar:household-generated",
      avatarAltText: "ignored",
      avatarAccepted: true,
    },
    personalAgent: {
      displayName: "Pollen",
      avatarArtifactId: "avatar:personal-generated",
      avatarAltText: "ignored",
      avatarAccepted: true,
    },
  };
  assert.throws(
    () => validateFounderProfileSelection(base, snapshot),
    FounderOnboardingContractError,
  );
  base.personalAgent.displayName = " hearth ";
  assert.throws(
    () => validateFounderProfileSelection(base, snapshot),
    FounderOnboardingContractError,
  );
});
test("accepts only a verified mutation readback", () => {
  const value = {
    state: "PROVISIONING",
    profileRevision: 8,
    operation: {
      operationId: "operation:founder-profiles",
      idempotencyKey: "micasa-founder-profiles:" + "a".repeat(64),
      state: "VERIFIED",
      retrySafe: true,
      mutationPossible: false,
      nextAction: "WAIT_FOR_PROVISIONING",
      policyRevision: 3,
      readbackAt: 2000,
    },
    readback: {
      householdName: "River House",
      humanDisplayName: "Alex",
      householdAgent: {
        id: "agent:household",
        displayName: "Hearth",
        avatarArtifactId: "avatar:household-generated",
      },
      personalAgent: {
        id: "agent:personal",
        displayName: "Juniper",
        avatarArtifactId: "avatar:personal-generated",
      },
    },
  };
  assert.equal(parseFounderProfileMutation(value).operation.state, "VERIFIED");
  value.operation.mutationPossible = true;
  assert.throws(
    () => parseFounderProfileMutation(value),
    FounderOnboardingContractError,
  );
});

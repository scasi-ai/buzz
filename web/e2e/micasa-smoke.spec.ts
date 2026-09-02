import { expect, test, type Page } from "@playwright/test";

async function routeFounderSigner(page: Page) {
  const challenge = "f".repeat(64);
  const csrfToken = `csrf_${"s".repeat(48)}`;
  let enrolledPublicKey: string | null = null;
  await page.route("**/api/micasa/v1/signer", async (route) => {
    if (route.request().method() === "PUT") {
      const payload = route.request().postDataJSON();
      enrolledPublicKey = payload.proof.pubkey;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          state: "VERIFIED",
          operation: {
            operationId: "operation:founder-signer",
            idempotencyKey: `micasa-signer-enrollment:${"e".repeat(64)}`,
            operation: "ENROLL_BROWSER_SIGNER",
            retrySafe: true,
            mutationPossible: false,
            nextAction: "SET_UP_SIGNER_RECOVERY",
            policyRevision: 2,
            readbackAt: 1000,
            effects: [
              "PUBLIC_KEY_BOUND",
              "DEVICE_REGISTERED",
              "RECOVERY_NOT_ASSUMED",
              "PRIVATE_KEY_NOT_RECEIVED",
            ],
          },
          readback: {
            state: "READY",
            bindingId: "signer-binding:founder-e2e",
            publicKey: enrolledPublicKey,
            deviceId: "signer-device:founder-e2e",
            keyRevision: 1,
            recoveryState: "SETUP_REQUIRED",
            registrationRevision: 2,
            enrollmentChallenge: null,
            csrfToken,
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        enrolledPublicKey
          ? {
              state: "READY",
              bindingId: "signer-binding:founder-e2e",
              publicKey: enrolledPublicKey,
              deviceId: "signer-device:founder-e2e",
              keyRevision: 1,
              recoveryState: "SETUP_REQUIRED",
              registrationRevision: 2,
              enrollmentChallenge: null,
              csrfToken,
            }
          : {
              state: "ENROLLMENT_REQUIRED",
              bindingId: "signer-binding:founder-e2e",
              publicKey: null,
              deviceId: null,
              keyRevision: 0,
              recoveryState: "SETUP_REQUIRED",
              registrationRevision: 1,
              enrollmentChallenge: challenge,
              csrfToken,
            },
      ),
    });
  });
}

async function enrollFounderSigner(page: Page) {
  await page.getByRole("button", { name: "Secure this device" }).click();
}

const viewerParticipant = {
  subjectId: "member-1",
  memberId: "member-1",
  kind: "HUMAN",
  displayName: "Alex",
  nostrPubkey: null,
  avatarPath: null,
};
const personalAgentParticipant = {
  subjectId: "agent-personal",
  memberId: "member-1",
  kind: "PERSONAL_AGENT",
  displayName: "Juniper",
  nostrPubkey: "b".repeat(64),
  avatarPath: "/api/micasa/v1/media/juniper",
};
const householdAgentParticipant = {
  subjectId: "agent-household",
  memberId: null,
  kind: "HOUSEHOLD_AGENT",
  displayName: "Hearth",
  nostrPubkey:
    "989c0b76cb563971fdc9bef31ec06c3560f3249d6ee9e5d83c57625596e05f6f",
  avatarPath: "/api/micasa/v1/media/hearth",
};

const readyBootstrap = {
  state: "READY",
  csrfToken: `csrf_${"r".repeat(48)}`,
  viewer: {
    id: "member-1",
    displayName: "Alex",
  },
  households: [
    {
      id: "household-1",
      name: "River House",
      role: "HEAD",
    },
  ],
  activeHousehold: {
    id: "household-1",
    name: "River House",
    role: "HEAD",
    activeRoomId: "room-household",
    rooms: [
      {
        id: "room-household",
        name: "Household",
        kind: "HOUSEHOLD",
        householdAgentExplicitlyAdded: false,
        participants: [
          viewerParticipant,
          personalAgentParticipant,
          householdAgentParticipant,
        ],
      },
      {
        id: "room-agent",
        name: "My Agent",
        kind: "PERSONAL_AGENT",
        householdAgentExplicitlyAdded: false,
        participants: [viewerParticipant, personalAgentParticipant],
      },
    ],
    householdAgent: {
      id: "agent-household",
      displayName: "Hearth",
      readiness: "READY",
      avatarPath: "/api/micasa/v1/media/hearth",
    },
    personalAgent: {
      id: "agent-personal",
      displayName: "Juniper",
      readiness: "READY",
      avatarPath: "/api/micasa/v1/media/juniper",
    },
  },
};

test("MiCasa uses the Personal-Agent sign-in path without Buzz setup", async ({
  page,
}) => {
  await page.route("**/api/micasa/v1/bootstrap**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "UNAUTHENTICATED",
        signInPath: "/api/micasa/v1/auth/start?return_to=%2F",
      }),
    });
  });

  await page.goto("/");

  await expect(page).toHaveTitle("MiCasa");
  await expect(
    page.getByRole("heading", {
      name: "Bring your Household and its agents into one private workspace.",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in to MiCasa" }),
  ).toHaveAttribute("href", "/api/micasa/v1/auth/start?return_to=%2F");
  await expect(page.getByText("Repositories")).toHaveCount(0);
  await expect(page.getByText("Buzz")).toHaveCount(0);
});

test("ready Household renders only PA-authorized rooms and agents", async ({
  page,
}) => {
  await page.route("**/api/micasa/v1/bootstrap**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readyBootstrap),
    });
  });
  await page.route("**/api/micasa/v1/signer", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "ENROLLMENT_REQUIRED",
        bindingId: "signer-binding-ready-test",
        publicKey: null,
        deviceId: null,
        keyRevision: 0,
        recoveryState: "SETUP_REQUIRED",
        registrationRevision: 1,
        enrollmentChallenge: "a".repeat(64),
        csrfToken: `csrf_${"s".repeat(40)}`,
      }),
    });
  });

  await page.goto("/");

  await expect(
    page.getByRole("navigation", { name: "Households" }),
  ).toContainText("River House");
  await expect(page.getByRole("navigation", { name: "Rooms" })).toContainText(
    "Household",
  );
  await expect(page.getByText("Hearth")).toBeVisible();
  await expect(page.getByAltText("Hearth avatar")).toBeVisible();
  await expect(page.getByText("Juniper")).toBeVisible();
  await expect(page.getByAltText("Juniper avatar")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Household Settings" }),
  ).toHaveAttribute(
    "href",
    "/settings/household/members?household=household-1",
  );
  await expect(
    page.getByRole("link", { name: /User Settings/ }),
  ).toHaveAttribute("href", "/settings/user/agent?household=household-1");
  await expect(
    page.getByRole("heading", { name: "Secure messaging on this device" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Secure this device" }),
  ).toBeVisible();
  await expect(page.getByText(/communities\.buzz\.xyz/)).toHaveCount(0);
  await expect(page.locator('a[href^="ws://"], a[href^="wss://"]')).toHaveCount(
    0,
  );
});

test("Personal-Agent readiness failure never falls back to demo data", async ({
  page,
}) => {
  await page.route("**/api/micasa/v1/bootstrap**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ request_id: "request-123" }),
    });
  });

  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "MiCasa is temporarily unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByText(/No substitute workspace or demo data/),
  ).toBeVisible();
  await expect(page.getByText("River House")).toHaveCount(0);
});

test("Household invitation uses Scasi sign-in and discloses My Agent", async ({
  page,
}) => {
  await page.route(
    "**/api/micasa/v1/invitations/family-code**",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          state: "UNAUTHENTICATED",
          householdName: "River House",
          inviterName: "Alex",
          role: "MEMBER",
          expiresAt: "2026-09-03T12:00:00Z",
          roomScope: [
            { roomId: "room-household", name: "Household", kind: "HOUSEHOLD" },
          ],
          capabilityScope: [
            {
              capabilityId: "capability-household-messaging",
              name: "Household messages",
            },
          ],
          consentNotices: [
            {
              noticeId: "consent-shared-room-visibility",
              text: "Household members and their Agents can access messages in shared rooms.",
            },
          ],
          personalAgentRequired: true,
          personalAgentReserved: true,
          signInPath:
            "/api/micasa/v1/auth/start?return_to=%2Finvite%2Ffamily-code",
        }),
      });
    },
  );

  await page.goto("/invite/family-code");

  await expect(
    page.getByRole("heading", { name: "River House" }),
  ).toBeVisible();
  await expect(page.getByText("Reserved for your setup")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Rooms included" }),
  ).toBeVisible();
  await expect(page.getByText("Household messages")).toBeVisible();
  await expect(
    page.getByText(/members and their Agents can access messages/),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Sign in to review invitation" }),
  ).toHaveAttribute(
    "href",
    "/api/micasa/v1/auth/start?return_to=%2Finvite%2Ffamily-code",
  );
  await expect(page.getByText(/NIP-07/)).toHaveCount(0);
  await expect(page.getByText(/Download/)).toHaveCount(0);
});

test("claiming a Household invitation sends CSRF protection to PA", async ({
  page,
}) => {
  let claimObserved = false;
  await page.route(
    "**/api/micasa/v1/invitations/family-code**",
    async (route) => {
      if (route.request().method() === "POST") {
        claimObserved = true;
        expect(route.request().headers()["x-csrf-token"]).toBe("csrf-123");
        expect(route.request().postDataJSON()).toEqual({
          code: "family-code",
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ destinationPath: "/" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          state: "CLAIMABLE",
          householdName: "River House",
          inviterName: "Alex",
          role: "MEMBER",
          expiresAt: "2026-09-03T12:00:00Z",
          roomScope: [
            { roomId: "room-household", name: "Household", kind: "HOUSEHOLD" },
          ],
          capabilityScope: [
            {
              capabilityId: "capability-household-messaging",
              name: "Household messages",
            },
          ],
          consentNotices: [
            {
              noticeId: "consent-shared-room-visibility",
              text: "Household members and their Agents can access messages in shared rooms.",
            },
          ],
          personalAgentRequired: true,
          personalAgentReserved: true,
          csrfToken: "csrf-123",
        }),
      });
    },
  );
  await page.route("**/api/micasa/v1/bootstrap**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readyBootstrap),
    });
  });

  await page.goto("/invite/family-code");
  await page
    .getByRole("button", { name: "Accept and set up My Agent" })
    .click();
  await expect.poll(() => claimObserved).toBe(true);
});

test("founder onboarding captures named agents without a Buzz community step", async ({
  page,
}) => {
  let mutationObserved = false;
  const csrfToken = `csrf_${"a".repeat(40)}`;

  await routeFounderSigner(page);

  await page.route("**/api/micasa/v1/onboarding**", async (route) => {
    if (route.request().method() === "PUT") {
      mutationObserved = true;
      expect(route.request().headers()["x-csrf-token"]).toBe(csrfToken);
      expect(route.request().postDataJSON()).toEqual({
        expectedRevision: 7,
        householdName: "River House",
        humanDisplayName: "Alex Rivera",
        householdAgent: {
          displayName: "Hearth",
          avatarArtifactId: "avatar:household-generated",
          avatarAltText: "Generated Household Agent avatar",
          avatarAccepted: true,
        },
        personalAgent: {
          displayName: "Juniper",
          avatarArtifactId: "avatar:personal-generated",
          avatarAltText: "Generated Personal Agent avatar",
          avatarAccepted: true,
        },
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          state: "PROVISIONING",
          profileRevision: 8,
          operation: {
            operationId: "operation:founder-profiles",
            idempotencyKey: `micasa-founder-profiles:${"b".repeat(64)}`,
            state: "VERIFIED",
            retrySafe: true,
            mutationPossible: false,
            nextAction: "WAIT_FOR_PROVISIONING",
            policyRevision: 3,
            readbackAt: 2000,
          },
          readback: {
            householdName: "River House",
            humanDisplayName: "Alex Rivera",
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
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
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
      }),
    });
  });

  await page.goto("/onboarding");
  await enrollFounderSigner(page);
  await expect(
    page.getByRole("heading", {
      name: "Name your Household and its agents",
    }),
  ).toBeVisible();
  await page.getByLabel("Household name").fill("River House");
  await page.getByLabel("Your display name").fill("Alex Rivera");
  await page.getByLabel("Household Agent name").fill("Hearth");
  await page.getByLabel("My Agent name").fill("Juniper");
  await page.getByLabel("Use the generated Household Agent avatar").check();
  await page.getByLabel("Use the generated My Agent avatar").check();
  await page
    .getByRole("button", {
      name: "Save profiles and start provisioning",
    })
    .click();

  await expect.poll(() => mutationObserved).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Creating your Household" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    /Buzz|community|relay|Fizz|Honey|Pollen/i,
  );
});

test("Household Apps review persists a decision for every applicable card", async ({
  page,
}) => {
  const founderCsrf = `csrf_founder_${"a".repeat(32)}`;
  const appsCsrf = `csrf_apps_${"b".repeat(32)}`;
  let mutationObserved = false;
  await routeFounderSigner(page);

  await page.route("**/api/micasa/v1/onboarding/apps**", async (route) => {
    expect(new URL(route.request().url()).searchParams.get("tier")).toBe(
      "HOUSEHOLD",
    );
    if (route.request().method() === "PUT") {
      mutationObserved = true;
      expect(route.request().headers()["x-csrf-token"]).toBe(appsCsrf);
      expect(route.request().postDataJSON()).toEqual({
        expectedRevision: 4,
        decisions: [
          { serviceId: "gmail", decision: "NOT_NOW" },
          {
            serviceId: "finance",
            decision: "ACKNOWLEDGED_UNAVAILABLE",
          },
        ],
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          state: "REVIEWED",
          tier: "HOUSEHOLD",
          decisionRevision: 5,
          operation: {
            operationId: "operation:apps",
            idempotencyKey: `micasa-apps-review:${"c".repeat(64)}`,
            state: "VERIFIED",
            retrySafe: true,
            mutationPossible: false,
            nextAction: "REVIEW_PRIVATE_APPS",
            policyRevision: 9,
            readbackAt: 2000,
          },
          decisions: [
            { serviceId: "gmail", decision: "NOT_NOW" },
            {
              serviceId: "finance",
              decision: "ACKNOWLEDGED_UNAVAILABLE",
            },
          ],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "REVIEW_REQUIRED",
        tier: "HOUSEHOLD",
        catalogVersion: "1.0",
        catalogDigest: "d".repeat(64),
        catalogTotalCards: 92,
        applicableCardCount: 2,
        decisionRevision: 4,
        csrfToken: appsCsrf,
        cards: [
          {
            serviceId: "gmail",
            displayName: "Gmail",
            category: "MAIL_CALENDAR_CONTACTS_TASKS",
            placement: "DEDICATED_OR_SHARED",
            catalogStatus: "PREVIEW",
            connectEnabled: false,
            decision: "UNREVIEWED",
            details: "Mail actions remain independently scoped.",
          },
          {
            serviceId: "finance",
            displayName: "Financial aggregators",
            category: "LIFE_COMMERCE_FINANCE_GAMING_VEHICLES",
            placement: "PRIVATE_SHARE_ONLY",
            catalogStatus: "POLICY_BLOCKED",
            connectEnabled: false,
            decision: "UNREVIEWED",
            details: "Read-only evidence remains blocked pending review.",
          },
        ],
      }),
    });
  });
  await page.route("**/api/micasa/v1/onboarding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "HOUSEHOLD_APPS_REQUIRED",
        profileRevision: 8,
        completedSteps: ["PROFILES", "PROVISIONING"],
        csrfToken: founderCsrf,
        generatedAvatars: null,
      }),
    });
  });

  await page.goto("/onboarding");
  await enrollFounderSigner(page);
  await expect(
    page.getByRole("heading", {
      name: "Review Household Apps & Services",
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect" })).toHaveCount(0);
  await page.getByRole("button", { name: "Review all as not now" }).click();
  await expect(
    page.getByText("Every applicable card has a decision."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save Household app decisions" })
    .click();

  await expect.poll(() => mutationObserved).toBe(true);
  await expect(
    page.getByRole("heading", {
      name: "Household Apps & Services reviewed",
    }),
  ).toBeVisible();
});

test("legacy repository route is no longer a product surface", async ({
  page,
}) => {
  await page.goto("/repos");
  await expect(page.getByText("Repositories")).toHaveCount(0);
  await expect(page.getByText("Buzz")).toHaveCount(0);
});

test("Head of Household can suspend a member with verified lifecycle readback", async ({
  page,
}) => {
  const csrfToken = `csrf_members_${"e".repeat(32)}`;
  let suspensionObserved = false;
  const membersSnapshot = {
    householdId: "household-1",
    policyRevision: 10,
    csrfToken,
    sharedRooms: [
      {
        roomId: "room-household",
        displayName: "Household",
        kind: "HOUSEHOLD",
      },
      {
        roomId: "room-photos",
        displayName: "Photo planning",
        kind: "GROUP",
      },
    ],
    sharedCapabilities: [
      {
        capabilityId: "capability-messaging",
        displayName: "Send and receive household messages",
      },
      {
        capabilityId: "capability-shared-apps",
        displayName: "Use approved Household Apps & Data",
      },
    ],
    members: [
      {
        memberId: "member-1",
        displayName: "Alex",
        role: "HEAD",
        lifecycle: "ACTIVE",
        personalAgentReadiness: "READY",
        configuredSharedRoomIds: ["room-household", "room-photos"],
        activeSharedRoomCount: 2,
        configuredCapabilityIds: [
          "capability-messaging",
          "capability-shared-apps",
        ],
        activeCapabilityCount: 2,
        membershipRevision: 1,
      },
      {
        memberId: "member-2",
        displayName: "Alice",
        role: "MEMBER",
        lifecycle: "ACTIVE",
        personalAgentReadiness: "READY",
        configuredSharedRoomIds: ["room-household", "room-photos"],
        activeSharedRoomCount: 2,
        configuredCapabilityIds: [
          "capability-messaging",
          "capability-shared-apps",
        ],
        activeCapabilityCount: 2,
        membershipRevision: 3,
      },
    ],
    invitations: [],
  };

  await page.route("**/api/micasa/v1/bootstrap**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readyBootstrap),
    });
  });
  await page.route(
    "**/api/micasa/v1/settings/household/members**",
    async (route) => {
      expect(new URL(route.request().url()).searchParams.get("household")).toBe(
        "household-1",
      );
      if (route.request().method() === "POST") {
        suspensionObserved = true;
        expect(route.request().url()).toContain("/member-2/suspend");
        expect(route.request().headers()["x-csrf-token"]).toBe(csrfToken);
        expect(route.request().postDataJSON()).toEqual({
          expectedRevision: 3,
        });
        const suspended = {
          ...membersSnapshot,
          policyRevision: 11,
          members: [
            membersSnapshot.members[0],
            {
              ...membersSnapshot.members[1],
              lifecycle: "SUSPENDED",
              personalAgentReadiness: "SUSPENDED",
              activeSharedRoomCount: 0,
              activeCapabilityCount: 0,
              membershipRevision: 4,
            },
          ],
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            state: "VERIFIED",
            operation: {
              operationId: "operation-suspend",
              idempotencyKey: `micasa-members:${"f".repeat(64)}`,
              operation: "SUSPEND_MEMBER",
              retrySafe: true,
              mutationPossible: false,
              nextAction: "REFRESH_HOUSEHOLD_SETTINGS",
              policyRevision: 11,
              readbackAt: 2000,
              effects: [
                "DIRECTORY_REVOKED",
                "RELAY_REVOKED",
                "ROOMS_REVOKED",
                "SESSIONS_REVOKED",
                "ACP_REVOKED",
                "CONNECTORS_BLOCKED",
                "HISTORY_RETAINED",
              ],
            },
            subjectId: "member-2",
            readback: suspended,
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(membersSnapshot),
      });
    },
  );

  await page.goto("/settings/household/members");
  await expect(
    page.getByRole("heading", { name: "Members & invitations" }),
  ).toBeVisible();
  await expect(page.getByText(/private agent conversations/)).toBeVisible();
  const capabilityScope = page.getByRole("group", {
    name: "Household capabilities",
  });
  await expect(
    capabilityScope.getByLabel("Send and receive household messages"),
  ).toBeChecked();
  await expect(
    capabilityScope.getByLabel("Use approved Household Apps & Data"),
  ).toBeChecked();
  await expect(page.locator("body")).not.toContainText(/Fizz|Honey|Pollen/i);
  await page.getByRole("button", { name: "Suspend" }).click();

  await expect.poll(() => suspensionObserved).toBe(true);
  await expect(
    page.getByText("Suspended · Personal Agent suspended"),
  ).toBeVisible();
  await expect(
    page.getByText("Personal-Agent verified the Household Settings change."),
  ).toBeVisible();
});

test("Household and My Agent profiles use separate verified Settings domains", async ({
  page,
}) => {
  const csrfToken = `csrf_agent_profile_${"g".repeat(32)}`;
  let householdMutationObserved = false;
  function profileSnapshot(scope: "HOUSEHOLD" | "PRIVATE") {
    return {
      scope,
      householdId: "household-1",
      csrfToken,
      profile: {
        agentInstanceId:
          scope === "HOUSEHOLD" ? "agent-household" : "agent-personal",
        displayName: scope === "HOUSEHOLD" ? "Hearth" : "Juniper",
        aliases: [],
        avatarArtifactId: "avatar-current",
        avatarAltText: "Current agent avatar",
        publicBio: "",
        profileRevision: 4,
        characterRevision: 2,
      },
      availableAvatars: [
        {
          artifactId: "avatar-current",
          mediaType: "image/webp",
          altText: "Current agent avatar",
          source: "UPLOADED",
          contentPath: "/api/micasa/v1/media/avatar/current",
        },
        {
          artifactId: "avatar-generated",
          mediaType: "image/webp",
          altText: "Generated agent avatar",
          source: "GENERATED",
          contentPath: "/api/micasa/v1/media/avatar/generated",
        },
      ],
    };
  }

  await page.route("**/api/micasa/v1/bootstrap**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readyBootstrap),
    });
  });
  await page.route(
    "**/api/micasa/v1/settings/household/agent-profile**",
    async (route) => {
      const before = profileSnapshot("HOUSEHOLD");
      if (route.request().method() === "PUT") {
        householdMutationObserved = true;
        expect(route.request().headers()["x-csrf-token"]).toBe(csrfToken);
        expect(route.request().postDataJSON()).toEqual({
          expectedRevision: 4,
          displayName: "Solace",
          aliases: ["Home helper"],
          avatarArtifactId: "avatar-generated",
          avatarAltText: "Generated agent avatar",
          publicBio: "Helps with shared plans.",
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            state: "VERIFIED",
            operation: {
              operationId: "operation-agent-profile",
              idempotencyKey: `micasa-agent-profile:${"h".repeat(64)}`,
              operation: "UPDATE_HOUSEHOLD_AGENT_PROFILE",
              retrySafe: true,
              mutationPossible: false,
              nextAction: "REFRESH_AGENT_SETTINGS",
              policyRevision: 9,
              readbackAt: 2000,
              effects: [
                "PRESENTATION_UPDATED",
                "TENANT_NAMES_RECONCILED",
                "NOSTR_PROFILE_PROJECTED",
                "ACP_PROFILE_READBACK",
                "CACHE_INVALIDATED",
                "IDENTITY_PRESERVED",
                "STATE_PRESERVED",
                "CAPABILITIES_UNCHANGED",
              ],
            },
            readback: {
              ...before,
              profile: {
                ...before.profile,
                displayName: "Solace",
                aliases: ["Home helper"],
                avatarArtifactId: "avatar-generated",
                avatarAltText: "Generated agent avatar",
                publicBio: "Helps with shared plans.",
                profileRevision: 5,
              },
            },
          }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(before),
      });
    },
  );
  await page.route(
    "**/api/micasa/v1/settings/user/agent-profile**",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(profileSnapshot("PRIVATE")),
      });
    },
  );

  await page.goto("/settings/household/agent");
  await expect(
    page.getByRole("heading", { name: "Household Agent profile" }),
  ).toBeVisible();
  await page.getByLabel("Agent name").fill("Solace");
  await page.getByLabel("Aliases").fill("Home helper");
  await page.getByRole("button", { name: /Generated/ }).click();
  await page.getByLabel("Public bio").fill("Helps with shared plans.");
  await page.getByRole("button", { name: "Save agent profile" }).click();

  await expect.poll(() => householdMutationObserved).toBe(true);
  await expect(page.getByText(/preserved this agent's identity/)).toBeVisible();
  await expect(
    page.getByText("Stable agent ID · agent-household"),
  ).toBeVisible();

  await page.goto("/settings/user/agent");
  await expect(
    page.getByRole("heading", { name: "My Agent profile" }),
  ).toBeVisible();
  await expect(page.getByText("Private to you")).toBeVisible();
  await expect(
    page.getByText("Stable agent ID · agent-personal"),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Fizz|Honey|Pollen/i);
});

test("Apps & Data Settings preserve household/private boundaries and never imply a connection", async ({
  page,
}) => {
  const csrfToken = `csrf_${"z".repeat(40)}`;
  const catalogDigest = "d".repeat(64);
  const settingsSnapshot = (tier: "HOUSEHOLD" | "PRIVATE") => ({
    state: "EDITABLE",
    surface: "SETTINGS",
    tier,
    householdId: "household-1",
    catalogVersion: "1.0",
    catalogDigest,
    catalogTotalCards: 92,
    applicableCardCount: 2,
    decisionRevision: 4,
    csrfToken,
    cards: [
      {
        serviceId: "google-calendar",
        displayName: "Google Calendar",
        category: "MAIL_CALENDAR_CONTACTS_TASKS",
        placement: tier === "HOUSEHOLD" ? "HOUSEHOLD" : "PRIVATE",
        catalogStatus: "PREVIEW",
        routeKinds: ["HOSTED_MCP", "DIRECT_API"],
        connectEnabled: false,
        decision: "NOT_NOW",
        authorizationStatus: "NOT_CONNECTED",
        resourceStatus: "SELECTION_REQUIRED",
        syncStatus: "NOT_STARTED",
        operationStatus: "BLOCKED",
        providerConnectionId: null,
        serviceGrantId: null,
        consentReceiptId: null,
        audience: [tier === "HOUSEHOLD" ? "HOUSEHOLD" : "SELF"],
        selectedResourceIds: [],
        details: "Select exact calendars in a separate authorization flow.",
      },
      {
        serviceId: "apple-home",
        displayName: "Apple Home",
        category: "HOME_DEVICES",
        placement: tier === "HOUSEHOLD" ? "HOUSEHOLD" : "PRIVATE",
        catalogStatus: "COMING_LATER",
        routeKinds: ["DEVICE_BRIDGE"],
        connectEnabled: false,
        decision: "ACKNOWLEDGED_UNAVAILABLE",
        authorizationStatus: "NOT_CONNECTED",
        resourceStatus: "SELECTION_REQUIRED",
        syncStatus: "NOT_STARTED",
        operationStatus: "BLOCKED",
        providerConnectionId: null,
        serviceGrantId: null,
        consentReceiptId: null,
        audience: [tier === "HOUSEHOLD" ? "HOUSEHOLD" : "SELF"],
        selectedResourceIds: [],
        details: "This integration is not available yet.",
      },
    ],
  });
  let householdSaveObserved = false;
  await page.route("**/api/micasa/v1/bootstrap**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readyBootstrap),
    });
  });
  await page.route("**/api/micasa/v1/settings/**/apps**", async (route) => {
    const household = route.request().url().includes("/household/apps");
    const before = settingsSnapshot(household ? "HOUSEHOLD" : "PRIVATE");
    if (route.request().method() === "PUT") {
      householdSaveObserved = true;
      expect(route.request().headers()["x-csrf-token"]).toBe(csrfToken);
      expect(route.request().postDataJSON()).toEqual({
        expectedRevision: 4,
        decisions: [
          {
            serviceId: "google-calendar",
            decision: "NOT_APPLICABLE",
          },
          {
            serviceId: "apple-home",
            decision: "ACKNOWLEDGED_UNAVAILABLE",
          },
        ],
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          state: "UPDATED",
          surface: "SETTINGS",
          tier: "HOUSEHOLD",
          operation: {
            operationId: "operation-app-settings",
            idempotencyKey: `micasa-app-settings:${"i".repeat(64)}`,
            operation: "UPDATE_HOUSEHOLD_APPS_SETTINGS",
            retrySafe: true,
            mutationPossible: false,
            nextAction: "REFRESH_APPS_SETTINGS",
            policyRevision: 8,
            readbackAt: 1000,
            effects: [
              "DECISIONS_UPDATED",
              "SERVICE_GRANTS_UNCHANGED",
              "CREDENTIALS_UNCHANGED",
              "HOUSEHOLD_PRIVATE_BOUNDARY_PRESERVED",
            ],
          },
          readback: {
            ...before,
            decisionRevision: 5,
            cards: before.cards.map((card, index) => ({
              ...card,
              decision:
                index === 0 ? "NOT_APPLICABLE" : "ACKNOWLEDGED_UNAVAILABLE",
            })),
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(before),
    });
  });

  await page.goto("/settings/household/apps?household=household-1");
  await expect(
    page.getByRole("heading", { name: "Household Apps & Data" }),
  ).toBeVisible();
  await expect(page.getByText("Head of Household only")).toBeVisible();
  await expect(page.getByText("Not connected").first()).toBeVisible();
  await expect(page.getByText("Selection required").first()).toBeVisible();
  await expect(page.getByText("Tools blocked").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request connection setup" }),
  ).toHaveCount(0);
  await page.getByText("Data boundary and connection route").first().click();
  await expect(
    page.getByText("Hosted MCP · Direct provider API"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Not applicable" }).first().click();
  await page.getByRole("button", { name: "Save decisions" }).click();
  await expect.poll(() => householdSaveObserved).toBe(true);
  await expect(
    page.getByText(/confirmed that grants and credentials were unchanged/),
  ).toBeVisible();

  await page.goto("/settings/user/apps?household=household-1");
  await expect(
    page.getByRole("heading", { name: "My Apps & Data" }),
  ).toBeVisible();
  await expect(page.getByText("Private to you")).toBeVisible();
  await expect(
    page.getByText(/saving here never connects or disconnects a provider/),
  ).toBeVisible();
});

test("clean browser enrolls its PA-bound signer and mounts a real signed room transport", async ({
  page,
}) => {
  const csrfToken = `csrf_${"v".repeat(40)}`;
  const challenge = "f".repeat(64);
  let enrolledPublicKey: string | null = null;
  let enrollmentObserved = false;
  await page.addInitScript(
    ({ historyEvent }) => {
      class MiCasaTestWebSocket {
        readyState = 1;
        listeners = new Map<string, Set<(event: { data?: string }) => void>>();
        url: string;

        constructor(url: string) {
          this.url = url;
          queueMicrotask(() => {
            this.emit("open", {});
            this.emit("message", {
              data: JSON.stringify(["AUTH", "challenge-123"]),
            });
          });
        }

        addEventListener(
          type: string,
          listener: (event: { data?: string }) => void,
        ) {
          const listeners = this.listeners.get(type) ?? new Set();
          listeners.add(listener);
          this.listeners.set(type, listeners);
        }

        removeEventListener(
          type: string,
          listener: (event: { data?: string }) => void,
        ) {
          this.listeners.get(type)?.delete(listener);
        }

        emit(type: string, event: { data?: string }) {
          for (const listener of this.listeners.get(type) ?? []) {
            listener(event);
          }
        }

        send(payload: string) {
          const frame = JSON.parse(payload);
          if (frame[0] === "AUTH") {
            queueMicrotask(() =>
              this.emit("message", {
                data: JSON.stringify(["OK", frame[1].id, true, ""]),
              }),
            );
          } else if (frame[0] === "REQ") {
            queueMicrotask(() => {
              this.emit("message", {
                data: JSON.stringify(["EVENT", frame[1], historyEvent]),
              });
              this.emit("message", {
                data: JSON.stringify(["EOSE", frame[1]]),
              });
            });
          } else if (frame[0] === "EVENT") {
            queueMicrotask(() =>
              this.emit("message", {
                data: JSON.stringify(["OK", frame[1].id, true, ""]),
              }),
            );
          }
        }

        close() {
          this.readyState = 3;
        }
      }
      Object.defineProperty(window, "WebSocket", {
        value: MiCasaTestWebSocket,
        configurable: true,
      });
    },
    {
      historyEvent: {
        kind: 9,
        created_at: 1788260400,
        tags: [["h", "room-household"]],
        content: "Welcome home from a real signed participant",
        pubkey:
          "989c0b76cb563971fdc9bef31ec06c3560f3249d6ee9e5d83c57625596e05f6f",
        id: "a0590c1e8ff717c0fcb736018d6f5937d498905c2c0451e1184f39358532bfe5",
        sig: "14d6dc118bc5bd94c2b12a27e0b1e26529b2bbe81f25b540ad56805b5af5250ff53bd28e746fdf30a6bc8a01797350688d45f9c259f2b413ba272f333782ca62",
      },
    },
  );
  await page.route("**/api/micasa/v1/bootstrap**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readyBootstrap),
    });
  });
  await page.route("**/api/micasa/v1/signer", async (route) => {
    if (route.request().method() === "PUT") {
      enrollmentObserved = true;
      expect(route.request().headers()["x-csrf-token"]).toBe(csrfToken);
      const payload = route.request().postDataJSON();
      expect(Object.keys(payload).sort()).toEqual([
        "deviceLabel",
        "expectedRegistrationRevision",
        "proof",
      ]);
      expect(payload.expectedRegistrationRevision).toBe(4);
      expect(payload.proof.kind).toBe(27235);
      expect(payload.proof.tags).toEqual([
        ["challenge", challenge],
        ["origin", "http://127.0.0.1:4173"],
        ["purpose", "micasa-signer-enrollment"],
      ]);
      enrolledPublicKey = payload.proof.pubkey;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          state: "VERIFIED",
          operation: {
            operationId: "operation-signer",
            idempotencyKey: `micasa-signer-enrollment:${"i".repeat(64)}`,
            operation: "ENROLL_BROWSER_SIGNER",
            retrySafe: true,
            mutationPossible: false,
            nextAction: "SET_UP_SIGNER_RECOVERY",
            policyRevision: 9,
            readbackAt: 1000,
            effects: [
              "PUBLIC_KEY_BOUND",
              "DEVICE_REGISTERED",
              "RECOVERY_NOT_ASSUMED",
              "PRIVATE_KEY_NOT_RECEIVED",
            ],
          },
          readback: {
            state: "READY",
            bindingId: "signer-binding-e2e",
            publicKey: enrolledPublicKey,
            deviceId: "device-e2e",
            keyRevision: 1,
            recoveryState: "SETUP_REQUIRED",
            registrationRevision: 5,
            enrollmentChallenge: null,
            csrfToken,
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        enrolledPublicKey
          ? {
              state: "READY",
              bindingId: "signer-binding-e2e",
              publicKey: enrolledPublicKey,
              deviceId: "device-e2e",
              keyRevision: 1,
              recoveryState: "SETUP_REQUIRED",
              registrationRevision: 5,
              enrollmentChallenge: null,
              csrfToken,
            }
          : {
              state: "ENROLLMENT_REQUIRED",
              bindingId: "signer-binding-e2e",
              publicKey: null,
              deviceId: null,
              keyRevision: 0,
              recoveryState: "SETUP_REQUIRED",
              registrationRevision: 4,
              enrollmentChallenge: challenge,
              csrfToken,
            },
      ),
    });
  });

  await page.goto("/");
  await page.getByLabel("Device name").fill("Alex's Browser");
  await page.getByRole("button", { name: "Secure this device" }).click();
  await expect.poll(() => enrollmentObserved).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Signed messages" }),
  ).toBeVisible();
  await expect(
    page.getByText("Welcome home from a real signed participant"),
  ).toBeVisible();
  await expect(page.getByText("Hearth · Agent")).toBeVisible();
  await page.getByLabel("Message Household").fill("Hello Hearth");
  await page.getByRole("button", { name: "Send signed message" }).click();
  await expect(page.getByText("Hello Hearth")).toBeVisible();
  await expect(page.getByText("Published to Buzz/Nostr")).toBeVisible();
  await expect(page.getByText(/NIP-07/)).toHaveCount(0);
});

test("group owner adds and removes the Household Agent with verified PA readback", async ({
  page,
}) => {
  let included = false;
  let membershipRevision = 8;
  let authorityDigest = "a".repeat(64);
  let addObserved = false;
  let removeObserved = false;
  const groupRoom = {
    id: "room-family",
    name: "Family plans",
    kind: "GROUP",
    householdAgentExplicitlyAdded: false,
    participants: [
      viewerParticipant,
      personalAgentParticipant,
      {
        subjectId: "member-2",
        memberId: "member-2",
        kind: "HUMAN",
        displayName: "Maya",
        nostrPubkey: "c".repeat(64),
        avatarPath: null,
      },
      {
        subjectId: "agent-maya",
        memberId: "member-2",
        kind: "PERSONAL_AGENT",
        displayName: "Spruce",
        nostrPubkey: "d".repeat(64),
        avatarPath: null,
      },
      {
        subjectId: "member-3",
        memberId: "member-3",
        kind: "HUMAN",
        displayName: "Rowan",
        nostrPubkey: "e".repeat(64),
        avatarPath: null,
      },
      {
        subjectId: "agent-rowan",
        memberId: "member-3",
        kind: "PERSONAL_AGENT",
        displayName: "Maple",
        nostrPubkey: "f".repeat(64),
        avatarPath: null,
      },
    ],
  };
  const bootstrap = structuredClone(readyBootstrap);
  bootstrap.activeHousehold.activeRoomId = groupRoom.id;
  bootstrap.activeHousehold.rooms.push(groupRoom);

  await page.route("**/api/micasa/v1/bootstrap**", async (route) => {
    const value = structuredClone(bootstrap);
    const projectedGroup = value.activeHousehold.rooms.find(
      (room) => room.id === groupRoom.id,
    );
    if (!projectedGroup) {
      throw new Error("Group fixture is missing.");
    }
    projectedGroup.householdAgentExplicitlyAdded = included;
    if (included) {
      projectedGroup.participants.push(householdAgentParticipant);
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(value),
    });
  });
  await page.route("**/api/micasa/v1/signer", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        state: "ENROLLMENT_REQUIRED",
        bindingId: "signer-binding-group-agent-test",
        publicKey: null,
        deviceId: null,
        keyRevision: 0,
        recoveryState: "SETUP_REQUIRED",
        registrationRevision: 1,
        enrollmentChallenge: "1".repeat(64),
        csrfToken: `csrf_${"2".repeat(48)}`,
      }),
    });
  });
  await page.route(
    "**/api/micasa/v1/households/household-1/rooms/room-family/household-agent",
    async (route) => {
      const request = route.request();
      if (request.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            state: "READY",
            householdId: "household-1",
            roomId: "room-family",
            householdAgent: {
              id: "agent-household",
              displayName: "Hearth",
              avatarPath: "/api/micasa/v1/media/hearth",
            },
            included,
            canManage: true,
            membershipRevision,
            policyRevision: 13,
            authorityDigest,
            csrfToken: `csrf_${"3".repeat(48)}`,
            observedAt: 1_788_278_400,
            expiresAt: 1_788_278_520,
          }),
        });
        return;
      }
      const body = JSON.parse(request.postData() ?? "{}");
      expect(request.headers()["x-csrf-token"]).toBe(`csrf_${"3".repeat(48)}`);
      expect(body.expectedAuthorityDigest).toBe(authorityDigest);
      expect(body.expectedMembershipRevision).toBe(membershipRevision);
      expect(body.expectedPolicyRevision).toBe(13);
      expect(body.idempotencyKey).toMatch(/^group-agent:/);
      const adding = request.method() === "PUT";
      if (adding) {
        expect(body.policyAcknowledged).toBe(true);
        expect(body.historyBoundaryAcknowledged).toBeUndefined();
        addObserved = true;
      } else {
        expect(request.method()).toBe("DELETE");
        expect(body.historyBoundaryAcknowledged).toBe(true);
        expect(body.policyAcknowledged).toBeUndefined();
        removeObserved = true;
      }
      included = adding;
      membershipRevision += 1;
      authorityDigest = adding ? "b".repeat(64) : "c".repeat(64);
      const effect = adding
        ? "HOUSEHOLD_AGENT_ADDED"
        : "HOUSEHOLD_AGENT_REMOVED";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          state: "VERIFIED",
          operation: {
            operationId: `operation:${membershipRevision}`,
            operation: adding
              ? "ADD_HOUSEHOLD_AGENT"
              : "REMOVE_HOUSEHOLD_AGENT",
            idempotencyKey: body.idempotencyKey,
            auditEventId: `audit-event:${membershipRevision}`,
            effects: [
              "ACP_ROOM_AUTHORITY_REVISED",
              "AUDIT_EVENT_APPENDED",
              "BOOTSTRAP_READ_MODEL_REBUILT",
              "BUZZ_CHANNEL_MEMBERSHIP_RECONCILED",
              effect,
              "NOSTR_ROOM_AUTHORITY_REVISED",
              "PA_ROOM_MEMBERSHIP_COMMITTED",
            ],
            retrySafe: true,
            mutationPossible: false,
          },
          readback: {
            state: "READY",
            householdId: "household-1",
            roomId: "room-family",
            householdAgent: {
              id: "agent-household",
              displayName: "Hearth",
              avatarPath: "/api/micasa/v1/media/hearth",
            },
            included,
            canManage: true,
            membershipRevision,
            policyRevision: 13,
            authorityDigest,
            csrfToken: `csrf_${"3".repeat(48)}`,
            observedAt: 1_788_278_400,
            expiresAt: 1_788_278_520,
          },
        }),
      });
    },
  );

  await page.goto("/?household=household-1&room=room-family");

  const access = page.getByRole("region", {
    name: "Household Agent group access",
  });
  await expect(access).toContainText("Add Hearth to this group");
  await expect(access).toContainText(
    "It never receives a member’s private mail, files, photos, calendar",
  );
  await access.getByRole("button", { name: "Add to group" }).click();
  await expect(access).toContainText("Hearth is in this group");
  await expect(access).toContainText(
    "messages already shared remain in group history",
  );
  expect(addObserved).toBe(true);

  await access.getByRole("button", { name: "Remove from group" }).click();
  await expect(access).toContainText("Add Hearth to this group");
  expect(removeObserved).toBe(true);
  await expect(page.getByText("Buzz")).toHaveCount(0);
  await expect(page.getByText(/relay|workload/i)).toHaveCount(0);
});

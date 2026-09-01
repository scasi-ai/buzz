import { expect, test } from "@playwright/test";

const readyBootstrap = {
  state: "READY",
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
      },
      {
        id: "room-agent",
        name: "My Agent",
        kind: "PERSONAL_AGENT",
      },
    ],
    householdAgent: {
      id: "agent-household",
      displayName: "Hearth",
      readiness: "READY",
    },
    personalAgent: {
      id: "agent-personal",
      displayName: "Juniper",
      readiness: "READY",
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
  ).toHaveAttribute(
    "href",
    "/api/micasa/v1/auth/start?return_to=%2F",
  );
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

  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "Households" })).toContainText(
    "River House",
  );
  await expect(page.getByRole("navigation", { name: "Rooms" })).toContainText(
    "Household",
  );
  await expect(page.getByText("Hearth")).toBeVisible();
  await expect(page.getByText("Juniper")).toBeVisible();
  await expect(page.getByText("Realtime readiness is enforced")).toBeVisible();
  await expect(page.getByText(/communities\.buzz\.xyz/)).toHaveCount(0);
  await expect(page.locator('a[href^="ws://"], a[href^="wss://"]')).toHaveCount(0);
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
  await expect(page.getByText(/No substitute workspace or demo data/)).toBeVisible();
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
          personalAgentRequired: true,
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
  await expect(page.getByText("Created during setup")).toBeVisible();
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
          personalAgentRequired: true,
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
  const csrfToken = "csrf_" + "a".repeat(40);

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
            idempotencyKey: "micasa-founder-profiles:" + "b".repeat(64),
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
  await expect(
    page.getByRole("heading", {
      name: "Name your Household and its agents",
    }),
  ).toBeVisible();
  await page.getByLabel("Household name").fill("River House");
  await page.getByLabel("Your display name").fill("Alex Rivera");
  await page.getByLabel("Household Agent name").fill("Hearth");
  await page.getByLabel("My Agent name").fill("Juniper");
  await page
    .getByLabel("Use the generated Household Agent avatar")
    .check();
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

test("legacy repository route is no longer a product surface", async ({
  page,
}) => {
  await page.goto("/repos");
  await expect(page.getByText("Repositories")).toHaveCount(0);
  await expect(page.getByText("Buzz")).toHaveCount(0);
});

import { expect, test } from "@playwright/test";

const tenant = `tenant:${"a".repeat(64)}`;
const oauthRef = `connector-oauth:${"b".repeat(64)}`;
const resourceFamily = `provider-resource:${"c".repeat(64)}`;
const resourceSchool = `provider-resource:${"d".repeat(64)}`;
const csrfToken = `csrf_${"e".repeat(40)}`;
const returnPath = `/settings/household/apps?household=${encodeURIComponent(tenant)}`;
const observedAt = "2099-09-01T11:00:00Z";
const expiresAt = "2099-09-01T11:05:00Z";

const readyBootstrap = {
  state: "READY",
  csrfToken,
  viewer: {
    id: "member-1",
    displayName: "Alex",
  },
  households: [
    {
      id: tenant,
      name: "River House",
      role: "HEAD",
    },
  ],
  activeHousehold: {
    id: tenant,
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
          {
            subjectId: "member-1",
            memberId: "member-1",
            kind: "HUMAN",
            displayName: "Alex",
            nostrPubkey: null,
            avatarPath: null,
          },
          {
            subjectId: "agent-personal",
            memberId: "member-1",
            kind: "PERSONAL_AGENT",
            displayName: "Juniper",
            nostrPubkey: "1".repeat(64),
            avatarPath: "/api/micasa/v1/media/juniper",
          },
          {
            subjectId: "agent-household",
            memberId: null,
            kind: "HOUSEHOLD_AGENT",
            displayName: "Hearth",
            nostrPubkey: "2".repeat(64),
            avatarPath: "/api/micasa/v1/media/hearth",
          },
        ],
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

function appsSettings() {
  return {
    state: "EDITABLE",
    surface: "SETTINGS",
    tier: "HOUSEHOLD",
    householdId: tenant,
    catalogVersion: "1.0.0",
    catalogDigest: "f".repeat(64),
    catalogTotalCards: 83,
    applicableCardCount: 1,
    decisionRevision: 4,
    csrfToken,
    cards: [
      {
        serviceId: "google-calendar",
        displayName: "Google Calendar",
        category: "MAIL_CALENDAR_CONTACTS_TASKS",
        placement: "DEDICATED_OR_SHARED",
        catalogStatus: "AVAILABLE",
        routeKinds: ["HOSTED_MCP", "DIRECT_API"],
        connectEnabled: true,
        decision: "NOT_NOW",
        authorizationStatus: "NOT_CONNECTED",
        resourceStatus: "SELECTION_REQUIRED",
        syncStatus: "NOT_STARTED",
        operationStatus: "BLOCKED",
        providerConnectionId: null,
        serviceGrantId: null,
        consentReceiptId: null,
        audience: ["HOUSEHOLD"],
        selectedResourceIds: [],
        details: "Select exact calendars in a separate authorization flow.",
      },
    ],
  };
}

async function installSettingsRoutes(page) {
  await page.route("**/api/micasa/v1/bootstrap**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(readyBootstrap),
    });
  });
  await page.route(
    "**/api/micasa/v1/settings/household/apps**",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(appsSettings()),
      });
    },
  );
}

test("Google Calendar setup starts through the PA BFF and stores only an opaque resume reference", async ({
  page,
}) => {
  await installSettingsRoutes(page);
  let startObserved = false;
  await page.route("**/api/micasa/v1/connectors/oauth/start", async (route) => {
    startObserved = true;
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["x-csrf-token"]).toBe(csrfToken);
    const body = route.request().postDataJSON();
    expect(body).toEqual({
      householdRef: tenant,
      tier: "HOUSEHOLD",
      serviceId: "google-calendar",
      returnPath,
      idempotencyKey: body.idempotencyKey,
    });
    expect(body.idempotencyKey).toMatch(
      /^connector-oauth-start:[0-9a-f-]{36}$/,
    );
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        schema: "micasa.connector_oauth_response.v1",
        oauthRef,
        householdRef: tenant,
        tier: "HOUSEHOLD",
        serviceId: "google-calendar",
        state: "AUTHORIZING",
        returnPath,
        observedAt,
        expiresAt,
        authorizationUrl:
          "https://accounts.google.com/o/oauth2/v2/auth?client_id=client.apps.googleusercontent.com&state=opaque",
      }),
    });
  });
  await page.route(
    "https://accounts.google.com/o/oauth2/v2/auth**",
    async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<h1>Google authorization boundary</h1>",
      });
    },
  );

  await page.goto(returnPath);
  await page.getByRole("button", { name: "Continue to Google" }).click();
  await expect.poll(() => startObserved).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Google authorization boundary" }),
  ).toBeVisible();

  const storage = await page.context().storageState();
  const micasaOrigin = storage.origins.find(
    (origin) => origin.origin === "http://127.0.0.1:4173",
  );
  expect(micasaOrigin?.localStorage).toHaveLength(1);
  const serialized = micasaOrigin?.localStorage[0].value ?? "";
  expect(serialized).toContain(oauthRef);
  expect(serialized).not.toContain("authorizationUrl");
  expect(serialized).not.toContain("accounts.google.com");
  expect(serialized).not.toContain("credential");
});

test("FINALIZING lets the Head select exact calendars without claiming Connected", async ({
  page,
}) => {
  await page.addInitScript(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    {
      key: `micasa.connector-oauth.resume.v1:HOUSEHOLD:${tenant}:google-calendar`,
      value: {
        schema: "micasa.connector_oauth_resume.v1",
        oauthRef,
        householdRef: tenant,
        tier: "HOUSEHOLD",
        serviceId: "google-calendar",
        returnPath,
        expiresAt,
      },
    },
  );
  await installSettingsRoutes(page);
  let selectionObserved = false;
  await page.route("**/api/micasa/v1/connectors/oauth/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/resources/discover")) {
      expect(route.request().method()).toBe("POST");
      expect(route.request().headers()["x-csrf-token"]).toBe(csrfToken);
      expect(route.request().postDataJSON()).toEqual({});
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(resourceReadback()),
      });
      return;
    }
    if (url.pathname.endsWith("/resources")) {
      selectionObserved = true;
      expect(route.request().method()).toBe("PUT");
      expect(route.request().headers()["x-csrf-token"]).toBe(csrfToken);
      expect(route.request().postDataJSON()).toEqual({
        expectedRevision: 1,
        resourceRefs: [resourceFamily],
      });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          resourceReadback({
            selectedResourceRefs: [resourceFamily],
            revision: 2,
          }),
        ),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema: "micasa.connector_oauth_response.v1",
        oauthRef,
        householdRef: tenant,
        tier: "HOUSEHOLD",
        serviceId: "google-calendar",
        state: "FINALIZING",
        returnPath,
        observedAt,
        expiresAt,
      }),
    });
  });

  await page.goto(returnPath);
  await expect(page.getByText("Finalizing — not connected yet")).toBeVisible();
  await expect(page.getByText(/MiCasa still does not call/)).toBeVisible();
  await page.getByRole("button", { name: "Find my calendars" }).click();
  await expect(
    page.getByRole("group", { name: "Choose exact calendars" }),
  ).toBeVisible();
  await page.getByLabel("Family · Primary").check();
  await page.getByRole("button", { name: "Save selected calendars" }).click();

  await expect.poll(() => selectionObserved).toBe(true);
  await expect(page.getByText(/Calendar choices saved/)).toBeVisible();
  await expect(page.getByText("Connected and verified")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(resourceFamily);
  await expect(page.locator("body")).not.toContainText("vault-credential:");
  await expect(page.locator("body")).not.toContainText("provider-connection:");
});

function resourceReadback(overrides = {}) {
  return {
    schema: "micasa.connector_oauth_resources.v1",
    oauthRef,
    householdRef: tenant,
    tier: "HOUSEHOLD",
    resources: [
      {
        resourceRef: resourceFamily,
        displayName: "Family",
        primary: true,
        accessRole: "owner",
        providerSelected: true,
        providerHidden: false,
      },
      {
        resourceRef: resourceSchool,
        displayName: "School",
        primary: false,
        accessRole: "reader",
        providerSelected: false,
        providerHidden: false,
      },
    ],
    selectedResourceRefs: [],
    revision: 1,
    observedAt,
    expiresAt,
    ...overrides,
  };
}

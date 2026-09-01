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

	await page.goto("/");

	await expect(
		page.getByRole("navigation", { name: "Households" }),
	).toContainText("River House");
	await expect(page.getByRole("navigation", { name: "Rooms" })).toContainText(
		"Household",
	);
	await expect(page.getByText("Hearth")).toBeVisible();
	await expect(page.getByText("Juniper")).toBeVisible();
	await expect(
		page.getByRole("link", { name: "Household Settings" }),
	).toHaveAttribute(
		"href",
		"/settings/household/members?household=household-1",
	);
	await expect(
		page.getByRole("link", { name: /User Settings/ }),
	).toHaveAttribute("href", "/settings/user/agent?household=household-1");
	await expect(page.getByText("Realtime readiness is enforced")).toBeVisible();
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
	const founderCsrf = "csrf_founder_" + "a".repeat(32);
	const appsCsrf = "csrf_apps_" + "b".repeat(32);
	let mutationObserved = false;

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
						idempotencyKey: "micasa-apps-review:" + "c".repeat(64),
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
				catalogTotalCards: 83,
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
	const csrfToken = "csrf_members_" + "e".repeat(32);
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
				kind: "SHARED",
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
							idempotencyKey: "micasa-members:" + "f".repeat(64),
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
	const csrfToken = "csrf_agent_profile_" + "g".repeat(32);
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
							idempotencyKey: "micasa-agent-profile:" + "h".repeat(64),
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

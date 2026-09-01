import assert from "node:assert/strict";
import test from "node:test";
import {
	AgentProfileSettingsContractError,
	buildAgentProfilePayload,
	parseAgentProfileMutation,
	parseAgentProfileSettings,
} from "./agent-profile-settings.ts";

const csrfToken = "csrf_" + "a".repeat(40);
const effects = [
	"PRESENTATION_UPDATED",
	"TENANT_NAMES_RECONCILED",
	"NOSTR_PROFILE_PROJECTED",
	"ACP_PROFILE_READBACK",
	"CACHE_INVALIDATED",
	"IDENTITY_PRESERVED",
	"STATE_PRESERVED",
	"CAPABILITIES_UNCHANGED",
];
function snapshot(overrides = {}) {
	return {
		scope: "HOUSEHOLD",
		householdId: "household-one",
		csrfToken,
		profile: {
			agentInstanceId: "agent-household",
			displayName: "Hearth",
			aliases: ["Home helper"],
			avatarArtifactId: "avatar-current",
			avatarAltText: "Current avatar",
			publicBio: "Helps the household.",
			profileRevision: 4,
			characterRevision: 2,
		},
		availableAvatars: [
			{
				artifactId: "avatar-current",
				mediaType: "image/webp",
				altText: "Current avatar",
				source: "UPLOADED",
				contentPath: "/api/micasa/v1/media/avatar/current",
			},
			{
				artifactId: "avatar-generated",
				mediaType: "image/webp",
				altText: "Generated avatar",
				source: "GENERATED",
				contentPath: "/api/micasa/v1/media/avatar/generated",
			},
		],
		...overrides,
	};
}
function draft(overrides = {}) {
	return {
		displayName: "Solace",
		aliases: ["Housemate", "Planner"],
		avatarArtifactId: "avatar-generated",
		avatarAltText: "A generated agent portrait",
		publicBio: "Helps with shared plans.",
		...overrides,
	};
}
function mutation(before, requested, overrides = {}) {
	return {
		state: "VERIFIED",
		operation: {
			operationId: "operation-agent-profile",
			idempotencyKey: "micasa-agent-profile:" + "b".repeat(64),
			operation:
				before.scope === "HOUSEHOLD"
					? "UPDATE_HOUSEHOLD_AGENT_PROFILE"
					: "UPDATE_PERSONAL_AGENT_PROFILE",
			retrySafe: true,
			mutationPossible: false,
			nextAction: "REFRESH_AGENT_SETTINGS",
			policyRevision: 9,
			readbackAt: 1000,
			effects,
		},
		readback: {
			...before,
			profile: {
				...before.profile,
				...requested,
				profileRevision: before.profile.profileRevision + 1,
			},
		},
		...overrides,
	};
}

test("parses presentation without private identity or connector fields", () => {
	const parsed = parseAgentProfileSettings(snapshot());
	assert.equal(parsed.profile.agentInstanceId, "agent-household");
	assert.throws(
		() =>
			parseAgentProfileSettings({
				...snapshot(),
				immutableIdentityDigest: "a".repeat(64),
			}),
		AgentProfileSettingsContractError,
	);
	const value = snapshot();
	value.profile = { ...value.profile, privateKey: "hidden" };
	assert.throws(
		() => parseAgentProfileSettings(value),
		AgentProfileSettingsContractError,
	);
});
test("requires every avatar to use a same-origin reviewed media path", () => {
	const value = snapshot();
	value.availableAvatars[0] = {
		...value.availableAvatars[0],
		contentPath: "https://relay.example/avatar",
	};
	assert.throws(
		() => parseAgentProfileSettings(value),
		AgentProfileSettingsContractError,
	);
});
test("rejects prototype names and aliases case-insensitively", () => {
	const parsed = parseAgentProfileSettings(snapshot());
	for (const value of [
		draft({ displayName: "Fizz" }),
		draft({ aliases: ["hOnEy"] }),
		draft({ aliases: ["Pollen"] }),
	]) {
		assert.throws(
			() => buildAgentProfilePayload(parsed, value),
			AgentProfileSettingsContractError,
		);
	}
});
test("rejects normalized duplicate aliases and display-name aliases", () => {
	const parsed = parseAgentProfileSettings(snapshot());
	assert.throws(
		() =>
			buildAgentProfilePayload(
				parsed,
				draft({ aliases: ["Helper", "helper"] }),
			),
		AgentProfileSettingsContractError,
	);
	assert.throws(
		() => buildAgentProfilePayload(parsed, draft({ aliases: ["Solace"] })),
		AgentProfileSettingsContractError,
	);
});
test("builds an exact presentation-only payload", () => {
	const parsed = parseAgentProfileSettings(snapshot());
	assert.deepEqual(buildAgentProfilePayload(parsed, draft()), {
		expectedRevision: 4,
		displayName: "Solace",
		aliases: ["Housemate", "Planner"],
		avatarArtifactId: "avatar-generated",
		avatarAltText: "A generated agent portrait",
		publicBio: "Helps with shared plans.",
	});
});
test("refuses an avatar not approved by Personal-Agent", () => {
	const parsed = parseAgentProfileSettings(snapshot());
	assert.throws(
		() =>
			buildAgentProfilePayload(
				parsed,
				draft({ avatarArtifactId: "avatar-unreviewed" }),
			),
		AgentProfileSettingsContractError,
	);
});
test("accepts exact Household Agent verified readback", () => {
	const before = parseAgentProfileSettings(snapshot());
	const requested = draft();
	const parsed = parseAgentProfileMutation(
		mutation(before, requested),
		before,
		requested,
	);
	assert.equal(parsed.operation.operation, "UPDATE_HOUSEHOLD_AGENT_PROFILE");
	assert.equal(parsed.readback.profile.agentInstanceId, "agent-household");
});
test("accepts only self-scoped Personal Agent operation type", () => {
	const before = parseAgentProfileSettings(
		snapshot({
			scope: "PRIVATE",
			profile: {
				...snapshot().profile,
				agentInstanceId: "agent-personal",
			},
		}),
	);
	const requested = draft({ publicBio: "My private helper." });
	assert.equal(
		parseAgentProfileMutation(mutation(before, requested), before, requested)
			.operation.operation,
		"UPDATE_PERSONAL_AGENT_PROFILE",
	);
});
test("refuses agent-instance and character substitution", () => {
	const before = parseAgentProfileSettings(snapshot());
	const requested = draft();
	const changedIdentity = mutation(before, requested);
	changedIdentity.readback.profile.agentInstanceId = "agent-replacement";
	assert.throws(
		() => parseAgentProfileMutation(changedIdentity, before, requested),
		AgentProfileSettingsContractError,
	);
	const changedCharacter = mutation(before, requested);
	changedCharacter.readback.profile.characterRevision += 1;
	assert.throws(
		() => parseAgentProfileMutation(changedCharacter, before, requested),
		AgentProfileSettingsContractError,
	);
});
test("refuses incomplete continuity effects or uncertain mutation", () => {
	const before = parseAgentProfileSettings(snapshot());
	const requested = draft();
	const incomplete = mutation(before, requested);
	incomplete.operation.effects = effects.filter(
		(effect) => effect !== "ACP_PROFILE_READBACK",
	);
	assert.throws(
		() => parseAgentProfileMutation(incomplete, before, requested),
		AgentProfileSettingsContractError,
	);
	const uncertain = mutation(before, requested);
	uncertain.operation.mutationPossible = true;
	assert.throws(
		() => parseAgentProfileMutation(uncertain, before, requested),
		AgentProfileSettingsContractError,
	);
});
test("refuses response scope drift", () => {
	const before = parseAgentProfileSettings(snapshot());
	const requested = draft();
	const value = mutation(before, requested);
	value.readback.scope = "PRIVATE";
	assert.throws(
		() => parseAgentProfileMutation(value, before, requested),
		AgentProfileSettingsContractError,
	);
});

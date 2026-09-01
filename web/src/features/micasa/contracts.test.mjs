import assert from "node:assert/strict";
import test from "node:test";

import { MiCasaContractError, parseMiCasaBootstrap } from "./contracts.ts";

const viewerId = "tenant-member:" + "1".repeat(64);

function participant({
	subjectId,
	memberId,
	kind,
	displayName,
	nostrPubkey,
	avatarPath = null,
}) {
	return {
		subjectId,
		memberId,
		kind,
		displayName,
		nostrPubkey,
		avatarPath,
	};
}

const alex = participant({
	subjectId: viewerId,
	memberId: viewerId,
	kind: "HUMAN",
	displayName: "Alex",
	nostrPubkey: "a".repeat(64),
	avatarPath: "/api/micasa/v1/media/alex",
});
const juniper = participant({
	subjectId: "agent:personal",
	memberId: viewerId,
	kind: "PERSONAL_AGENT",
	displayName: "Juniper",
	nostrPubkey: "b".repeat(64),
});
const mayaId = "tenant-member:" + "2".repeat(64);
const maya = participant({
	subjectId: mayaId,
	memberId: mayaId,
	kind: "HUMAN",
	displayName: "Maya",
	nostrPubkey: "c".repeat(64),
});
const spruce = participant({
	subjectId: "agent:maya",
	memberId: mayaId,
	kind: "PERSONAL_AGENT",
	displayName: "Spruce",
	nostrPubkey: "d".repeat(64),
});
const rowanId = "tenant-member:" + "3".repeat(64);
const rowan = participant({
	subjectId: rowanId,
	memberId: rowanId,
	kind: "HUMAN",
	displayName: "Rowan",
	nostrPubkey: "e".repeat(64),
});
const maple = participant({
	subjectId: "agent:rowan",
	memberId: rowanId,
	kind: "PERSONAL_AGENT",
	displayName: "Maple",
	nostrPubkey: "f".repeat(64),
});
const hearth = participant({
	subjectId: "agent:household",
	memberId: null,
	kind: "HOUSEHOLD_AGENT",
	displayName: "Hearth",
	nostrPubkey: "0".repeat(64),
});

function ready() {
	const household = {
		id: "tenant:" + "4".repeat(64),
		name: "River House",
		role: "HEAD",
	};
	return {
		state: "READY",
		viewer: { id: viewerId, displayName: "Alex" },
		households: [household],
		activeHousehold: {
			...household,
			rooms: [
				{
					id: "room:household",
					name: "Household",
					kind: "HOUSEHOLD",
					participants: [alex, juniper, maya, spruce, rowan, maple, hearth],
				},
				{
					id: "room:my-agent",
					name: "My Agent",
					kind: "PERSONAL_AGENT",
					participants: [alex, juniper],
				},
				{
					id: "room:family",
					name: "Family",
					kind: "GROUP",
					participants: [alex, juniper, maya, spruce, rowan, maple],
				},
			],
			activeRoomId: "room:family",
			householdAgent: {
				id: "agent:household",
				displayName: "Hearth",
				readiness: "READY",
			},
			personalAgent: {
				id: "agent:personal",
				displayName: "Juniper",
				readiness: "READY",
			},
		},
	};
}

test("parses tenant-chosen human, personal-agent, and household-agent profiles", () => {
	const parsed = parseMiCasaBootstrap(ready());
	assert.equal(parsed.state, "READY");
	const room = parsed.activeHousehold.rooms[2];
	assert.deepEqual(
		room.participants.map((item) => [item.displayName, item.kind]),
		[
			["Alex", "HUMAN"],
			["Juniper", "PERSONAL_AGENT"],
			["Maya", "HUMAN"],
			["Spruce", "PERSONAL_AGENT"],
			["Rowan", "HUMAN"],
			["Maple", "PERSONAL_AGENT"],
		],
	);
	assert.equal(room.participants[0].avatarPath, "/api/micasa/v1/media/alex");
});

test("groups require at least three humans and one Personal Agent per human", () => {
	for (const participants of [
		[alex, juniper, maya, spruce],
		[alex, juniper, maya, spruce, rowan],
	]) {
		const value = ready();
		value.activeHousehold.rooms[2].participants = participants;
		assert.throws(() => parseMiCasaBootstrap(value), MiCasaContractError);
	}
});

test("DMs require exactly two humans and both Personal Agents", () => {
	const value = ready();
	value.activeHousehold.rooms[2] = {
		id: "room:dm",
		name: "Alex and Maya",
		kind: "DM",
		participants: [alex, juniper, maya, spruce],
	};
	value.activeHousehold.activeRoomId = "room:dm";
	assert.doesNotThrow(() => parseMiCasaBootstrap(value));
	value.activeHousehold.rooms[2].participants.pop();
	assert.throws(() => parseMiCasaBootstrap(value), MiCasaContractError);
});

test("duplicate signed identities and Household Agents in groups are refused", () => {
	const duplicate = ready();
	duplicate.activeHousehold.rooms[2].participants[5] = {
		...maple,
		nostrPubkey: juniper.nostrPubkey,
	};
	assert.throws(() => parseMiCasaBootstrap(duplicate), MiCasaContractError);

	const householdAgent = ready();
	householdAgent.activeHousehold.rooms[2].participants.push(hearth);
	assert.throws(
		() => parseMiCasaBootstrap(householdAgent),
		MiCasaContractError,
	);
});

test("every visible room must contain the viewer and the viewer's Personal Agent", () => {
	const value = ready();
	value.activeHousehold.rooms[2].participants = [
		maya,
		spruce,
		rowan,
		maple,
		participant({
			subjectId: "tenant-member:" + "5".repeat(64),
			memberId: "tenant-member:" + "5".repeat(64),
			kind: "HUMAN",
			displayName: "Taylor",
			nostrPubkey: "5".repeat(64),
		}),
		participant({
			subjectId: "agent:taylor",
			memberId: "tenant-member:" + "5".repeat(64),
			kind: "PERSONAL_AGENT",
			displayName: "Cedar",
			nostrPubkey: "6".repeat(64),
		}),
	];
	assert.throws(() => parseMiCasaBootstrap(value), MiCasaContractError);
});

test("room agent names must match the authoritative profile summaries", () => {
	for (const mutate of [
		(value) => {
			value.activeHousehold.personalAgent.displayName = "Wrong Personal Name";
		},
		(value) => {
			value.activeHousehold.householdAgent.displayName = "Wrong Household Name";
		},
	]) {
		const value = ready();
		mutate(value);
		assert.throws(() => parseMiCasaBootstrap(value), MiCasaContractError);
	}
});

test("participant avatars are same-origin MiCasa media paths only", () => {
	for (const avatarPath of [
		"https://tracker.example/avatar.png",
		"//tracker.example/avatar.png",
		"/other/avatar.png",
	]) {
		const value = ready();
		value.activeHousehold.rooms[2].participants[0] = {
			...alex,
			avatarPath,
		};
		assert.throws(() => parseMiCasaBootstrap(value), MiCasaContractError);
	}
});

test("a pending human signer may be null but every agent key is mandatory", () => {
	const pendingHuman = ready();
	for (const room of pendingHuman.activeHousehold.rooms) {
		room.participants = room.participants.map((item) =>
			item.subjectId === viewerId ? { ...item, nostrPubkey: null } : item,
		);
	}
	assert.doesNotThrow(() => parseMiCasaBootstrap(pendingHuman));

	const missingAgent = ready();
	missingAgent.activeHousehold.rooms[2].participants[5] = {
		...maple,
		nostrPubkey: null,
	};
	assert.throws(() => parseMiCasaBootstrap(missingAgent), MiCasaContractError);
});

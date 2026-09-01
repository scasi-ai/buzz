import assert from "node:assert/strict";
import test from "node:test";
import {
	finalizeEvent,
	generateSecretKey,
	getPublicKey,
} from "nostr-tools/pure";
import {
	buildSignerEnrollmentPayload,
	MiCasaSignerContractError,
	parseMiCasaSignerSnapshot,
} from "./signer.ts";

const origin = "https://micasa.mediaglyphics.com";
const challenge = "a".repeat(64);
const csrfToken = "csrf_" + "b".repeat(40);

Object.defineProperty(globalThis, "window", {
	value: { location: { origin } },
	configurable: true,
});

class Signer {
	secret = generateSecretKey();

	async getPublicKey() {
		return getPublicKey(this.secret);
	}

	async signEvent(event) {
		return finalizeEvent(event, this.secret);
	}
}

function snapshot(overrides = {}) {
	return {
		state: "ENROLLMENT_REQUIRED",
		bindingId: "signer-binding-one",
		publicKey: null,
		deviceId: null,
		keyRevision: 0,
		recoveryState: "SETUP_REQUIRED",
		registrationRevision: 4,
		enrollmentChallenge: challenge,
		csrfToken,
		...overrides,
	};
}

test("parses enrollment without any private key material", () => {
	const parsed = parseMiCasaSignerSnapshot(snapshot());
	assert.equal(parsed.bindingId, "signer-binding-one");
	assert.equal(parsed.enrollmentChallenge, challenge);
	for (const field of [
		"privateKey",
		"secretKey",
		"seed",
		"mnemonic",
		"recoverySecret",
	]) {
		assert.throws(
			() => parseMiCasaSignerSnapshot({ ...snapshot(), [field]: "hidden" }),
			MiCasaSignerContractError,
		);
	}
});

test("parses a ready signer with the same stable binding", () => {
	const parsed = parseMiCasaSignerSnapshot(
		snapshot({
			state: "READY",
			publicKey: "c".repeat(64),
			deviceId: "device-one",
			keyRevision: 1,
			registrationRevision: 5,
			enrollmentChallenge: null,
		}),
	);
	assert.equal(parsed.state, "READY");
	assert.equal(parsed.deviceId, "device-one");
});

test("rejects contradictory enrollment state", () => {
	for (const value of [
		snapshot({ publicKey: "c".repeat(64) }),
		snapshot({ deviceId: "device-one" }),
		snapshot({ keyRevision: 1 }),
		snapshot({ recoveryState: "READY" }),
		snapshot({ enrollmentChallenge: null }),
	]) {
		assert.throws(
			() => parseMiCasaSignerSnapshot(value),
			MiCasaSignerContractError,
		);
	}
});

test("rejects contradictory ready state", () => {
	for (const patch of [
		{ publicKey: null },
		{ deviceId: null },
		{ keyRevision: 0 },
		{ enrollmentChallenge: challenge },
	]) {
		assert.throws(
			() =>
				parseMiCasaSignerSnapshot(
					snapshot({
						state: "READY",
						publicKey: "c".repeat(64),
						deviceId: "device-one",
						keyRevision: 1,
						registrationRevision: 5,
						enrollmentChallenge: null,
						...patch,
					}),
				),
			MiCasaSignerContractError,
		);
	}
});

test("builds exact signed proof bound to challenge, origin, and purpose", async () => {
	const signer = new Signer();
	const payload = await buildSignerEnrollmentPayload(
		parseMiCasaSignerSnapshot(snapshot()),
		"  Alex's   MacBook  ",
		signer,
		() => 2_000_000,
	);
	assert.equal(payload.expectedRegistrationRevision, 4);
	assert.equal(payload.deviceLabel, "Alex's MacBook");
	assert.equal(payload.proof.pubkey, await signer.getPublicKey());
	assert.equal(payload.proof.kind, 27235);
	assert.equal(payload.proof.created_at, 2000);
	assert.equal(payload.proof.content, "");
	assert.deepEqual(payload.proof.tags, [
		["challenge", challenge],
		["origin", origin],
		["purpose", "micasa-signer-enrollment"],
	]);
});

test("rejects device labels that cannot be audited safely", async () => {
	const before = parseMiCasaSignerSnapshot(snapshot());
	for (const label of ["", "x".repeat(81), "device\u007fname"]) {
		await assert.rejects(
			buildSignerEnrollmentPayload(before, label, new Signer()),
			MiCasaSignerContractError,
		);
	}
});

test("refuses a signer that substitutes its public key", async () => {
	const signer = new Signer();
	signer.getPublicKey = async () => "0".repeat(64);
	await assert.rejects(
		buildSignerEnrollmentPayload(
			parseMiCasaSignerSnapshot(snapshot()),
			"Browser",
			signer,
		),
		MiCasaSignerContractError,
	);
});

test("refuses a signer that changes the requested proof event", async () => {
	const signer = new Signer();
	const original = signer.signEvent.bind(signer);
	signer.signEvent = async (event) =>
		original({ ...event, content: "substituted" });
	await assert.rejects(
		buildSignerEnrollmentPayload(
			parseMiCasaSignerSnapshot(snapshot()),
			"Browser",
			signer,
		),
		MiCasaSignerContractError,
	);
});

test("refuses enrollment after the authority is already ready", async () => {
	const ready = parseMiCasaSignerSnapshot(
		snapshot({
			state: "READY",
			publicKey: "c".repeat(64),
			deviceId: "device-one",
			keyRevision: 1,
			registrationRevision: 5,
			enrollmentChallenge: null,
		}),
	);
	await assert.rejects(
		buildSignerEnrollmentPayload(ready, "Browser", new Signer()),
		MiCasaSignerContractError,
	);
});

test("binding and authority identifiers are strict public references", () => {
	for (const patch of [
		{ bindingId: "../other" },
		{ deviceId: "https://relay.example" },
		{ registrationRevision: 0 },
		{ csrfToken: "short" },
	]) {
		assert.throws(
			() => parseMiCasaSignerSnapshot(snapshot(patch)),
			MiCasaSignerContractError,
		);
	}
});

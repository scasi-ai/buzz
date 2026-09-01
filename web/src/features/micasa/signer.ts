import { verifyEvent } from "nostr-tools/pure";
import type {
	MiCasaNostrSigner,
	SignedNostrEvent,
	UnsignedNostrEvent,
} from "@/features/micasa/realtime";

export class MiCasaSignerContractError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MiCasaSignerContractError";
	}
}

type MiCasaSignerSnapshotCommon = {
	bindingId: string;
	registrationRevision: number;
	csrfToken: string;
};
export type MiCasaSignerSnapshot = MiCasaSignerSnapshotCommon &
	(
		| {
				state: "ENROLLMENT_REQUIRED";
				publicKey: null;
				deviceId: null;
				keyRevision: 0;
				recoveryState: "SETUP_REQUIRED";
				enrollmentChallenge: string;
		  }
		| {
				state: "READY";
				publicKey: string;
				deviceId: string;
				keyRevision: number;
				recoveryState: "SETUP_REQUIRED" | "READY";
				enrollmentChallenge: null;
		  }
	);
export type MiCasaSignerMutation = {
	state: "VERIFIED";
	operation: {
		operationId: string;
		idempotencyKey: string;
		operation: "ENROLL_BROWSER_SIGNER";
		retrySafe: true;
		mutationPossible: false;
		nextAction: "SET_UP_SIGNER_RECOVERY";
		policyRevision: number;
		readbackAt: number;
		effects: string[];
	};
	readback: MiCasaSignerSnapshot & {
		state: "READY";
		publicKey: string;
		deviceId: string;
		recoveryState: "SETUP_REQUIRED";
	};
};

type JsonObject = Record<string, unknown>;
const SIGNER_PATH = "/api/micasa/v1/signer";
const SIGNER_PROOF_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const CSRF = /^[A-Za-z0-9_-]{32,256}$/;
const EFFECTS = [
	"PUBLIC_KEY_BOUND",
	"DEVICE_REGISTERED",
	"RECOVERY_NOT_ASSUMED",
	"PRIVATE_KEY_NOT_RECEIVED",
] as const;

function fail(message: string): never {
	throw new MiCasaSignerContractError(message);
}
function object(value: unknown, label: string): JsonObject {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		fail(label + " must be an object.");
	}
	return value as JsonObject;
}
function exact(record: JsonObject, fields: readonly string[], label: string) {
	const actual = Object.keys(record).sort();
	const expected = [...fields].sort();
	if (
		actual.length !== expected.length ||
		actual.some((field, index) => field !== expected[index])
	) {
		fail(label + " has an unsupported field.");
	}
}
function reference(record: JsonObject, key: string, label: string): string {
	const value = record[key];
	if (typeof value !== "string" || !REF.test(value)) {
		fail(label + "." + key + " is invalid.");
	}
	return value;
}
function positive(record: JsonObject, key: string, label: string): number {
	const value = record[key];
	if (!Number.isSafeInteger(value) || (value as number) < 1) {
		fail(label + "." + key + " must be a positive integer.");
	}
	return value as number;
}
function nullable(
	record: JsonObject,
	key: string,
	pattern: RegExp,
	label: string,
): string | null {
	const value = record[key];
	if (value === null) return null;
	if (typeof value !== "string" || !pattern.test(value)) {
		fail(label + "." + key + " is invalid.");
	}
	return value;
}

export function parseMiCasaSignerSnapshot(
	value: unknown,
): MiCasaSignerSnapshot {
	const label = "signer";
	const record = object(value, label);
	exact(
		record,
		[
			"state",
			"bindingId",
			"publicKey",
			"deviceId",
			"keyRevision",
			"recoveryState",
			"registrationRevision",
			"enrollmentChallenge",
			"csrfToken",
		],
		label,
	);
	const state = record.state;
	const bindingId = reference(record, "bindingId", label);
	const publicKey = nullable(record, "publicKey", HEX64, label);
	const deviceId = nullable(record, "deviceId", REF, label);
	const challenge = nullable(record, "enrollmentChallenge", HEX64, label);
	const csrfToken = record.csrfToken;
	if (
		(state !== "ENROLLMENT_REQUIRED" && state !== "READY") ||
		(record.recoveryState !== "SETUP_REQUIRED" &&
			record.recoveryState !== "READY") ||
		typeof csrfToken !== "string" ||
		!CSRF.test(csrfToken)
	) {
		fail("The signer authority is invalid.");
	}
	const registrationRevision = positive(record, "registrationRevision", label);
	const keyRevision = record.keyRevision;
	if (
		!Number.isSafeInteger(keyRevision) ||
		(keyRevision as number) < 0 ||
		(state === "ENROLLMENT_REQUIRED" &&
			(publicKey !== null ||
				deviceId !== null ||
				keyRevision !== 0 ||
				challenge === null ||
				record.recoveryState !== "SETUP_REQUIRED")) ||
		(state === "READY" &&
			(publicKey === null ||
				deviceId === null ||
				(keyRevision as number) < 1 ||
				challenge !== null))
	) {
		fail("The signer authority contradicts its state.");
	}
	const common: MiCasaSignerSnapshotCommon = {
		bindingId,
		registrationRevision,
		csrfToken,
	};
	if (state === "ENROLLMENT_REQUIRED") {
		return {
			...common,
			state,
			publicKey: null,
			deviceId: null,
			keyRevision: 0,
			recoveryState: "SETUP_REQUIRED",
			enrollmentChallenge: challenge as string,
		};
	}
	return {
		...common,
		state: "READY",
		publicKey: publicKey as string,
		deviceId: deviceId as string,
		keyRevision: keyRevision as number,
		recoveryState: record.recoveryState as "SETUP_REQUIRED" | "READY",
		enrollmentChallenge: null,
	};
}

function sameUnsigned(
	expected: UnsignedNostrEvent,
	actual: SignedNostrEvent,
): boolean {
	return (
		actual.kind === expected.kind &&
		actual.created_at === expected.created_at &&
		actual.content === expected.content &&
		JSON.stringify(actual.tags) === JSON.stringify(expected.tags)
	);
}
function deviceLabel(value: string): string {
	const normalized = value.trim().replace(/\s+/g, " ");
	if (
		normalized.length < 1 ||
		normalized.length > 80 ||
		/[\u0000-\u001f\u007f]/.test(normalized)
	) {
		fail("Enter a valid device name.");
	}
	return normalized;
}

export async function buildSignerEnrollmentPayload(
	snapshot: MiCasaSignerSnapshot,
	label: string,
	signer: MiCasaNostrSigner,
	now: () => number = Date.now,
) {
	if (
		snapshot.state !== "ENROLLMENT_REQUIRED" ||
		snapshot.enrollmentChallenge === null
	) {
		fail("This signer is already enrolled.");
	}
	const publicKey = await signer.getPublicKey();
	if (!HEX64.test(publicKey)) fail("The browser signer is invalid.");
	const unsigned: UnsignedNostrEvent = {
		kind: SIGNER_PROOF_KIND,
		created_at: Math.floor(now() / 1_000),
		tags: [
			["challenge", snapshot.enrollmentChallenge],
			["origin", window.location.origin],
			["purpose", "micasa-signer-enrollment"],
		],
		content: "",
	};
	const proof = await signer.signEvent(unsigned);
	if (
		proof.pubkey !== publicKey ||
		!HEX64.test(proof.id) ||
		!HEX128.test(proof.sig) ||
		!sameUnsigned(unsigned, proof) ||
		!verifyEvent(proof)
	) {
		fail("The browser signer returned an invalid enrollment proof.");
	}
	return {
		expectedRegistrationRevision: snapshot.registrationRevision,
		deviceLabel: deviceLabel(label),
		proof,
	};
}

function parseMutation(
	value: unknown,
	before: MiCasaSignerSnapshot,
	expectedPublicKey: string,
): MiCasaSignerMutation {
	const record = object(value, "signerMutation");
	exact(record, ["state", "operation", "readback"], "signerMutation");
	const operation = object(record.operation, "signerMutation.operation");
	exact(
		operation,
		[
			"operationId",
			"idempotencyKey",
			"operation",
			"retrySafe",
			"mutationPossible",
			"nextAction",
			"policyRevision",
			"readbackAt",
			"effects",
		],
		"signerMutation.operation",
	);
	if (
		record.state !== "VERIFIED" ||
		operation.operation !== "ENROLL_BROWSER_SIGNER" ||
		operation.retrySafe !== true ||
		operation.mutationPossible !== false ||
		operation.nextAction !== "SET_UP_SIGNER_RECOVERY" ||
		!Array.isArray(operation.effects)
	) {
		fail("Signer enrollment lacks verified readback.");
	}
	const effects = operation.effects;
	const expectedEffects = [...EFFECTS].sort();
	if (
		effects.length !== expectedEffects.length ||
		new Set(effects).size !== effects.length ||
		effects.some((effect) => typeof effect !== "string") ||
		[...effects]
			.sort()
			.some((effect, index) => effect !== expectedEffects[index])
	) {
		fail("Signer enrollment did not preserve the custody boundary.");
	}
	const readback = parseMiCasaSignerSnapshot(record.readback);
	if (
		readback.state !== "READY" ||
		readback.bindingId !== before.bindingId ||
		readback.publicKey !== expectedPublicKey ||
		readback.deviceId === null ||
		readback.keyRevision !== 1 ||
		readback.recoveryState !== "SETUP_REQUIRED" ||
		readback.registrationRevision !== before.registrationRevision + 1
	) {
		fail("Signer enrollment returned a different identity.");
	}
	return {
		state: "VERIFIED",
		operation: {
			operationId: reference(
				operation,
				"operationId",
				"signerMutation.operation",
			),
			idempotencyKey: reference(
				operation,
				"idempotencyKey",
				"signerMutation.operation",
			),
			operation: "ENROLL_BROWSER_SIGNER",
			retrySafe: true,
			mutationPossible: false,
			nextAction: "SET_UP_SIGNER_RECOVERY",
			policyRevision: positive(
				operation,
				"policyRevision",
				"signerMutation.operation",
			),
			readbackAt: positive(operation, "readbackAt", "signerMutation.operation"),
			effects: effects as string[],
		},
		readback: {
			...readback,
			state: "READY",
			publicKey: readback.publicKey,
			deviceId: readback.deviceId,
			recoveryState: "SETUP_REQUIRED",
		},
	};
}

function apiUrl(): URL {
	const configured = import.meta.env.VITE_PA_BFF_ORIGIN?.trim();
	const base = new URL(configured || window.location.origin);
	if (import.meta.env.PROD && base.protocol !== "https:") {
		fail("The production signer API must use HTTPS.");
	}
	return new URL(SIGNER_PATH, base);
}
async function requestJson<T>(
	parser: (value: unknown) => T,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(apiUrl(), {
		...init,
		credentials: "include",
		cache: "no-store",
		headers: { Accept: "application/json", ...init?.headers },
		signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	const body = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(
			response.status === 409
				? "This signer changed. Refresh before continuing."
				: response.status === 401
					? "Your MiCasa session has expired."
					: response.status === 403
						? "Signer enrollment was refused."
						: "Personal-Agent could not verify signer enrollment.",
		);
	}
	return parser(body);
}

export function loadMiCasaSigner(): Promise<MiCasaSignerSnapshot> {
	return requestJson(parseMiCasaSignerSnapshot);
}
export async function enrollMiCasaSigner(
	snapshot: MiCasaSignerSnapshot,
	label: string,
	signer: MiCasaNostrSigner,
): Promise<MiCasaSignerMutation> {
	const expectedPublicKey = await signer.getPublicKey();
	const payload = await buildSignerEnrollmentPayload(snapshot, label, signer);
	return requestJson(
		(value) => parseMutation(value, snapshot, expectedPublicKey),
		{
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				"X-CSRF-Token": snapshot.csrfToken,
			},
			body: JSON.stringify(payload),
		},
	);
}

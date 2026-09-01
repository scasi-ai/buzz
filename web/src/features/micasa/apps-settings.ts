import {
	type AppsDecision,
	AppsOnboardingContractError,
	type AppsReviewCard,
	type AppsReviewSnapshot,
	type AppsTier,
	buildAppsDecisionPayload,
	parseAppsReviewSnapshot,
} from "@/features/micasa/apps-onboarding";

export class AppsSettingsContractError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AppsSettingsContractError";
	}
}

export type AppsSettingsSnapshot = Omit<AppsReviewSnapshot, "state"> & {
	state: "EDITABLE";
	surface: "SETTINGS";
	householdId: string;
};
export type AppsSettingsMutation = {
	state: "UPDATED";
	surface: "SETTINGS";
	tier: AppsTier;
	operation: {
		operationId: string;
		idempotencyKey: string;
		operation:
			| "UPDATE_HOUSEHOLD_APPS_SETTINGS"
			| "UPDATE_PRIVATE_APPS_SETTINGS";
		retrySafe: true;
		mutationPossible: false;
		nextAction: "REFRESH_APPS_SETTINGS";
		policyRevision: number;
		readbackAt: number;
		effects: string[];
	};
	readback: AppsSettingsSnapshot;
};

type JsonObject = Record<string, unknown>;
const API_PREFIX = "/api/micasa/v1";
const PATHS: Record<AppsTier, string> = {
	HOUSEHOLD: API_PREFIX + "/settings/household/apps",
	PRIVATE: API_PREFIX + "/settings/user/apps",
};
const OPERATIONS: Record<
	AppsTier,
	AppsSettingsMutation["operation"]["operation"]
> = {
	HOUSEHOLD: "UPDATE_HOUSEHOLD_APPS_SETTINGS",
	PRIVATE: "UPDATE_PRIVATE_APPS_SETTINGS",
};
const EFFECTS = [
	"DECISIONS_UPDATED",
	"SERVICE_GRANTS_UNCHANGED",
	"CREDENTIALS_UNCHANGED",
	"HOUSEHOLD_PRIVATE_BOUNDARY_PRESERVED",
] as const;
const REQUEST_TIMEOUT_MS = 15_000;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function fail(message: string): never {
	throw new AppsSettingsContractError(message);
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
function ref(record: JsonObject, key: string, label: string): string {
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
function parseTier(value: unknown): AppsTier {
	if (value !== "HOUSEHOLD" && value !== "PRIVATE") {
		fail("Apps Settings tier is unsupported.");
	}
	return value;
}
function reviewedProjection(record: JsonObject): AppsReviewSnapshot {
	try {
		return parseAppsReviewSnapshot({
			state: "REVIEWED",
			tier: record.tier,
			catalogVersion: record.catalogVersion,
			catalogDigest: record.catalogDigest,
			catalogTotalCards: record.catalogTotalCards,
			applicableCardCount: record.applicableCardCount,
			decisionRevision: record.decisionRevision,
			csrfToken: record.csrfToken,
			cards: record.cards,
		});
	} catch (error) {
		if (error instanceof AppsOnboardingContractError) {
			fail(error.message);
		}
		throw error;
	}
}

export function parseAppsSettingsSnapshot(
	value: unknown,
): AppsSettingsSnapshot {
	const record = object(value, "appsSettings");
	exact(
		record,
		[
			"state",
			"surface",
			"tier",
			"householdId",
			"catalogVersion",
			"catalogDigest",
			"catalogTotalCards",
			"applicableCardCount",
			"decisionRevision",
			"csrfToken",
			"cards",
		],
		"appsSettings",
	);
	if (record.state !== "EDITABLE" || record.surface !== "SETTINGS") {
		fail("Apps Settings is not editable.");
	}
	const reviewed = reviewedProjection(record);
	return {
		...reviewed,
		state: "EDITABLE",
		surface: "SETTINGS",
		householdId: ref(record, "householdId", "appsSettings"),
	};
}

export function buildAppsSettingsPayload(
	snapshot: AppsSettingsSnapshot,
	decisions: Readonly<Record<string, AppsDecision>>,
) {
	return buildAppsDecisionPayload(
		{
			...snapshot,
			state: "REVIEWED",
		},
		decisions,
	);
}

function parseOperation(
	value: unknown,
	tier: AppsTier,
): AppsSettingsMutation["operation"] {
	const label = "appsSettingsMutation.operation";
	const record = object(value, label);
	exact(
		record,
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
		label,
	);
	if (
		record.operation !== OPERATIONS[tier] ||
		record.retrySafe !== true ||
		record.mutationPossible !== false ||
		record.nextAction !== "REFRESH_APPS_SETTINGS" ||
		!Array.isArray(record.effects)
	) {
		fail("Apps Settings mutation lacks verified readback.");
	}
	const effects = record.effects;
	const expected = [...EFFECTS].sort();
	if (
		effects.some((effect) => typeof effect !== "string") ||
		new Set(effects).size !== effects.length ||
		[...effects].sort().some((effect, index) => effect !== expected[index]) ||
		effects.length !== expected.length
	) {
		fail("Apps Settings mutation changed an unapproved grant boundary.");
	}
	return {
		operationId: ref(record, "operationId", label),
		idempotencyKey: ref(record, "idempotencyKey", label),
		operation: OPERATIONS[tier],
		retrySafe: true,
		mutationPossible: false,
		nextAction: "REFRESH_APPS_SETTINGS",
		policyRevision: positive(record, "policyRevision", label),
		readbackAt: positive(record, "readbackAt", label),
		effects: effects as string[],
	};
}

export function parseAppsSettingsMutation(
	value: unknown,
	before: AppsSettingsSnapshot,
	decisions: Readonly<Record<string, AppsDecision>>,
): AppsSettingsMutation {
	const record = object(value, "appsSettingsMutation");
	exact(
		record,
		["state", "surface", "tier", "operation", "readback"],
		"appsSettingsMutation",
	);
	const tier = parseTier(record.tier);
	if (
		record.state !== "UPDATED" ||
		record.surface !== "SETTINGS" ||
		tier !== before.tier
	) {
		fail("Apps Settings mutation changed scope or is unverified.");
	}
	const operation = parseOperation(record.operation, tier);
	const readback = parseAppsSettingsSnapshot(record.readback);
	const requested = buildAppsSettingsPayload(before, decisions).decisions;
	if (
		readback.householdId !== before.householdId ||
		readback.tier !== before.tier ||
		readback.catalogDigest !== before.catalogDigest ||
		readback.decisionRevision !== before.decisionRevision + 1 ||
		JSON.stringify(
			readback.cards.map((card: AppsReviewCard) => ({
				serviceId: card.serviceId,
				decision: card.decision,
			})),
		) !== JSON.stringify(requested)
	) {
		fail("Apps Settings mutation lacks exact catalog decision readback.");
	}
	return {
		state: "UPDATED",
		surface: "SETTINGS",
		tier,
		operation,
		readback,
	};
}

function apiBase(): URL {
	const configured = import.meta.env.VITE_PA_BFF_ORIGIN?.trim();
	const base = new URL(configured || window.location.origin);
	if (import.meta.env.PROD && base.protocol !== "https:") {
		fail("The production Personal-Agent BFF origin must use HTTPS.");
	}
	return base;
}
function endpoint(tier: AppsTier, householdId: string): URL {
	if (!REF.test(householdId)) fail("The Household identifier is invalid.");
	const url = new URL(PATHS[tier], apiBase());
	url.searchParams.set("household", householdId);
	return url;
}
async function requestJson<T>(
	url: URL,
	parser: (value: unknown) => T,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(url, {
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
				? "These app decisions changed. Refresh before saving."
				: response.status === 401
					? "Your MiCasa session has expired."
					: response.status === 403
						? "You are not allowed to edit these Apps & Data decisions."
						: "Personal-Agent could not verify Apps & Data Settings.",
		);
	}
	return parser(body);
}
export function loadAppsSettings(
	tier: AppsTier,
	householdId: string,
): Promise<AppsSettingsSnapshot> {
	return requestJson(endpoint(tier, householdId), parseAppsSettingsSnapshot);
}
export function saveAppsSettings(
	snapshot: AppsSettingsSnapshot,
	decisions: Readonly<Record<string, AppsDecision>>,
): Promise<AppsSettingsMutation> {
	return requestJson(
		endpoint(snapshot.tier, snapshot.householdId),
		(value) => parseAppsSettingsMutation(value, snapshot, decisions),
		{
			method: "PUT",
			headers: {
				"Content-Type": "application/json",
				"X-CSRF-Token": snapshot.csrfToken,
			},
			body: JSON.stringify(buildAppsSettingsPayload(snapshot, decisions)),
		},
	);
}

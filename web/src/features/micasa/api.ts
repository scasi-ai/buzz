import {
	MiCasaContractError,
	type GroupHouseholdAgentMutation,
	type GroupHouseholdAgentSettings,
	type HouseholdInvitation,
	type MiCasaBootstrap,
	parseGroupHouseholdAgentMutation,
	parseGroupHouseholdAgentSettings,
	parseHouseholdInvitation,
	parseInvitationAcceptance,
	parseMiCasaBootstrap,
} from "@/features/micasa/contracts";
import {
	buildGroupHouseholdAgentMutationRequest,
	groupHouseholdAgentPath,
} from "@/features/micasa/group-household-agent";

const REQUEST_TIMEOUT_MS = 15_000;
const API_PREFIX = "/api/micasa/v1";

export class MiCasaApiError extends Error {
	readonly status: number;
	readonly requestId?: string;

	constructor(message: string, status: number, requestId?: string) {
		super(message);
		this.name = "MiCasaApiError";
		this.status = status;
		this.requestId = requestId;
	}
}

function apiBase(): URL {
	const configured = import.meta.env.VITE_PA_BFF_ORIGIN?.trim();
	const base = new URL(configured || window.location.origin);
	if (import.meta.env.PROD && base.protocol !== "https:") {
		throw new MiCasaContractError(
			"The production Personal-Agent BFF origin must use HTTPS.",
		);
	}
	return base;
}

function endpoint(apiPath: string): URL {
	if (!apiPath.startsWith(API_PREFIX + "/")) {
		throw new MiCasaContractError("Refusing a non-MiCasa API path.");
	}
	return new URL(apiPath, apiBase());
}

function requestIdFrom(value: unknown): string | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const requestId = (value as Record<string, unknown>).request_id;
	return typeof requestId === "string" && requestId.length > 0
		? requestId
		: undefined;
}

async function requestJson<T>(
	url: URL,
	parse: (value: unknown) => T,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(url, {
		...init,
		credentials: "include",
		cache: "no-store",
		headers: {
			Accept: "application/json",
			...init?.headers,
		},
		signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	const body = await response.json().catch(() => null);
	if (!response.ok) {
		throw new MiCasaApiError(
			response.status === 401
				? "Your MiCasa session has expired."
				: "Personal-Agent is temporarily unavailable.",
			response.status,
			requestIdFrom(body),
		);
	}
	return parse(body);
}

function selectedIdentifier(name: "household" | "room"): string | null {
	const value = new URL(window.location.href).searchParams.get(name);
	return value && /^[A-Za-z0-9._:-]{1,256}$/.test(value) ? value : null;
}

export function loadMiCasaBootstrap(): Promise<MiCasaBootstrap> {
	const url = endpoint(API_PREFIX + "/bootstrap");
	const householdId = selectedIdentifier("household");
	const roomId = selectedIdentifier("room");
	if (householdId) url.searchParams.set("household", householdId);
	if (roomId) url.searchParams.set("room", roomId);
	return requestJson(url, parseMiCasaBootstrap);
}

export function loadHouseholdInvitation(
	code: string,
): Promise<HouseholdInvitation> {
	const url = endpoint(API_PREFIX + "/invitations/" + encodeURIComponent(code));
	return requestJson(url, parseHouseholdInvitation);
}

export async function acceptHouseholdInvitation(
	code: string,
	csrfToken: string,
): Promise<{ destinationPath: string }> {
	const url = endpoint(
		API_PREFIX + "/invitations/" + encodeURIComponent(code) + "/accept",
	);
	return requestJson(url, parseInvitationAcceptance, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-CSRF-Token": csrfToken,
		},
		body: JSON.stringify({ code }),
	});
}

export function loadGroupHouseholdAgent(
	householdId: string,
	roomId: string,
): Promise<GroupHouseholdAgentSettings> {
	return requestJson(
		endpoint(groupHouseholdAgentPath(householdId, roomId)),
		parseGroupHouseholdAgentSettings,
	);
}

function groupAgentIdempotencyKey(): string {
	if (typeof crypto.randomUUID !== "function") {
		throw new MiCasaContractError(
			"This browser cannot create a secure operation identifier.",
		);
	}
	return "group-agent:" + crypto.randomUUID();
}

export async function setGroupHouseholdAgent(
	settings: GroupHouseholdAgentSettings,
	desiredIncluded: boolean,
): Promise<GroupHouseholdAgentMutation> {
	const request = buildGroupHouseholdAgentMutationRequest(
		settings,
		desiredIncluded,
		groupAgentIdempotencyKey(),
	);
	const result = await requestJson(
		endpoint(request.path),
		parseGroupHouseholdAgentMutation,
		{
			method: request.method,
			headers: request.headers,
			body: request.body,
		},
	);
	if (
		result.readback.householdId !== settings.householdId ||
		result.readback.roomId !== settings.roomId ||
		result.readback.householdAgent.id !== settings.householdAgent.id ||
		result.readback.membershipRevision !== settings.membershipRevision + 1 ||
		result.readback.policyRevision !== settings.policyRevision ||
		result.readback.included !== desiredIncluded
	) {
		throw new MiCasaContractError(
			"Group Household Agent mutation readback is inconsistent.",
		);
	}
	return result;
}

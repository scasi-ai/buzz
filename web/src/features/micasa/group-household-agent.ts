import {
  MiCasaContractError,
  type GroupHouseholdAgentSettings,
} from "./contracts.ts";

const PUBLIC_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{15,191}$/;
const API_PREFIX = "/api/micasa/v1";

export type GroupHouseholdAgentMutationRequest = {
  method: "PUT" | "DELETE";
  path: string;
  headers: {
    "Content-Type": "application/json";
    "X-CSRF-Token": string;
  };
  body: string;
};

export function groupHouseholdAgentPath(
  householdId: string,
  roomId: string,
): string {
  if (!PUBLIC_IDENTIFIER.test(householdId) || !PUBLIC_IDENTIFIER.test(roomId)) {
    throw new MiCasaContractError(
      "Group Household Agent authority has invalid identifiers.",
    );
  }
  return (
    API_PREFIX +
    "/households/" +
    householdId +
    "/rooms/" +
    roomId +
    "/household-agent"
  );
}

function canonicalJson(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

export function buildGroupHouseholdAgentMutationRequest(
  settings: GroupHouseholdAgentSettings,
  desiredIncluded: boolean,
  idempotencyKey: string,
): GroupHouseholdAgentMutationRequest {
  if (
    settings.state !== "READY" ||
    !settings.canManage ||
    desiredIncluded === settings.included
  ) {
    throw new MiCasaContractError(
      "Group Household Agent mutation is not authorized from this state.",
    );
  }
  if (!IDEMPOTENCY_KEY.test(idempotencyKey)) {
    throw new MiCasaContractError(
      "Group Household Agent operation identifier is invalid.",
    );
  }
  const common = {
    expectedAuthorityDigest: settings.authorityDigest,
    expectedMembershipRevision: settings.membershipRevision,
    expectedPolicyRevision: settings.policyRevision,
  };
  const body = desiredIncluded
    ? canonicalJson({
        ...common,
        idempotencyKey,
        policyAcknowledged: true,
      })
    : canonicalJson({
        ...common,
        historyBoundaryAcknowledged: true,
        idempotencyKey,
      });
  return {
    method: desiredIncluded ? "PUT" : "DELETE",
    path: groupHouseholdAgentPath(settings.householdId, settings.roomId),
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": settings.csrfToken,
    },
    body,
  };
}

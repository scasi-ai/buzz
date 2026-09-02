import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AppsDecision } from "@/features/micasa/apps-onboarding";
import type {
  AppsSettingsCard,
  AppsSettingsSnapshot,
} from "@/features/micasa/apps-settings";
import {
  clearConnectorOAuthResume,
  connectorOAuthReturnPath,
  discoverConnectorOAuthResources,
  loadConnectorOAuthResume,
  readConnectorOAuthStatus,
  saveConnectorOAuthResume,
  selectConnectorOAuthResources,
  startConnectorOAuth,
  type ConnectorOAuthContext,
  type ConnectorOAuthResources,
  type ConnectorOAuthResume,
} from "@/features/micasa/connector-oauth";
import { Button } from "@/shared/ui/button";

const accessRoleLabels: Record<
  ConnectorOAuthResources["resources"][number]["accessRole"],
  string
> = {
  freeBusyReader: "Availability only",
  reader: "Read",
  writer: "Read and write",
  writerWithoutPrivateAccess: "Write without private event details",
  owner: "Owner",
};

function explanation(state: string): string {
  if (state === "AUTHORIZING") {
    return "Google authorization has started, but Personal-Agent has not received a verified callback.";
  }
  if (state === "CALLBACK_PENDING") {
    return "Google returned control. Personal-Agent is exchanging and staging the credential before any calendar can be selected.";
  }
  if (state === "FINALIZING") {
    return "The credential is staged. Choose the exact calendars this scope may use; MiCasa still does not call the connector Connected.";
  }
  if (state === "DENIED") {
    return "Google authorization was declined. No provider connection was assumed.";
  }
  if (state === "EXPIRED") {
    return "This authorization attempt expired. No provider connection was assumed.";
  }
  return "Personal-Agent cannot prove whether the provider changed. MiCasa will not retry or call this connection ready automatically.";
}

export function GoogleCalendarOAuthPanel({
  snapshot,
  card,
  setDecision,
}: {
  snapshot: AppsSettingsSnapshot;
  card: AppsSettingsCard;
  setDecision: (decision: AppsDecision) => void;
}) {
  const queryClient = useQueryClient();
  const context = useMemo<ConnectorOAuthContext | null>(() => {
    if (card.serviceId !== "google-calendar") return null;
    try {
      return {
        householdRef: snapshot.householdId,
        tier: snapshot.tier,
        serviceId: card.serviceId,
        returnPath: connectorOAuthReturnPath(
          snapshot.tier,
          snapshot.householdId,
        ),
      };
    } catch {
      return null;
    }
  }, [card.serviceId, snapshot.householdId, snapshot.tier]);
  const [resume, setResume] = useState<ConnectorOAuthResume | null>(() =>
    context === null
      ? null
      : loadConnectorOAuthResume(window.localStorage, context),
  );
  const [resources, setResources] = useState<ConnectorOAuthResources | null>(
    null,
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [selectionSaved, setSelectionSaved] = useState(false);

  useEffect(() => {
    setResume(
      context === null
        ? null
        : loadConnectorOAuthResume(window.localStorage, context),
    );
    setResources(null);
    setSelected([]);
    setSelectionSaved(false);
  }, [context]);

  const status = useQuery({
    queryKey: ["micasa", "connector-oauth", resume?.oauthRef],
    queryFn: () => readConnectorOAuthStatus(resume as ConnectorOAuthResume),
    enabled: resume !== null,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.state === "CALLBACK_PENDING" ? 3_000 : false,
  });
  const start = useMutation({
    mutationFn: () => {
      if (context === null) {
        throw new Error(
          "This Household does not expose a connector authority reference.",
        );
      }
      return startConnectorOAuth(context, snapshot.csrfToken);
    },
    onSuccess: (result) => {
      setDecision("CONNECT_NOW");
      setResume(saveConnectorOAuthResume(window.localStorage, result));
      window.location.assign(result.authorizationUrl);
    },
  });
  const discover = useMutation({
    mutationFn: () =>
      discoverConnectorOAuthResources(
        resume as ConnectorOAuthResume,
        snapshot.csrfToken,
      ),
    onSuccess: (result) => {
      setResources(result);
      setSelected(result.selectedResourceRefs);
      setSelectionSaved(false);
    },
  });
  const save = useMutation({
    mutationFn: () =>
      selectConnectorOAuthResources(
        resume as ConnectorOAuthResume,
        snapshot.csrfToken,
        resources as ConnectorOAuthResources,
        selected,
      ),
    onSuccess: (result) => {
      setResources(result);
      setSelected(result.selectedResourceRefs);
      setSelectionSaved(true);
    },
  });

  useEffect(() => {
    if (status.data) {
      setResume(saveConnectorOAuthResume(window.localStorage, status.data));
      if (status.data.state === "CONNECTED") {
        void queryClient.invalidateQueries({
          queryKey: [
            "micasa",
            "apps-settings",
            snapshot.tier,
            snapshot.householdId,
          ],
        });
      }
    }
  }, [queryClient, snapshot.householdId, snapshot.tier, status.data]);

  if (context === null) return null;

  const currentState = status.data?.state ?? null;
  const terminal =
    currentState === "DENIED" ||
    currentState === "EXPIRED" ||
    currentState === "OUTCOME_UNKNOWN";
  const connectorReady =
    currentState === "CONNECTED" &&
    card.authorizationStatus === "CONNECTED" &&
    card.resourceStatus === "SELECTED" &&
    card.syncStatus === "READY" &&
    card.operationStatus === "ADMITTED";
  function restart() {
    clearConnectorOAuthResume(
      window.localStorage,
      context as ConnectorOAuthContext,
    );
    setResume(null);
    setResources(null);
    setSelected([]);
    setSelectionSaved(false);
  }
  function toggle(resourceRef: string) {
    setSelectionSaved(false);
    setSelected((current) =>
      current.includes(resourceRef)
        ? current.filter((item) => item !== resourceRef)
        : [...current, resourceRef].sort(),
    );
  }

  return (
    <section
      aria-label="Google Calendar authorization"
      className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4"
    >
      <div className="flex items-start gap-3">
        <CalendarDays
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0 text-sky-800"
        />
        <div className="min-w-0 flex-1">
          <h4 className="font-semibold text-sky-950">
            Verified Google Calendar setup
          </h4>
          <p className="mt-1 text-xs leading-5 text-sky-900">
            Google authorization is separate from this preference. Your private
            choice stays private; a Household choice is controlled by the Head
            of Household.
          </p>

          {resume === null && (
            <div className="mt-3">
              <Button
                className="bg-slate-950 text-white hover:bg-slate-800"
                disabled={!card.connectEnabled || start.isPending}
                onClick={() => start.mutate()}
                size="sm"
                type="button"
              >
                {start.isPending ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="mr-2 h-4 w-4 animate-spin"
                  />
                ) : (
                  <ExternalLink aria-hidden="true" className="mr-2 h-4 w-4" />
                )}
                Continue to Google
              </Button>
              {!card.connectEnabled && (
                <p className="mt-2 text-xs text-sky-800">
                  Personal-Agent has not admitted this connector for setup yet.
                </p>
              )}
              {start.isError && (
                <p className="mt-2 text-xs text-rose-700" role="alert">
                  {start.error.message}
                </p>
              )}
            </div>
          )}

          {resume !== null && status.isPending && (
            <p
              className="mt-3 flex items-center text-xs text-sky-900"
              role="status"
            >
              <LoaderCircle
                aria-hidden="true"
                className="mr-2 h-4 w-4 animate-spin"
              />
              Checking the durable authorization state…
            </p>
          )}
          {resume !== null && status.isError && (
            <div
              className="mt-3 rounded-xl bg-white p-3 text-xs text-rose-700"
              role="alert"
            >
              Personal-Agent could not verify this authorization attempt.
              <Button
                className="ml-2"
                onClick={() => void status.refetch()}
                size="sm"
                type="button"
                variant="outline"
              >
                Retry
              </Button>
            </div>
          )}
          {resume !== null && status.data && (
            <div className="mt-3 rounded-xl bg-white p-3">
              <p className="text-xs font-semibold text-slate-900">
                {connectorReady
                  ? "Connected and verified"
                  : status.data.state === "CONNECTED"
                    ? "Authorization verified — confirming readiness"
                    : status.data.state === "FINALIZING"
                      ? "Finalizing — not connected yet"
                      : status.data.state.replaceAll("_", " ")}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                {status.data.state === "CONNECTED" && !connectorReady
                  ? "The OAuth ceremony completed. MiCasa is refreshing current resource, sync, and tool authority before it reports Connected."
                  : status.data.state === "CONNECTED"
                    ? "Personal-Agent verified the grant, credential custody, resource boundary, tool admission, and initial sync."
                    : explanation(status.data.state)}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {!terminal && status.data.state !== "CONNECTED" && (
                  <Button
                    onClick={() => void status.refetch()}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <RefreshCw
                      aria-hidden="true"
                      className="mr-2 h-3.5 w-3.5"
                    />
                    Check status
                  </Button>
                )}
                {terminal && (
                  <Button
                    onClick={restart}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Start a new attempt
                  </Button>
                )}
              </div>
            </div>
          )}

          {currentState === "FINALIZING" && resources === null && (
            <Button
              className="mt-3 bg-slate-950 text-white hover:bg-slate-800"
              disabled={discover.isPending}
              onClick={() => discover.mutate()}
              size="sm"
              type="button"
            >
              {discover.isPending && (
                <LoaderCircle
                  aria-hidden="true"
                  className="mr-2 h-4 w-4 animate-spin"
                />
              )}
              Find my calendars
            </Button>
          )}
          {discover.isError && (
            <p
              className="mt-3 flex items-start text-xs text-rose-700"
              role="alert"
            >
              <ShieldAlert
                aria-hidden="true"
                className="mr-2 h-4 w-4 shrink-0"
              />
              {discover.error.message}
            </p>
          )}

          {resources && (
            <fieldset className="mt-4">
              <legend className="text-sm font-semibold text-slate-950">
                Choose exact calendars
              </legend>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                Nothing is selected automatically. Names come from the verified
                provider readback; MiCasa sends only opaque resource references.
              </p>
              <div className="mt-3 space-y-2">
                {resources.resources.map((resource) => (
                  <label
                    className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-white p-3"
                    key={resource.resourceRef}
                  >
                    <input
                      checked={selected.includes(resource.resourceRef)}
                      className="mt-0.5 h-4 w-4"
                      onChange={() => toggle(resource.resourceRef)}
                      type="checkbox"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-slate-900">
                        {resource.displayName}
                        {resource.primary ? " · Primary" : ""}
                        {resource.providerHidden ? " · Hidden in Google" : ""}
                      </span>
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {accessRoleLabels[resource.accessRole]}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {save.isError && (
                <p className="mt-3 text-xs text-rose-700" role="alert">
                  {save.error.message}
                </p>
              )}
              {selectionSaved && (
                <p
                  className="mt-3 flex items-start rounded-xl bg-emerald-50 p-3 text-xs leading-5 text-emerald-900"
                  role="status"
                >
                  <CheckCircle2
                    aria-hidden="true"
                    className="mr-2 h-4 w-4 shrink-0"
                  />
                  Calendar choices saved. Personal-Agent must still verify the
                  grant, credential promotion, tool admission, and initial sync
                  before MiCasa can report Connected.
                </p>
              )}
              <Button
                className="mt-3 bg-slate-950 text-white hover:bg-slate-800"
                disabled={selected.length === 0 || save.isPending}
                onClick={() => save.mutate()}
                size="sm"
                type="button"
              >
                {save.isPending && (
                  <LoaderCircle
                    aria-hidden="true"
                    className="mr-2 h-4 w-4 animate-spin"
                  />
                )}
                Save selected calendars
              </Button>
            </fieldset>
          )}
        </div>
      </div>
    </section>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import {
  loadGroupHouseholdAgent,
  setGroupHouseholdAgent,
} from "@/features/micasa/api";
import type { RoomSummary } from "@/features/micasa/contracts";
import { Button } from "@/shared/ui/button";

export function MiCasaGroupHouseholdAgentControl({
  householdId,
  room,
}: {
  householdId: string;
  room: RoomSummary;
}) {
  const queryClient = useQueryClient();
  const queryKey = [
    "micasa",
    "group-household-agent",
    householdId,
    room.id,
  ] as const;
  const settings = useQuery({
    queryKey,
    queryFn: () => loadGroupHouseholdAgent(householdId, room.id),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (desiredIncluded: boolean) => {
      if (!settings.data) {
        throw new Error("Group Household Agent authority is not loaded.");
      }
      return setGroupHouseholdAgent(settings.data, desiredIncluded);
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(queryKey, result.readback);
      await queryClient.invalidateQueries({
        queryKey: ["micasa", "bootstrap"],
      });
    },
  });

  if (settings.isPending) {
    return (
      <section
        aria-label="Household Agent group access"
        className="mt-4 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600"
      >
        <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />
        Checking Household Agent access…
      </section>
    );
  }

  if (settings.isError) {
    return (
      <section
        aria-label="Household Agent group access"
        className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4"
      >
        <p className="text-sm font-medium text-amber-950">
          Household Agent access could not be verified.
        </p>
        <p className="mt-1 text-sm leading-6 text-amber-800">
          No change was made. Refresh the current Personal-Agent authority
          before trying again.
        </p>
        <Button
          className="mt-3 gap-2"
          onClick={() => void settings.refetch()}
          type="button"
          variant="outline"
        >
          <RefreshCw aria-hidden="true" className="h-4 w-4" />
          Refresh access
        </Button>
      </section>
    );
  }

  const authority = settings.data;
  const included = authority.included;
  const agentName = authority.householdAgent.displayName;

  return (
    <section
      aria-label="Household Agent group access"
      className="mt-4 rounded-2xl border border-slate-200 bg-white p-4"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-10 w-10 shrink-0 overflow-hidden rounded-xl bg-slate-100 text-slate-700">
            {authority.householdAgent.avatarPath ? (
              <img
                alt={`${agentName} avatar`}
                className="h-full w-full object-cover"
                src={authority.householdAgent.avatarPath}
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center">
                <Bot aria-hidden="true" className="h-5 w-5" />
              </span>
            )}
          </span>
          <div>
            <p className="font-medium text-slate-950">
              {included
                ? `${agentName} is in this group`
                : `Add ${agentName} to this group`}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {included
                ? "The Household Agent can use Household-shared apps and context here. Removing it stops future access; messages already shared remain in group history."
                : "The Household Agent will receive future group messages and may use Household-shared apps. It never receives a member’s private mail, files, photos, calendar, or other private app grants."}
            </p>
          </div>
        </div>
        {authority.canManage ? (
          <Button
            className="shrink-0 gap-2"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate(!included)}
            type="button"
            variant={included ? "outline" : "default"}
          >
            {mutation.isPending ? (
              <LoaderCircle
                aria-hidden="true"
                className="h-4 w-4 animate-spin"
              />
            ) : (
              <ShieldCheck aria-hidden="true" className="h-4 w-4" />
            )}
            {mutation.isPending
              ? "Verifying…"
              : included
                ? "Remove from group"
                : "Add to group"}
          </Button>
        ) : (
          <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600">
            Group owner or admin manages this
          </span>
        )}
      </div>
      {mutation.isError && (
        <div
          aria-live="polite"
          className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800"
          role="status"
        >
          Personal-Agent could not verify the change. Refresh access before
          retrying; MiCasa will not assume the Household Agent was added or
          removed.
        </div>
      )}
    </section>
  );
}

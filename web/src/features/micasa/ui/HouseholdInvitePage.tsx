import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  House,
  LoaderCircle,
  LogIn,
  RefreshCw,
  ShieldCheck,
  UserRoundPlus,
} from "lucide-react";
import {
  acceptHouseholdInvitation,
  loadHouseholdInvitation,
} from "@/features/micasa/api";
import { Button } from "@/shared/ui/button";

function invitationStatusMessage(state: "EXPIRED" | "REVOKED"): string {
  return state === "EXPIRED"
    ? "This invitation has expired. Ask the Head of Household for a new invitation."
    : "This invitation has been revoked. Ask the Head of Household if you still need access.";
}

export function HouseholdInvitePage({ code }: { code: string }) {
  const invitation = useQuery({
    queryKey: ["micasa", "invitation", code],
    queryFn: () => loadHouseholdInvitation(code),
    retry: false,
  });
  const acceptance = useMutation({
    mutationFn: async () => {
      if (
        invitation.data?.state !== "CLAIMABLE" ||
        !invitation.data.csrfToken
      ) {
        throw new Error("This invitation is not claimable.");
      }
      return acceptHouseholdInvitation(code, invitation.data.csrfToken);
    },
    onSuccess: ({ destinationPath }) => {
      window.location.assign(destinationPath);
    },
  });

  if (invitation.isPending) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-50">
        <div className="text-center">
          <LoaderCircle
            aria-hidden="true"
            className="mx-auto h-7 w-7 animate-spin text-slate-600"
          />
          <p className="mt-3 text-sm text-slate-600">
            Checking your Household invitation…
          </p>
        </div>
      </main>
    );
  }

  if (invitation.isError) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-8 text-center">
          <House
            aria-hidden="true"
            className="mx-auto h-9 w-9 text-slate-800"
          />
          <h1 className="mt-5 text-2xl font-semibold text-slate-950">
            This invitation cannot be verified
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            MiCasa could not verify it with Personal-Agent. No Buzz-only access
            has been granted.
          </p>
          <Button
            className="mt-6 gap-2 bg-slate-950 text-white hover:bg-slate-800"
            onClick={() => void invitation.refetch()}
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Try again
          </Button>
        </div>
      </main>
    );
  }

  const data = invitation.data;
  const expires = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(data.expiresAt));

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-950 text-white">
          <House aria-hidden="true" className="h-6 w-6" />
        </div>
        <p className="mt-6 text-sm font-medium text-slate-500">
          {data.inviterName} invited you to
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
          {data.householdName}
        </h1>

        <dl className="mt-7 grid gap-4 rounded-2xl bg-slate-50 p-5 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-slate-500">Household role</dt>
            <dd className="font-medium text-slate-900">{data.role}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-slate-500">Invitation expires</dt>
            <dd className="text-right font-medium text-slate-900">{expires}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-slate-500">Personal Agent</dt>
            <dd className="flex items-center gap-2 font-medium text-slate-900">
              <UserRoundPlus aria-hidden="true" className="h-4 w-4" />
              Created during setup
            </dd>
          </div>
        </dl>

        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-slate-200 p-4">
          <ShieldCheck
            aria-hidden="true"
            className="mt-0.5 h-5 w-5 text-slate-600"
          />
          <p className="text-sm leading-6 text-slate-600">
            Accepting reserves your Household membership and Personal Agent,
            then takes you through profile, Agent, privacy, and app setup. Buzz
            access stays off until Personal-Agent verifies every required step.
          </p>
        </div>

        {data.state === "UNAUTHENTICATED" && data.signInPath ? (
          <Button
            asChild
            className="mt-7 h-11 w-full gap-2 rounded-xl bg-slate-950 text-white hover:bg-slate-800"
          >
            <a href={data.signInPath}>
              <LogIn aria-hidden="true" className="h-4 w-4" />
              Sign in to review invitation
            </a>
          </Button>
        ) : null}

        {data.state === "CLAIMABLE" ? (
          <>
            <Button
              className="mt-7 h-11 w-full rounded-xl bg-slate-950 text-white hover:bg-slate-800"
              disabled={acceptance.isPending}
              onClick={() => acceptance.mutate()}
            >
              {acceptance.isPending
                ? "Saving your acceptance…"
                : "Accept invitation and set up My Agent"}
            </Button>
            {acceptance.isError ? (
              <p className="mt-3 text-sm text-red-700" role="alert">
                MiCasa could not confirm the claim outcome. Refresh this
                invitation so Personal-Agent can reconcile it before trying
                anything again.
              </p>
            ) : null}
          </>
        ) : null}

        {data.state === "ALREADY_MEMBER" ? (
          <div className="mt-7 flex items-center gap-3 rounded-2xl bg-emerald-50 p-4 text-emerald-800">
            <CheckCircle2 aria-hidden="true" className="h-5 w-5" />
            <p className="text-sm font-medium">
              You already belong to this Household.
            </p>
          </div>
        ) : null}

        {data.state === "EXPIRED" || data.state === "REVOKED" ? (
          <p className="mt-7 rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-800">
            {invitationStatusMessage(data.state)}
          </p>
        ) : null}
      </div>
    </main>
  );
}

import { Boxes, ShieldCheck } from "lucide-react";
import type { AppsTier } from "@/features/micasa/apps-onboarding";
import { Button } from "@/shared/ui/button";

export function GoogleWorkspacePlanner({
  active,
  onToggle,
  serviceCount,
  tier,
}: {
  active: boolean;
  onToggle: () => void;
  serviceCount: number;
  tier: AppsTier;
}) {
  return (
    <section
      aria-label="Google Workspace service chooser"
      className="mt-6 rounded-2xl border border-blue-200 bg-blue-50 p-4 sm:p-5"
    >
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-blue-700 shadow-sm">
            <Boxes aria-hidden="true" className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-semibold text-slate-950">
              Connect Google Workspace
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-700">
              Review {serviceCount} Google services for the{" "}
              {tier === "HOUSEHOLD" ? "Household" : "current user"}. Each
              product keeps its own consent, resources, tools, and revoke
              control. Google sign-in alone grants no app data.
            </p>
          </div>
        </div>
        <Button
          aria-pressed={active}
          className="shrink-0 border border-blue-300 bg-white text-blue-900 hover:bg-blue-100"
          onClick={onToggle}
          type="button"
        >
          <ShieldCheck aria-hidden="true" className="mr-2 h-4 w-4" />
          {active ? "Show all apps" : "Review Google services"}
        </Button>
      </div>
    </section>
  );
}

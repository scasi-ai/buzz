import { createFileRoute } from "@tanstack/react-router";
import { HouseholdInvitePage } from "@/features/micasa/ui/HouseholdInvitePage";

export const Route = createFileRoute("/invite/$code")({
  component: HouseholdInvitePageRoute,
});

function HouseholdInvitePageRoute() {
  const { code } = Route.useParams();
  return <HouseholdInvitePage code={code} />;
}

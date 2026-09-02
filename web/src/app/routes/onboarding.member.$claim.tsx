import { createFileRoute } from "@tanstack/react-router";
import { MemberOnboardingPage } from "@/features/micasa/ui/MemberOnboardingPage";

export const Route = createFileRoute("/onboarding/member/$claim")({
  component: MemberOnboardingRoute,
});

function MemberOnboardingRoute() {
  const { claim } = Route.useParams();
  return <MemberOnboardingPage claimId={claim} />;
}

import { createFileRoute } from "@tanstack/react-router";
import { FounderOnboardingPage } from "@/features/micasa/ui/FounderOnboardingPage";

export const Route = createFileRoute("/onboarding")({
  component: FounderOnboardingPage,
});

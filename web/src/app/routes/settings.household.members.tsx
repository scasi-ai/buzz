import { createFileRoute } from "@tanstack/react-router";
import { HouseholdMembersPage } from "@/features/micasa/ui/HouseholdMembersPage";

export const Route = createFileRoute("/settings/household/members")({
  component: HouseholdMembersPage,
});

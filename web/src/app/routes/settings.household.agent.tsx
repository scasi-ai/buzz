import { createFileRoute } from "@tanstack/react-router";
import { AgentProfileSettingsPage } from "@/features/micasa/ui/AgentProfileSettingsPage";

export const Route = createFileRoute("/settings/household/agent")({
	component: HouseholdAgentSettingsRoute,
});

function HouseholdAgentSettingsRoute() {
	return <AgentProfileSettingsPage scope="HOUSEHOLD" />;
}

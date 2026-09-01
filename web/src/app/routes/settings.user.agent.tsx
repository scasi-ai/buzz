import { createFileRoute } from "@tanstack/react-router";
import { AgentProfileSettingsPage } from "@/features/micasa/ui/AgentProfileSettingsPage";

export const Route = createFileRoute("/settings/user/agent")({
	component: UserAgentSettingsRoute,
});

function UserAgentSettingsRoute() {
	return <AgentProfileSettingsPage scope="PRIVATE" />;
}

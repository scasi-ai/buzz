import { createFileRoute } from "@tanstack/react-router";
import { AppsSettingsPage } from "@/features/micasa/ui/AppsSettingsPage";

export const Route = createFileRoute("/settings/household/apps")({
	component: HouseholdAppsSettingsRoute,
});

function HouseholdAppsSettingsRoute() {
	return <AppsSettingsPage tier="HOUSEHOLD" />;
}

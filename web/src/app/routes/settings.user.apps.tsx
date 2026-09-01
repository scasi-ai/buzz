import { createFileRoute } from "@tanstack/react-router";
import { AppsSettingsPage } from "@/features/micasa/ui/AppsSettingsPage";

export const Route = createFileRoute("/settings/user/apps")({
  component: UserAppsSettingsRoute,
});

function UserAppsSettingsRoute() {
  return <AppsSettingsPage tier="PRIVATE" />;
}

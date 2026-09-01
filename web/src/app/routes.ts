import { index, rootRoute, route } from "@tanstack/virtual-file-routes";

export const routes = rootRoute("root.tsx", [
	index("index.tsx"),
	route("/onboarding", "onboarding.tsx"),
	route("/settings/household/agent", "settings.household.agent.tsx"),
	route("/settings/household/members", "settings.household.members.tsx"),
	route("/settings/user/agent", "settings.user.agent.tsx"),
	route("/invite/$code", "invite.$code.tsx"),
]);

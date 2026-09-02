import { index, rootRoute, route } from "@tanstack/virtual-file-routes";

export const routes = rootRoute("root.tsx", [
  index("index.tsx"),
  route("/onboarding", "onboarding.tsx"),
  route("/onboarding/member/$claim", "onboarding.member.$claim.tsx"),
  route("/settings/household/agent", "settings.household.agent.tsx"),
  route("/settings/household/apps", "settings.household.apps.tsx"),
  route("/settings/household/members", "settings.household.members.tsx"),
  route("/settings/user/agent", "settings.user.agent.tsx"),
  route("/settings/user/apps", "settings.user.apps.tsx"),
  route("/invite/$code", "invite.$code.tsx"),
]);

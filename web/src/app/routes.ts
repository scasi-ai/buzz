import { index, route, rootRoute } from "@tanstack/virtual-file-routes";

export const routes = rootRoute("root.tsx", [
  index("index.tsx"),
  route("/onboarding", "onboarding.tsx"),
  route("/invite/$code", "invite.$code.tsx"),
]);

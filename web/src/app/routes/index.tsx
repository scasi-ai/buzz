import { createFileRoute } from "@tanstack/react-router";
import { MiCasaEntryPage } from "@/features/micasa/ui/MiCasaEntryPage";

export const Route = createFileRoute("/")({
  component: MiCasaEntryPage,
});

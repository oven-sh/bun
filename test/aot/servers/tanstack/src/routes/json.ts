import { createFileRoute } from "@tanstack/react-router";
import { catalog } from "../utils/shared";

export const Route = createFileRoute("/json")({
  server: {
    handlers: {
      GET: () => Response.json(catalog(42)),
    },
  },
});

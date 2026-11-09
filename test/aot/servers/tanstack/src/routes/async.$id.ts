import { createFileRoute } from "@tanstack/react-router";
import { summarize } from "../utils/shared";

export const Route = createFileRoute("/async/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => Response.json(await summarize(Number(params.id))),
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/text")({
  server: {
    handlers: {
      GET: () => new Response("Hello, World!", { headers: { "Content-Type": "text/plain" } }),
    },
  },
});

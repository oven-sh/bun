import { createFileRoute } from "@tanstack/react-router";
import { exportProducts } from "../utils/shared";

const encoder = new TextEncoder();

export const Route = createFileRoute("/stream")({
  server: {
    handlers: {
      GET: () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              for await (const chunk of exportProducts()) controller.enqueue(encoder.encode(chunk));
              controller.close();
            },
          }),
          { headers: { "Content-Type": "text/csv" } },
        ),
    },
  },
});

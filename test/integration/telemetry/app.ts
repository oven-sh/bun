import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { BunSDK } from "../../../packages/bun-otel";

// Initialize telemetry
const sdk = new BunSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: "integration-test-service",
  }),
  traceExporter: new OTLPTraceExporter({
    url: "http://localhost:4318/v1/traces",
  }),
  autoStart: false, // We'll use startAndRegisterSystemShutdownHooks instead
});

// Simple HTTP server
const server = Bun.serve({
  port: 0, // Use ephemeral port to avoid collisions
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    if (url.pathname === "/api/test") {
      // Simulate some work
      await Bun.sleep(Math.random() * 10);

      // Make downstream call to simulate distributed tracing
      if (url.searchParams.has("downstream")) {
        await fetch(`http://localhost:${server.port}/api/downstream`);
      }

      return Response.json({
        message: "Hello from Bun with telemetry!",
        timestamp: Date.now(),
      });
    }

    if (url.pathname === "/api/downstream") {
      await Bun.sleep(5);
      return Response.json({ downstream: "response" });
    }

    if (url.pathname === "/api/error") {
      throw new Error("Intentional test error");
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Server running at http://localhost:${server.port}`);

// Graceful shutdown using SDK's built-in signal handlers
await sdk.startAndRegisterSystemShutdownHooks(async () => {
  server.stop();
});

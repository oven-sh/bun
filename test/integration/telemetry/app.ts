import { BunSDK } from "bun-otel";

const sdk = new BunSDK({
  serviceName: "integration-test-service",
  autoStart: false,
});

console.log("✓ SDK created");

// Simple HTTP server on dynamic port to avoid conflicts
const server = Bun.serve({
  port: 0, // Use dynamic port assignment
  hostname: "0.0.0.0", // Listen on all interfaces
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

console.log(`PORT=${server.port}`);

// Start SDK and register shutdown handlers
if (process.argv.includes("--no-otel")) {
  console.log("✓ SDK start skipped via --no-sdk-start");
} else {
  try {
    await sdk.startAndRegisterSystemShutdownHooks(async () => {
      console.log("✓ Shutting down server...");
      server.stop();
    });
  } catch (e) {
    console.error("Failed to start SDK: (old bun?)", e);
  }
}
console.log("✓ SDK started and signal handlers registered");
console.log("");
console.log("=== Test with oha ===");
console.log(`  oha -n 1000 -c 10 http://localhost:${server.port}/api/test`);
console.log(`  oha -n 100 -c 10 http://localhost:${server.port}/api/test?downstream=true`);
console.log(`  oha -n 50 -c 5 http://localhost:${server.port}/api/error`);
console.log("");
console.log(`Health check: http://localhost:${server.port}/health`);

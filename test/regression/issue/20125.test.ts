import swagger from "@elysiajs/swagger";
import { expect, test } from "bun:test";
import { Elysia } from "elysia";

test("request.clone().json() should not crash on swagger endpoints - issue #20125", async () => {
  const RequestLogger = () =>
    new Elysia({ name: "request-logger" }).onRequest(async ({ request }) => {
      try {
        const body = await request.clone().json();
        console.log("Body:", body);
      } catch (e) {
        // Expected to fail for empty bodies
      }
    });

  const app = new Elysia().use(swagger()).use(RequestLogger()).listen({ port: 0 });

  const port = app.server!.port;

  try {
    // Make a request to the swagger endpoint that previously caused a crash in v1.2.15
    const response = await fetch(`http://localhost:${port}/swagger/json`);

    // The server should respond successfully (not crash)
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toBeDefined();
    expect(json.openapi).toBeDefined();

    // Verify server is still running by making another request
    const response2 = await fetch(`http://localhost:${port}/swagger`);
    expect(response2.status).toBe(200);
  } finally {
    app.stop();
  }
});

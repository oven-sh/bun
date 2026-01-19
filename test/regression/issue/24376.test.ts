import { describe, expect, it } from "bun:test";
import { expiredTls } from "harness";
import { Agent } from "undici";

// Test for issue #24376: fetch doesn't respect dispatcher option from undici
// The dispatcher option should allow setting TLS options like rejectUnauthorized
// via undici's Agent class.

describe("fetch with undici dispatcher", () => {
  it("should respect rejectUnauthorized: false from dispatcher", async () => {
    // Create a server with an expired/self-signed certificate
    using server = Bun.serve({
      port: 0,
      tls: expiredTls,
      fetch() {
        return new Response("Hello World");
      },
    });

    // Create an undici Agent with rejectUnauthorized: false
    const agent = new Agent({
      connect: {
        rejectUnauthorized: false,
      },
    });

    // This should succeed because the agent has rejectUnauthorized: false
    const response = await fetch(`https://localhost:${server.port}`, {
      dispatcher: agent,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("Hello World");
  });

  it("should fail with self-signed cert when dispatcher has rejectUnauthorized: true", async () => {
    using server = Bun.serve({
      port: 0,
      tls: expiredTls,
      fetch() {
        return new Response("Hello World");
      },
    });

    const agent = new Agent({
      connect: {
        rejectUnauthorized: true,
      },
    });

    // This should fail because the certificate is invalid and rejectUnauthorized is true
    expect(
      fetch(`https://localhost:${server.port}`, {
        dispatcher: agent,
      }),
    ).rejects.toThrow();
  });

  it("should fail with self-signed cert when no dispatcher is provided", async () => {
    using server = Bun.serve({
      port: 0,
      tls: expiredTls,
      fetch() {
        return new Response("Hello World");
      },
    });

    // This should fail because the certificate is invalid and no TLS options are provided
    expect(fetch(`https://localhost:${server.port}`)).rejects.toThrow();
  });

  it("tls option should take precedence over dispatcher", async () => {
    using server = Bun.serve({
      port: 0,
      tls: expiredTls,
      fetch() {
        return new Response("Hello World");
      },
    });

    // Agent says reject, but tls option says don't reject
    const agent = new Agent({
      connect: {
        rejectUnauthorized: true,
      },
    });

    // tls option should override dispatcher
    const response = await fetch(`https://localhost:${server.port}`, {
      dispatcher: agent,
      tls: {
        rejectUnauthorized: false,
      },
    });

    expect(response.status).toBe(200);
  });

  it("Agent stores and exposes options", () => {
    const options = {
      connect: {
        rejectUnauthorized: false,
        timeout: 5000,
      },
    };

    const agent = new Agent(options);
    expect(agent.options).toEqual(options);
  });
});

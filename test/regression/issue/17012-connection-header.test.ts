import { serve, type Server } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

// Regression test for issue #17012
// Connection header should be respected in fetch() requests
describe("Issue #17012: Connection header ignored in fetch", () => {
  let server: Server;
  let port: number;
  let receivedHeaders: Record<string, string> = {};

  beforeAll(async () => {
    server = serve({
      port: 0,
      fetch(req) {
        // Capture all headers sent by the client
        receivedHeaders = {};
        for (const [name, value] of req.headers.entries()) {
          receivedHeaders[name.toLowerCase()] = value;
        }
        
        return new Response("OK");
      },
    });
    
    port = server.port;
  });

  afterAll(() => {
    server?.stop();
  });

  it("should send Connection: close when explicitly set in Request headers", async () => {
    // Reproduce the exact scenario from the issue
    const request = new Request(`http://localhost:${port}/`, {
      headers: {
        'accept':          '-',
        'accept-encoding': '-',
        'accept-language': '-',
        'connection':      'close',                     // This should NOT be ignored
        'user-agent':      '-',
        'x-version-node':  process.versions.node,
        'x-version-bun':   process.versions.bun || '',
      }
    });

    const response = await fetch(request);

    expect(response.status).toBe(200);
    
    // The bug was that 'keep-alive' was always sent instead of 'close'
    expect(receivedHeaders.connection).toBe("close");
    expect(receivedHeaders.accept).toBe("-");
    expect(receivedHeaders["accept-encoding"]).toBe("-");
    expect(receivedHeaders["accept-language"]).toBe("-");
    expect(receivedHeaders["user-agent"]).toBe("-");
  });

  it("should send Connection: keep-alive when explicitly set", async () => {
    const request = new Request(`http://localhost:${port}/`, {
      headers: {
        'connection': 'keep-alive',
      }
    });

    const response = await fetch(request);

    expect(response.status).toBe(200);
    expect(receivedHeaders.connection).toBe("keep-alive");
  });

  it("should default to keep-alive when Connection header not provided", async () => {
    const response = await fetch(`http://localhost:${port}/`);

    expect(response.status).toBe(200);
    expect(receivedHeaders.connection).toBe("keep-alive");
  });
});
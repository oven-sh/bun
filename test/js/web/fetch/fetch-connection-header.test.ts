import { serve, type Server } from "bun";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";

describe("fetch Connection header", () => {
  let server: Server;
  let port: number;
  let receivedHeaders: Record<string, string> = {};

  beforeAll(async () => {
    server = serve({
      port: 0,
      fetch(req) {
        // Capture headers sent by the client
        receivedHeaders = {};
        for (const [name, value] of req.headers.entries()) {
          receivedHeaders[name.toLowerCase()] = value;
        }
        
        return new Response("OK", {
          headers: {
            "content-type": "text/plain",
          },
        });
      },
    });
    
    port = server.port;
  });

  afterAll(() => {
    server?.stop();
  });

  it("should respect explicit Connection: close header", async () => {
    const response = await fetch(`http://localhost:${port}/test`, {
      headers: {
        Connection: "close",
      },
    });

    expect(response.status).toBe(200);
    expect(receivedHeaders.connection).toBe("close");
  });

  it("should respect explicit Connection: keep-alive header", async () => {
    const response = await fetch(`http://localhost:${port}/test`, {
      headers: {
        Connection: "keep-alive",
      },
    });

    expect(response.status).toBe(200);
    expect(receivedHeaders.connection).toBe("keep-alive");
  });

  it("should respect case-insensitive Connection header", async () => {
    const response = await fetch(`http://localhost:${port}/test`, {
      headers: {
        connection: "close",
      },
    });

    expect(response.status).toBe(200);
    expect(receivedHeaders.connection).toBe("close");
  });

  it("should respect Connection header in Request object", async () => {
    const request = new Request(`http://localhost:${port}/test`, {
      headers: {
        Connection: "close",
      },
    });

    const response = await fetch(request);

    expect(response.status).toBe(200);
    expect(receivedHeaders.connection).toBe("close");
  });

  it("should default to keep-alive when no Connection header provided", async () => {
    const response = await fetch(`http://localhost:${port}/test`);

    expect(response.status).toBe(200);
    expect(receivedHeaders.connection).toBe("keep-alive");
  });

  it("should respect custom Connection header values", async () => {
    const response = await fetch(`http://localhost:${port}/test`, {
      headers: {
        Connection: "upgrade",
      },
    });

    expect(response.status).toBe(200);
    expect(receivedHeaders.connection).toBe("upgrade");
  });

  it("should handle multiple headers including Connection", async () => {
    const response = await fetch(`http://localhost:${port}/test`, {
      headers: {
        "accept": "-",
        "accept-encoding": "-", 
        "accept-language": "-",
        "connection": "close",
        "user-agent": "-",
        "x-test-header": "test-value",
      },
    });

    expect(response.status).toBe(200);
    expect(receivedHeaders.connection).toBe("close");
    expect(receivedHeaders.accept).toBe("-");
    expect(receivedHeaders["x-test-header"]).toBe("test-value");
  });
});
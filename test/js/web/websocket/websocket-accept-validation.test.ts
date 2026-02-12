import { describe, expect, it, mock } from "bun:test";
import crypto from "node:crypto";
import net from "node:net";

describe("WebSocket Sec-WebSocket-Accept validation (RFC 6455 Section 4.1)", () => {
  function computeAcceptKey(websocketKey: string): string {
    return crypto
      .createHash("sha1")
      .update(websocketKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
      .digest("base64");
  }

  async function createFakeServer(
    getAcceptKey: (clientKey: string) => string,
  ): Promise<{ port: number; [Symbol.asyncDispose]: () => Promise<void> }> {
    const server = net.createServer();
    let port: number;

    await new Promise<void>(resolve => {
      server.listen(0, () => {
        port = (server.address() as any).port;
        resolve();
      });
    });

    server.on("connection", socket => {
      let requestData = "";

      socket.on("data", data => {
        requestData += data.toString();

        if (requestData.includes("\r\n\r\n")) {
          const lines = requestData.split("\r\n");
          let websocketKey = "";

          for (const line of lines) {
            if (line.startsWith("Sec-WebSocket-Key:")) {
              websocketKey = line.split(":")[1].trim();
              break;
            }
          }

          const acceptKey = getAcceptKey(websocketKey);

          const response = [
            "HTTP/1.1 101 Switching Protocols",
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Accept: ${acceptKey}`,
            "\r\n",
          ].join("\r\n");

          socket.write(response);
        }
      });
    });

    return {
      port: port!,
      [Symbol.asyncDispose]: async () => {
        server.close();
      },
    };
  }

  it("should accept valid Sec-WebSocket-Accept header", async () => {
    await using server = await createFakeServer(key => computeAcceptKey(key));

    const { promise, resolve, reject } = Promise.withResolvers();
    const ws = new WebSocket(`ws://localhost:${server.port}`);

    ws.onopen = () => resolve(undefined);
    ws.onerror = () => reject(new Error("connection failed"));

    await promise;
    ws.close();
  });

  it("should reject invalid Sec-WebSocket-Accept header", async () => {
    // Server returns a completely wrong accept key
    await using server = await createFakeServer(_key => "dGhlIHNhbXBsZSBub25jZQ==");

    const { promise, resolve } = Promise.withResolvers<{ code: number; reason: string }>();
    const onopenMock = mock(() => {});

    const ws = new WebSocket(`ws://localhost:${server.port}`);
    ws.onopen = onopenMock;
    ws.onclose = event => {
      resolve({ code: event.code, reason: event.reason });
    };

    const result = await promise;
    expect(onopenMock).not.toHaveBeenCalled();
    expect(result.code).toBe(1002);
    expect(result.reason).toBe("Mismatch websocket accept header");
  });

  it("should reject empty Sec-WebSocket-Accept value", async () => {
    // Server returns an empty accept key
    await using server = await createFakeServer(_key => "");

    const { promise, resolve } = Promise.withResolvers<{ code: number; reason: string }>();
    const onopenMock = mock(() => {});

    const ws = new WebSocket(`ws://localhost:${server.port}`);
    ws.onopen = onopenMock;
    ws.onclose = event => {
      resolve({ code: event.code, reason: event.reason });
    };

    const result = await promise;
    expect(onopenMock).not.toHaveBeenCalled();
    // Empty value should be caught by either the missing header check or the accept validation
    expect(result.code).toBe(1002);
  });

  it("should reject Sec-WebSocket-Accept with wrong key computation", async () => {
    // Server computes accept from a different key (simulating MitM)
    await using server = await createFakeServer(_key => {
      // Compute valid accept but for a different (attacker-chosen) key
      return computeAcceptKey("AAAAAAAAAAAAAAAAAAAAAA==");
    });

    const { promise, resolve } = Promise.withResolvers<{ code: number; reason: string }>();
    const onopenMock = mock(() => {});

    const ws = new WebSocket(`ws://localhost:${server.port}`);
    ws.onopen = onopenMock;
    ws.onclose = event => {
      resolve({ code: event.code, reason: event.reason });
    };

    const result = await promise;
    expect(onopenMock).not.toHaveBeenCalled();
    expect(result.code).toBe(1002);
  });
});

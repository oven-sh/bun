// Test for https://github.com/oven-sh/bun/issues/25773
// Verifies that server.upgrade() preserves websocket-specific headers without duplicates

import { describe, expect, test } from "bun:test";
import { serve } from "bun";
import net from "node:net";

type UpgradeHeaders = Headers | Record<string, string>;

const headerVariants = [
  {
    label: "plain object",
    makeHeaders(webSocketHeaders: Record<string, string>, extraHeaders?: Record<string, string>): UpgradeHeaders {
      return {
        ...webSocketHeaders,
        ...extraHeaders,
      };
    },
    preservesOriginalHeaders: false,
  },
  {
    label: "Headers instance",
    makeHeaders(webSocketHeaders: Record<string, string>, extraHeaders?: Record<string, string>): UpgradeHeaders {
      return new Headers({
        ...webSocketHeaders,
        ...extraHeaders,
      });
    },
    preservesOriginalHeaders: true,
  },
] as const;

function getRequestHeaderValues(req: Request, headerName: string): string[] {
  return req.headers
    .get(headerName)
    ?.split(",")
    .map(value => value.trim())
    .filter(Boolean) || [];
}

function getClientProtocols(req: Request): string[] {
  return getRequestHeaderValues(req, "Sec-WebSocket-Protocol");
}

async function expectNegotiatedProtocol(port: number, clientProtocols: string[], expectedProtocol: string) {
  const { promise: openPromise, resolve: resolveOpen, reject } = Promise.withResolvers<void>();
  const ws = new WebSocket(`ws://localhost:${port}`, clientProtocols);

  try {
    ws.onopen = () => resolveOpen();
    ws.onerror = reject;
    ws.onclose = event => {
      if (event.code === 1002 && event.reason === "Mismatch client protocol") {
        reject(new Error("Connection failed with 'Mismatch client protocol'"));
      }
    };

    await openPromise;
    expect(ws.protocol).toBe(expectedProtocol);
  } finally {
    ws.terminate();
  }
}

async function readUpgradeResponse(
  port: number,
  {
    clientProtocols = [],
    clientExtensions = [],
  }: {
    clientProtocols?: string[];
    clientExtensions?: string[];
  } = {},
) {
  const key = Buffer.from("0123456789abcdef").toString("base64");

  return await new Promise<string>((resolve, reject) => {
    const socket = net.createConnection({ host: "localhost", port });
    let response = "";
    let completed = false;

    const finish = (callback: () => void) => {
      if (completed) return;
      completed = true;
      socket.removeAllListeners();
      socket.destroy();
      callback();
    };

    socket.on("connect", () => {
      const requestLines = [
        "GET / HTTP/1.1",
        `Host: localhost:${port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
      ];

      if (clientProtocols.length > 0) {
        requestLines.push(`Sec-WebSocket-Protocol: ${clientProtocols.join(", ")}`);
      }

      if (clientExtensions.length > 0) {
        requestLines.push(`Sec-WebSocket-Extensions: ${clientExtensions.join(", ")}`);
      }

      requestLines.push("", "");

      socket.write(requestLines.join("\r\n"));
    });

    socket.on("data", chunk => {
      response += chunk.toString("latin1");
      const headerEnd = response.indexOf("\r\n\r\n");
      if (headerEnd !== -1) {
        finish(() => resolve(response.slice(0, headerEnd + 4)));
      }
    });

    socket.on("error", error => {
      finish(() => reject(error));
    });

    socket.on("end", () => {
      if (!completed) {
        finish(() => reject(new Error("Socket closed before receiving the full upgrade response")));
      }
    });
  });
}

function getHeaderValues(response: string, headerName: string): string[] {
  const lines = response.split("\r\n");
  const headerPrefix = `${headerName.toLowerCase()}:`;

  return lines
    .slice(1)
    .filter(line => line.toLowerCase().startsWith(headerPrefix))
    .map(line => line.slice(line.indexOf(":") + 1).trim());
}

describe("server.upgrade() with custom Sec-WebSocket-Protocol", () => {
  for (const { label, makeHeaders, preservesOriginalHeaders } of headerVariants) {
    test(`${label}: should work when selecting the first protocol`, async () => {
      let protocolHeaderAfterUpgrade: string | null = null;

      using server = serve({
        hostname: "localhost",
        port: 0,
        fetch(req, server) {
          const protocols = getClientProtocols(req);
          const headers = makeHeaders({
            "Sec-WebSocket-Protocol": protocols[0],
          });

          server.upgrade(req, { headers });

          if (headers instanceof Headers) {
            protocolHeaderAfterUpgrade = headers.get("Sec-WebSocket-Protocol");
          }
        },
        websocket: {
          open(ws) {},
          close(ws) {},
        },
      });

      await expectNegotiatedProtocol(server.port, ["ocpp1.6", "ocpp2.0.1"], "ocpp1.6");

      if (preservesOriginalHeaders) {
        expect(protocolHeaderAfterUpgrade).toBe("ocpp1.6");
      }
    });

    test(`${label}: should work when selecting the second protocol`, async () => {
      let protocolHeaderAfterUpgrade: string | null = null;

      using server = serve({
        hostname: "localhost",
        port: 0,
        fetch(req, server) {
          const protocols = getClientProtocols(req);
          const headers = makeHeaders({
            "Sec-WebSocket-Protocol": protocols[1] || protocols[0],
          });

          server.upgrade(req, { headers });

          if (headers instanceof Headers) {
            protocolHeaderAfterUpgrade = headers.get("Sec-WebSocket-Protocol");
          }
        },
        websocket: {
          open(ws) {},
          close(ws) {},
        },
      });

      await expectNegotiatedProtocol(server.port, ["ocpp1.6", "ocpp2.0.1"], "ocpp2.0.1");

      if (preservesOriginalHeaders) {
        expect(protocolHeaderAfterUpgrade).toBe("ocpp2.0.1");
      }
    });

    test(`${label}: should work when selecting any protocol from the list`, async () => {
      let protocolHeaderAfterUpgrade: string | null = null;

      using server = serve({
        hostname: "localhost",
        port: 0,
        fetch(req, server) {
          const protocols = getClientProtocols(req);
          const selected = protocols.find(protocol => protocol === "chat");
          const headers = makeHeaders({
            "Sec-WebSocket-Protocol": selected!,
          });

          server.upgrade(req, { headers });

          if (headers instanceof Headers) {
            protocolHeaderAfterUpgrade = headers.get("Sec-WebSocket-Protocol");
          }
        },
        websocket: {
          open(ws) {},
          close(ws) {},
        },
      });

      await expectNegotiatedProtocol(server.port, ["echo", "chat", "binary"], "chat");

      if (preservesOriginalHeaders) {
        expect(protocolHeaderAfterUpgrade).toBe("chat");
      }
    });

    test(`${label}: should preserve other custom headers in the upgrade response`, async () => {
      let protocolHeaderAfterUpgrade: string | null = null;

      using server = serve({
        hostname: "localhost",
        port: 0,
        fetch(req, server) {
          const protocols = getClientProtocols(req);
          const headers = makeHeaders(
            { "Sec-WebSocket-Protocol": protocols[0] },
            { "X-Custom-Header": "custom-value" },
          );

          server.upgrade(req, { headers });

          if (headers instanceof Headers) {
            protocolHeaderAfterUpgrade = headers.get("Sec-WebSocket-Protocol");
          }
        },
        websocket: {
          open(ws) {},
          close(ws) {},
        },
      });

      const response = await readUpgradeResponse(server.port, {
        clientProtocols: ["test-protocol"],
      });

      expect(response.startsWith("HTTP/1.1 101 Switching Protocols")).toBe(true);
      expect(getHeaderValues(response, "Sec-WebSocket-Protocol")).toEqual(["test-protocol"]);
      expect(getHeaderValues(response, "X-Custom-Header")).toEqual(["custom-value"]);

      if (preservesOriginalHeaders) {
        expect(protocolHeaderAfterUpgrade).toBe("test-protocol");
      }
    });
  }
});

describe("server.upgrade() with custom Sec-WebSocket-Extensions", () => {
  for (const { label, makeHeaders, preservesOriginalHeaders } of headerVariants) {
    test(`${label}: should preserve websocket extensions without duplicates`, async () => {
      let extensionHeaderAfterUpgrade: string | null = null;

      using server = serve({
        hostname: "localhost",
        port: 0,
        fetch(req, server) {
          const [extension = "permessage-deflate"] = getRequestHeaderValues(req, "Sec-WebSocket-Extensions");
          const headers = makeHeaders(
            { "Sec-WebSocket-Extensions": extension },
            { "X-Custom-Header": "custom-value" },
          );

          server.upgrade(req, { headers });

          if (headers instanceof Headers) {
            extensionHeaderAfterUpgrade = headers.get("Sec-WebSocket-Extensions");
          }
        },
        websocket: {
          perMessageDeflate: true,
          open(ws) {},
          close(ws) {},
        },
      });

      const response = await readUpgradeResponse(server.port, {
        clientExtensions: ["permessage-deflate"],
      });
      const extensionHeaderValues = getHeaderValues(response, "Sec-WebSocket-Extensions");

      expect(response.startsWith("HTTP/1.1 101 Switching Protocols")).toBe(true);
      expect(extensionHeaderValues).toHaveLength(1);
      expect(extensionHeaderValues[0]).toContain("permessage-deflate");
      expect(getHeaderValues(response, "X-Custom-Header")).toEqual(["custom-value"]);

      if (preservesOriginalHeaders) {
        expect(extensionHeaderAfterUpgrade).toBe("permessage-deflate");
      }
    });
  }
});

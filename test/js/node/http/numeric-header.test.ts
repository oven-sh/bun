import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

describe("HTTP numeric headers", () => {
  test("should handle numeric header names", async () => {
    let received: { byString: unknown; byNumber: unknown; hasKey: boolean } | undefined;

    // Capture header values in the handler and assert after the response
    // completes so a failed assertion surfaces as a test failure instead of a
    // hung fetch (res.end() would otherwise never run).
    const server = createServer((req, res) => {
      received = {
        byString: req.headers["1234"],
        byNumber: req.headers[1234],
        hasKey: "1234" in req.headers,
      };
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(`Received header value: ${req.headers["1234"]}`);
    });

    server.listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;

      const response = await fetch(`http://127.0.0.1:${port}/`, {
        headers: {
          "1234": "Hello from client!",
          "Connection": "close",
        },
      });
      const data = await response.text();

      expect(received).toEqual({
        byString: "Hello from client!",
        byNumber: "Hello from client!",
        hasKey: true,
      });
      expect(data).toBe("Received header value: Hello from client!");
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});

// The server builds req.headers when it is first read, so it follows a rawHeaders that the handler assigned
// before reading it. (In Node the headers exist before the handler runs.)
describe("req.headers after req.rawHeaders was assigned", () => {
  test("is what the assigned array folds to", async () => {
    let received: { headers: [string, unknown][]; rawHeaders: string[] } | undefined;

    const server = createServer((req, res) => {
      req.rawHeaders = ["X-Assigned", "1", "x-assigned", "2", "Host", "assigned"];
      received = { headers: Object.entries(req.headers), rawHeaders: req.rawHeaders };
      res.end();
    });

    server.listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const { port } = server.address() as AddressInfo;

      const response = await fetch(`http://127.0.0.1:${port}/`, { headers: { "Connection": "close" } });
      await response.text();

      expect(received).toEqual({
        headers: [
          ["x-assigned", "1, 2"],
          ["host", "assigned"],
        ],
        rawHeaders: ["X-Assigned", "1", "x-assigned", "2", "Host", "assigned"],
      });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});

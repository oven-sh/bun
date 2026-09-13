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

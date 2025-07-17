import { describe, expect, it } from "bun:test";
import { once } from "node:events";
import { createServer, request } from "node:http";

describe("node:http client timeout", () => {
  it("should emit timeout event when timeout is reached", async () => {
    const server = createServer((req, res) => {
      // Intentionally not sending response to trigger timeout
    }).listen(0);

    try {
      await once(server, "listening");
      const port = (server.address() as any).port;

      const req = request({
        port,
        host: "localhost",
        path: "/",
        timeout: 50, // Set a short timeout
      });

      let timeoutEventEmitted = false;
      let destroyCalled = false;

      req.on("timeout", () => {
        timeoutEventEmitted = true;
      });

      req.on("close", () => {
        destroyCalled = true;
      });

      req.end();

      // Wait for events to be emitted
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(timeoutEventEmitted).toBe(true);
      expect(destroyCalled).toBe(true);
      expect(req.destroyed).toBe(true);
    } finally {
      server.close();
    }
  });

  it("should clear timeout when explicitly set to 0", async () => {
    const server = createServer((req, res) => {
      res.end("OK");
    }).listen(0);

    try {
      await once(server, "listening");
      const port = (server.address() as any).port;

      const req = request({
        port,
        host: "localhost",
        path: "/",
      });

      let timeoutEventEmitted = false;
      req.on("timeout", () => {
        timeoutEventEmitted = true;
      });

      // Set and then clear timeout
      req.setTimeout(50);
      req.setTimeout(0);

      req.end();

      // Wait longer than the original timeout
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(timeoutEventEmitted).toBe(false);
      expect(req.destroyed).toBe(false);
    } finally {
      server.close();
    }
  });
});

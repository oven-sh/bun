import { expect, test } from "bun:test";
import { createServer } from "node:http";

test("ServerResponse emits close event on client disconnect", async () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  let requestClosed = false;
  let responseClosed = false;

  const server = createServer((req, res) => {
    req.once("close", () => {
      requestClosed = true;
    });

    res.once("close", () => {
      responseClosed = true;
      resolve();
    });

    // Don't end the response — wait for the client to disconnect.
  });

  server.listen(0, async () => {
    const port = server.address()!.port;

    try {
      // Connect and immediately abort to simulate client disconnect
      const controller = new AbortController();
      fetch(`http://localhost:${port}`, { signal: controller.signal }).catch(() => {});
      // Give the server a moment to receive the request before aborting
      await Bun.sleep(50);
      controller.abort();

      // Wait for the close event on the response
      await promise;

      expect(requestClosed).toBe(true);
      expect(responseClosed).toBe(true);
    } finally {
      server.close();
    }
  });

  // Timeout safety: reject if close event never fires
  await Promise.race([
    promise,
    new Promise<void>((_, rej) => setTimeout(() => rej(new Error("Timed out waiting for response close event")), 5000)),
  ]);
});

test("ServerResponse emits close event on normal response end", async () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  let responseClosed = false;

  const server = createServer((req, res) => {
    res.once("close", () => {
      responseClosed = true;
      resolve();
    });

    res.end("hello");
  });

  server.listen(0, async () => {
    const port = server.address()!.port;

    try {
      const resp = await fetch(`http://localhost:${port}`);
      const text = await resp.text();
      expect(text).toBe("hello");

      await promise;
      expect(responseClosed).toBe(true);
    } finally {
      server.close();
    }
  });

  await Promise.race([
    promise,
    new Promise<void>((_, rej) => setTimeout(() => rej(new Error("Timed out waiting for response close event")), 5000)),
  ]);
});

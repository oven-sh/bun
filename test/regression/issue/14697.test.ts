import { test, expect } from "bun:test";
import { createServer } from "node:http";

// https://github.com/oven-sh/bun/issues/14697
test("ServerResponse emits close event when client disconnects", async () => {
  const { promise: reqClosePromise, resolve: reqCloseResolve } = Promise.withResolvers<void>();
  const { promise: resClosePromise, resolve: resCloseResolve } = Promise.withResolvers<void>();

  const server = createServer((req, res) => {
    req.once("close", () => {
      reqCloseResolve();
    });

    res.once("close", () => {
      resCloseResolve();
    });
  });

  const { promise: listeningPromise, resolve: listeningResolve } = Promise.withResolvers<void>();
  server.listen(0, () => {
    listeningResolve();
  });
  await listeningPromise;

  const addr = server.address()!;
  const port = typeof addr === "string" ? 0 : addr.port;

  // Connect and immediately abort to simulate client disconnect
  try {
    const controller = new AbortController();
    const fetchPromise = fetch(`http://localhost:${port}`, { signal: controller.signal });
    // Give the server a moment to receive the request, then abort
    await Bun.sleep(50);
    controller.abort();
    await fetchPromise.catch(() => {});
  } catch {
    // Expected - abort causes an error
  }

  // Both close events should fire
  await Promise.all([
    reqClosePromise,
    resClosePromise,
  ]);

  server.close();
});

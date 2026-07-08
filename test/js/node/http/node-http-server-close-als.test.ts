import { expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { createServer } from "node:http";

test("http.Server 'close' runs in the closer's AsyncLocalStorage context, not listen()'s", async () => {
  const als = new AsyncLocalStorage<string>();
  const server = createServer((req, res) => res.end("ok"));
  const events: { where: string; store: string | undefined }[] = [];

  als.run("register", () => {
    server.on("close", () => events.push({ where: "listener", store: als.getStore() }));
  });

  const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    als.run("listen", () => server.listen(0, "127.0.0.1", resolve));
  });

  als.run("closer", () => {
    server.close(() => {
      events.push({ where: "cb", store: als.getStore() });
      onClosed();
    });
  });
  await closed;

  // Both the 'close' listener and close(cb) observe the store active at
  // close() time, and close(cb) is a once('close') listener so the earlier
  // registration fires first (matching Node's net.Server.prototype.close).
  expect(events).toEqual([
    { where: "listener", store: "closer" },
    { where: "cb", store: "closer" },
  ]);
});

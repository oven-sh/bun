import { expect, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { finished } from "node:stream";

// https://github.com/oven-sh/bun/issues/27428
// The stream.finished() callback must run in the AsyncLocalStorage context that was active when finished() was called.
test("stream.finished callback preserves AsyncLocalStorage context", async () => {
  const asyncLocalStorage = new AsyncLocalStorage<{ foo: string }>();
  const store = { foo: "bar" };
  const calls: { err: unknown; store: unknown }[] = [];
  const { promise: responseClosed, resolve: onResponseClosed } = Promise.withResolvers<void>();

  await using server = http.createServer((req, res) => {
    asyncLocalStorage.run(store, () => {
      finished(res, err => {
        calls.push({ err, store: asyncLocalStorage.getStore() });
      });
    });
    res.on("close", onResponseClosed);
    // Like the issue, end the response on a later tick, outside run(): the
    // stream events then fire with no store active, so only the context that
    // finished() captured can reach the callback.
    setImmediate(() => res.end());
  });
  await once(server.listen(0, "127.0.0.1"), "listening");
  const { port } = server.address() as AddressInfo;

  const response = await fetch(`http://127.0.0.1:${port}/`);
  expect(await response.text()).toBe("");
  // 'close' is the last event finished() listens for, so after it the callback
  // count is final.
  await responseClosed;

  expect(calls).toEqual([{ err: undefined, store: { foo: "bar" } }]);
  expect(calls[0].store).toBe(store);
});

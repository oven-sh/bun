import { expect, test } from "bun:test";

// https://github.com/oven-sh/bun/issues/15665
// WebSocket.onclose should fire asynchronously after .close() returns,
// not synchronously during the .close() call.
test("WebSocket.onclose fires asynchronously after .close()", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("not a websocket", { status: 400 });
    },
    websocket: {
      open(ws) {},
      message(ws, data) {
        ws.send(data);
      },
      close(ws, code, reason) {},
    },
  });

  const ws = new WebSocket(`ws://localhost:${server.port}`);

  // Wait for open
  const { promise: openPromise, resolve: openResolve } = Promise.withResolvers<void>();
  ws.onopen = () => openResolve();
  await openPromise;

  // Track the order of execution
  const order: string[] = [];
  let closeResolve: (() => void) | undefined;

  ws.onclose = () => {
    order.push("onclose");
    closeResolve?.();
  };

  // Call close - onclose should NOT fire synchronously here
  ws.close(3000);
  order.push("after-close");

  // Set up the close promise AFTER calling close.
  // If onclose fires asynchronously (correct), closeResolve will be set
  // before onclose runs, and the promise will resolve.
  // If onclose fires synchronously (bug), closeResolve is still undefined
  // when onclose runs, and the promise would never resolve.
  const closePromise = new Promise<void>(r => (closeResolve = r));
  await closePromise;

  // Verify that "after-close" was recorded before "onclose"
  expect(order).toEqual(["after-close", "onclose"]);
});

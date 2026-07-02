import { expect, test } from "bun:test";
import { getEventLoopStats } from "bun:internal-for-testing";
import { isWindows } from "harness";

// `nestedDispatchTicks` counts event-loop ticks that began while an outer
// ready-poll dispatch was still mid-batch, i.e. a poll callback synchronously
// waited on the event loop. https://github.com/oven-sh/bun/issues/33261
// POSIX only: Windows readiness is driven by libuv, so it reports 0 there.
test.skipIf(isWindows)("nestedDispatchTicks counts re-entrant ticks started inside a dispatch callback", async () => {
  const before = getEventLoopStats().nestedDispatchTicks;
  expect(before).toBeNumber();

  // The fetch handler runs inside the server socket's poll dispatch, and
  // HTMLRewriter.transform with an async handler synchronously waits on that
  // handler's promise (waitForPromise), so a nested tick starts while the
  // dispatch is still mid-batch. Sockets are level-triggered, so the nested
  // tick cannot lose any one-shot event. When #33261 de-blocks HTMLRewriter,
  // this trigger must become another synchronous waiter (or an internal hook).
  const rewriter = new HTMLRewriter().on("p", {
    async element() {
      await Bun.sleep(1);
    },
  });
  using server = Bun.serve({
    port: 0,
    fetch() {
      rewriter.transform("<p>x</p>");
      return new Response("ok");
    },
  });
  const res = await fetch(`http://localhost:${server.port}/`);
  expect(await res.text()).toBe("ok");

  expect(getEventLoopStats().nestedDispatchTicks).toBeGreaterThan(before);
});

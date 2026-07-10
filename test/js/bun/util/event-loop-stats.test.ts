import { getEventLoopStats } from "bun:internal-for-testing";
import { expect, test } from "bun:test";
import { isDebug, isWindows } from "harness";

// `nestedDispatchTicks` counts event-loop ticks that began while an outer
// ready-poll dispatch was still mid-batch, i.e. a poll callback synchronously
// waited on the event loop. https://github.com/oven-sh/bun/issues/33261
// The counter only exists in debug builds (BUN_DEBUG), and only the POSIX
// event loop increments it: release builds and Windows always report 0.
test.skipIf(isWindows || !isDebug)(
  "nestedDispatchTicks counts re-entrant ticks started inside a dispatch callback",
  async () => {
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
  },
);

// Runs in every build flavor: the field always exists, and outside debug
// builds it must stay 0 (the counter is compiled out).
test("getEventLoopStats() always reports nestedDispatchTicks", async () => {
  const stats = getEventLoopStats();
  expect(stats.nestedDispatchTicks).toBeNumber();
  expect(stats.nestedDispatchTicks).toBeGreaterThanOrEqual(0);
  if (!isDebug) {
    await Promise.all(Array.from({ length: 4 }, (_, i) => Bun.$`printf %s r${i}`.quiet()));
    expect(getEventLoopStats().nestedDispatchTicks).toBe(0);
  }
});

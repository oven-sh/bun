// close()/terminate() during CONNECTING must transition to CLOSED, fire
// error + close events, and release the pending-activity ref so the
// WebSocket can be garbage-collected. Previously the Zig upgrade client
// was cancelled without any completion callback reaching C++, leaving
// the socket stuck in CLOSING with hasPendingActivity() permanently true
// — never GC'd, close event never fired, process never exited.

import { describe, expect, it } from "bun:test";
import { heapStats } from "bun:jsc";
import { createServer, type AddressInfo } from "net";

describe.each(["close", "terminate"] as const)("%s() during CONNECTING", method => {
  it("fires error + close events and transitions to CLOSED", async () => {
    // TCP server that accepts connections but never responds — keeps the
    // WebSocket in CONNECTING until we abort it.
    const listening = Promise.withResolvers<void>();
    const server = createServer(() => {}).listen(0, "127.0.0.1", listening.resolve);
    await listening.promise;
    try {
      const port = (server.address() as AddressInfo).port;
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      expect(ws.readyState).toBe(WebSocket.CONNECTING);

      const events: { type: string; message?: string }[] = [];
      ws.onerror = e => events.push({ type: e.type, message: (e as ErrorEvent).message });
      const closed = new Promise<CloseEvent>(resolve => {
        ws.onclose = e => {
          events.push({ type: e.type });
          resolve(e);
        };
      });

      ws[method]();
      expect(ws.readyState).toBe(WebSocket.CLOSING);

      const ev = await closed;
      // Spec "fail the WebSocket connection": error event then close event.
      expect(events.map(e => e.type)).toEqual(["error", "close"]);
      expect(events[0].message).toContain("closed before the connection is established");
      expect({
        readyState: ws.readyState,
        code: ev.code,
        wasClean: ev.wasClean,
      }).toEqual({
        readyState: WebSocket.CLOSED,
        code: 1006,
        wasClean: false,
      });
    } finally {
      server.close();
    }
  });

  it("does not leak", async () => {
    function getWebSocketCount() {
      Bun.gc(true);
      return heapStats().objectTypeCounts?.WebSocket || 0;
    }

    const listening = Promise.withResolvers<void>();
    const server = createServer(() => {}).listen(0, "127.0.0.1", listening.resolve);
    await listening.promise;
    try {
      const port = (server.address() as AddressInfo).port;
      const before = getWebSocketCount();

      const closes: Promise<unknown>[] = [];
      for (let i = 0; i < 64; i++) {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        closes.push(new Promise(resolve => (ws.onclose = resolve)));
        ws[method]();
      }
      await Promise.all(closes);

      // disablePendingActivity is posted as a separate task after the close
      // event fires; drain those plus any pending socket-close callbacks
      // before counting. Without the fix, all 64 instances remain alive.
      let after: number;
      for (let i = 0; i < 10; i++) {
        await new Promise(resolve => setImmediate(resolve));
        after = getWebSocketCount();
        if (after - before <= 5) break;
      }

      expect(after! - before).toBeLessThanOrEqual(5);
    } finally {
      server.close();
    }
  });
});

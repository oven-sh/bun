import { expect, test } from "bun:test";
import { isWindows } from "harness";
import net from "node:net";

// https://github.com/oven-sh/bun/issues/39846
// A fetch() response tail that arrived while receive backpressure had the
// socket paused was discarded when a TCP reset arrived behind it: the event
// loop closed the paused socket without draining the bytes the kernel still
// held. Windows cannot recover the tail (AFD discards the receive queue on a
// reset, and node loses it there too), so the test is skipped on Windows.
test.skipIf(isWindows)("fetch: response tail received before a reset is delivered, not discarded", async () => {
  for (let i = 0; i < 2; i++) {
    let conn: net.Socket | undefined;
    const server = net.createServer(c => {
      conn = c;
      c.on("error", () => {});
      let buf = "";
      const onData = (d: Buffer) => {
        buf += d.toString("latin1");
        if (buf.includes("\r\n\r\n")) {
          c.off("data", onData);
          c.write("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n5\r\nfirst\r\n");
        }
      };
      c.on("data", onData);
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as net.AddressInfo).port;

      let push!: (s: string) => void;
      const requestBody = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hello"));
          push = s => controller.enqueue(new TextEncoder().encode(s));
        },
      });

      const res = await fetch(`http://127.0.0.1:${port}/`, {
        method: "POST",
        body: requestBody,
        duplex: "half",
      });

      // The first body chunk pauses the transport (nothing consumes the body
      // yet). The pause is the precondition under test and is unobservable
      // from JS (a paused socket produces no events), so the sleeps below are
      // the only way to sequence the race deterministically.
      await Bun.sleep(100);

      // Finish the response and close the server socket cleanly. The tail and
      // the FIN sit unread in the paused client's kernel buffer.
      await new Promise<void>(resolve => conn!.write("4\r\ntail\r\n0\r\n\r\n", () => resolve()));
      conn!.destroy();
      await Bun.sleep(50);

      // A request-body chunk sent to the closed server socket makes its kernel
      // answer with a reset. The reset reaches the paused client while the
      // response tail is still queued behind it.
      push("x");
      await Bun.sleep(100);

      // Consuming the body resumes the transport, which must drain the tail
      // before it surfaces the reset.
      expect(await res.text()).toBe("firsttail");
    } finally {
      conn?.destroy();
      server.close();
    }
  }
});

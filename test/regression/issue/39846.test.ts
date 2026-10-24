import { expect, test } from "bun:test";
import { isWindows } from "harness";
import net from "node:net";

// https://github.com/oven-sh/bun/issues/39846
// Windows cannot recover the tail: AFD discards the receive queue on a reset, and node loses it there too.
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

      const res = await fetch(`http://127.0.0.1:${port}/`, {
        method: "POST",
        body: new ReadableStream({ start: () => {} }),
        duplex: "half",
      });

      // "first" arrived with the headers and nothing pulls the body, so the transport is paused.
      // The tail and the reset now queue behind each other in the paused client's kernel buffer.
      await new Promise<void>(resolve => conn!.write("4\r\ntail\r\n0\r\n\r\n", () => resolve()));
      conn!.resetAndDestroy();

      expect(await res.text()).toBe("firsttail");
    } finally {
      conn?.destroy();
      server.close();
    }
  }
});

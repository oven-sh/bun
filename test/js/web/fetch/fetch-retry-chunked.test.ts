// Coverage for the chunked-body path on a keep-alive connection that the
// server drops before responding (on_close with allow_retry == true). Added
// alongside the None-safe body_out_str guards for Sentry BUN-3BZF; the
// body_out_str == None state itself is not deterministically reachable from
// fetch().

import { expect, test } from "bun:test";
import type { AddressInfo } from "node:net";
import net from "node:net";

// The server drops every third request without responding, so the client
// that adopted the pooled socket observes on_close with response_stage ==
// Pending and allow_retry == true, runs the retry, reconnects, and processes
// a chunked body.
test("chunked uncompressed body over a retried keep-alive connection", async () => {
  let reqNo = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buf = "";
    socket.on("data", chunk => {
      buf += chunk.toString("latin1");
      let idx: number;
      while ((idx = buf.indexOf("\r\n\r\n")) !== -1) {
        buf = buf.slice(idx + 4);
        reqNo++;
        if (reqNo % 3 === 0) {
          // Close without responding: client retries on a fresh connection.
          socket.destroy();
          return;
        }
        socket.write(
          "HTTP/1.1 200 OK\r\n" +
            "Connection: keep-alive\r\n" +
            "Transfer-Encoding: chunked\r\n" +
            "\r\n" +
            "5\r\nhello\r\n" +
            "6\r\n world\r\n" +
            "0\r\n\r\n",
        );
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  try {
    for (let i = 0; i < 40; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello world");
    }
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise<void>(r => server.close(() => r()));
  }
});

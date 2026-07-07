import { expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";

test(
  "server-side IncomingMessage.setTimeout does not leak into the keep-alive idle window",
  async () => {
    // The handler calls req.setTimeout(2000) and responds immediately. The
    // client then holds the keep-alive connection idle for longer than that
    // per-request timeout and issues a second request on the same socket. The
    // per-request override must not close the idle connection between requests.
    const server = http.createServer((req, res) => {
      req.setTimeout(2000);
      res.end("ok");
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const { port } = server.address() as AddressInfo;

    try {
      const result = await new Promise<{ first: boolean; second: boolean; closedEarly: boolean }>(resolve => {
        const s = net.connect(port, "127.0.0.1");
        let buffered = "";
        let first = false;
        let second = false;
        let waitingForSecond = false;
        let done = false;

        const finish = (closedEarly: boolean) => {
          if (done) return;
          done = true;
          try {
            s.destroy();
          } catch {}
          resolve({ first, second, closedEarly });
        };

        s.on("connect", () => {
          s.write("GET /a HTTP/1.1\r\nHost: a\r\nConnection: keep-alive\r\n\r\n");
        });
        s.on("data", chunk => {
          buffered += chunk.toString("latin1");
          if (!first && buffered.includes("\r\n\r\nok")) {
            first = true;
            buffered = "";
            waitingForSecond = true;
            // Idle longer than the per-request setTimeout(2000); uWS tick
            // granularity means a leaked 2s override fires within ~8s.
            setTimeout(() => {
              waitingForSecond = false;
              s.write("GET /b HTTP/1.1\r\nHost: a\r\nConnection: close\r\n\r\n");
            }, 10_000);
          } else if (first && buffered.includes("\r\n\r\nok")) {
            second = true;
            finish(false);
          }
        });
        s.on("error", () => {});
        s.on("close", () => finish(waitingForSecond));
      });

      expect(result).toEqual({ first: true, second: true, closedEarly: false });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  },
  20_000,
);

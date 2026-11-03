// Body of test/js/bun/test/parallel/test-net-half-open-peer-reset-*: a backpressured socket whose peer stops reading, FINs, then RSTs must close (with `end` at most once), not spin.
import { tls as tlsCert } from "../../../harness";
import { once } from "node:events";
import http from "node:http";
import https from "node:https";

const big = Buffer.alloc(4 * 1024 * 1024, 0x78);
const { key, cert } = tlsCert;
const upgradeReq = "GET / HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n";
const getReq = "GET / HTTP/1.1\r\nHost: x\r\n\r\n";

export async function run(mode) {
  const issued = Promise.withResolvers(); // victim has queued more than the kernel will buffer
  const ended = Promise.withResolvers(); // victim saw the peer's FIN (half-open modes)
  const closed = Promise.withResolvers(); // victim socket/request was torn down
  let endCount = 0;
  const onEnd = () => {
    if (++endCount > 1) fail("end delivered " + endCount + " times");
    ended.resolve();
  };
  const fail = why => {
    console.error("FAIL", why);
    process.exit(1);
  };

  // The peer is a raw Bun socket so FIN (shutdown) and RST (terminate) are exactly what hits the wire, in that order.
  async function peer(port, { preface, useTls, waitForEnd }) {
    const opened = Promise.withResolvers();
    const s = await Bun.connect({
      hostname: "127.0.0.1",
      port,
      allowHalfOpen: true,
      tls: useTls ? { rejectUnauthorized: false } : false,
      socket: {
        open: s => (useTls ? undefined : opened.resolve(s)),
        handshake: s => opened.resolve(s),
        data() {},
        end() {},
        // Reject so a setup failure names itself instead of pending past the
        // watchdog (both are no-ops once opened has resolved).
        error: (_s, e) => opened.reject(e),
        close: (_s, e) => opened.reject(e ?? new Error("peer socket closed before setup finished")),
      },
    });
    await opened.promise;
    if (preface) s.write(preface);
    s.flush();
    s.pause();
    await issued.promise;
    s.shutdown();
    if (waitForEnd) await Promise.race([ended.promise, closed.promise]);
    // The FIN→RST gap is where the bug lived; an immediate RST can overtake the FIN and just read as ECONNRESET.
    await Bun.sleep(50);
    s.terminate();
    const deadline = setTimeout(() => fail("still open 5s after peer reset"), 5000);
    closed.promise.then(() => clearTimeout(deadline));
  }

  switch (mode) {
    case "bun-listen":
    case "bun-listen-tls": {
      const useTls = mode === "bun-listen-tls";
      using server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        allowHalfOpen: true,
        tls: useTls ? { key, cert } : undefined,
        socket: {
          open(s) {
            s.write(big);
            issued.resolve();
          },
          data() {},
          drain(s) {
            s.write(big);
          },
          end: onEnd,
          error() {},
          close: () => closed.resolve(""),
        },
      });
      await peer(server.port, { useTls, waitForEnd: true });
      await closed.promise;
      break;
    }
    case "node-http-upgrade":
    case "node-https-upgrade": {
      const useTls = mode === "node-https-upgrade";
      await using server = (useTls ? https : http).createServer(useTls ? { key, cert } : {}, (_q, res) => res.end());
      server.on("upgrade", (_req, socket) => {
        socket.on("error", () => {});
        socket.on("close", () => closed.resolve(""));
        socket.on("end", () => {
          onEnd();
          socket.end();
        });
        socket.write("HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n");
        for (let i = 0; i < 8; i++) socket.write(big);
        issued.resolve();
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      await peer(server.address().port, { preface: upgradeReq, useTls, waitForEnd: true });
      await closed.promise;
      break;
    }
    case "node-http-response":
    case "node-https-response": {
      const useTls = mode === "node-https-response";
      await using server = (useTls ? https : http).createServer(useTls ? { key, cert } : {}, (_req, res) => {
        res.on("close", () => closed.resolve("res"));
        res.writeHead(200);
        for (let i = 0; i < 8; i++) res.write(big);
        issued.resolve();
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      await peer(server.address().port, { preface: getReq, useTls, waitForEnd: false });
      await closed.promise;
      break;
    }
    case "bun-serve":
    case "bun-serve-tls": {
      const useTls = mode === "bun-serve-tls";
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        idleTimeout: 0,
        tls: useTls ? { key, cert } : undefined,
        fetch(req) {
          req.signal.addEventListener("abort", () => closed.resolve("abort"));
          let i = 0;
          return new Response(
            new ReadableStream({
              pull(ctrl) {
                if (i++ < 64) ctrl.enqueue(big);
                else ctrl.close();
                issued.resolve();
              },
              cancel: () => closed.resolve("cancel"),
            }),
          );
        },
      });
      await peer(server.port, { preface: getReq, useTls, waitForEnd: false });
      await closed.promise;
      break;
    }
    case "fetch-upload": {
      // Roles flipped: the server is the peer that stops reading / FINs / RSTs; fetch() is the victim with a pending body.
      using server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        allowHalfOpen: true,
        socket: {
          async open(s) {
            s.pause();
            await issued.promise;
            s.shutdown();
            await Bun.sleep(50);
            s.terminate();
            const deadline = setTimeout(() => fail("fetch still pending 5s after peer reset"), 5000);
            closed.promise.then(() => clearTimeout(deadline));
          },
          data() {},
          end() {},
          error() {},
          close() {},
        },
      });
      let i = 0;
      fetch(`http://127.0.0.1:${server.port}/`, {
        method: "POST",
        duplex: "half",
        body: new ReadableStream({
          pull(c) {
            if (i++ < 64) c.enqueue(big);
            else c.close();
            issued.resolve();
          },
        }),
      }).then(
        r =>
          r.text().then(
            () => closed.resolve("resolved"),
            e => closed.resolve("body rejected " + e?.code),
          ),
        e => closed.resolve("rejected " + e?.code),
      );
      await closed.promise;
      break;
    }
    default:
      fail("unknown mode " + mode);
  }
  console.log("closed", await closed.promise);
}

import { expect, test } from "bun:test";
import net from "node:net";
import { once } from "node:events";

// Data that arrives on a server socket before the user attaches a 'data'
// listener must not be lost. Previously, ServerHandlers.open called
// socket.resume() before the user's connection callback could add a listener,
// which put the Readable into flowing mode. If data then arrived before the
// listener was attached (e.g. when the listener is added inside an async
// callback), flow() would read from the buffer and emit 'data' with no
// listener, silently dropping bytes.
//
// Regression repro: a TCP proxy that attaches the 'data' listener only after
// yielding to the event loop (setImmediate / async upstream connect).
test("server socket does not lose data when 'data' listener is added asynchronously", async () => {
  const PAYLOAD = 1 * 1024 * 1024;
  const CHUNK = 64 * 1024;
  const ITERATIONS = 3;

  function listen(srv: net.Server): Promise<number> {
    return new Promise(r => srv.listen(0, "127.0.0.1", () => r((srv.address() as net.AddressInfo).port)));
  }

  const destServer = net.createServer(s => {
    let received = 0;
    s.on("data", c => {
      received += c.length;
      if (received >= PAYLOAD) s.write("F");
    });
    s.on("error", () => {});
  });
  const destPort = await listen(destServer);

  let proxyToServerBytes = 0;
  const proxy = net.createServer(c => {
    proxyToServerBytes = 0;
    // Defer listener attachment across two event-loop turns so the accepted
    // socket definitely sees client data before we start reading. Mirrors a
    // real-world proxy that attaches 'data' inside an async upstream connect
    // callback, but deterministic.
    setImmediate(() =>
      setImmediate(() => {
        const t = net.createConnection(destPort, "127.0.0.1", () => {
          c.on("data", d => {
            proxyToServerBytes += d.length;
            if (!t.write(d)) c.pause();
          });
          t.on("drain", () => c.resume());
          t.on("data", d => c.write(d));
        });
        c.on("error", () => t.destroy());
        t.on("error", () => c.destroy());
        c.on("close", () => t.destroy());
        t.on("close", () => c.destroy());
      }),
    );
  });
  const proxyPort = await listen(proxy);

  try {
    for (let i = 0; i < ITERATIONS; i++) {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const done = (fn: (v?: any) => void, v?: any) => {
          if (settled) return;
          settled = true;
          fn(v);
        };
        const client = net.connect(proxyPort, "127.0.0.1", () => {
          const chunk = Buffer.alloc(CHUNK, 0xab);
          let sent = 0;
          const send = () => {
            while (sent < PAYLOAD) {
              sent += CHUNK;
              if (!client.write(chunk)) {
                client.once("drain", send);
                return;
              }
            }
          };
          send();
        });
        client.on("data", c => {
          if (c.toString().includes("F")) {
            client.destroy();
            done(resolve);
          }
        });
        client.on("close", () => {
          // If the connection closed without the sentinel, bytes were dropped
          // on the way from proxy to destination — the original bug.
          done(reject, new Error(`iter ${i} closed early: proxyToServer=${proxyToServerBytes}/${PAYLOAD}`));
        });
        client.on("error", e => done(reject, e));
      });
    }
  } finally {
    destServer.close();
    proxy.close();
  }

  expect(proxyToServerBytes).toBe(PAYLOAD);
});

// Companion fix: net.createServer(s => { s.write(...); s.end(); }) must not
// leak `server._connections` when the peer sends data the server never reads.
// Without auto-resume in ServerHandlers.open, bytes accumulate in the paused
// Readable buffer; SocketEmitEndNT's push(null) + read(0) is a no-op when the
// buffer is non-empty (endReadable() skips), so 'end' never fires, the socket
// never autoDestroys, and server._connections never decrements. The drain
// branch in SocketEmitEndNT flips into flowing mode in this case so close
// completes cleanly.
test("net.createServer close completes when peer sends unread bytes", async () => {
  // Write-only TCP server (think fixed-response health check) that never
  // adds a 'data' listener. The accepted Readable stays paused; incoming
  // bytes accumulate in its buffer. Without the drain branch in
  // SocketEmitEndNT, push(null) + read(0) is a no-op (endReadable() skips
  // when state.length > 0), 'end' never fires, autoDestroy never runs, and
  // server._connections leaks. server.close() then hangs forever.
  const server = net.createServer(s => {
    s.on("error", () => {});
    s.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK");
    // Wait for the peer's bytes to actually land in our Readable buffer
    // before ending. Without this yield the server calls end() so quickly
    // that the bytes are still in-flight and the leak window is missed.
    setImmediate(() => setImmediate(() => s.end()));
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

  const clientDone: Promise<void>[] = [];
  for (let i = 0; i < 3; i++) {
    clientDone.push(
      (async () => {
        const c = net.connect(port, "127.0.0.1");
        await once(c, "connect");
        c.write("GET / HTTP/1.1\r\nHost: x\r\n\r\nEXTRA");
        c.on("data", () => {});
        await once(c, "close");
      })(),
    );
  }
  await Promise.all(clientDone);

  // server._connections must decrement all the way back to 0, otherwise
  // server.close() will never emit 'close' and this await hangs.
  server.close();
  await once(server, "close");
  expect((server as any)._connections).toBe(0);
});

import { test, expect } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";

// Data that arrives on a server socket before the user attaches a 'data' listener
// must not be lost. Previously, ServerHandlers.open called socket.resume() before
// the user's connection callback could add a listener, which put the Readable into
// flowing mode. If data then arrived before the listener was attached (e.g. when
// the listener is added inside an async callback), flow() would read from the
// buffer and emit 'data' with no listener, silently dropping bytes.
//
// This was observed as a stall in TCP proxy patterns where the connection handler
// creates an upstream connection and attaches the 'data' listener only once that
// upstream connection is established.
test("server socket does not lose data when 'data' listener is added asynchronously", async () => {
  const script = /* js */ `
    import net from "net";

    const PAYLOAD = 16 * 1024 * 1024;
    const CHUNK = 64 * 1024;

    function listen(srv) {
      return new Promise(r => srv.listen(0, "127.0.0.1", () => r(srv.address().port)));
    }

    let serverBytes = 0;
    const server = net.createServer(s => {
      serverBytes = 0;
      s.on("data", c => {
        serverBytes += c.length;
        if (serverBytes >= PAYLOAD) s.write("F");
      });
      s.on("error", () => {});
    });
    const sp = await listen(server);

    let proxyToServerBytes = 0;
    const proxy = net.createServer(c => {
      const t = net.createConnection(sp, "127.0.0.1", () => {
        // 'data' listener added asynchronously — data may have already arrived on c
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
    });
    const pp = await listen(proxy);

    await new Promise((resolve, reject) => {
      const tid = setTimeout(() => {
        reject(new Error("stalled: proxyToServer=" + proxyToServerBytes + "/" + PAYLOAD));
      }, 10000);
      const client = net.connect(pp, "127.0.0.1", () => {
        const chunk = Buffer.alloc(CHUNK, 0xab);
        let sent = 0;
        function send() {
          while (sent < PAYLOAD) {
            sent += CHUNK;
            if (!client.write(chunk)) {
              client.once("drain", send);
              return;
            }
          }
        }
        send();
      });
      client.on("data", c => {
        if (c.toString().includes("F")) {
          clearTimeout(tid);
          client.destroy();
          resolve();
        }
      });
      client.on("error", e => {
        clearTimeout(tid);
        reject(e);
      });
    });

    server.close();
    proxy.close();
    console.log("OK");
  `;

  // Run multiple times — the data loss is a race that depends on whether data
  // arrives on the accepted socket in the same event loop iteration as the
  // upstream connect completing.
  for (let i = 0; i < 10; i++) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr)).toBe("");
    expect(stdout.trim()).toBe("OK");
    expect(exitCode).toBe(0);
  }
}, 60000);

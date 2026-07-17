// https://github.com/oven-sh/bun/issues/34158
//
// A graceful server.stop()/server.close() released the server's loop ref
// immediately, before in-flight requests had drained. On Windows uv_run's
// alive-guard skips I/O polling entirely when no ref'd handles exist, so a
// half-closed connection's teardown event was never delivered and
// server.close() waited forever. On POSIX the loop keeps polling, but with
// no ref held is_event_loop_alive() could go false and exit the process
// before a Bun.serve request's abort was observed.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test.concurrent("Bun.serve: graceful stop() keeps the loop alive until in-flight requests drain", async () => {
  const script = /* js */ `
    const net = require("net");

    let sawAbort = false;
    let dropClient;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        // Request is in flight (pending_requests == 1). Stop the server now.
        server.stop();
        // The handler has started; schedule the client drop from here so the
        // sequencing is explicit. An unref'd timer does not itself keep the
        // loop alive, so whether it fires is decided by the server's ref.
        setTimeout(dropClient, 50).unref();
        // With no other ref'd handles, the server's own ref is the only thing
        // keeping the loop polling for this socket's close. Wait for it.
        await new Promise(resolve => {
          req.signal.addEventListener("abort", () => {
            sawAbort = true;
            resolve();
          });
        });
        return new Response("ok");
      },
    });

    const client = net.connect(server.port, "127.0.0.1", () => {
      client.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
    });
    client.unref();
    dropClient = () => client.destroy();

    process.on("exit", () => {
      process.stdout.write(sawAbort ? "SAW_ABORT" : "EXITED_EARLY");
    });
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "SAW_ABORT",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

test.concurrent("node:http: server.close() with a half-closed connection drains without wedging", async () => {
  // Canonical #34158 repro: res.socket.end() half-closes, the client aborts
  // its in-flight upload, and server.close() must observe that teardown.
  const script = /* js */ `
    const { once } = require("node:events");
    const http = require("node:http");

    const { promise, resolve, reject } = Promise.withResolvers();
    const server = http.createServer((req, res) => {
      res.writeHead(200, { Connection: "close" });
      res.socket.end();
      res.on("error", reject);
      try {
        resolve(res.write("hello"));
      } catch (err) {
        reject(err);
      }
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    const url = "http://127.0.0.1:" + server.address().port;

    await fetch(url, {
      method: "POST",
      body: Buffer.allocUnsafe(64 * 1024),
    })
      .then(r => r.bytes())
      .catch(() => {});

    if ((await promise) !== true) throw new Error("write() did not return true");

    await new Promise((resolve, reject) => {
      server.close(err => (err ? reject(err) : resolve()));
    });
    process.stdout.write("CLOSED");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    // Regression mode is a hang; bound the child so the assertion reports a
    // clear signalCode diff instead of the outer runner timing out.
    timeout: 30_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "CLOSED",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

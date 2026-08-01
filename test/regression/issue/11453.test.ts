// https://github.com/oven-sh/bun/issues/11453
//
// @edgedb/generate under Bun would sometimes exit 0 silently mid-connect.
// Root cause: edgedb's RawConnection does sock.ref()/await/sock.unref() around
// reads, and in between runs SCRAM via crypto.subtle (Bun exposes a global
// `crypto`, so the edgedb client picks its browserCrypto adapter). When the
// small-input digest fast path (or the completion leg of a work-queue crypto
// op) posts its result via ScriptExecutionContext::postTaskTo, the task lands
// in EventLoop.concurrent_tasks with no accompanying event-loop ref, and
// is_event_loop_alive() did not look at concurrent_tasks. With the socket
// unref'd, the liveness check saw zero and the process exited with the crypto
// result still queued.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";
import { once } from "node:events";
import net from "node:net";

describe("issue #11453: crypto.subtle keeps the event loop alive after a yield", () => {
  // Deterministic: the <64-byte SHA digest fast path computes synchronously
  // and posts the callback via postTaskTo with no work-queue ref.
  test.concurrent("crypto.subtle.digest (small input) awaited after setImmediate", async () => {
    const script = `
      (async () => {
        await new Promise(r => setImmediate(r));
        await crypto.subtle.digest("SHA-256", new Uint8Array(32));
        console.log("resolved");
      })();
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr)).toBe("");
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"resolved"`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("crypto.subtle.digest (small input) awaited after setTimeout", async () => {
    const script = `
      (async () => {
        await new Promise(r => setTimeout(r, 0));
        await crypto.subtle.digest("SHA-256", new Uint8Array(32));
        console.log("resolved");
      })();
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(normalizeBunSnapshot(stderr)).toBe("");
    expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"resolved"`);
    expect(exitCode).toBe(0);
  });

  // The exact shape from edgedb's rawConn._waitForMessage: with the socket
  // unref'd between reads, an awaited crypto.subtle op must keep the process
  // alive until it resolves and the next sock.ref() runs.
  test.concurrent("crypto.subtle between sock.unref() and sock.ref() on a net.Socket", async () => {
    const server = net.createServer(socket => {
      socket.setNoDelay();
      socket.on("data", () => {
        setImmediate(() => {
          try {
            socket.write("R");
          } catch {}
        });
      });
      socket.on("error", () => {});
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as net.AddressInfo).port;

    const script = `
      const net = require("net");
      const sock = net.createConnection(${port}, "127.0.0.1");
      let connR, dataR;
      sock.on("connect", () => connR());
      sock.on("error", e => { console.error("err", e.message); process.exit(2); });
      sock.on("data", () => { if (dataR) { dataR(); dataR = null; } });
      (async () => {
        await new Promise(r => (connR = r));

        // round-trip: edgedb's ref() / await data / unref() pattern
        sock.write("x");
        sock.ref();
        await new Promise(r => (dataR = r));
        sock.unref();

        // Socket is now unref'd. Nothing else is ref'd. The awaited digest
        // must keep the loop alive on its own.
        await crypto.subtle.digest("SHA-256", new Uint8Array(32));

        sock.write("y");
        sock.ref();
        await new Promise(r => (dataR = r));
        sock.unref();

        console.log("resolved");
        sock.destroy();
      })();
    `;

    try {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(normalizeBunSnapshot(stderr)).toBe("");
      expect(normalizeBunSnapshot(stdout)).toMatchInlineSnapshot(`"resolved"`);
      expect(exitCode).toBe(0);
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  });
});

// https://github.com/oven-sh/bun/issues/11453
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot } from "harness";
import { once } from "node:events";
import net from "node:net";

describe("issue #11453: crypto.subtle keeps the event loop alive after a yield", () => {
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

import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { once } from "node:events";
import { connect, createServer, type AddressInfo } from "node:net";

// connect_finish must tear down a still-live previous native socket before
// reusing the wrapper, not alias two native sockets onto one ext slot.
describe.concurrent("socket.connect() on an already-connected socket", () => {
  it("does not crash and emits connect for the new connection", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { createServer, connect } = require("node:net");
          const srv = createServer(c => c.on("error", () => {})).listen(0, "127.0.0.1", () => {
            const port = srv.address().port;
            const s = connect(port, "127.0.0.1", () => {
              process.stdout.write("first ");
              s.once("connect", () => {
                process.stdout.write("second");
                s.destroy();
                srv.close();
              });
              s.once("error", e => {
                process.stdout.write("err:" + e.code);
                srv.close();
              });
              s.connect(port, "127.0.0.1");
            });
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "first second", stderr, exitCode: 0 });
  });

  it("pauses the new connection although the previous one was left paused", async () => {
    // The wrapper is reused, so the paused state recorded for the first connection must
    // not turn the pause of the second one (a paused stream stops its new handle in
    // afterConnect) into a no-op.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { createServer, connect } = require("node:net");
          const { once } = require("node:events");
          let connections = 0;
          const wrote = Promise.withResolvers();
          const srv = createServer(c => {
            c.on("error", () => {});
            if (++connections === 2) c.end("hello", wrote.resolve);
          });
          srv.listen(0, "127.0.0.1", async () => {
            const port = srv.address().port;
            let resumed = false;
            let deliveredWhilePaused = false;
            let received = "";
            const onread = {
              buffer: Buffer.alloc(64),
              callback(n, buf) {
                if (!resumed) deliveredWhilePaused = true;
                received += buf.toString("utf8", 0, n);
                if (received === "hello") {
                  console.log(JSON.stringify({ deliveredWhilePaused, received }));
                  s.destroy();
                  srv.close();
                }
              },
            };
            const s = connect({ port, host: "127.0.0.1", onread });
            await once(s, "connect");
            // Connected and reading: this pause stops the first connection's handle.
            s.pause();
            s.connect({ port, host: "127.0.0.1" });
            await once(s, "connect");
            // "hello" is queued on the second connection once the server's end() callback
            // ran. The loop polls once between the two immediates, so a handle that still
            // reads delivers it (to the callback above, while !resumed) before resume().
            await wrote.promise;
            await new Promise(done => setImmediate(() => setImmediate(done)));
            resumed = true;
            s.resume();
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ deliveredWhilePaused: false, received: "hello" }),
      stderr,
      exitCode: 0,
    });
  });

  it("resume() reads the new connection of a socket that was paused while it read the previous one", async () => {
    let connections = 0;
    await using server = createServer(socket => {
      socket.on("error", () => {});
      if (++connections === 2) socket.end("hello");
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const { port } = server.address() as AddressInfo;
    const socket = connect(port, "127.0.0.1");
    try {
      await once(socket, "connect");
      socket.pause();
      socket.connect(port, "127.0.0.1");
      await once(socket, "connect");
      const received = once(socket, "data");
      socket.resume();
      expect(String((await received)[0])).toBe("hello");
    } finally {
      socket.destroy();
    }
  });

  it("does not crash when reconnecting while the first connect is still in flight", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { createServer, connect } = require("node:net");
          const srv = createServer(c => c.on("error", () => {})).listen(0, "127.0.0.1", () => {
            const port = srv.address().port;
            const s = connect(port, "127.0.0.1");
            // Second connect while the first is still connecting.
            s.connect(port, "127.0.0.1");
            s.once("connect", () => {
              process.stdout.write("connect");
              s.destroy();
              srv.close();
            });
            s.once("error", e => {
              process.stdout.write("err:" + e.code);
              s.destroy();
              srv.close();
            });
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Node emits EALREADY here; Bun drops the first in-flight connect and
    // completes the second. Either is acceptable so long as the process
    // exits cleanly.
    expect(["connect", "err:EALREADY"]).toContain(stdout);
    expect({ stderr, exitCode }).toEqual({ stderr, exitCode: 0 });
  });

  // connect() gives the handle another table of callbacks. Windows takes a first send of any size whole.
  it.skipIf(isWindows).each([
    ["canceled by connect()", "ECANCELED", `write(); s.connect(path); process.nextTick(collect);`],
    [
      "failed, from whose callback connect() is called",
      "EPIPE",
      `write(() => (s.connect(path), collect())); peer.once("data", () => peer.destroy()).resume();`,
    ],
  ])("a collection leaves the previous connection's callbacks to a queued write %s", async (_, code, body) => {
    using dir = tempDir("reconnect-gc", {});
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { createServer, connect } = require("node:net");
          const { once } = require("node:events");
          const path = "s.sock";
          const chunk = Buffer.alloc(4 << 20);
          // New handles take the cells that the collection freed.
          function collect() {
            Bun.gc(true);
            for (let i = 0; i < 20; i++) connect("missing.sock").on("error", () => {});
          }
          const srv = createServer({ pauseOnConnect: true }, c => c.on("error", () => {})).listen(path, async () => {
            const codes = new Set();
            for (let i = 0; i < 10; i++) {
              const s = connect(path).on("error", () => {});
              const [[peer]] = await Promise.all([once(srv, "connection"), once(s, "connect")]);
              await new Promise(setImmediate);
              const written = Promise.withResolvers();
              const write = then => s.write(chunk, err => (then?.(), written.resolve(err?.code)));
              const reconnected = once(srv, "connection");
              ${body}
              codes.add(await written.promise);
              const [second] = await reconnected;
              for (const socket of [s, peer, second]) socket.destroy();
            }
            srv.close();
            console.log(...codes);
          });
        `,
      ],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: code + "\n", stderr: "", exitCode: 0 });
  });
});

import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
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

  // libuv fails a second connect on a handle that has one in flight (Windows: EISCONN): https://github.com/nodejs/node/blob/v26.3.0/deps/uv/src/unix/tcp.c#L288-L289
  it("fails when reconnecting while the first connect is still in flight", async () => {
    const events: string[] = [];
    const server = createServer(connection => connection.on("error", () => {}));
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const { port } = server.address() as AddressInfo;
      const socket = connect(port, "127.0.0.1");
      socket.connect(port, "127.0.0.1");
      socket.on("connect", () => {
        events.push("connect");
        socket.destroy();
      });
      socket.on("error", (error: NodeJS.ErrnoException) => events.push(`err:${error.code}`));
      await new Promise(resolve => socket.on("close", resolve));
      expect(events).toEqual([isWindows ? "err:EISCONN" : "err:EALREADY"]);
    } finally {
      server.close();
    }
  });
});

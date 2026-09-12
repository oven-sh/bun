import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import type { AddressInfo } from "node:net";
import { connect, createServer } from "node:net";

// connect_finish must tear down a still-live previous native socket before
// reusing the wrapper, not alias two native sockets onto one ext slot.
describe.concurrent("socket.connect() re-entry", () => {
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

  // libuv's uv_tcp_connect returns UV_EALREADY while the handle's connect_req
  // is in flight, and internalConnect destroys the socket with that error.
  // The first attempt is torn down, no 'connect' fires, and the server sees at
  // most the one connection the first attempt opened.
  async function connectWhileConnecting(extraConnects: string) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { createServer, connect } = require("node:net");
          const { getSystemErrorName } = require("node:util");
          const events = [];
          let connections = 0;
          const srv = createServer(c => { connections++; c.on("error", () => {}); });
          srv.listen(0, "127.0.0.1", () => {
            const port = srv.address().port;
            const s = connect(port, "127.0.0.1");
            ${extraConnects}
            s.on("connect", () => {
              events.push("connect");
              s.destroy();
            });
            s.on("error", e => events.push("error:" + e.code + ":" + getSystemErrorName(e.errno) + ":" + e.syscall));
            s.on("close", hadError => {
              events.push("close:" + hadError);
              setImmediate(() => {
                srv.close();
                process.stdout.write(JSON.stringify({ events, connections }));
              });
            });
          });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return JSON.parse(stdout);
  }

  const EALREADY = "error:EALREADY:EALREADY:connect";

  it("while the first connect is still in flight fails with EALREADY and no connect", async () => {
    const { events, connections } = await connectWhileConnecting(`s.connect(port, "127.0.0.1");`);
    expect(events).toEqual([EALREADY, "close:true"]);
    expect(connections).toBeLessThanOrEqual(1);
  });

  it("a third connect() is dropped once the EALREADY destroy cleared connecting", async () => {
    const { events, connections } = await connectWhileConnecting(
      `s.connect(port, "127.0.0.1"); s.connect(port, "127.0.0.1");`,
    );
    expect(events).toEqual([EALREADY, "close:true"]);
    expect(connections).toBeLessThanOrEqual(1);
  });

  it("a lookup callback that fires twice fails the second connect with EALREADY", async () => {
    let connections = 0;
    const server = createServer(c => {
      connections++;
      c.on("error", () => {});
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const events: string[] = [];
      await new Promise<void>(resolve => {
        const c = connect({
          host: "example.invalid",
          port,
          autoSelectFamily: false,
          lookup(_host, _opts, cb) {
            cb(null, "127.0.0.1", 4);
            cb(null, "127.0.0.1", 4);
          },
        });
        c.on("connect", () => {
          events.push("connect");
          c.destroy();
        });
        c.on("error", (e: NodeJS.ErrnoException) => events.push("error:" + e.code + ":" + e.syscall));
        c.on("close", hadError => {
          events.push("close:" + hadError);
          resolve();
        });
      });
      expect(events).toEqual(["error:EALREADY:connect", "close:true"]);
      expect(connections).toBeLessThanOrEqual(1);
    } finally {
      server.close();
    }
  });
});

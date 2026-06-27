import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import os from "node:os";

// libuv's UV_EALREADY is -errno on POSIX and a fixed synthetic on Windows
// (uv/errno.h). process.binding("uv").UV_EALREADY is not usable here: on
// Windows it reports the MSVC CRT errno, which getSystemErrorName rejects.
const UV_EALREADY = isWindows ? -4084 : -os.constants.errno.EALREADY;

async function runNetFixture(source: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// connect_finish must tear down a still-live previous native socket before
// reusing the wrapper, not alias two native sockets onto one ext slot.
describe.concurrent("socket.connect() re-entry", () => {
  it("on an already-connected socket emits connect for the new connection", async () => {
    const { stdout, stderr, exitCode } = await runNetFixture(`
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
    `);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "first second", stderr, exitCode: 0 });
  });

  // Node rejects a connect() issued while the previous one is still in flight
  // with EALREADY (libuv: handle->connect_req != NULL) and destroys the
  // socket. The in-flight attempt must never emit 'connect'. Any connect()
  // after the EALREADY destroy is dropped by the `connecting` guard, so two
  // and three calls produce the same single error.
  it.each([
    ["one extra connect()", 1],
    ["two extra connect()s", 2],
  ])("while still connecting errors with EALREADY (%s)", async (_name, extra) => {
    const { stdout, stderr, exitCode } = await runNetFixture(`
      const { createServer, connect } = require("node:net");
      const srv = createServer(c => c.on("error", () => {})).listen(0, "127.0.0.1", () => {
        const port = srv.address().port;
        const events = [];
        const s = connect(port, "127.0.0.1");
        for (let i = 0; i < ${extra}; i++) s.connect(port, "127.0.0.1");
        // 'connect' must never fire; destroy so a regression still reaches
        // 'close' and reports the wrong event list instead of hanging.
        s.on("connect", () => {
          events.push("connect");
          s.destroy();
        });
        s.on("error", e => {
          const { name, message, code, errno, syscall, address, port } = e;
          events.push({ name, message, code, errno, syscall, address, port });
        });
        s.on("close", hadError => {
          events.push("close:" + hadError);
          process.stdout.write(JSON.stringify({ port, events }));
          srv.close();
        });
      });
    `);
    expect({ stderr, exitCode }).toEqual({ stderr, exitCode: 0 });
    const { port, events } = JSON.parse(stdout);
    expect(events).toEqual([
      {
        name: "Error",
        message: `connect EALREADY 127.0.0.1:${port}`,
        code: "EALREADY",
        errno: UV_EALREADY,
        syscall: "connect",
        address: "127.0.0.1",
        port,
      },
      "close:true",
    ]);
  });

  // The abandoned first attempt's connect callback must never fire; neither
  // may the rejected second attempt's.
  it("does not invoke either attempt's connect callback", async () => {
    const { stdout, stderr, exitCode } = await runNetFixture(`
      const { createServer, connect } = require("node:net");
      const srv = createServer(c => c.on("error", () => {})).listen(0, "127.0.0.1", () => {
        const port = srv.address().port;
        const events = [];
        const s = connect(port, "127.0.0.1", () => events.push("cb1"));
        s.connect(port, "127.0.0.1", () => events.push("cb2"));
        // Neither callback may fire; destroy so a regression still reaches
        // 'close' and reports the wrong event list instead of hanging.
        s.on("connect", () => s.destroy());
        s.on("error", e => events.push("error:" + e.code));
        s.on("close", () => {
          process.stdout.write(JSON.stringify(events));
          srv.close();
        });
      });
    `);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: JSON.stringify(["error:EALREADY"]),
      stderr,
      exitCode: 0,
    });
  });
});

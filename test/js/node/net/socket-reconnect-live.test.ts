import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

// `Socket.prototype.connect` on a socket that still has a live native handle
// used to trip `debug_assert!(prev.socket.get().is_detached())` in
// connect_finish (assert builds) and, on release builds, silently aliased two
// native sockets onto one wrapper (the old us_socket_t's ext slot kept
// pointing at the wrapper while `do_connect` overwrote `self.socket`).
describe("socket.connect() on an already-connected socket", () => {
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
    expect({ stdout, exitCode }).toEqual({ stdout: "first second", exitCode: 0 });
    expect(stderr).not.toContain("assertion failed");
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
    expect(exitCode).toBe(0);
    expect(["connect", "err:EALREADY"]).toContain(stdout);
    expect(stderr).not.toContain("assertion failed");
  });
});

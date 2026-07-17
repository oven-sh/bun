import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// When `Bun.listen()` on a Windows named pipe fails (e.g. the pipe name is
// already in use), the cleanup path must:
//   - not double-unprotect the socket handler callbacks (previously both
//     `errdefer this.deinit()` and `errdefer handlers.deinit()` unprotected the
//     same JSValues, tripping a debug assertion)
//   - free the heap-allocated `WindowsNamedPipeListeningContext` and close the
//     libuv pipe handle, so the event loop can drain and the process exits
describe.skipIf(!isWindows)("Bun.listen named-pipe error path", () => {
  test("failed listen on in-use pipe throws, cleans up, and does not hang", async () => {
    const src = /* js */ `
      const pipe = "\\\\\\\\.\\\\pipe\\\\bun-test-named-pipe-" + Math.random().toString(36).slice(2);

      const first = Bun.listen({
        unix: pipe,
        socket: { data() {}, open() {}, close() {}, error() {} },
      });

      let threw = false;
      try {
        Bun.listen({
          unix: pipe,
          socket: { data() {}, open() {}, close() {}, error() {} },
        });
      } catch (e) {
        threw = true;
        // The collision must surface as a Node-shaped system error, not a
        // generic TypeError: code/errno/syscall identify EADDRINUSE so
        // callers can react (retry another name) - and distinguish it from
        // EACCES (pipe namespace denied, e.g. sandboxed processes binding
        // outside \.\pipe\LOCAL\, where renaming never helps).
        if (e.code !== "EADDRINUSE") {
          console.error("expected code EADDRINUSE, got", e.code);
          process.exit(1);
        }
        if (e.errno !== -98) {
          console.error("expected errno -98, got", e.errno);
          process.exit(1);
        }
        if (e.syscall !== "listen") {
          console.error("expected syscall listen, got", e.syscall);
          process.exit(1);
        }
        if (e.path !== pipe) {
          console.error("expected path", pipe, "got", e.path);
          process.exit(1);
        }
      }

      first.stop(true);

      if (!threw) {
        console.error("expected second Bun.listen to throw");
        process.exit(1);
      }

      Bun.gc(true);
      console.log("OK");
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      // If the libuv pipe handle leaks, the event loop never drains and the
      // process hangs; bound it so we get a useful failure instead of a test
      // runner timeout.
      timeout: 15_000,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({
      stdout: stdout.trim(),
      stderr: stderr.trim(),
      exitCode,
      signalCode: proc.signalCode ?? null,
    }).toMatchObject({
      stdout: "OK",
      exitCode: 0,
      signalCode: null,
    });
  });
});

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

      let threw;
      try {
        Bun.listen({
          unix: pipe,
          socket: { data() {}, open() {}, close() {}, error() {} },
        });
      } catch (e) {
        threw = e;
      }

      first.stop(true);

      if (!threw) {
        console.error("expected second Bun.listen to throw");
        process.exit(1);
      }

      // The thrown error must match Node's 'listen EADDRINUSE' shape so
      // node:net can re-emit it on the 'error' event with the right code.
      const result = {
        code: threw.code,
        syscall: threw.syscall,
        address: threw.address,
        errnoType: typeof threw.errno,
      };
      console.log(JSON.stringify(result));

      Bun.gc(true);
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
      shape: JSON.parse(stdout.trim() || "null"),
      stderr: stderr.trim(),
      exitCode,
      signalCode: proc.signalCode ?? null,
    }).toEqual({
      shape: {
        code: "EADDRINUSE",
        syscall: "listen",
        address: expect.stringMatching(/^\\\\\.\\pipe\\bun-test-named-pipe-/),
        errnoType: "number",
      },
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // Regression test for https://github.com/oven-sh/bun/issues/30265 — a second
  // `net.createServer().listen(<named-pipe>)` against an already-owned pipe
  // used to panic with "Internal assertion failure" (Zig tagged-union partial
  // write in the errdefer cleanup path). After that was fixed, the error
  // arrived on `'error'` but as a generic `TypeError: Failed to listen at …`,
  // missing `.code`, `.errno`, `.syscall`, `.address`. Node delivers
  // `listen EADDRINUSE: address already in use <pipe>` with those fields;
  // this test locks that contract down.
  test("net.createServer().listen(pipe) emits 'error' with EADDRINUSE on busy pipe", async () => {
    const src = /* js */ `
      const { createServer } = require("node:net");
      const pipe = "\\\\\\\\.\\\\pipe\\\\bun-test-net-listen-" + Math.random().toString(36).slice(2);

      const first = createServer(() => {});
      first.on("error", err => {
        console.error("first listen errored:", err);
        process.exit(2);
      });
      first.listen(pipe, () => {
        const second = createServer(() => {});
        second.on("error", err => {
          const result = {
            code: err.code,
            syscall: err.syscall,
            address: err.address,
            errnoType: typeof err.errno,
            messageHasCode: err.message.includes("EADDRINUSE"),
            messageHasAddress: err.message.includes(pipe),
          };
          console.log(JSON.stringify(result));
          first.close();
        });
        second.listen(pipe);
      });
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({
      shape: JSON.parse(stdout.trim() || "null"),
      stderr: stderr.trim(),
      exitCode,
      signalCode: proc.signalCode ?? null,
    }).toEqual({
      shape: {
        code: "EADDRINUSE",
        syscall: "listen",
        address: expect.stringMatching(/^\\\\\.\\pipe\\bun-test-net-listen-/),
        errnoType: "number",
        messageHasCode: true,
        messageHasAddress: true,
      },
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // `normalizePipeName` accepts `//./pipe/`, `//?/pipe/`, `\\?\pipe\`, or any
  // mixed-slash variant — but internally rewrites to the canonical
  // `\\.\pipe\` form before handing off to libuv. Node's convention is that
  // `err.address` echoes the user's input verbatim, so the two must stay
  // decoupled: the uv bind call uses the canonical form, but the error
  // object (and its message) use whatever the user passed.
  test("error .address preserves the user's original pipe prefix form", async () => {
    const src = /* js */ `
      const forward = "//./pipe/bun-test-forward-slash-" + Math.random().toString(36).slice(2);

      const first = Bun.listen({
        unix: forward,
        socket: { data() {}, open() {}, close() {}, error() {} },
      });

      let threw;
      try {
        Bun.listen({
          unix: forward,
          socket: { data() {}, open() {}, close() {}, error() {} },
        });
      } catch (e) {
        threw = e;
      }

      first.stop(true);

      if (!threw) {
        console.error("expected second Bun.listen to throw");
        process.exit(1);
      }

      console.log(JSON.stringify({
        code: threw.code,
        address: threw.address,
        messageContainsForward: threw.message.includes(forward),
      }));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 15_000,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({
      shape: JSON.parse(stdout.trim() || "null"),
      stderr: stderr.trim(),
      exitCode,
      signalCode: proc.signalCode ?? null,
    }).toEqual({
      shape: {
        code: "EADDRINUSE",
        address: expect.stringMatching(/^\/\/\.\/pipe\/bun-test-forward-slash-/),
        messageContainsForward: true,
      },
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});

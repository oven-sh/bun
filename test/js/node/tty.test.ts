import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { WriteStream } from "node:tty";

describe("ReadStream.prototype.setRawMode", () => {
  // Regression: on Windows, the `fd === 0` branch returned early on success
  // without ever reaching `this.isRaw = flag`, so `process.stdin.isRaw` stayed
  // `false` after a successful `setRawMode(true)`. On POSIX this already
  // worked; the test runs on both to lock the behaviour in.
  test("updates isRaw on process.stdin after a successful call", async () => {
    let output = "";
    const decoder = new TextDecoder();
    const done = Promise.withResolvers<void>();
    const eof = Promise.withResolvers<void>();

    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          let err;
          process.stdin.on("error", e => (err = String(e)));
          const isTTY = process.stdin.isTTY;
          const before = process.stdin.isRaw;
          const ret = process.stdin.setRawMode(true);
          const afterTrue = process.stdin.isRaw;
          process.stdin.setRawMode(false);
          const afterFalse = process.stdin.isRaw;
          process.stdout.write(
            "RESULT " +
              JSON.stringify({
                isTTY,
                before,
                afterTrue,
                afterFalse,
                returnsThis: ret === process.stdin,
                ...(err ? { err } : {}),
              }),
          );
          process.exit(0);
        `,
      ],
      env: bunEnv,
      terminal: {
        // Wide enough that ConPTY does not hard-wrap the RESULT line.
        cols: 200,
        rows: 24,
        data(_t, chunk: Uint8Array) {
          output += decoder.decode(chunk, { stream: true });
          if (output.includes("RESULT ") && output.includes("}")) done.resolve();
        },
        exit() {
          eof.resolve();
        },
      },
    });

    await Promise.race([done.promise, eof.promise]);
    proc.kill();
    await proc.exited;
    proc.terminal?.close();
    output += decoder.decode();

    // ConPTY injects VT escape sequences and CR around the payload; strip
    // them so the RESULT JSON can be matched regardless of where the
    // terminal emulator decides to park the cursor.
    const stripped = Bun.stripANSI(output).replace(/[\r\n]/g, "");

    // Bun.Terminal always gives the child a TTY stdin (openpty / ConPTY). If
    // RESULT is missing for any reason, surface the raw terminal output
    // rather than a bare null match.
    const match = stripped.match(/RESULT (\{[^}]*\})/);
    if (!match) {
      throw new Error("child did not emit RESULT; terminal output was: " + JSON.stringify(output));
    }
    expect(JSON.parse(match[1])).toEqual({
      isTTY: true,
      before: false,
      afterTrue: true,
      afterFalse: false,
      returnsThis: true,
    });
  });

  // Regression (Windows): a synchronous `setRawMode(false); setRawMode(true)`
  // while a raw read is pending used to leave libuv's
  // UV_HANDLE_CANCELLATION_PENDING stuck on the stdin tty. On the *next*
  // `setRawMode(false)` → (yield) → `setRawMode(true)` cycle — where the
  // yield lets a cooked ReadConsoleW actually get queued — `uv__tty_read_stop`
  // saw the stale flag, skipped `uv__cancel_read_console`, and the worker
  // thread stayed blocked in ReadConsoleW: the next raw keystroke was
  // consumed by that read, dispatched through uv_process_tty_read_line_req,
  // and dropped on the floor because CANCELLATION_PENDING was set. Seen in
  // the wild as frozen-until-Enter / lost keystrokes after Ink App
  // unmount/remount.
  //
  // On POSIX there is no reader thread and no line-read work item; termios
  // mode changes take effect immediately on the same fd, so the sequence is
  // a no-op there. The test still runs on POSIX to lock the behaviour in.
  test("setRawMode(true) cancels a pending cooked read after a prior synchronous false/true bounce", async () => {
    let output = "";
    const decoder = new TextDecoder();
    const ready = Promise.withResolvers<void>();
    const gotKey = Promise.withResolvers<void>();
    const eof = Promise.withResolvers<void>();

    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const tick = () => new Promise(r => setImmediate(r));
          let armed = false;
          process.stdin.setRawMode(true);
          process.stdin.on("data", d => {
            if (!armed) return; // ignore noise (FOCUS_EVENT echoes etc.) before READY
            process.stdout.write("KEY " + JSON.stringify([...d]));
            process.exit(0);
          });
          (async () => {
            // Let the raw read arm (RegisterWaitForSingleObject on Windows).
            await tick();
            // First cycle, synchronous: both mode switches happen before the
            // loop can process the raw-read completion. Before the fix this
            // misroutes uv__tty_read_stop down the line-read path against a
            // raw request, setting UV_HANDLE_CANCELLATION_PENDING on the
            // stdin tty with nothing to ever clear it.
            process.stdin.setRawMode(false);
            process.stdin.setRawMode(true);
            await tick();
            // Second cycle: drop to cooked, then yield enough event-loop
            // turns for libuv to process the raw-read completion, queue a
            // line read (QueueUserWorkItem), and for the threadpool to pick
            // it up and commit to ReadConsoleW.
            process.stdin.setRawMode(false);
            for (let i = 0; i < 20; i++) await tick();
            // Before the fix, UV_HANDLE_CANCELLATION_PENDING is still set
            // here so uv__tty_read_stop skips uv__cancel_read_console and
            // the in-flight ReadConsoleW is never cancelled.
            process.stdin.setRawMode(true);
            armed = true;
            process.stdout.write("READY");
          })();
        `,
      ],
      env: bunEnv,
      terminal: {
        // Wide enough that ConPTY does not hard-wrap the KEY line.
        cols: 200,
        rows: 24,
        data(_t, chunk: Uint8Array) {
          output += decoder.decode(chunk, { stream: true });
          if (output.includes("READY")) ready.resolve();
          if (/KEY \[[^\]]*\]/.test(Bun.stripANSI(output))) gotKey.resolve();
        },
        exit() {
          eof.resolve();
        },
      },
    });

    // Wait until the child has re-armed raw mode after the double bounce.
    await Promise.race([ready.promise, eof.promise]);

    // Send a single keystroke — no Enter. Before the fix this was swallowed
    // by the uncancelled cooked ReadConsoleW (consumed and then dropped by
    // uv_process_tty_read_line_req because CANCELLATION_PENDING was set).
    proc.terminal!.write("x");

    // Sentinel so the failure mode is a clean assertion rather than a hang:
    // give the 'x' a generous number of loop turns to propagate through
    // ConPTY and the child's raw read, then send a second keystroke. If the
    // first one was lost (the bug), the raw read has since been re-armed by
    // the line-req completion and the child receives the sentinel instead —
    // failing the toContain('x') assertion with useful output.
    for (let i = 0; i < 50; i++) {
      if (/KEY \[[^\]]*\]/.test(Bun.stripANSI(output))) break;
      await new Promise(r => setImmediate(r));
    }
    if (!/KEY \[[^\]]*\]/.test(Bun.stripANSI(output))) {
      proc.terminal!.write("z");
    }

    await Promise.race([gotKey.promise, eof.promise]);
    proc.kill();
    await proc.exited;
    proc.terminal?.close();
    output += decoder.decode();

    const stripped = Bun.stripANSI(output).replace(/[\r\n]/g, "");
    const match = stripped.match(/KEY (\[[^\]]*\])/);
    if (!match) {
      throw new Error("child never received a keystroke in raw mode; terminal output was: " + JSON.stringify(output));
    }
    // The essential property is that the child's data handler fired for the
    // first bare keystroke after re-entering raw mode — i.e. it was not
    // swallowed by a stuck cooked ReadConsoleW. ConPTY may tack VT bytes
    // around the payload and POSIX PTYs may translate, so just assert 'x'
    // is present somewhere in the first chunk the child received.
    const bytes = JSON.parse(match[1]);
    expect(bytes).toContain("x".charCodeAt(0));
  });
});

describe("WriteStream.prototype.getColorDepth", () => {
  it("iTerm ancient", () => {
    expect(
      WriteStream.prototype.getColorDepth.call(undefined, {
        TERM_PROGRAM: "iTerm.app",
      }),
    ).toBe(isWindows ? 24 : 8);
  });

  it("iTerm modern", () => {
    expect(
      WriteStream.prototype.getColorDepth.call(undefined, {
        TERM_PROGRAM: "iTerm.app",
        TERM_PROGRAM_VERSION: 3,
      }),
    ).toBe(24);
  });

  it("empty", () => {
    expect(WriteStream.prototype.getColorDepth.call(undefined, {})).toBe(isWindows ? 24 : 1);
  });
});

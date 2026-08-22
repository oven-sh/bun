import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import os from "node:os";
import { WriteStream } from "node:tty";

// ConPTY on Windows 10 1809 / Server 2019 (build 17763) is the original v1
// implementation. It does not reliably propagate raw single-byte input to
// the child after the console mode has been bounced between cooked and raw
// — the child's stdin tty can error and its event loop drain under that
// sequence. The cancel-cooked-read test below exercises exactly that path,
// so skip it on pre-19041 (20H1) Windows where ConPTY got its first major
// input-handling overhaul. The libuv fix itself still ships for those
// builds; only the ConPTY-backed regression harness cannot observe it.
const windowsBuild = isWindows ? Number(os.release().split(".")[2] ?? 0) : 0;
const isConPTYv1 = isWindows && windowsBuild > 0 && windowsBuild < 19041;

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

  // Raw mode is per-stream in libuv (each uv_tty_t holds its own mode and its
  // own saved termios), so a second tty.ReadStream on the same fd must not be
  // able to restore the terminal out from under the stream that raw'd it.
  // Bun used to keep one process-wide mode + termios snapshot, which turned
  // `setRawMode(false)` on a never-raw stream into a real tcsetattr.
  test.skipIf(isWindows)("a second ReadStream's setRawMode does not disturb process.stdin", async () => {
    const ICANON = process.platform === "darwin" ? 0x100 : 0x2;
    const ECHO = 0x8;

    const decoder = new TextDecoder();
    let buffer = "";
    const waiters: { marker: string; resolve: () => void }[] = [];

    await using terminal = new Bun.Terminal({
      data(_terminal, chunk: Uint8Array) {
        buffer += decoder.decode(chunk, { stream: true });
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (buffer.includes(waiters[i].marker)) {
            waiters[i].resolve();
            waiters.splice(i, 1);
          }
        }
      },
    });

    const isRaw = () => (terminal.localFlags & (ICANON | ECHO)) === 0;
    const observed: Record<string, boolean> = { beforeSpawn: isRaw() };

    // Each phase announces itself, then blocks on stdin so the parent can read
    // termios while the child is still alive, and releases on the ack byte.
    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const tty = require("node:tty");
          const { TTY } = process.binding("tty_wrap");
          const say = s => process.stdout.write(s + "\\n");
          const ack = () => new Promise(resolve => process.stdin.once("data", () => resolve()));
          (async () => {
            process.stdin.resume();
            process.stdin.setRawMode(true);
            say("P1"); await ack();

            const second = new tty.ReadStream(0);
            second.setRawMode(false); // never raw: must be a no-op
            say("P2"); await ack();

            second.setRawMode(true);
            second.setRawMode(false); // restores its own snapshot, which was already raw
            say("P3"); await ack();

            new TTY(0).setRawMode(0); // same, through the tty_wrap binding
            say("P4"); await ack();

            process.stdin.setRawMode(false); // the stream that raw'd it restores cooked
            say("P5"); await ack();
            process.exit(0);
          })();
        `,
      ],
      env: bunEnv,
      terminal,
    });

    // A child that dies early must reject the phase waits rather than hang them.
    const exitedEarly = proc.exited.then(code => {
      throw new Error(`child exited early with code ${code}; terminal output: ${JSON.stringify(buffer)}`);
    });
    exitedEarly.catch(() => {});

    const phase = (marker: string) => {
      const seen = buffer.includes(marker)
        ? Promise.resolve()
        : new Promise<void>(resolve => waiters.push({ marker, resolve }));
      return Promise.race([seen, exitedEarly]);
    };

    await phase("P1");
    observed.afterStdinRaw = isRaw();
    terminal.write("\n");

    await phase("P2");
    observed.afterSecondStreamCooked = isRaw();
    terminal.write("\n");

    await phase("P3");
    observed.afterSecondStreamRoundTrip = isRaw();
    terminal.write("\n");

    await phase("P4");
    observed.afterTTYWrapCooked = isRaw();
    terminal.write("\n");

    await phase("P5");
    observed.afterStdinCooked = isRaw();
    terminal.write("\n");

    expect(observed).toEqual({
      beforeSpawn: false,
      afterStdinRaw: true,
      afterSecondStreamCooked: true,
      afterSecondStreamRoundTrip: true,
      afterTTYWrapCooked: true,
      afterStdinCooked: false,
    });
    expect(await proc.exited).toBe(0);
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
  //
  // Skipped on ConPTY v1 (Windows Server 2019 / 1809) — see isConPTYv1 above.
  test.skipIf(isConPTYv1)(
    "setRawMode(true) cancels a pending cooked read after a prior synchronous false/true bounce",
    async () => {
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
          // Keepalive: an stdin-reader error after the mode bounce must not
          // drain the event loop before the diagnostics below reach the
          // parent. The interval never fires; it is purely a ref'd handle.
          const keepalive = setInterval(() => {}, 1 << 30);
          process.stdin.on("error", e => process.stdout.write("STDIN_ERR " + String(e) + " "));
          process.on("uncaughtException", e => {
            process.stdout.write("UNCAUGHT " + String(e) + " ");
            process.exit(1);
          });
          process.stdin.setRawMode(true);
          process.stdin.on("data", d => {
            if (!armed) return; // ignore noise (FOCUS_EVENT echoes etc.) before READY
            process.stdout.write("KEY " + JSON.stringify([...d]));
            clearInterval(keepalive);
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
    },
  );
});

describe("WriteStream.prototype.getColorDepth", () => {
  const getColorDepth = (env: Record<string, string>) => WriteStream.prototype.getColorDepth.call(undefined, env);

  // Expected values come from running the same env objects through Node
  // v26.3.0. On Windows the OS build number decides instead of TERM/CI/
  // COLORTERM, so the env matrix is only meaningful on POSIX.
  const cases: [env: Record<string, string>, depth: number][] = [
    [{ TERM: "dumb" }, 1],
    [{ TERM: "dumb", COLORTERM: "truecolor" }, 1],
    [{ NO_COLOR: "1", COLORTERM: "24bit" }, 1],
    [{ NO_COLOR: "", COLORTERM: "24bit" }, 24],
    [{ NO_COLOR: "", TERM: "xterm-256color" }, 8],
    [{ NODE_DISABLE_COLORS: "1", TERM: "color" }, 1],
    [{ NODE_DISABLE_COLORS: "", TERM: "xterm" }, 4],
    [{ FORCE_COLOR: "" }, 4],
    [{ FORCE_COLOR: "1" }, 4],
    [{ FORCE_COLOR: "true" }, 4],
    [{ FORCE_COLOR: "2" }, 8],
    [{ FORCE_COLOR: "3" }, 24],
    [{ FORCE_COLOR: "0" }, 1],
    [{ FORCE_COLOR: "junk" }, 1],
    [{ NO_COLOR: "1", FORCE_COLOR: "2" }, 8],
    [{ NODE_DISABLE_COLORS: "1", FORCE_COLOR: "3" }, 24],
    [{ COLORTERM: "24bit", FORCE_COLOR: "" }, 4],
    [{ TMUX: "1" }, 24],
    [{ TMUX: "1", COLORTERM: "truecolor" }, 24],
    [{ TMUX: "1", TERM: "tmux-256color" }, 24],
    [{ TF_BUILD: "1", AGENT_NAME: "x" }, 4],
    [{ TF_BUILD: "1" }, 1],
    [{ CI: "1" }, 1],
    [{ CI: "" }, 1],
    [{ CI: "1", APPVEYOR: "1" }, 8],
    [{ CI: "1", BUILDKITE: "1" }, 8],
    [{ CI: "1", CIRCLECI: "1" }, 24],
    [{ CI: "1", DRONE: "1" }, 8],
    [{ CI: "1", GITEA_ACTIONS: "1" }, 24],
    [{ CI: "1", GITHUB_ACTIONS: "1" }, 24],
    [{ CI: "1", GITLAB_CI: "1" }, 8],
    [{ CI: "1", TRAVIS: "1" }, 8],
    [{ CI: "1", CI_NAME: "codeship" }, 8],
    [{ TEAMCITY_VERSION: "9.0.5 (build 32523)" }, 1],
    [{ TEAMCITY_VERSION: "9.1.0 (build 32523)" }, 4],
    [{ TERM_PROGRAM: "iTerm.app" }, 8],
    [{ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "2.1" }, 8],
    [{ TERM_PROGRAM: "iTerm.app", TERM_PROGRAM_VERSION: "3.2" }, 24],
    [{ TERM_PROGRAM: "HyperTerm" }, 24],
    [{ TERM_PROGRAM: "MacTerm" }, 24],
    [{ TERM_PROGRAM: "Apple_Terminal" }, 8],
    [{ COLORTERM: "truecolor" }, 24],
    [{ COLORTERM: "24bit" }, 24],
    [{ COLORTERM: "1" }, 4],
    [{ TERM: "xterm" }, 4],
    [{ TERM: "xterm", COLORTERM: "truecolor" }, 24],
    [{ TERM: "xterm-256" }, 8],
    [{ TERM: "xterm-256color" }, 8],
    [{ TERM: "xterm-kitty" }, 24],
    [{ TERM: "xterm-direct" }, 4],
    [{ TERM: "screen.xterm-truecolor" }, 24],
    [{ TERM: "rxvt-unicode-24bit" }, 24],
    [{ TERM: "rxvt" }, 4],
    [{ TERM: "vt100" }, 4],
    [{ TERM: "vt220" }, 4],
    [{ TERM: "konsole" }, 4],
    [{ TERM: "KONSOLE" }, 4],
    [{ TERM: "mosh" }, 24],
    [{ TERM: "terminator" }, 24],
    [{ TERM: "st" }, 4],
    [{ TERM: "linux" }, 4],
    [{ TERM: "ansi" }, 4],
    [{ TERM: "ANSI" }, 4],
    [{ TERM: "color" }, 4],
    [{ TERM: "con132x25" }, 4],
    [{ TERM: "fail" }, 1],
    [{ TERM: "" }, 1],
    [{ COLORTERM: "ansi256" }, 4],
  ];

  it.skipIf(isWindows)("matches Node across the TERM/COLORTERM/CI env matrix", () => {
    const results = cases.map(([env, expected]) => ({ env, expected, actual: getColorDepth(env) }));
    expect(results.filter(r => r.actual !== r.expected)).toEqual([]);
  });

  // Bun recognizes these truecolor terminals on top of Node's list.
  it.skipIf(isWindows)("reports 24-bit color for ghostty and WezTerm", () => {
    expect(getColorDepth({ TERM_PROGRAM: "ghostty" })).toBe(24);
    expect(getColorDepth({ TERM_PROGRAM: "WezTerm" })).toBe(24);
  });

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

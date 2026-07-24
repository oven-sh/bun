// Explicit per-platform behavioral assertions for Bun.Terminal.
//
// Each test probes one dimension and asserts the platform-specific expected
// result, so this file doubles as a living spec of where POSIX (openpty +
// termios line discipline) and Windows (ConPTY) diverge.
//
// "GAP" tests assert different results per platform.
// "SAME" tests assert identical behaviour and exist to lock that in.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

/** Spawn a child attached to a fresh terminal, collect all PTY output until
 *  `done()` returns true or the child exits, then close the terminal.
 *
 *  On POSIX the child becomes the session leader with the PTY as its
 *  controlling terminal (setsid + TIOCSCTTY) whether the terminal is created
 *  inline by the spawn or passed as a pre-constructed `Bun.Terminal`; set
 *  `existing: true` to exercise the latter (oven-sh/bun#33237). */
async function runInTerminal(
  childScript: string,
  opts: {
    cols?: number;
    rows?: number;
    existing?: boolean;
    done: (output: string) => boolean;
    afterReady?: (terminal: Bun.Terminal, output: () => string) => void | Promise<void>;
    readyMarker?: string;
  },
): Promise<{ output: string; exitCode: number | null }> {
  let output = "";
  const ready = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  const eof = Promise.withResolvers<void>();
  const readyMarker = opts.readyMarker ?? "READY";
  const decoder = new TextDecoder();

  const terminalOptions: Bun.TerminalOptions = {
    cols: opts.cols ?? 80,
    rows: opts.rows ?? 24,
    data(_t, chunk: Uint8Array) {
      output += decoder.decode(chunk, { stream: true });
      if (output.includes(readyMarker)) ready.resolve();
      if (opts.done(output)) finished.resolve();
    },
    exit() {
      eof.resolve();
    },
  };

  const proc = Bun.spawn({
    cmd: [bunExe(), "-e", childScript],
    env: bunEnv,
    terminal: opts.existing ? new Bun.Terminal(terminalOptions) : terminalOptions,
  });

  if (opts.afterReady) {
    await Promise.race([ready.promise, eof.promise]);
    if (!proc.terminal!.closed) await opts.afterReady(proc.terminal!, () => output);
  }

  // Wait for the data condition or for the terminal to receive EOF (which
  // fires after all buffered data has been delivered). Do not race on
  // proc.exited: on Windows the exit IOCP and the final pipe-data IOCP are
  // independent and closing the terminal after the former drops the latter.
  await Promise.race([finished.promise, eof.promise]);
  // Kill before closing the terminal so ClosePseudoConsole on older Windows
  // doesn't have to wait on a still-running client.
  proc.kill();
  await proc.exited;
  proc.terminal?.close();
  output += decoder.decode();
  return { output, exitCode: proc.exitCode };
}

describe("Bun.Terminal platform behaviour", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // termios
  // ──────────────────────────────────────────────────────────────────────────

  test("GAP: termios flag accessors", async () => {
    await using terminal = new Bun.Terminal({});
    if (isWindows) {
      // ConPTY has no termios; accessors are stubbed to 0 and setters are no-ops.
      expect(terminal.inputFlags).toBe(0);
      expect(terminal.outputFlags).toBe(0);
      expect(terminal.localFlags).toBe(0);
      expect(terminal.controlFlags).toBe(0);
      terminal.localFlags = 0xff;
      expect(terminal.localFlags).toBe(0);
    } else {
      // POSIX openpty + tcgetattr returns real flag words.
      expect(terminal.localFlags).toBeGreaterThan(0);
      expect(terminal.outputFlags).toBeGreaterThan(0);
    }
  });

  test("GAP: line-discipline echo without a child process", async () => {
    let output = "";
    const got = Promise.withResolvers<void>();
    await using terminal = new Bun.Terminal({
      data(_t, chunk) {
        output += Buffer.from(chunk).toString("latin1");
        got.resolve();
      },
    });
    // POSIX: enable ECHO so the line discipline reflects writes back.
    if (!isWindows) terminal.localFlags = terminal.localFlags | 0x8;
    terminal.write("ping\n");
    await Promise.race([got.promise, Bun.sleep(200)]);

    if (isWindows) {
      // ConPTY emits its VT init sequence on creation; "ping" is buffered as
      // input awaiting a reader and never echoed.
      expect(output).not.toContain("ping");
    } else {
      expect(output).toContain("ping");
    }
  });

  test("GAP: setRawMode is a no-op on Windows", async () => {
    await using terminal = new Bun.Terminal({});
    // Neither platform throws; on POSIX it actually flips termios, on Windows
    // it just records the flag.
    expect(() => terminal.setRawMode(true)).not.toThrow();
    expect(() => terminal.setRawMode(false)).not.toThrow();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // child environment
  // ──────────────────────────────────────────────────────────────────────────

  test("SAME: child sees a TTY on all three std streams", async () => {
    const { output } = await runInTerminal(
      `process.stdout.write('READY in=' + process.stdin.isTTY + ' out=' + process.stdout.isTTY + ' err=' + process.stderr.isTTY)`,
      { done: o => o.includes("err=") },
    );
    expect(output).toContain("in=true");
    expect(output).toContain("out=true");
    expect(output).toContain("err=true");
  });

  test("SAME: child sees the configured terminal dimensions", async () => {
    const { output } = await runInTerminal(
      `process.stdout.write('READY cols=' + process.stdout.columns + ' rows=' + process.stdout.rows)`,
      { cols: 87, rows: 19, done: o => o.includes("rows=") },
    );
    expect(output).toContain("cols=87");
    expect(output).toContain("rows=19");
  });

  // POSIX only: /dev/tty (the controlling terminal) has no Windows equivalent,
  // so these are skipped rather than todo'd there. The child opens /dev/tty
  // and writes a marker; that marker only reaches the PTY's data callback if
  // the PTY is the child's controlling terminal (setsid + TIOCSCTTY). Before
  // https://github.com/oven-sh/bun/issues/33237 an existing-Terminal child
  // kept the parent's controlling terminal (or none), so the open failed with
  // ENXIO or the write went to the wrong tty.
  const DEV_TTY_CHILD = `
    const fs = require("fs");
    process.stdout.write("READY");
    let r;
    try { fs.writeSync(fs.openSync("/dev/tty", "w"), "VIA_DEV_TTY"); r = "ok"; }
    catch (e) { r = String(e.code || e); }
    process.stdout.write(" DONE:" + r);`;

  test.skipIf(isWindows)("POSIX: /dev/tty inside the child is the PTY (inline terminal)", async () => {
    const { output } = await runInTerminal(DEV_TTY_CHILD, { done: o => o.includes("DONE:") });
    expect(output).toContain("VIA_DEV_TTY");
    expect(output).toContain("DONE:ok");
  });

  test.skipIf(isWindows)("POSIX: /dev/tty inside the child is the PTY (existing Terminal)", async () => {
    const { output } = await runInTerminal(DEV_TTY_CHILD, {
      existing: true,
      done: o => o.includes("DONE:"),
    });
    expect(output).toContain("VIA_DEV_TTY");
    expect(output).toContain("DONE:ok");
  });

  // (Bun.Terminal stores `name` but does not inject TERM= into the child env
  // on either platform; that's inheritance from the caller's env, not a gap.)

  // ──────────────────────────────────────────────────────────────────────────
  // input → child
  // ──────────────────────────────────────────────────────────────────────────

  test("SAME: terminal.write reaches child stdin", async () => {
    const { output } = await runInTerminal(
      `process.stdout.write('READY');
       process.stdin.setEncoding('utf8');
       process.stdin.on('data', d => process.stdout.write('GOT:' + d));`,
      {
        done: o => o.includes("GOT:hello"),
        afterReady: t => void t.write("hello\r"),
      },
    );
    expect(output).toContain("GOT:hello");
  });

  test("GAP: input CR/LF translation", async () => {
    // POSIX ICRNL maps CR (\r) → LF (\n) on input. ConPTY passes \r through.
    const { output } = await runInTerminal(
      `process.stdout.write('READY');
       process.stdin.setEncoding('utf8');
       process.stdin.on('data', d => process.stdout.write('HEX:' + Buffer.from(d).toString('hex')));`,
      {
        done: o => o.includes("HEX:"),
        afterReady: t => void t.write("\r"),
      },
    );
    if (isWindows) {
      expect(output).toContain("HEX:0d"); // \r unchanged
    } else {
      expect(output).toContain("HEX:0a"); // \r → \n
    }
  });

  // System conhost's ConPTY does not translate \x03 input to CTRL_C_EVENT.
  test.todoIf(isWindows)("SAME: Ctrl+C input interrupts the child", async () => {
    const { output } = await runInTerminal(
      `process.on('SIGINT', () => { process.stdout.write('SIGINT'); process.exit(0); });
       setInterval(() => {}, 1000);
       process.stdout.write('READY');`,
      {
        done: o => o.includes("SIGINT"),
        afterReady: t => void t.write("\x03"),
      },
    );
    expect(output).toContain("SIGINT");
  });

  // https://github.com/oven-sh/bun/issues/33237: a pre-constructed Bun.Terminal
  // must also become the child's controlling terminal, or the line discipline
  // has no foreground process group to deliver SIGINT to and \x03 is only echoed.
  test.todoIf(isWindows)("SAME: Ctrl+C input interrupts a child on an existing Terminal", async () => {
    const { output } = await runInTerminal(
      `process.on('SIGINT', () => { process.stdout.write('SIGINT'); process.exit(0); });
       setInterval(() => {}, 1000);
       process.stdout.write('READY');`,
      {
        existing: true,
        done: o => o.includes("SIGINT"),
        afterReady: t => void t.write("\x03"),
      },
    );
    expect(output).toContain("SIGINT");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // output ← child
  // ──────────────────────────────────────────────────────────────────────────

  test("SAME: child stdout reaches data callback", async () => {
    const { output } = await runInTerminal(`process.stdout.write('READY hello-from-child')`, {
      done: o => o.includes("hello-from-child"),
    });
    expect(output).toContain("hello-from-child");
  });

  test("SAME: child stderr reaches data callback", async () => {
    const { output } = await runInTerminal(`process.stderr.write('on-stderr', () => process.stdout.write('READY'))`, {
      done: o => o.includes("READY"),
    });
    expect(output).toContain("on-stderr");
  });

  test("SAME: output LF is translated to CRLF", async () => {
    // POSIX ONLCR and ConPTY both render \n as \r\n on the master/read side.
    // Older ConPTY may pad to the cell boundary with spaces before \r\n.
    const { output } = await runInTerminal(`process.stdout.write('READY\\nLINE2')`, {
      done: o => o.includes("LINE2"),
    });
    expect(output).toMatch(/READY *\r\n/);
  });

  test("GAP: ANSI escape sequences", async () => {
    const { output } = await runInTerminal(`process.stdout.write('READY \\x1b[31mRED\\x1b[0m')`, {
      done: o => o.includes("RED"),
    });
    // The colour and text are preserved on both platforms; ConPTY re-encodes
    // the stream (it renders to a virtual screen and emits whatever sequences
    // describe the diff), so the byte sequence is not identical.
    expect(output).toContain("RED");
    expect(output).toMatch(/\x1b\[(?:\d+;)*31m/);
    if (!isWindows) {
      expect(output).toContain("\x1b[31mRED\x1b[0m");
    }
  });

  test("SAME: UTF-8 multibyte characters reach the data callback", async () => {
    // ConPTY may alter spacing around wide-cell characters when re-rendering,
    // so assert the codepoints individually rather than the exact run.
    const { output } = await runInTerminal(`process.stdout.write('READY héllo 🍔 世界')`, {
      done: o => o.includes("世界"),
    });
    expect(output).toContain("héllo");
    expect(output).toContain("🍔");
    expect(output).toContain("世界");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // resize
  // ──────────────────────────────────────────────────────────────────────────

  // libuv's SIGWINCH detection on Windows requires a conhost window; ConPTY has none.
  test.todoIf(isWindows)("SAME: resize while child is running fires SIGWINCH in child", async () => {
    const { output } = await runInTerminal(
      `process.on('SIGWINCH', () => setImmediate(() => {
         process.stdout.write('WINCH cols=' + process.stdout.columns + ' rows=' + process.stdout.rows);
         process.exit(0);
       }));
       setInterval(() => {}, 1000);
       process.stdout.write('READY');`,
      {
        cols: 80,
        rows: 24,
        done: o => o.includes("WINCH"),
        afterReady: t => void t.resize(133, 41),
      },
    );
    expect(output).toContain("cols=133");
    expect(output).toContain("rows=41");
  });

  test("SAME: child can observe resize by re-querying window size", async () => {
    // SIGWINCH does not fire under ConPTY (see above), so the cached
    // process.stdout.columns is stale. But the underlying syscall
    // (TIOCGWINSZ / GetConsoleScreenBufferInfo) returns the new size, so an
    // explicit refresh works on both platforms.
    const { output } = await runInTerminal(
      `let done = false;
       setInterval(() => {
         process.stdout._refreshSize();
         if (!done && process.stdout.columns === 133) {
           done = true;
           process.stdout.write('SAW cols=' + process.stdout.columns + ' rows=' + process.stdout.rows);
         }
       }, 50);
       process.stdout.write('READY');`,
      {
        cols: 80,
        rows: 24,
        done: o => o.includes("SAW cols="),
        afterReady: t => void t.resize(133, 41),
      },
    );
    expect(output).toContain("cols=133");
    expect(output).toContain("rows=41");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  test("SAME: exit callback fires after child exits (inline terminal)", async () => {
    // Inline terminal: spawn creates it and closes the parent's slave_fd copy
    // (POSIX) / closes ConPTY on subprocess exit (Windows), so child exit → EOF.
    const exitFired = Promise.withResolvers<void>();
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", ""],
      env: bunEnv,
      terminal: {
        exit() {
          exitFired.resolve();
        },
      },
    });
    await proc.exited;
    await exitFired.promise;
    expect(proc.terminal).toBeDefined();
  });

  test("SAME: exit callback does NOT fire on child exit for existing terminal", async () => {
    // Existing terminal: caller manages lifecycle and may reuse it, so child
    // exit must not tear it down on either platform.
    let fired = false;
    const terminal = new Bun.Terminal({
      exit() {
        fired = true;
      },
    });
    const proc = Bun.spawn({ cmd: [bunExe(), "-e", ""], env: bunEnv, terminal });
    await proc.exited;
    await Bun.sleep(100);
    expect(fired).toBe(false);
    terminal.close();
  });

  // Companion to the test above: the exit callback that a child's exit must NOT
  // fire must still fire on close(). On macOS/BSD the session leader's exit
  // revokes the pts and finishes the master reader early; the exit callback is
  // deferred through that, not lost (https://github.com/oven-sh/bun/issues/33237).
  test("SAME: exit callback fires on close() after an existing terminal's child exited", async () => {
    const exitFired = Promise.withResolvers<void>();
    const terminal = new Bun.Terminal({
      exit() {
        exitFired.resolve();
      },
    });
    const proc = Bun.spawn({ cmd: [bunExe(), "-e", ""], env: bunEnv, terminal });
    await proc.exited;
    terminal.close();
    await exitFired.promise;
  });

  test("SAME: terminal can be reused across sequential spawns", async () => {
    let output = "";
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const terminal = new Bun.Terminal({
      data(_t, chunk) {
        output += Buffer.from(chunk).toString("latin1");
        if (output.includes("FIRST")) first.resolve();
        if (output.includes("SECOND")) second.resolve();
      },
    });

    const p1 = Bun.spawn({ cmd: [bunExe(), "-e", "process.stdout.write('FIRST')"], env: bunEnv, terminal });
    await first.promise;
    await p1.exited;

    const p2 = Bun.spawn({ cmd: [bunExe(), "-e", "process.stdout.write('SECOND')"], env: bunEnv, terminal });
    await second.promise;
    await p2.exited;

    terminal.close();
    expect(output).toContain("FIRST");
    expect(output).toContain("SECOND");
  });

  // https://github.com/oven-sh/bun/issues/33237: sequential children on a
  // reused Terminal must each get the PTY as their controlling terminal. On
  // macOS/BSD the first session leader's exit revokes every fd on the pts, so
  // the Terminal must transparently re-acquire a live slave (and re-arm its
  // master reader) before the second spawn. POSIX only: /dev/tty has no
  // Windows equivalent.
  test.skipIf(isWindows)("POSIX: sequential children on a reused Terminal each get it as the ctty", async () => {
    let output = "";
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const terminal = new Bun.Terminal({
      data(_t, chunk) {
        output += Buffer.from(chunk).toString("latin1");
        if (output.includes("DONE1:")) first.resolve();
        if (output.includes("DONE2:")) second.resolve();
      },
    });
    // Writes a marker to /dev/tty (only visible on the PTY when it is the
    // child's ctty), then always reports DONE on stdout so the test never hangs.
    const writeToDevTty = (n: number) =>
      `const fs = require("fs");
       let r;
       try { fs.writeSync(fs.openSync("/dev/tty", "w"), "CTTY:${n} "); r = "ok"; }
       catch (e) { r = String(e.code || e); }
       process.stdout.write("DONE${n}:" + r + " ");`;

    try {
      const p1 = Bun.spawn({ cmd: [bunExe(), "-e", writeToDevTty(1)], env: bunEnv, terminal });
      await first.promise;
      await p1.exited;

      const p2 = Bun.spawn({ cmd: [bunExe(), "-e", writeToDevTty(2)], env: bunEnv, terminal });
      await second.promise;
      await p2.exited;
    } finally {
      terminal.close();
    }
    expect(output).toContain("CTTY:1");
    expect(output).toContain("CTTY:2");
    expect(output).toContain("DONE1:ok");
    expect(output).toContain("DONE2:ok");
  });

  // ClosePseudoConsole on Windows < 11 24H2 may not terminate a still-running
  // client promptly even when dispatched off-thread; kill the child first if
  // tearing down with one attached on those versions.
  test.todoIf(isWindows)(
    "SAME: closing an inline terminal while a child is attached terminates the child",
    async () => {
      let output = "";
      const ready = Promise.withResolvers<void>();
      const proc = Bun.spawn({
        cmd: [bunExe(), "-e", "setInterval(() => {}, 1000); process.stdout.write('READY')"],
        env: bunEnv,
        terminal: {
          data(_t, chunk: Uint8Array) {
            output += Buffer.from(chunk).toString("latin1");
            if (output.includes("READY")) ready.resolve();
          },
        },
      });
      await ready.promise;
      proc.terminal!.close();
      const exitCode = await proc.exited;
      // POSIX: SIGHUP to session. Windows: ConPTY terminates attached clients.
      expect(exitCode).not.toBe(0);
    },
  );
});

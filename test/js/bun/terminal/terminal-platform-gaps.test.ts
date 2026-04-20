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

const decoder = new TextDecoder();

/** Spawn a child attached to a fresh terminal, collect all PTY output until
 *  `done()` returns true or the child exits, then close the terminal. */
async function runInTerminal(
  childScript: string,
  opts: {
    cols?: number;
    rows?: number;
    done: (output: string) => boolean;
    afterReady?: (terminal: Bun.Terminal, output: () => string) => void | Promise<void>;
    readyMarker?: string;
  },
): Promise<{ output: string; exitCode: number | null }> {
  let output = "";
  const ready = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  const readyMarker = opts.readyMarker ?? "READY";

  // Use an inline terminal so the child becomes the session leader on POSIX
  // (setsid + TIOCSCTTY), which is required for SIGINT/SIGWINCH delivery.
  const proc = Bun.spawn({
    cmd: [bunExe(), "-e", childScript],
    env: bunEnv,
    terminal: {
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      data(_t, chunk: Uint8Array) {
        output += decoder.decode(chunk);
        if (output.includes(readyMarker)) ready.resolve();
        if (opts.done(output)) finished.resolve();
      },
    },
  });

  if (opts.afterReady) {
    await Promise.race([ready.promise, proc.exited]);
    await opts.afterReady(proc.terminal!, () => output);
  }

  await Promise.race([finished.promise, proc.exited.then(() => finished.resolve())]);
  proc.terminal?.close();
  await proc.exited;
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
        output += decoder.decode(chunk);
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

  // (Bun.Terminal stores `name` but does not inject TERM= into the child env
  // on either platform; that's inheritance from the caller's env, not a gap.)

  // ──────────────────────────────────────────────────────────────────────────
  // input → child
  // ──────────────────────────────────────────────────────────────────────────

  test("SAME: terminal.write reaches child stdin", async () => {
    const { output } = await runInTerminal(
      `process.stdout.write('READY');
       process.stdin.setEncoding('utf8');
       process.stdin.on('data', d => { process.stdout.write('GOT:' + d); process.exit(0); });`,
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
       process.stdin.on('data', d => {
         process.stdout.write('HEX:' + Buffer.from(d).toString('hex'));
         process.exit(0);
       });`,
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

  // On Windows, writing \x03 to ConPTY input does not currently reach a Bun
  // child's process.on('SIGINT') — Bun installs its own console-ctrl handler
  // (Bun__setCTRLHandler) and the interaction with ConPTY's CTRL_C_EVENT path
  // needs separate investigation. Works on POSIX via the line discipline.
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
    const { output } = await runInTerminal(`process.stdout.write('READY'); process.stderr.write('on-stderr')`, {
      done: o => o.includes("on-stderr"),
    });
    expect(output).toContain("on-stderr");
  });

  test("SAME: output LF is translated to CRLF", async () => {
    // POSIX ONLCR and ConPTY both render \n as \r\n on the master/read side.
    const { output } = await runInTerminal(`process.stdout.write('READY\\nLINE2')`, {
      done: o => o.includes("LINE2"),
    });
    expect(output).toContain("READY\r\n");
  });

  test("GAP: ANSI escape sequences", async () => {
    const { output } = await runInTerminal(`process.stdout.write('READY \\x1b[31mRED\\x1b[0m')`, {
      done: o => o.includes("RED"),
    });
    // The colour and text are preserved on both platforms; ConPTY re-encodes
    // the stream (it renders to a virtual screen and emits whatever sequences
    // describe the diff), so the byte sequence is not identical.
    expect(output).toContain("RED");
    expect(output).toContain("\x1b[31m");
    if (!isWindows) {
      expect(output).toContain("\x1b[31mRED\x1b[0m");
    }
  });

  test("SAME: UTF-8 passes through unchanged", async () => {
    const { output } = await runInTerminal(`process.stdout.write('READY héllo 🍔 世界')`, {
      done: o => o.includes("世界"),
    });
    expect(output).toContain("héllo 🍔 世界");
  });

  // ──────────────────────────────────────────────────────────────────────────
  // resize
  // ──────────────────────────────────────────────────────────────────────────

  // On Windows, ResizePseudoConsole does change the buffer size (the
  // "subprocess sees correct terminal dimensions" test proves the child sees
  // it at startup), but Bun's synthetic SIGWINCH event in the child is not
  // currently delivered under ConPTY — needs separate investigation.
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

  test("SAME: terminal can be reused across sequential spawns", async () => {
    let output = "";
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    const terminal = new Bun.Terminal({
      data(_t, chunk) {
        output += decoder.decode(chunk);
        if (output.includes("FIRST")) first.resolve();
        if (output.includes("SECOND")) second.resolve();
      },
    });

    const p1 = Bun.spawn({ cmd: [bunExe(), "-e", "process.stdout.write('FIRST')"], env: bunEnv, terminal });
    await Promise.race([first.promise, p1.exited]);
    await p1.exited;

    const p2 = Bun.spawn({ cmd: [bunExe(), "-e", "process.stdout.write('SECOND')"], env: bunEnv, terminal });
    await Promise.race([second.promise, p2.exited]);
    await p2.exited;

    terminal.close();
    expect(output).toContain("FIRST");
    expect(output).toContain("SECOND");
  });

  test("SAME: closing an inline terminal while a child is attached terminates the child", async () => {
    let output = "";
    const ready = Promise.withResolvers<void>();
    const proc = Bun.spawn({
      cmd: [bunExe(), "-e", "setInterval(() => {}, 1000); process.stdout.write('READY')"],
      env: bunEnv,
      terminal: {
        data(_t, chunk: Uint8Array) {
          output += decoder.decode(chunk);
          if (output.includes("READY")) ready.resolve();
        },
      },
    });
    await ready.promise;
    proc.terminal!.close();
    const exitCode = await proc.exited;
    // POSIX: SIGHUP to session. Windows: ConPTY terminates attached clients.
    expect(exitCode).not.toBe(0);
  });
});

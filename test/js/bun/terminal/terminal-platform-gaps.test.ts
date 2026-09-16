// Explicit per-platform behavioral assertions for Bun.Terminal.
//
// Each test probes one dimension and asserts the platform-specific expected
// result, so this file doubles as a living spec of where POSIX (openpty +
// termios line discipline) and Windows (ConPTY) diverge.
//
// "GAP" tests assert different results per platform.
// "SAME" tests assert identical behaviour and exist to lock that in.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Spawn a child attached to a fresh terminal, collect all PTY output until
 *  `done()` returns true or the child exits, then close the terminal. */
async function runInTerminal(
  childScript: string,
  opts: {
    cols?: number;
    rows?: number;
    done: (output: string) => boolean;
    afterReady?: (
      terminal: Bun.Terminal,
      output: () => string,
      waitFor: (marker: string) => Promise<void>,
    ) => void | Promise<void>;
    readyMarker?: string;
  },
): Promise<{ output: string; exitCode: number | null }> {
  let output = "";
  const ready = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  const eof = Promise.withResolvers<void>();
  const readyMarker = opts.readyMarker ?? "READY";
  const decoder = new TextDecoder();
  const waiters: { marker: string; resolve: () => void }[] = [];
  // Settles once `marker` has been printed, or at EOF so a dead child cannot hang the caller.
  const waitFor = (marker: string) => {
    const waiter = Promise.withResolvers<void>();
    if (Bun.stripANSI(output).includes(marker)) waiter.resolve();
    else waiters.push({ marker, resolve: waiter.resolve });
    return Promise.race([waiter.promise, eof.promise]);
  };

  // Use an inline terminal so the child becomes the session leader on POSIX
  // (setsid + TIOCSCTTY), which is required for SIGINT/SIGWINCH delivery.
  const proc = Bun.spawn({
    cmd: [bunExe(), "-e", childScript],
    env: bunEnv,
    terminal: {
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      data(_t, chunk: Uint8Array) {
        output += decoder.decode(chunk, { stream: true });
        if (output.includes(readyMarker)) ready.resolve();
        if (waiters.length) {
          // A cursor sequence can land inside a marker on a frame boundary.
          const shown = Bun.stripANSI(output);
          for (const waiter of waiters) if (shown.includes(waiter.marker)) waiter.resolve();
        }
        if (opts.done(output)) finished.resolve();
      },
      exit() {
        eof.resolve();
      },
    },
  });

  if (opts.afterReady) {
    await Promise.race([ready.promise, eof.promise]);
    if (!proc.terminal!.closed) await opts.afterReady(proc.terminal!, () => output, waitFor);
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

  test("SAME: a parent that pauses stdin with a line read pending leaves the next line to its child", async () => {
    // pause() runs two loop turns after the first line was delivered, so the read for the next
    // line is already pending in the parent when the child that inherits the terminal starts.
    const child = `
      process.stdout.write("CHILD-READY\\n");
      let lines = 0;
      process.stdin.on("data", d => {
        process.stdout.write("CHILD-GOT#" + ++lines + ":" + JSON.stringify(d.toString()) + "\\n");
        process.exit(0);
      });`;
    const { output } = await runInTerminal(
      `let spawned = false;
       let lines = 0;
       process.stdin.on("data", d => {
         process.stdout.write("PARENT-GOT#" + ++lines + ":" + JSON.stringify(d.toString()) + "\\n");
         if (spawned) return;
         spawned = true;
         setImmediate(() => setImmediate(() => {
           process.stdin.pause();
           const child = Bun.spawn({
             cmd: [process.execPath, "-e", ${JSON.stringify(child)}],
             stdin: "inherit",
             stdout: "inherit",
             stderr: "inherit",
           });
           child.exited.then(code => process.exit(code));
         }));
       });
       process.stdout.write("READY\\n");`,
      {
        done: o => /-GOT#\d+:"second/.test(o),
        afterReady: async (t, _output, waitFor) => {
          t.write("first\r");
          await waitFor("CHILD-READY");
          t.write("second\r");
        },
      },
    );
    // The line ends in CRLF under ConPTY and in LF on POSIX (ICRNL), so only its start is matched.
    // conhost 17763 (Server 2019) repaints the whole screen when a process puts the console mode
    // back on exit (#38054), so a row can come through twice. Each delivery has its own number:
    // a row painted again is the same text, a line delivered again is not.
    const deliveries = Bun.stripANSI(output).match(/(?:PARENT|CHILD)-GOT#\d+:"(?:first|second)/g) ?? [];
    expect([...new Set(deliveries)]).toEqual(['PARENT-GOT#1:"first', 'CHILD-GOT#1:"second']);
  });

  // The console's line editor has a cursor; a POSIX terminal in canonical mode has none, so the
  // arrow keys would be part of the line there.
  for (const [where, typed, echoed] of [
    ["at the end of", "wx", "wx"],
    ["inside", "wxyz\x1b[D\x1b[D", "wxyz"],
  ] as const) {
    test.skipIf(!isWindows)(
      `GAP: text typed before pause() is carried into the next line read (cursor ${where} the text)`,
      async () => {
        using dir = tempDir("terminal-stdin-carry", {});
        const flag = join(String(dir), "pause-now");
        const { output } = await runInTerminal(
          `import { existsSync } from "node:fs";
           let lines = 0;
           process.stdin.on("data", d => {
             process.stdout.write("GOT#" + ++lines + ":" + JSON.stringify(d.toString()) + "\\n");
           });
           const poll = setInterval(() => {
             if (!existsSync(${JSON.stringify(flag)})) return;
             clearInterval(poll);
             process.stdin.pause();
             setImmediate(() => setImmediate(() => {
               process.stdin.resume();
               process.stdout.write("RESUMED\\n");
             }));
           }, 5);
           process.stdout.write("READY\\n");`,
          {
            done: o => /GOT#\d+:"(?:[^"\\]|\\.)*"/.test(o),
            afterReady: async (t, _output, waitFor) => {
              t.write(typed);
              // The line editor echoes: the pending read has taken all of it.
              await waitFor(echoed);
              writeFileSync(flag, "");
              await waitFor("RESUMED");
              t.write("q!\r");
            },
          },
        );
        // What was left of the cursor is the line so far; nothing else reaches the program, least
        // of all the key that ended the read.
        const deliveries = Bun.stripANSI(output).match(/GOT#\d+:"(?:[^"\\]|\\.)*"/g) ?? [];
        expect([...new Set(deliveries)]).toEqual(['GOT#1:"wxq!\\r\\n"']);
      },
    );
  }

  // The key that ends input is Ctrl-Z at the start of a line on Windows and Ctrl-D on POSIX.
  test("SAME: a shell builtin that reads the terminal ends at the end-of-input key, and the next one reads on", async () => {
    const end = isWindows ? "\x1a\r" : "\x04";
    const { output } = await runInTerminal(
      `import { $ } from "bun";
       process.stdout.write("READY\\n");
       for (const name of ["FIRST", "SECOND"]) {
         const text = await $\`cat\`.text();
         process.stdout.write(name + ":" + JSON.stringify(text.replaceAll("\\r\\n", "\\n")) + "\\n");
       }`,
      {
        done: o => o.includes("SECOND:"),
        afterReady: async (t, _output, waitFor) => {
          t.write("one\r");
          // Inside a line the key is a character like any other.
          if (isWindows) t.write("a\x1ab\r");
          t.write(end);
          await waitFor("FIRST:");
          t.write("two\r");
          t.write(end);
        },
      },
    );
    const results = Bun.stripANSI(output).match(/(?:FIRST|SECOND):"(?:[^"\\]|\\.)*"/g) ?? [];
    expect([...new Set(results)]).toEqual([
      isWindows ? 'FIRST:"one\\na\\u001ab\\n"' : 'FIRST:"one\\n"',
      'SECOND:"two\\n"',
    ]);
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
    // Server 2019's ConPTY pads the row before the \r\n with spaces or, on a
    // full repaint, ESC[nX ESC[nC (#38054): strip the escapes and anchor on
    // LINE2 so the \r\n has to be the row break between the two markers.
    const { output } = await runInTerminal(`process.stdout.write('READY\\nLINE2')`, {
      done: o => o.includes("LINE2"),
    });
    expect(Bun.stripANSI(output)).toMatch(/READY *\r\nLINE2/);
    if (!isWindows) expect(output).toContain("READY\r\nLINE2");
  });

  test("SAME: output LF is translated to CRLF in a string with non-Latin-1 characters", async () => {
    const { output } = await runInTerminal(`process.stdout.write('READY \u4e16\\nLINE2')`, {
      done: o => o.includes("LINE2"),
    });
    // ConPTY may pad after a wide character.
    expect(Bun.stripANSI(output)).toMatch(/READY \u4e16 *\r\nLINE2/);
    if (!isWindows) expect(output).toContain("READY \u4e16\r\nLINE2");
  });

  test("SAME: a UTF-8 sequence split between two byte writes is joined, and one cut short by a string is replaced", async () => {
    const { output } = await runInTerminal(
      `process.stdout.write(Buffer.from([0xe4, 0xb8]));
       process.stdout.write(Buffer.from([0x96]));
       process.stdout.write(Buffer.from([0xe4, 0xb8]));
       process.stdout.write("\u754c READY");`,
      { done: o => o.includes("READY") },
    );
    expect(Bun.stripANSI(output)).toMatch(/\u4e16 *\ufffd *\u754c/);
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

  test("SAME: resize while child is running fires SIGWINCH in child", async () => {
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
    // Until SIGWINCH fires, the cached
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

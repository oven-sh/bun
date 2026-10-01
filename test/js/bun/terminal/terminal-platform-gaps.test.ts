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
import { release } from "node:os";
import { join } from "node:path";

// Windows build number ("10.0.17763" is Server 2019, "10.0.26100" is 11 24H2).
const windowsBuild = isWindows ? Number(release().split(".")[2]) : 0;

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

  // The queue is shared with every process attached to the console.
  test.skipIf(!isWindows)("GAP: leaving raw mode puts nothing into the console's input queue", async () => {
    using dir = tempDir("terminal-raw-mode-queue", {
      // Reads the console's input records, as a child that shares the console may.
      "records.js": `
        const { dlopen, ptr } = require("bun:ffi");
        const k32 = dlopen("kernel32.dll", {
          GetStdHandle: { args: ["i32"], returns: "ptr" },
          ReadConsoleInputW: { args: ["ptr", "ptr", "u32", "ptr"], returns: "i32" },
        }).symbols;
        const input = k32.GetStdHandle(-10);
        const record = new Uint16Array(10);
        const count = new Uint32Array(1);
        const eventTypes = [];
        process.stdout.write("CHILD-READY");
        for (;;) {
          if (!k32.ReadConsoleInputW(input, ptr(record), 1, ptr(count))) throw new Error("ReadConsoleInputW");
          // KEY_EVENT, bKeyDown, UnicodeChar "x"
          if (record[0] === 1 && record[2] === 1 && record[7] === 0x78) break;
          eventTypes.push(record[0]);
        }
        process.stdout.write("RECORDS=" + JSON.stringify(eventTypes) + " DONE");`,
    });
    const { output } = await runInTerminal(
      `process.stdin.setRawMode(true);
       process.stdin.on("data", () => {});
       // The wait on the console's input stays armed; the records are the child's to read.
       process.stdin.pause();
       setImmediate(async () => {
         const child = Bun.spawn({
           cmd: [process.execPath, ${JSON.stringify(join(String(dir), "records.js"))}],
           stdio: ["inherit", "inherit", "inherit"],
         });
         process.stdin.setRawMode(false);
         process.stdout.write("SWITCHED");
         process.exit(await child.exited);
       });`,
      {
        readyMarker: "CHILD-READY",
        done: o => o.includes(" DONE"),
        afterReady: async (t, _output, waitFor) => {
          await waitFor("SWITCHED");
          t.write("x");
        },
      },
    );
    // A FOCUS_EVENT record would be 16.
    expect(Bun.stripANSI(output)).toContain("RECORDS=[] DONE");
  });

  // QuickEdit, insert mode and mouse input are the user's settings, in the same word.
  test.skipIf(!isWindows)("GAP: setRawMode(false) leaves a console that is not raw as it found it", async () => {
    const { output } = await runInTerminal(
      `const { dlopen, ptr } = require("bun:ffi");
       const k32 = dlopen("kernel32.dll", {
         GetStdHandle: { args: ["i32"], returns: "ptr" },
         GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
         SetConsoleMode: { args: ["ptr", "u32"], returns: "i32" },
       }).symbols;
       const input = k32.GetStdHandle(-10);
       const mode = () => {
         const word = new Uint32Array(1);
         if (!k32.GetConsoleMode(input, ptr(word))) throw new Error("GetConsoleMode");
         return word[0];
       };
       // ENABLE_EXTENDED_FLAGS | ENABLE_QUICK_EDIT_MODE | ENABLE_INSERT_MODE, and line input.
       if (!k32.SetConsoleMode(input, 0x80 | 0x40 | 0x20 | 0x7)) throw new Error("SetConsoleMode");
       const found = mode();
       process.stdin.setRawMode(false);
       const untouched = mode();
       process.stdin.setRawMode(true);
       const raw = mode();
       process.stdin.setRawMode(false);
       // Short enough not to be wrapped: ENABLE_LINE_INPUT is what raw mode takes away.
       process.stdout.write("MODES=" + JSON.stringify([found, untouched, raw & 0x2, mode() & 0x2]) + " DONE");
       process.exit(0);`,
      { readyMarker: " DONE", done: o => o.includes(" DONE") },
    );
    expect(Bun.stripANSI(output)).toContain("MODES=[231,231,0,2] DONE");
  });

  // The input mode is the console's, whichever handle it is set through.
  test.skipIf(!isWindows)("tty.ReadStream#setRawMode() works on a console descriptor that is not stdin", async () => {
    const { output } = await runInTerminal(
      `const { dlopen, ptr } = require("bun:ffi");
       const k32 = dlopen("kernel32.dll", {
         GetStdHandle: { args: ["i32"], returns: "ptr" },
         GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
       }).symbols;
       // ENABLE_LINE_INPUT is what raw mode takes away.
       const lineInput = () => {
         const word = new Uint32Array(1);
         if (!k32.GetConsoleMode(k32.GetStdHandle(-10), ptr(word))) throw new Error("GetConsoleMode");
         return word[0] & 0x2;
       };
       const errors = [];
       const stream = new (require("node:tty").ReadStream)(require("node:fs").openSync("CONIN$", "r+"));
       stream.on("error", error => errors.push(error.message));
       const seen = [lineInput()];
       stream.setRawMode(true);
       seen.push(stream.isRaw, lineInput());
       stream.setRawMode(false);
       seen.push(stream.isRaw, lineInput());
       const file = new (require("node:tty").ReadStream)(require("node:fs").openSync(process.execPath, "r"));
       file.on("error", error => errors.push("file: " + /^setRawMode failed with errno/.test(error.message)));
       file.setRawMode(true);
       process.stdout.write("SEEN=" + JSON.stringify([seen, file.isRaw, errors]) + " DONE");
       process.exit(0);`,
      { readyMarker: " DONE", done: o => o.includes(" DONE") },
    );
    expect(Bun.stripANSI(output)).toContain('SEEN=[[2,true,0,false,2],false,["file: true"]] DONE');
  });

  // A screen buffer has a mode as well, whose bits mean other things.
  test.skipIf(!isWindows)("setRawMode() tells a console's input from its screen buffer every time", async () => {
    const { output } = await runInTerminal(
      `const { dlopen, ptr } = require("bun:ffi");
       const { ReadStream } = require("node:tty");
       const { openSync } = require("node:fs");
       const k32 = dlopen("kernel32.dll", {
         GetStdHandle: { args: ["i32"], returns: "ptr" },
         GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
       }).symbols;
       const mode = which => {
         const word = new Uint32Array(1);
         if (!k32.GetConsoleMode(k32.GetStdHandle(which), ptr(word))) throw new Error("GetConsoleMode");
         return word[0];
       };
       const refused = [];
       const input = new ReadStream(openSync("CONIN$", "r+"));
       const screen = new ReadStream(openSync("CONOUT$", "r+"));
       input.on("error", error => refused.push("input"));
       screen.on("error", error => refused.push("screen"));
       const screenMode = mode(-11);
       const seen = [];
       for (const stream of [input, screen, process.stdin, screen, input, input, screen]) {
         stream.setRawMode(true);
         // ENABLE_LINE_INPUT is what raw mode takes away.
         seen.push(mode(-10) & 0x2);
         stream.setRawMode(false);
         seen.push(mode(-10) & 0x2);
       }
       process.stdout.write("SEEN=" + JSON.stringify([seen.join(""), refused.join(), mode(-11) === screenMode]) + " DONE");
       process.exit(0);`,
      { readyMarker: " DONE", done: o => o.includes(" DONE") },
    );
    expect(Bun.stripANSI(output)).toContain(
      'SEEN=["02220222020222","screen,screen,screen,screen,screen,screen",true] DONE',
    );
  });

  // A Windows console hands over key records. Raw mode asks it to make VT sequences of the keys
  // itself; for one that cannot (legacy console mode), Bun does, with libuv's (so Node's) mappings.
  // The child puts the records into its own console's queue, each case followed by a key that
  // marks its end.
  describe.skipIf(!isWindows)("GAP: key records in raw mode", () => {
    const [ALT_R, ALT_L, CTRL_R, CTRL_L, SHIFT, ENHANCED] = [0x1, 0x2, 0x4, 0x8, 0x10, 0x100];
    const [CLEAR, MENU, PRIOR, NEXT, END, HOME, LEFT, UP, RIGHT, DOWN, INSERT, DELETE] = [
      0x0c, 0x12, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2d, 0x2e,
    ];
    const [NUMPAD0, DECIMAL, F1] = [0x60, 0x6e, 0x70];
    type KeyRecord = [type: number, down: number, repeat: number, vk: number, unit: number, modifiers: number];
    const key = (down: boolean, repeat: number, vk: number, unit: number, modifiers = 0): KeyRecord => [
      1,
      +down,
      repeat,
      vk,
      unit,
      modifiers,
    ];
    const char = (c: string | number, modifiers = 0) =>
      key(true, 1, 0, typeof c === "string" ? c.charCodeAt(0) : c, modifiers);
    const fn = (vk: number, modifiers = 0) => key(true, 1, vk, 0, modifiers);
    // WINDOW_BUFFER_SIZE_EVENT, and MOUSE_EVENT, MENU_EVENT and FOCUS_EVENT.
    const resize: KeyRecord = [4, 120, 0, 0, 0, 0];
    const notAKey = [2, 8, 16].map((type): KeyRecord => [type, 1, 1, UP, 0x78, 0]);

    // name -> [the records, in the batches they are written in, and the bytes expected]
    const cases: Record<string, [KeyRecord[][], string | number[]]> = {};
    const add = (name: string, records: KeyRecord[], expected: string | number[]) => {
      expect(cases).not.toHaveProperty(name);
      cases[name] = [[records], expected];
    };

    add("a", [char("a")], "a");
    add("enter", [char(0x0d)], "\r");
    add("ctrl+c", [char(0x03, CTRL_L)], "\x03");
    add("ctrl+]", [key(true, 1, 0xdd, 0x1d, CTRL_L)], "\x1d");
    add("two bytes", [char("é")], "é");
    add("three bytes", [char("€")], "€");
    add("shift is in the character", [char("h", SHIFT), char("i")], "hi");

    add("left alt", [char("x", ALT_L)], "\x1bx");
    add("right alt", [char("x", ALT_R)], "\x1bx");
    add("alt+shift", [char("é", ALT_L | SHIFT)], "\x1bé");
    add("altgr", [char("€", ALT_R | CTRL_L)], "€");
    add("altgr, the other two keys", [char("@", ALT_L | CTRL_R)], "@");

    add("surrogate pair", [char(0xd83d), char(0xde00)], "😀");
    add("surrogate pair with alt", [char(0xd83d, ALT_L), char(0xde00, ALT_L)], "\x1b😀");
    add("surrogate pair around other records", [char(0xd83d), key(false, 1, 0, 0xd83d), resize, char(0xde00)], "😀");
    cases["surrogate pair in two reads, and the next key"] = [[[char(0xd83d)], [char(0xde00)], [char("a")]], "😀a"];
    add("lone low surrogate", [char(0xde00)], [0xed, 0xb8, 0x80]);
    add("lone high surrogate", [char(0xd83d), char("a")], [0xed, 0xa0, 0xbd, 0x61]);
    add("a second high surrogate replaces the first", [char(0xd83c), char(0xd83d), char(0xde00)], "😀");

    // How a character composed with Alt+numpad arrives, and one outside the BMP from a pseudoconsole.
    add("alt up with a character", [key(false, 1, MENU, 0xe9)], "é");
    add("alt up with a character, alt still reported", [key(false, 1, MENU, 0xe9, ALT_L)], "é");
    add("alt up with a surrogate pair", [key(false, 1, MENU, 0xd83d), key(false, 1, MENU, 0xde00)], "😀");
    add("alt up", [key(false, 1, MENU, 0)], "");
    add("key up", [key(false, 1, 0x41, 0x61), key(false, 1, UP, 0), key(false, 1, F1, 0, SHIFT)], "");

    const modified = [
      ["", 0],
      ["shift+", SHIFT],
      ["ctrl+", CTRL_L],
      ["right ctrl+", CTRL_R],
      ["shift+ctrl+", SHIFT | CTRL_L],
    ] as const;
    for (const [vk, letter] of [
      [UP, "A"],
      [DOWN, "B"],
      [RIGHT, "C"],
      [LEFT, "D"],
    ] as const) {
      const sequences = [`[${letter}`, `[1;2${letter}`, `[1;5${letter}`, `[1;5${letter}`, `[1;6${letter}`];
      modified.forEach(([name, modifiers], i) =>
        add(`${name}arrow ${letter}`, [fn(vk, ENHANCED | modifiers)], "\x1b" + sequences[i]),
      );
    }
    [
      [INSERT, "[2~"],
      [END, "[4~"],
      [DOWN, "[B"],
      [NEXT, "[6~"],
      [LEFT, "[D"],
      [CLEAR, "[G"],
      [RIGHT, "[C"],
      [UP, "[A"],
      [HOME, "[1~"],
      [PRIOR, "[5~"],
    ].forEach(([vk, sequence], digit) => {
      add(`navigation ${sequence}`, [fn(vk as number)], "\x1b" + sequence);
      add(`numpad ${digit}`, [fn(NUMPAD0 + digit)], "\x1b" + sequence);
    });
    add("delete", [fn(DELETE)], "\x1b[3~");
    add("numpad .", [fn(DECIMAL)], "\x1b[3~");
    add("shift+home", [fn(HOME, SHIFT)], "\x1b[1;2~");
    add("ctrl+end", [fn(END, CTRL_L)], "\x1b[4;5~");
    add("shift+ctrl+page up", [fn(PRIOR, SHIFT | CTRL_R)], "\x1b[5;6~");
    add("shift+ctrl+clear", [fn(CLEAR, SHIFT | CTRL_L)], "\x1b[1;6G");
    [
      ["[[A", "[23~", "[11^", "[23^"],
      ["[[B", "[24~", "[12^", "[24^"],
      ["[[C", "[25~", "[13^", "[25^"],
      ["[[D", "[26~", "[14^", "[26^"],
      ["[[E", "[28~", "[15^", "[28^"],
      ["[17~", "[29~", "[17^", "[29^"],
      ["[18~", "[31~", "[18^", "[31^"],
      ["[19~", "[32~", "[19^", "[32^"],
      ["[20~", "[33~", "[20^", "[33^"],
      ["[21~", "[34~", "[21^", "[34^"],
      ["[23~", "[23$", "[23^", "[23@"],
      ["[24~", "[24$", "[24^", "[24@"],
    ].forEach(([normal, shift, ctrl, shiftCtrl], i) => {
      const sequences = [normal, shift, ctrl, ctrl, shiftCtrl];
      modified.forEach(([name, modifiers], j) =>
        add(`${name}F${i + 1}`, [fn(F1 + i, modifiers)], "\x1b" + sequences[j]),
      );
    });
    add("alt+arrow", [fn(UP, ENHANCED | ALT_L)], "\x1b\x1b[A");
    add("right alt+F1", [fn(F1, ALT_R)], "\x1b\x1b[[A");
    // Unlike with a character.
    add("ctrl does not take the prefix from alt+delete", [fn(DELETE, ENHANCED | ALT_L | CTRL_L)], "\x1b\x1b[3;5~");
    // Shift, Ctrl, Alt, Caps Lock and F13.
    for (const vk of [0x10, 0x11, MENU, 0x14, 0x7c]) {
      add(`key 0x${vk.toString(16)} sends nothing`, [fn(vk), fn(vk, ALT_L)], "");
    }

    add("repeated", [key(true, 3, 0x41, 0x61)], "aaa");
    add("repeated 0 times", [key(true, 0, 0x41, 0x61)], "a");
    add("repeated with alt", [key(true, 2, 0x41, 0x61, ALT_L)], "\x1ba\x1ba");
    add("repeated arrow", [key(true, 2, LEFT, 0, ENHANCED)], "\x1b[D\x1b[D");
    add("repeated low surrogate", [char(0xd83d), key(true, 2, 0, 0xde00)], "😀😀");
    add("what came before is not repeated", [char("x"), key(true, 2, 0x41, 0x61)], "xaa");

    // The digits of an Alt+numpad composition: the numpad's keys (the navigation cluster's are
    // ENHANCED_KEY) while left Alt is down, whether NumLock makes them digits or not.
    const numpad = [INSERT, END, DOWN, NEXT, LEFT, CLEAR, RIGHT, HOME, UP, PRIOR];
    for (let digit = 0; digit < 10; digit++) numpad.push(NUMPAD0 + digit);
    for (const vk of numpad) {
      add(`composing with 0x${vk.toString(16)}`, [fn(vk, ALT_L), key(true, 1, vk, 0x31, ALT_L)], "");
    }
    add("right alt does not compose", [fn(NUMPAD0 + 4, ALT_R)], "\x1b\x1b[D");
    add("the navigation cluster does not compose", [fn(LEFT, ALT_L | ENHANCED)], "\x1b\x1b[D");
    add("delete does not compose", [fn(DELETE, ALT_L), fn(DECIMAL, ALT_L)], "\x1b\x1b[3~\x1b\x1b[3~");

    add("records that are not keys", [resize, ...notAKey], "");
    add("keys between records that are not", [char("a"), resize, notAKey[2], char("b")], "ab");

    async function expectBytes(names: string[], vtInput: boolean) {
      using dir = tempDir("terminal-key-records", {
        "cases.json": JSON.stringify(names.map(name => [name, cases[name][0]])),
      });
      const { output } = await runInTerminal(
        `const { dlopen, ptr } = require("bun:ffi");
       const { readFileSync, writeFileSync } = require("node:fs");
       const k32 = dlopen("kernel32.dll", {
         GetStdHandle: { args: ["i32"], returns: "ptr" },
         GetNumberOfConsoleInputEvents: { args: ["ptr", "ptr"], returns: "i32" },
         GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
         SetConsoleMode: { args: ["ptr", "u32"], returns: "i32" },
         WriteConsoleInputW: { args: ["ptr", "ptr", "u32", "ptr"], returns: "i32" },
       }).symbols;
       const input = k32.GetStdHandle(-10);
       const count = new Uint32Array(1);
       function send(records) {
         // INPUT_RECORD: EventType, then a KEY_EVENT_RECORD at offset 4.
         const words = new Uint16Array(records.length * 10);
         records.forEach(([type, down, repeat, vk, unit, modifiers], i) =>
           words.set([type, 0, down, 0, repeat, vk, 0, unit, modifiers & 0xffff, modifiers >>> 16], i * 10),
         );
         if (!k32.WriteConsoleInputW(input, ptr(words), records.length, ptr(count))) throw new Error("WriteConsoleInputW");
       }
       async function taken() {
         for (;;) {
           if (!k32.GetNumberOfConsoleInputEvents(input, ptr(count))) throw new Error("GetNumberOfConsoleInputEvents");
           if (count[0] === 0) return;
           await new Promise(setImmediate);
         }
       }
       const END = 0x1f;
       let received = [];
       let ended = Promise.withResolvers();
       process.stdin.setRawMode(true);
       if (!${vtInput}) {
         // As raw mode leaves a console that refuses ENABLE_VIRTUAL_TERMINAL_INPUT.
         if (!k32.GetConsoleMode(input, ptr(count))) throw new Error("GetConsoleMode");
         if (!k32.SetConsoleMode(input, count[0] & ~0x200)) throw new Error("SetConsoleMode");
       }
       process.stdin.on("data", chunk => {
         received.push(...chunk);
         if (chunk.includes(END)) ended.resolve();
       });
       const results = {};
       for (const [name, batches] of JSON.parse(readFileSync(${JSON.stringify(join(String(dir), "cases.json"))}, "utf8"))) {
         for (const batch of batches.slice(0, -1)) {
           send(batch);
           await taken();
         }
         send([...batches.at(-1), [1, 1, 1, 0, END, 0]]);
         await ended.promise;
         results[name] = Buffer.from(received).toString("hex");
         received = [];
         ended = Promise.withResolvers();
       }
       writeFileSync(${JSON.stringify(join(String(dir), "results.json"))}, JSON.stringify(results));
       process.stdout.write("DONE");
       process.exit(0);`,
        { readyMarker: "DONE", done: o => o.includes("DONE") },
      );
      expect(Bun.stripANSI(output)).toContain("DONE");
      expect(await Bun.file(join(String(dir), "results.json")).json()).toEqual(
        Object.fromEntries(names.map(name => [name, Buffer.from(cases[name][1]).toString("hex") + "1f"])),
      );
    }

    test("on a console without VT input", () => expectBytes(Object.keys(cases), false));

    // What the console makes of a function key is the console's business.
    test("on a console with VT input", () =>
      expectBytes(
        [
          ...["a", "enter", "ctrl+c", "two bytes", "three bytes", "shift is in the character"],
          ...["surrogate pair", "key up", "records that are not keys", "keys between records that are not"],
        ],
        true,
      ));
  });

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

  // A line that is being read ends when the console host is given a key that ends it, which it does
  // not take while it shows one of its popups (F7: the lines typed so far).
  test.skipIf(!isWindows)("a Worker that reads lines from a console with a popup open can be terminated", async () => {
    using dir = tempDir("console-popup-worker", {});
    const go = join(String(dir), "go");
    const { output } = await runInTerminal(
      `const worker = new Worker(URL.createObjectURL(new Blob([\`
         const reader = Bun.stdin.stream().getReader();
         postMessage("READY");
         while (!(await reader.read()).done) postMessage("GOT-LINE");
       \`], { type: "application/javascript" })));
       worker.onmessage = ({ data }) => console.log(data);
       worker.addEventListener("close", () => console.log("WORKER-CLOSED"));
       const poll = setInterval(() => {
         if (!require("fs").existsSync(${JSON.stringify(go)})) return;
         clearInterval(poll);
         worker.terminate();
       }, 5);`,
      {
        done: o => o.includes("WORKER-CLOSED"),
        async afterReady(terminal, _output, waitFor) {
          terminal.write("typed\r");
          await waitFor("GOT-LINE");
          terminal.write("\x1b[18~");
          await waitFor("0: typed");
          writeFileSync(go, "");
        },
      },
    );
    expect(Bun.stripANSI(output)).toContain("WORKER-CLOSED");
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

  // Two bytes that spell "/" or ESC are not that character: whoever checked the bytes did not see one.
  test.skipIf(!isWindows)("bytes that are not UTF-8 are replaced, whatever they would decode to", async () => {
    const { output } = await runInTerminal(
      `for (const bytes of [
         [0xc0, 0xaf], [0xc1, 0x9b], [0xe0, 0x80, 0xaf], [0xf0, 0x80, 0x80, 0xaf],
         [0xf4, 0x90, 0x80, 0x80], [0xf8, 0x88, 0x80, 0x80, 0x80], [0xfe], [0xff],
       ]) {
         process.stdout.write("<");
         process.stdout.write(Buffer.from(bytes));
         process.stdout.write(">");
       }
       process.stdout.write(" READY");`,
      { done: o => o.includes("READY") },
    );
    // Server 2019's ConPTY scrolls first, and prints a character again over itself: after a backspace,
    // or, when it is the first of the line, after moving there.
    expect(
      Bun.stripANSI(output)
        .replace(/.\x08|\s/g, "")
        .replace(/^<+/, "<"),
    ).toMatch(/^(?:<\ufffd+>){8}READY/);
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

  // The inbox conhost on Windows 10 and Server 2019 predates
  // microsoft/terminal#4856 and drops mouse-tracking DECSET sequences written
  // by the child, so the outer terminal never starts reporting mouse events to
  // it (#43450). Server 2022 (build 20348) and Windows 11 relay them, but only
  // once the child has switched stdin to VT input mode (setRawMode).
  test.todoIf(isWindows && windowsBuild < 20348)(
    "SAME: mouse-tracking enable sequences reach the data callback",
    async () => {
      const { output } = await runInTerminal(
        `process.stdin.setRawMode(true);
       process.stdin.resume();
       process.stdout.write('\\x1b[?1000h\\x1b[?1006h');
       process.stdout.write('READY');
       setInterval(() => {}, 1000);`,
        { done: o => o.includes("READY") },
      );
      expect(output).toContain("\x1b[?1000h");
      expect(output).toContain("\x1b[?1006h");
    },
  );

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

  // A pseudoconsole raises no WinEvents; it reports a resize only to the reader of its input.
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

  test("SAME: resize fires SIGWINCH in an idle child that reads the terminal in raw mode", async () => {
    const { output } = await runInTerminal(
      `process.stdin.setRawMode(true);
       process.stdin.on("data", () => {});
       process.on('SIGWINCH', () => setImmediate(() => {
         process.stdout.write('WINCH cols=' + process.stdout.columns + ' rows=' + process.stdout.rows);
         process.exit(0);
       }));
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

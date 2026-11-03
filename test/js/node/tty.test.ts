import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { release } from "node:os";
import { join } from "node:path";
import { WriteStream } from "node:tty";

// Windows build number ("10.0.17763" is Server 2019, "10.0.26100" is 11 24H2).
const windowsBuild = isWindows ? Number(release().split(".")[2]) : 0;

/** Runs `script` on a console of its own until what it has printed, without line ends, matches `until`. */
async function runOnConsole(
  script: string,
  until: RegExp,
  { onText, ...size }: { cols?: number; rows?: number; onText?(text: string, terminal: Bun.Terminal): void } = {},
) {
  const decoder = new TextDecoder();
  let buffer = "";
  const result = Promise.withResolvers<RegExpMatchArray>();

  await using terminal = new Bun.Terminal({
    ...size,
    data(terminal, chunk: Uint8Array) {
      buffer += decoder.decode(chunk, { stream: true });
      // An older console host draws a blank where the cursor is and steps back over it.
      const text = Bun.stripANSI(buffer).replace(/[\r\n]| \x08/g, "");
      onText?.(text, terminal);
      const match = text.match(until);
      if (match) result.resolve(match);
    },
  });

  const proc = Bun.spawn({
    cmd: [bunExe(), "-e", `${script}\nprocess.stdin.resume();`],
    env: bunEnv,
    terminal,
  });
  proc.exited.then(code =>
    result.reject(new Error(`child exited with code ${code}; terminal output: ${JSON.stringify(buffer)}`)),
  );

  // Ends a child that never prints it while the test can still report what the console did print.
  const watchdog = setTimeout(() => proc.kill(), 20_000);
  try {
    return await result.promise;
  } finally {
    clearTimeout(watchdog);
    proc.kill();
    await proc.exited;
  }
}

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

  // Runs `script` on a console of its own and resolves to its `seen`. Its `typed()` resolves to what process.stdin
  // reads when "x" and Enter are typed. A console has no termios to look at. What tells is the Enter key: "\r" to a
  // raw reader, and "\r\n" at the end of the line that a cooked reader gets.
  async function seenOnConsole(script: string) {
    let typed = 0;
    const [, seen] = await runOnConsole(
      `
        const tty = require("node:tty");
        const { TTY } = process.binding("tty_wrap");
        let phase = 0;
        function typed() {
          const { promise, resolve } = Promise.withResolvers();
          let text = "";
          process.stdin.on("data", function onData(chunk) {
            text += chunk;
            if (!/[\\r\\n]$/.test(text)) return;
            process.stdin.off("data", onData);
            resolve(text);
          });
          process.stdout.write("READY" + ++phase + ";");
          return promise;
        }
        const seen = [];
        ${script}
        process.stdout.write("RESULT " + JSON.stringify(seen));
      `,
      /RESULT (\[[^\]]*\])/,
      {
        onText(text, terminal) {
          if (text.includes(`READY${typed + 1};`)) {
            typed++;
            terminal.write("x\r");
          }
        },
      },
    );
    return JSON.parse(seen);
  }

  test.skipIf(!isWindows)("setRawMode(false) on a handle that was never raw leaves process.stdin raw", async () => {
    const seen = await seenOnConsole(`
      process.stdin.setRawMode(true);
      seen.push(await typed());
      new tty.ReadStream(0).setRawMode(false);
      seen.push(await typed());
      new TTY(0).setRawMode(0);
      seen.push(await typed());
      process.stdin.setRawMode(false);
      seen.push(await typed());
    `);
    expect(seen).toEqual(["x\r", "x\r", "x\r", "x\r\n"]);
  });

  // cmd.exe turns line input on when it starts, and leaves it on.
  test.skipIf(!isWindows)("process.stdin stays raw when a child leaves the console in line mode", async () => {
    const seen = await seenOnConsole(`
      const { execSync } = require("node:child_process");
      process.stdin.setRawMode(true);
      execSync("echo from the shell", { stdio: "inherit" });
      seen.push(process.stdin.isRaw, await typed());
      process.stdin.setRawMode(false);
      execSync("echo from the shell", { stdio: "inherit" });
      seen.push(process.stdin.isRaw, await typed());
    `);
    expect(seen).toEqual([true, "x\r", false, "x\r\n"]);
  });

  test.skipIf(!isWindows)("TTY#setRawMode takes the modes of uv_tty_set_mode", async () => {
    const [UV_ENOTSUP, UV_EINVAL] = [-4049, -4071];
    const seen = await seenOnConsole(`
      const handle = new TTY(0);
      seen.push("RAW_VT", handle.setRawMode(3), await typed());
      seen.push("IO", handle.setRawMode(2), "no mode", handle.setRawMode(4), handle.setRawMode(-1), await typed());
      seen.push("NORMAL", handle.setRawMode(0), await typed());
    `);
    expect(seen).toEqual([
      ...["RAW_VT", 0, "x\r"],
      ...["IO", UV_ENOTSUP, "no mode", UV_EINVAL, UV_EINVAL, "x\r"],
      ...["NORMAL", 0, "x\r\n"],
    ]);
  });

  test.skipIf(!isWindows)("a setRawMode that fails is an 'error' with a code", async () => {
    const seen = await seenOnConsole(`
      const stream = new (require("node:tty").ReadStream)(require("node:fs").openSync("CONIN$", "r"));
      stream.on("error", ({ message, code, errno, syscall }) => seen.push(message, code, errno, syscall));
      seen.push(stream.setRawMode(true) === stream, stream.isRaw);
      stream.destroy();
    `);
    expect(seen).toEqual(["setRawMode EPERM", "EPERM", -4048, "setRawMode", true, false]);
  });

  test("setRawMode on a destroyed stream only takes note of the flag", async () => {
    const seen = await seenOnConsole(`
      const { once } = require("node:events");
      const open = () => {
        const stream = new tty.ReadStream(require("node:fs").openSync("${isWindows ? "CONIN$" : "/dev/fd/0"}", "r+"));
        return stream.on("error", error => seen.push(String(error)));
      };
      const stream = open();
      await once(stream.destroy(), "close");
      seen.push(stream.setRawMode(true) === stream, stream.isRaw, stream.setRawMode(false) === stream, stream.isRaw);
      const input = open();
      const lines = require("node:readline").createInterface({ input, terminal: true });
      await once(input.destroy(), "close");
      lines.close();
      seen.push(input.isRaw);
    `);
    expect(seen).toEqual([true, true, true, false, false]);
  });

  // The mode stays with the console when the process that set it is gone.
  test.skipIf(!isWindows).each([
    ["process.kill(process.pid)", "process.kill(process.pid)"],
    ["process.abort()", "process.abort()"],
    [
      "Ctrl+Break",
      `require("bun:ffi")
        .dlopen("kernel32.dll", { GenerateConsoleCtrlEvent: { args: ["u32", "u32"], returns: "i32" } })
        .symbols.GenerateConsoleCtrlEvent(1, 0)`,
    ],
  ])("a raw process that %s ends leaves the console as it found it", async (_, die) => {
    const seen = await seenOnConsole(`
      const { spawnSync } = require("node:child_process");
      process.on("SIGBREAK", () => {});
      const script = ${JSON.stringify(`process.stdin.setRawMode(true); process.stdin.resume(); ${die};`)};
      spawnSync(process.execPath, ["-e", script], { stdio: "inherit" });
      seen.push(await typed());
    `);
    expect(seen).toEqual(["x\r\n"]);
  });

  // Another process may have changed it since this one started.
  test.skipIf(!isWindows)(
    "a process that did not change the input mode of its console ends without setting it",
    async () => {
      const seen = await seenOnConsole(`
      const { GetStdHandle, GetConsoleMode } = require("bun:ffi").dlopen("kernel32.dll", {
        GetStdHandle: { args: ["i32"], returns: "ptr" },
        GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
      }).symbols;
      function inputMode() {
        const mode = new Uint32Array(1);
        GetConsoleMode(GetStdHandle(-10), mode);
        return mode[0];
      }
      const started = Promise.withResolvers();
      const child = Bun.spawn({
        cmd: [process.execPath, "-e", "process.send('started'); process.on('message', () => process.exit());"],
        stdio: ["inherit", "inherit", "inherit"],
        ipc: started.resolve,
      });
      await started.promise;
      const cooked = inputMode();
      process.stdin.setRawMode(true);
      const raw = inputMode();
      child.send("leave");
      await child.exited;
      seen.push(raw !== cooked, inputMode() === raw);
    `);
      expect(seen).toEqual([true, true]);
    },
  );

  // What puts the console back at Ctrl+C is asked last, so only if nothing else handles the event.
  test.skipIf(!isWindows)(
    "a Ctrl+C that a listener handles leaves the console to Bun, after TTY#setRawMode(0) too",
    async () => {
      const seen = await seenOnConsole(`
      const { GenerateConsoleCtrlEvent, GetConsoleOutputCP } = require("bun:ffi").dlopen("kernel32.dll", {
        GenerateConsoleCtrlEvent: { args: ["u32", "u32"], returns: "i32" },
        GetConsoleOutputCP: { args: [], returns: "u32" },
      }).symbols;
      const interrupted = Promise.withResolvers();
      process.on("SIGINT", interrupted.resolve);
      const handle = new TTY(0);
      handle.setRawMode(1);
      handle.setRawMode(0);
      GenerateConsoleCtrlEvent(0, 0);
      await interrupted.promise;
      seen.push(GetConsoleOutputCP());
    `);
      expect(seen).toEqual([65001]);
    },
  );
});

describe.skipIf(!isWindows)("process.stdin on a raw console", () => {
  const [RIGHT_ALT, LEFT_ALT, RIGHT_CTRL, LEFT_CTRL, SHIFT, ENHANCED] = [1, 2, 4, 8, 0x10, 0x100];
  // bKeyDown, wRepeatCount, wVirtualKeyCode, wVirtualScanCode, UnicodeChar, dwControlKeyState
  type KeyEvent = [number, number, number, number, number, number];
  const up = (state: number): KeyEvent => [1, 1, 0x26, 0x48, 0, ENHANCED | state];
  const f1 = (state: number): KeyEvent => [1, 1, 0x70, 0x3b, 0, state];
  const keys: [name: string, events: KeyEvent[], text: string][] = [
    ["Up", [up(0)], "\x1b[A"],
    ["Shift+Up", [up(SHIFT)], "\x1b[1;2A"],
    ["Ctrl+Up", [up(LEFT_CTRL)], "\x1b[1;5A"],
    ["Ctrl+Shift+Up", [up(RIGHT_CTRL | SHIFT)], "\x1b[1;6A"],
    ["Alt+Up", [up(LEFT_ALT)], "\x1b\x1b[A"],
    ["F1", [f1(0)], "\x1b[[A"],
    ["Shift+F1", [f1(SHIFT)], "\x1b[23~"],
    ["F12", [[1, 1, 0x7b, 0x58, 0, 0]], "\x1b[24~"],
    ["Delete", [[1, 1, 0x2e, 0x53, 0, ENHANCED]], "\x1b[3~"],
    ["7 on the keypad, which is Home", [[1, 1, 0x67, 0x47, 0, 0]], "\x1b[1~"],
    ["8 on the keypad, which is Up", [[1, 1, 0x68, 0x48, 0, 0]], "\x1b[A"],
    ["Alt+A", [[1, 1, 0x41, 0x1e, 0x61, LEFT_ALT]], "\x1ba"],
    ["AltGr+Q on a German keyboard", [[1, 1, 0x51, 0x10, 0x40, RIGHT_ALT | LEFT_CTRL]], "@"],
    [
      "a surrogate pair",
      [
        [1, 1, 0, 0, 0xd83d, 0],
        [1, 1, 0, 0, 0xde00, 0],
      ],
      "\u{1f600}",
    ],
    ["a key that is held down", [[1, 3, 0x58, 0x2d, 0x78, 0]], "xxx"],
    ["Ctrl+Space", [[1, 1, 0x20, 0x39, 0, LEFT_CTRL]], "\0"],
    ["a character that comes with the release of Alt", [[0, 1, 0x12, 0x38, 0xe9, 0]], "\xe9"],
    ["the release of a key", [[0, 1, 0x41, 0x1e, 0x61, 0]], ""],
    ["Alt and a digit of a character's code", [[1, 1, 0x61, 0x4f, 0, LEFT_ALT]], ""],
    ["Shift", [[1, 1, 0x10, 0x2a, 0, SHIFT]], ""],
  ];

  // With ENABLE_VIRTUAL_TERMINAL_INPUT, which raw mode asks for, the console translates most keys itself.
  const passKeysOnAsTheyAre = `
    const { symbols: kernel32 } = require("bun:ffi").dlopen("kernel32.dll", {
      GetNumberOfConsoleInputEvents: { args: ["i64", "ptr"], returns: "i32" },
      GetStdHandle: { args: ["i32"], returns: "i64" },
      SetConsoleMode: { args: ["i64", "u32"], returns: "i32" },
      WriteConsoleInputW: { args: ["i64", "ptr", "u32", "ptr"], returns: "i32" },
    });
    const STD_INPUT_HANDLE = -10, ENABLE_WINDOW_INPUT = 8, KEY_EVENT = 1;
    const input = kernel32.GetStdHandle(STD_INPUT_HANDLE);
    process.stdin.setRawMode(true);
    kernel32.SetConsoleMode(input, ENABLE_WINDOW_INPUT);
    function press(events) {
      const records = Buffer.alloc(20 * events.length);
      events.forEach(([down, repeat, key, scan, unit, state], i) => {
        records.writeUInt16LE(KEY_EVENT, 20 * i);
        records.writeInt32LE(down, 20 * i + 4);
        records.writeUInt16LE(repeat, 20 * i + 8);
        records.writeUInt16LE(key, 20 * i + 10);
        records.writeUInt16LE(scan, 20 * i + 12);
        records.writeUInt16LE(unit, 20 * i + 14);
        records.writeUInt32LE(state, 20 * i + 16);
      });
      kernel32.WriteConsoleInputW(input, records, events.length, new Uint32Array(1));
    }
  `;
  const [a, b, fullStop]: KeyEvent[] = [
    [1, 65535, 0x41, 0x1e, 0x61, 0],
    [1, 65535, 0x42, 0x30, 0x62, 0],
    [1, 1, 0xbe, 0x34, 0x2e, 0],
  ];

  test("gets what a terminal sends for a key from a console that passes keys on as they are", async () => {
    const [, seen] = await runOnConsole(
      `
        ${passKeysOnAsTheyAre}
        let text = "", gotFullStop;
        process.stdin.setEncoding("utf8").on("data", chunk => {
          text += chunk;
          if (text.endsWith(".")) gotFullStop();
        });
        const seen = [];
        for (const events of ${JSON.stringify(keys.map(([, events]) => events))}) {
          events.push(${JSON.stringify(fullStop)});
          const { promise, resolve } = Promise.withResolvers();
          gotFullStop = resolve;
          press(events);
          await promise;
          seen.push(Buffer.from(text.slice(0, -1)).toString("hex"));
          text = "";
        }
        process.stdout.write("RESULT " + JSON.stringify(seen));
      `,
      /RESULT (\[[^\]]*\])/,
      { cols: 1000 },
    );
    expect((JSON.parse(seen) as string[]).map((hex, i) => [keys[i][0], Buffer.from(hex, "hex").toString()])).toEqual(
      keys.map(([name, , text]) => [name, text]),
    );
  });

  test("gets every repeat of a key in order, with a pause in between", async () => {
    const [, runs] = await runOnConsole(
      `
        ${passKeysOnAsTheyAre}
        let text = "";
        process.stdin.setEncoding("utf8").on("data", chunk => {
          if (!text) {
            process.stdin.pause();
            setImmediate(() => process.stdin.resume());
          }
          text += chunk;
          if (!text.endsWith(".")) return;
          process.stdout.write("RESULT " + JSON.stringify(text.match(/(.)\\1*/g).map(run => run[0] + run.length)));
        });
        press(${JSON.stringify([a, b, fullStop])});
      `,
      /RESULT (\[[^\]]*\])/,
    );
    expect(JSON.parse(runs)).toEqual(["a65535", "b65535", ".1"]);
  });

  // One event stands for up to 65535 keys.
  test("leaves to the console what it has no room for", async () => {
    const events = Array.from({ length: 600 }, (_, i) => (i % 2 ? b : a));
    const [, left] = await runOnConsole(
      `
        ${passKeysOnAsTheyAre}
        process.stdin.once("data", () => {
          process.stdin.pause();
          const count = new Uint32Array(1);
          kernel32.GetNumberOfConsoleInputEvents(input, count);
          process.stdout.write("LEFT " + count[0] + ";");
        });
        press(${JSON.stringify(events)});
      `,
      /LEFT (\d+);/,
    );
    expect(Number(left)).toBeGreaterThanOrEqual(300);
  });
});

describe.skipIf(!isWindows)("process.stdin on a console that reads lines", () => {
  // The console can only take a read back by ending every read that waits on it, with nothing.
  test("does not end the read of a child when it stops reading before anything is typed", async () => {
    let typed = false;
    const [, line] = await runOnConsole(
      `
        const { spawn } = require("node:child_process");
        process.stdin.on("data", () => {});
        const child = spawn(
          process.execPath,
          [
            "-e",
            \`
              const fs = require("node:fs");
              process.send("reading", () => {
                const buffer = Buffer.alloc(64);
                const length = fs.readSync(0, buffer);
                fs.writeSync(1, "CHILD " + JSON.stringify(buffer.toString("latin1", 0, length)) + ";");
              });
            \`,
          ],
          { stdio: ["inherit", "inherit", "inherit", "ipc"] },
        );
        child.on("message", () => {
          // The loop has to wait in between for a read to start.
          let rounds = 10;
          const timer = setInterval(() => {
            process.stdin.pause();
            if (--rounds) return process.stdin.resume();
            clearInterval(timer);
            process.stdout.write("QUIET;");
          }, 10);
        });
        await new Promise(() => {});
      `,
      /CHILD ("[^"]*");/,
      {
        onText(text, terminal) {
          if (!typed && text.includes("QUIET;")) {
            typed = true;
            terminal.write("abc\r");
          }
        },
      },
    );
    expect(JSON.parse(line)).toBe("abc\r\n");
  });

  // From the first key on, the console edits a line for the read. It has to be made to drop both.
  test("gets the next line after it stopped reading in the middle of one", async () => {
    using dir = tempDir("tty-console-midline", {});
    const echoed = join(String(dir), "echoed");
    let step = 0;
    const [, line] = await runOnConsole(
      `
        const fs = require("node:fs");
        process.stdin.on("data", chunk => process.stdout.write("DATA " + JSON.stringify(String(chunk)) + ";"));
        process.stdout.write("READY;");
        const timer = setInterval(() => {
          if (!fs.existsSync(${JSON.stringify(echoed)})) return;
          clearInterval(timer);
          process.stdin.pause();
          setImmediate(() => {
            process.stdin.resume();
            process.stdout.write("RESUMED;");
          });
        }, 5);
      `,
      /DATA ("[^"]*");/,
      {
        onText(text, terminal) {
          if (step === 0 && text.includes("READY;")) {
            step = 1;
            terminal.write("par");
          } else if (step === 1 && text.includes("READY;par")) {
            step = 2;
            fs.writeFileSync(echoed, "");
          } else if (step === 2 && text.includes("RESUMED;")) {
            step = 3;
            terminal.write("tial\r");
          }
        },
      },
    );
    expect(JSON.parse(line)).toBe("tial\r\n");
  });

  // The console keeps what a read of 8192 units has no room for, and has nothing more to say about it.
  test.each([
    ["fills a read", Buffer.alloc(8190, "a").toString()],
    ["is one unit longer than a read", Buffer.alloc(8191, "a").toString()],
    ["takes three reads", Buffer.alloc(20000, "a").toString()],
    ["has Ctrl+Z where the second read starts", Buffer.alloc(8192, "a").toString() + "\x1ab"],
  ])("gets all of a line that %s without another key", async (_, line) => {
    let typed = 0;
    const [, first, second] = await runOnConsole(
      `
        let received = 0, lines = 0;
        process.stdin.on("end", () => process.stdout.write("END;"));
        process.stdin.on("data", chunk => {
          received += chunk.length;
          if (chunk.at(-1) === 10) process.stdout.write(["FIRST ", "SECOND "][lines++] + received + ";");
        });
        process.stdout.write("READY;");
      `,
      /FIRST (\d+);.*SECOND (\d+);|END;/,
      {
        onText(text, terminal) {
          if (typed === 0 && text.includes("READY;")) {
            typed = 1;
            terminal.write(line + "\r");
          } else if (typed === 1 && text.includes("FIRST ")) {
            typed = 2;
            terminal.write("b\r");
          }
        },
      },
    );
    // Before Windows 11 24H2 the console takes no more of a line than the read has room for.
    expect([line.length + 2, 8192]).toContain(Number(first));
    expect(Number(second)).toBe(Number(first) + 3);
  });

  test("fails once the process behind the console is gone, with nothing typed", async () => {
    using dir = tempDir("tty-console-gone", {});
    const script = `
      const fs = require("node:fs");
      const say = line => fs.appendFileSync("said.txt", line + "\\n");
      process.stdin.on("error", error => say(error.code));
      process.stdin.on("close", () => say("close"));
      process.stdin.on("data", () => {});
      const { symbols: ntdll } = require("bun:ffi").dlopen("ntdll.dll", {
        NtQueryInformationProcess: { args: ["i64", "u32", "ptr", "u32", "ptr"], returns: "i32" },
      });
      const ProcessConsoleHostProcess = 49, host = new BigUint64Array(1);
      ntdll.NtQueryInformationProcess(-1n, ProcessConsoleHostProcess, host, 8, null);
      // The host passes the text on before it answers the write, so it may be gone by then.
      process.stdout.on("error", () => {});
      setImmediate(() => process.stdout.write("HOST " + (host[0] & ~3n) + ";"));
    `;
    let output = "";
    let ended = false;
    await using terminal = new Bun.Terminal({
      data(_, chunk: Uint8Array) {
        if (ended) return;
        output += Buffer.from(chunk).toString("latin1");
        const host = output.match(/HOST (\d+);/);
        if (!host) return;
        ended = true;
        process.kill(Number(host[1]));
      },
    });
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, cwd: String(dir), terminal });
    // Ends a child that does not notice while the test can still report what it said.
    const watchdog = setTimeout(() => proc.kill(), 20_000);
    const exitCode = await proc.exited;
    clearTimeout(watchdog);
    expect(fs.readFileSync(join(String(dir), "said.txt"), "utf8")).toBe("EPIPE\nclose\n");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("ReadStream destroy()", () => {
  // As in Node, whose tty.ReadStream wraps a libuv handle that never closes
  // descriptors 0-2: destroying a ReadStream on fd 0 leaves fd 0 open, and one
  // on a higher fd closes it.
  test("leaves fd 0 open and closes a higher fd", async () => {
    const script = `
      const fs = require("fs");
      const tty = require("tty");
      const isOpen = fd => { try { fs.fstatSync(fd); return true; } catch { return false; } };
      const stdin = new tty.ReadStream(0);
      stdin.on("close", () => {
        const fd = fs.openSync(process.execPath, "r");
        const other = new tty.ReadStream(fd);
        other.on("close", () => console.log(JSON.stringify({ fd0: isOpen(0), higherFd: isOpen(fd) })));
        other.destroy();
      });
      stdin.destroy();
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      stdin: Bun.file(import.meta.path),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: '{"fd0":true,"higherFd":false}', stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("runs a subclass's _destroy on fds 0-2", async () => {
    const script = `
      const fs = require("fs");
      const tty = require("tty");
      const { once } = require("events");
      const isOpen = fd => { try { fs.fstatSync(fd); return true; } catch { return false; } };
      const out = process.stdout;
      const destroyed = [];
      class Sub extends tty.ReadStream {
        _destroy(err, cb) {
          destroyed.push(this.fd);
          super._destroy(err, cb);
        }
      }
      (async () => {
        for (const fd of [0, 1, 2]) {
          const stream = new Sub(fd);
          stream.destroy();
          await once(stream, "close");
        }
        out.write(JSON.stringify({ destroyed, open: [0, 1, 2].map(isOpen) }));
      })();
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      stdin: Bun.file(import.meta.path),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: '{"destroyed":[0,1,2],"open":[true,true,true]}', stderr: "" });
    expect(exitCode).toBe(0);
  });

  // The parent leaves the child's stdin open and silent until the child has reported, so the child's
  // read is in flight at destroy(). Closing it then ends that read, which is what lets the child exit.
  test("on fd 0 does not wait for a read in flight", async () => {
    const script = `
      const tty = require("tty");
      const stdin = new tty.ReadStream(0);
      let closed = false;
      stdin.on("close", () => (closed = true));
      stdin.resume();
      setImmediate(() => {
        stdin.destroy();
        setImmediate(() => console.log(JSON.stringify({ closed })));
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    async function readStdoutThenCloseStdin() {
      const decoder = new TextDecoder();
      let stdout = "";
      for await (const chunk of proc.stdout) {
        stdout += decoder.decode(chunk, { stream: true });
        if (stdout.includes("\n")) proc.stdin.end();
      }
      return stdout;
    }

    const [stdout, stderr, exitCode] = await Promise.all([readStdoutThenCloseStdin(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: '{"closed":true}', stderr: "" });
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("WriteStream destroy()", () => {
  async function destroyStdioStreams(exhaustDescriptors: boolean) {
    const script = `
      const fs = require("fs");
      const tty = require("tty");
      const { once } = require("events");
      const isOpen = fd => { try { fs.fstatSync(fd); return true; } catch { return false; } };
      const hasSink = s => Object.getOwnPropertySymbols(s).some(sym => sym.description === "kWriteStreamFastPath");
      const out = process.stdout;
      const destroyed = [];
      const errors = [];
      class Sub extends tty.WriteStream {
        _destroy(err, cb) {
          destroyed.push(this.fd);
          super._destroy(err, cb);
        }
      }
      (async () => {
        // A debug build opens each builtin module's file on first use, so load them while it still can.
        const warmup = new tty.WriteStream(1);
        warmup.destroy();
        await once(warmup, "close");

        const held = [];
        let code;
        try {
          while (${exhaustDescriptors}) held.push(fs.openSync(process.execPath, "r"));
        } catch (e) {
          code = e.code;
        }
        const streams = [0, 1, 2].map(fd => new Sub(fd));
        held.forEach(fd => fs.closeSync(fd));
        await new Promise(resolve => setImmediate(resolve)); // a write before construction ends is only queued
        for (const stream of streams) {
          stream.on("error", e => errors.push(e.code));
          stream.write(""); // without a FileSink, still in flight at destroy()
          stream.destroy();
          await new Promise(resolve => stream.on("close", resolve)); // once() would reject on "error"
        }
        const sinks = code && [warmup, ...streams].map(hasSink);
        const pending = streams.map(s => s.pending);
        out.write(JSON.stringify({ code, sinks, destroyed, errors, pending, open: [0, 1, 2].map(isOpen) }));
      })();
    `;
    await using proc = Bun.spawn({
      cmd: [...(exhaustDescriptors ? ["sh", "-c", 'ulimit -n 64 && exec "$0" "$@"'] : []), bunExe(), "-e", script],
      stdin: Bun.file(import.meta.path),
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("leaves fds 0-2 open", async () => {
    expect(await destroyStdioStreams(false)).toEqual({
      stdout: '{"destroyed":[0,1,2],"errors":[],"pending":[true,true,true],"open":[true,true,true]}',
      stderr: "",
      exitCode: 0,
    });
  });

  // The FileSink writes to its own dup of the fd. With no descriptor left for the dup, the
  // stream falls back to node:fs on the fd itself, and only then could destroy() close it.
  // Windows has no ulimit, so this cannot take the sink away.
  test.skipIf(isWindows)("leaves fds 0-2 open when it has no FileSink", async () => {
    expect(await destroyStdioStreams(true)).toEqual({
      stdout:
        '{"code":"EMFILE","sinks":[true,false,false,false],"destroyed":[0,1,2],"errors":[],' +
        '"pending":[true,true,true],"open":[true,true,true]}',
      stderr: "",
      exitCode: 0,
    });
  });
});

describe("WriteStream end()", () => {
  // The parent does not read the child's stdout until the child has called
  // end(), so most of the 1 MiB sits in the stream's sink at that point. The
  // callback must wait for it, or process.exit truncates the output.
  //
  // Windows: a write to an inherited stdout pipe blocks until the reader
  // drains it (every write() returns true), so the child never reaches end()
  // while the parent waits, and there is no backlog to flush.
  it.skipIf(isWindows)("fires the callback after the backlog is flushed", async () => {
    const child = spawn(
      bunExe(),
      [
        "-e",
        `const { WriteStream } = require("node:tty");
         const out = new WriteStream(1);
         const chunk = Buffer.alloc(256 * 1024, 120);
         for (let i = 0; i < 4; i++) out.write(chunk);
         out.end(() => process.exit(0));
         process.send("ending");`,
      ],
      { env: bunEnv, stdio: ["ignore", "pipe", "pipe", "ipc"] },
    );
    let received = 0;
    let reading = false;
    // 'exit' is the fallback for a child that dies before it sends "ending".
    const read = () => {
      if (reading) return;
      reading = true;
      child.stdout!.on("data", d => (received += d.length));
    };
    child.on("message", read);
    child.on("exit", read);
    const stderr = new Promise<string>(resolve => {
      let err = "";
      child.stderr!.on("data", d => (err += d));
      child.stderr!.on("end", () => resolve(err));
    });
    const { promise: ended, resolve: onEnd } = Promise.withResolvers<void>();
    child.stdout!.on("end", onEnd);
    const exited = new Promise<number | null>(resolve => child.on("exit", resolve));

    await ended;
    expect(await stderr).toBe("");
    expect(received).toBe(4 * 256 * 1024);
    expect(await exited).toBe(0);
  });
});

describe("WriteStream.prototype", () => {
  test("keeps its methods off fs.WriteStream", () => {
    const names = [...Object.getOwnPropertyNames(WriteStream.prototype), Symbol.asyncIterator];
    expect(names).toContain("hasColors");
    const overrides: PropertyKey[] = ["constructor", "_destroy"];
    expect(names.filter(name => !overrides.includes(name) && name in fs.WriteStream.prototype)).toEqual([]);
    expect(Object.create(fs.WriteStream.prototype) instanceof WriteStream).toBe(false);
    expect(Object.create(WriteStream.prototype) instanceof fs.WriteStream).toBe(true);
  });

  // As in Node: libuv has written to the console when uv_write returns.
  test.skipIf(!isWindows)("write() to a console is synchronous, whichever descriptor it is", async () => {
    const [, written] = await runOnConsole(
      `
        const fs = require("node:fs");
        const { WriteStream } = require("node:tty");
        const out = new WriteStream(fs.openSync("//./CONOUT$", "r+"));
        fs.writeSync(1, "START;");
        for (let i = 0; i < 3; i++) {
          out.write("stream" + i + ";");
          fs.writeSync(1, "sync" + i + ";");
        }
        fs.writeSync(1, "END;");
      `,
      /START;(.*)END;/,
    );
    expect(written).toBe("stream0;sync0;stream1;sync1;stream2;sync2;");
  });

  // The console host of Server 2019 passes a surrogate pair on to the terminal doubled or as U+FFFD.
  test.skipIf(!isWindows).todoIf(windowsBuild < 20348)(
    "a console gets a character whole that is written in pieces",
    async () => {
      const [, ...seen] = await runOnConsole(
        `
        const fs = require("node:fs");
        const burger = Buffer.from("\u{1f354}");
        const write = bytes => new Promise(resolve => process.stdout.write(bytes, resolve));
        await write("A[");
        for (const byte of burger) await write(Buffer.from([byte]));
        await write("]B[");
        await write(Buffer.concat([Buffer.from("x"), burger.subarray(0, 3)]));
        await write(Buffer.concat([burger.subarray(3), Buffer.from("y")]));
        await write("]C[");
        fs.writeSync(1, burger.subarray(0, 2));
        fs.writeSync(1, burger.subarray(2));
        await write("]D[");
        await write(Buffer.concat([Buffer.alloc(8190, "a"), burger, Buffer.from("b")]));
        await write("]E[");
        await write(burger.subarray(0, 2));
        await write("z]F[");
        await write(Buffer.concat([burger.subarray(0, 3), Buffer.from("z")]));
        await write("]END");
      `,
        /A\[(.*)\]B\[(.*)\]C\[(.*)\]D\[(.*)\]E\[(.*)\]F\[(.*)\]END/,
        { cols: 1000 },
      );
      expect(seen).toEqual([
        "\u{1f354}",
        "x\u{1f354}y",
        "\u{1f354}",
        Buffer.alloc(8190, "a").toString() + "\u{1f354}b",
        "\ufffdz",
        "\ufffdz",
      ]);
    },
  );

  test.skipIf(!isWindows)("a console has a size, whichever descriptor it is", async () => {
    const [, sizes] = await runOnConsole(
      `
        const fs = require("node:fs");
        const { WriteStream } = require("node:tty");
        const out = new WriteStream(fs.openSync("//./CONOUT$", "r+"));
        process.stdout.write("SIZE " + JSON.stringify([out.columns, out.rows, ...out.getWindowSize()]));
      `,
      /SIZE (\[[^\]]*\])/,
      { cols: 91, rows: 17 },
    );
    expect(JSON.parse(sizes)).toEqual([91, 17, 91, 17]);
  });

  test.skipIf(!isWindows)("columns is the width of the screen buffer, where text wraps, as in Node.js", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { dlopen, ptr } = require("bun:ffi");
          const { CreateFileW, SetConsoleScreenBufferSize } = dlopen("kernel32.dll", {
            CreateFileW: { args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "ptr"], returns: "ptr" },
            SetConsoleScreenBufferSize: { args: ["ptr", "u32"], returns: "i32" },
          }).symbols;
          const size = () => {
            const out = new (require("node:tty").WriteStream)(require("node:fs").openSync("//./CONOUT$", "r+"));
            const size = [out.columns, out.rows];
            out.destroy();
            return size;
          };
          const [columns, rows] = size();
          const [GENERIC_READ_WRITE, FILE_SHARE_READ_WRITE, OPEN_EXISTING] = [0xc0000000, 3, 3];
          const name = Buffer.from("CONOUT$\\0", "utf16le");
          const handle = CreateFileW(ptr(name), GENERIC_READ_WRITE, FILE_SHARE_READ_WRITE, null, OPEN_EXISTING, 0, null);
          const widened = SetConsoleScreenBufferSize(handle, ((rows + 100) << 16) | (columns + 50));
          const [columnsNow, rowsNow] = size();
          console.log(JSON.stringify([widened !== 0, columnsNow - columns, rowsNow - rows]));
        `,
      ],
      env: bunEnv,
      // A console of its own without a window. The buffer of a pseudoconsole is always as wide as its window.
      windowsHide: true,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(JSON.parse(stdout)).toEqual([true, 50, 0]);
    expect(exitCode).toBe(0);
  });

  test.skipIf(!isWindows)("a line feed leads to the start of a line in any console mode", async () => {
    const [, columns] = await runOnConsole(
      `
        const { ptr, dlopen } = require("bun:ffi");
        const { GetStdHandle, GetConsoleMode, SetConsoleMode, GetConsoleScreenBufferInfo } = dlopen("kernel32.dll", {
          GetStdHandle: { args: ["i32"], returns: "ptr" },
          GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
          SetConsoleMode: { args: ["ptr", "u32"], returns: "i32" },
          GetConsoleScreenBufferInfo: { args: ["ptr", "ptr"], returns: "i32" },
        }).symbols;
        const output = GetStdHandle(-11);
        const DISABLE_NEWLINE_AUTO_RETURN = 8;
        function leaveItSet() {
          const mode = new Uint32Array(1);
          GetConsoleMode(output, ptr(mode));
          SetConsoleMode(output, mode[0] | DISABLE_NEWLINE_AUTO_RETURN);
        }
        function column() {
          const info = new Int16Array(11);
          GetConsoleScreenBufferInfo(output, ptr(info));
          return info[2];
        }
        const columns = [];
        leaveItSet();
        Bun.spawnSync({ cmd: [process.execPath, "-e", 'process.stdout.write("abc\\\\nde")'], stdio: ["inherit", "inherit", "inherit"] });
        columns.push(column());
        leaveItSet();
        const stream = new (require("node:tty").WriteStream)(require("node:fs").openSync("//./CONOUT$", "r+"));
        stream.write("\\r\\nabcd\\nefg");
        columns.push(column());
        process.stdout.write("\\r\\nCOLUMNS " + JSON.stringify(columns));
      `,
      /COLUMNS (\[[^\]]*\])/,
    );
    expect(JSON.parse(columns)).toEqual([2, 3]);
  });

  // The mode belongs to the screen buffer, which the other processes on the console go on writing to.
  test.skipIf(!isWindows).each(["inherit", "pipe"])(
    "a process that ends leaves escape sequences on for the rest of its console (stdout: %s)",
    async stdout => {
      const [, mode] = await runOnConsole(
        `
          const { GetStdHandle, GetConsoleMode, SetConsoleMode } = require("bun:ffi").dlopen("kernel32.dll", {
            GetStdHandle: { args: ["i32"], returns: "ptr" },
            GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
            SetConsoleMode: { args: ["ptr", "u32"], returns: "i32" },
          }).symbols;
          const output = GetStdHandle(-11);
          // Without ENABLE_VIRTUAL_TERMINAL_PROCESSING, which Bun turns on.
          SetConsoleMode(output, 3);
          Bun.spawnSync({ cmd: [process.execPath, "-e", ""], stdio: ["inherit", "${stdout}", "inherit"] });
          const mode = new Uint32Array(1);
          GetConsoleMode(output, mode);
          console.log("MODE " + mode[0] + ";");
        `,
        /MODE (\d+);/,
      );
      expect(mode).toBe("7");
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

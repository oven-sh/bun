// Windows console-control → signal mapping.
//
// Node.js (libuv's uv__signal_control_handler, src/win/signal.c) maps:
//   CTRL_C_EVENT     → SIGINT
//   CTRL_BREAK_EVENT → SIGBREAK
//   CTRL_CLOSE_EVENT → SIGHUP
//
// process.on('SIGHUP'/'SIGBREAK') must therefore watch the console control
// event on Windows so it reaches JS. A name missing from the Windows branch
// of signalNameToNumberMap is treated as a plain emitter event and never
// reaches the console control handler.
//
// We can't reliably synthesise CTRL_CLOSE_EVENT in CI (it requires the user
// or UI automation to actually close a console window), so this test
// checks the name lookup: process.kill(pid, name) resolves `name` through the
// same signalNameToNumberMap that process.on(name, fn) uses to decide whether
// to watch the console. For SIGHUP/SIGBREAK the name resolves and kill() fails
// with ENOSYS, as in Node.js.

import { dlopen, ptr } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { once } from "node:events";
import net from "node:net";
import { join } from "node:path";

test.skipIf(!isWindows)("SIGHUP and SIGBREAK are recognised as signal names on Windows", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const os = require("node:os");
      if (os.constants.signals.SIGHUP !== 1) throw new Error("SIGHUP constant wrong");
      if (os.constants.signals.SIGBREAK !== 21) throw new Error("SIGBREAK constant wrong");

      for (const sig of ["SIGHUP", "SIGBREAK"]) {
        // Registering a listener must not throw.
        const fn = () => {};
        process.on(sig, fn);
        process.off(sig, fn);

        // Resolving the name in process.kill must not throw ERR_UNKNOWN_SIGNAL.
        // (kill() returns ENOSYS for these on Windows, which matches Node.js.)
        try {
          process.kill(process.pid, sig);
          console.log(sig, "no error");
        } catch (e) {
          console.log(sig, e.code ?? e.message);
        }
      }
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).not.toContain("ERR_UNKNOWN_SIGNAL");
  expect(stdout.trim().split("\n")).toEqual(["SIGHUP ENOSYS", "SIGBREAK ENOSYS"]);
  expect(exitCode).toBe(0);
});

// A process on a pseudoconsole of its own sends itself the control event:
// GenerateConsoleCtrlEvent reaches every process attached to the caller's console.
describe.skipIf(!isWindows)("console control events", () => {
  const prelude = `
    const { dlopen, ptr } = require("bun:ffi");
    const k32 = dlopen("kernel32.dll", {
      GetStdHandle: { args: ["i32"], returns: "ptr" },
      GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
      SetConsoleCtrlHandler: { args: ["ptr", "i32"], returns: "i32" },
      GenerateConsoleCtrlEvent: { args: ["u32", "u32"], returns: "i32" },
    }).symbols;
    const inputMode = () => {
      const mode = new Uint32Array(1);
      if (!k32.GetConsoleMode(k32.GetStdHandle(-10), ptr(mode))) throw new Error("GetConsoleMode");
      return mode[0];
    };
    const raise = event => {
      // A process started in a new process group ignores Ctrl+C until it asks not to.
      k32.SetConsoleCtrlHandler(null, 0);
      if (!k32.GenerateConsoleCtrlEvent(event, 0)) throw new Error("GenerateConsoleCtrlEvent");
    };
  `;

  // What a terminal has shown. A pseudoconsole hands over a child's last output
  // after the child is gone, so it is read when it is there, not when the child exits.
  function terminalOutput() {
    let output = "";
    const waiters: { pattern: RegExp; resolve: (match: RegExpMatchArray | null) => void }[] = [];
    const shown = () => Bun.stripANSI(output);
    return {
      shown,
      options: {
        data(_terminal: Bun.Terminal, chunk: Uint8Array) {
          output += Buffer.from(chunk).toString("latin1");
          const text = shown();
          for (const waiter of waiters) {
            const match = text.match(waiter.pattern);
            if (match) waiter.resolve(match);
          }
        },
        // Everything has been delivered: what has not matched by now never will.
        exit() {
          for (const waiter of waiters) waiter.resolve(null);
        },
      },
      match(pattern: RegExp) {
        const { promise, resolve } = Promise.withResolvers<RegExpMatchArray | null>();
        waiters.push({ pattern, resolve });
        return promise;
      },
    };
  }

  test.concurrent.each([
    ["SIGINT", 0],
    ["SIGBREAK", 1],
  ])("%s reaches its listener and leaves the console's modes alone", async (signal, event) => {
    const { options, match } = terminalOutput();
    const done = match(/before=(\d+) after=(\d+) DONE/);
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        prelude +
          `
          const tty = new (process.binding("tty_wrap").TTY)(0);
          tty.setRawMode(1);
          tty.setRawMode(0);
          process.stdin.setRawMode(true);
          const before = inputMode();
          process.on("${signal}", () => {
            process.stdout.write("${signal} before=" + before + " after=" + inputMode() + " DONE");
            process.exit(0);
          });
          setInterval(() => {}, 100000);
          raise(${event});
          `,
      ],
      env: bunEnv,
      // Of its own: the terminal ends when the child is gone, so a child that
      // dies without printing fails the test instead of hanging it.
      terminal: options,
    });
    const [, before, after] = (await done) ?? [];
    const exitCode = await proc.exited;
    proc.terminal!.close();
    expect({ before, after }).toEqual({ before: expect.any(String), after: before });
    expect(exitCode).toBe(0);
  });

  test.concurrent.each([
    ["Ctrl+C", 0],
    ["Ctrl+Break", 1],
  ])("%s without a listener ends the process with the console's input mode put back", async (_name, event) => {
    const { options, match, shown } = terminalOutput();
    // One terminal for both: the second process finds the mode the first left.
    await using terminal = new Bun.Terminal(options);
    const run = (script: string) => Bun.spawn({ cmd: [bunExe(), "-e", prelude + script], env: bunEnv, terminal });
    const exitCode = await run(`
      process.stdout.write("first=" + inputMode() + ";");
      process.stdin.setRawMode(true);
      setInterval(() => {}, 100000);
      raise(${event});
    `).exited;
    const secondShown = match(/second=(\d+);/);
    const secondProcess = run(`process.stdout.write("second=" + inputMode() + ";");`);
    // The terminal shows output in the order it was written, so the first
    // process's is there as well.
    const second = (await secondShown)?.[1];
    const first = shown().match(/first=(\d+);/)?.[1];
    await secondProcess.exited;
    expect({ first, second }).toEqual({ first: expect.any(String), second: first });
    // STATUS_CONTROL_C_EXIT
    expect(exitCode).toBe(0xc000013a & 0xff);
  });
});

test.skipIf(!isWindows)("a console window's resize raises SIGWINCH in a process that does not read stdin", async () => {
  using dir = tempDir("sigwinch-console-window", {
    "child.js": `
      const { dlopen, ptr } = require("bun:ffi");
      const k32 = dlopen("kernel32.dll", {
        GetStdHandle: { args: ["i32"], returns: "ptr" },
        GetConsoleScreenBufferInfo: { args: ["ptr", "ptr"], returns: "i32" },
        SetConsoleWindowInfo: { args: ["ptr", "i32", "ptr"], returns: "i32" },
      }).symbols;
      const out = k32.GetStdHandle(-11);
      const resizeWindow = (columns, rows) => {
        if (!k32.SetConsoleWindowInfo(out, 1, ptr(new Int16Array([0, 0, columns - 1, rows - 1])))) throw new Error("SetConsoleWindowInfo");
      };
      const sizes = () => {
        const info = new Int16Array(11);
        k32.GetConsoleScreenBufferInfo(out, ptr(info));
        return {
          reported: [process.stdout.columns, process.stdout.rows],
          bufferWidth: info[0],
          window: [info[7] - info[5] + 1, info[8] - info[6] + 1],
        };
      };
      // A window narrower than the screen buffer.
      resizeWindow(60, 25);
      const sock = require("net").connect(+process.argv[2], "127.0.0.1", () => {
        const before = [process.stdout.columns, process.stdout.rows];
        let first;
        process.on("SIGWINCH", () => {
          if (!first) {
            // Whether the watcher heard of this resize from the console or found it
            // when it started, it is listening for the console's events by now.
            first = sizes();
            // Only such an event can report this one.
            resizeWindow(60, 22);
          } else if (!sock.writableEnded) {
            sock.end(JSON.stringify({ before, first, second: sizes() }));
          }
        });
        resizeWindow(60, 20);
      });
      sock.on("close", () => process.exit(0));
    `,
  });

  const { promise: report, resolve } = Promise.withResolvers<string>();
  const server = net.createServer(socket => {
    let data = "";
    socket.on("data", chunk => (data += chunk));
    socket.on("end", () => resolve(data));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as net.AddressInfo).port;

  // A console of its own, with a window, that is never shown.
  const k32 = dlopen("kernel32.dll", {
    CreateProcessW: {
      args: ["ptr", "ptr", "ptr", "ptr", "i32", "u32", "ptr", "ptr", "ptr", "ptr"],
      returns: "i32",
    },
    TerminateProcess: { args: ["ptr", "u32"], returns: "i32" },
    CloseHandle: { args: ["ptr"], returns: "i32" },
  }).symbols;
  const CREATE_NEW_CONSOLE = 0x10;
  const STARTF_USESHOWWINDOW = 0x1;
  const commandLine = Buffer.from(`"${bunExe()}" "${join(String(dir), "child.js")}" ${port} `, "utf16le");
  const startupInfo = new Uint8Array(104);
  const startup = new DataView(startupInfo.buffer);
  startup.setUint32(0, 104, true); // cb
  startup.setUint32(60, STARTF_USESHOWWINDOW, true); // dwFlags
  startup.setUint16(64, 0, true); // wShowWindow = SW_HIDE
  const processInfo = new BigUint64Array(3);
  try {
    expect(
      k32.CreateProcessW(
        null,
        ptr(commandLine),
        null,
        null,
        0,
        CREATE_NEW_CONSOLE,
        null,
        null,
        ptr(startupInfo),
        ptr(processInfo),
      ),
    ).not.toBe(0);
    const { before, first, second } = JSON.parse(await report);
    const bufferWidth = second.bufferWidth;
    expect(bufferWidth).toBeGreaterThan(60);
    // columns is where text wraps: the width of the screen buffer, as in Node.
    expect({ before, first, second }).toEqual({
      before: [bufferWidth, 25],
      first: { reported: [bufferWidth, 20], bufferWidth, window: [60, 20] },
      second: { reported: [bufferWidth, 22], bufferWidth, window: [60, 22] },
    });
  } finally {
    server.close();
    if (processInfo[0]) {
      k32.TerminateProcess(Number(processInfo[0]), 1);
      k32.CloseHandle(Number(processInfo[0]));
      k32.CloseHandle(Number(processInfo[1]));
    }
  }
});

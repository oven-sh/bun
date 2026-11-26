import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { type AddressInfo, createServer, type Socket } from "node:net";
import { release } from "node:os";
import { createInterface } from "node:readline";
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
  // Windows has no ulimit, and its FileSink takes the fd without a dup, so this cannot take the sink away.
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

  // The same in a debug build, a release build and a compiled program.
  it("has no name", () => {
    expect(WriteStream.prototype.getColorDepth.name).toBe("");
    expect(WriteStream.prototype.getColorDepth.length).toBe(0);
  });
});

describe.concurrent("stdio in a terminal", () => {
  const ffiPrelude = `
    const k32 = process.platform === "win32" && require("bun:ffi").dlopen("kernel32.dll", {
      SetConsoleCtrlHandler: { args: ["ptr", "i32"], returns: "i32" },
      GenerateConsoleCtrlEvent: { args: ["u32", "u32"], returns: "i32" },
      GetStdHandle: { args: ["i32"], returns: "i64" },
      GetConsoleMode: { args: ["i64", "ptr"], returns: "i32" },
      SetConsoleMode: { args: ["i64", "u32"], returns: "i32" },
      ReadConsoleInputW: { args: ["i64", "ptr", "u32", "ptr"], returns: "i32" },
      GetConsoleScreenBufferInfo: { args: ["i64", "ptr"], returns: "i32" },
      GetConsoleCP: { args: [], returns: "u32" },
      GetConsoleOutputCP: { args: [], returns: "u32" },
      SetConsoleCP: { args: ["u32"], returns: "i32" },
      SetConsoleOutputCP: { args: ["u32"], returns: "i32" },
      WriteConsoleInputW: { args: ["i64", "ptr", "u32", "ptr"], returns: "i32" },
      SetConsoleActiveScreenBuffer: { args: ["i64"], returns: "i32" },
      WaitForSingleObject: { args: ["i64", "u32"], returns: "u32" },
      ReadConsoleOutputCharacterW: { args: ["i64", "ptr", "u32", "u32", "ptr"], returns: "i32" },
    }).symbols;
    const STD_INPUT_HANDLE = -10;
    const STD_OUTPUT_HANDLE = -11;
    const isOnRow = (y, text) => {
      const row = new Uint16Array(80);
      k32.ReadConsoleOutputCharacterW(k32.GetStdHandle(STD_OUTPUT_HANDLE), row, 80, y << 16, new Uint32Array(1));
      return String.fromCharCode(...row).includes(text);
    };
    const INPUT_RECORD_SIZE = 20;
    function writeKeyEvents(events) {
      const records = Buffer.alloc(INPUT_RECORD_SIZE * events.length);
      events.forEach(([isKeyDown, virtualKey, char, controlKeyState = 0, repeatCount = 1], i) => {
        records.writeUInt16LE(1 /* KEY_EVENT */, INPUT_RECORD_SIZE * i);
        records.writeInt32LE(isKeyDown, INPUT_RECORD_SIZE * i + 4);
        records.writeUInt16LE(repeatCount, INPUT_RECORD_SIZE * i + 8);
        records.writeUInt16LE(virtualKey, INPUT_RECORD_SIZE * i + 10);
        records.writeUInt16LE(char, INPUT_RECORD_SIZE * i + 14);
        records.writeUInt32LE(controlKeyState, INPUT_RECORD_SIZE * i + 16);
      });
      k32.WriteConsoleInputW(k32.GetStdHandle(STD_INPUT_HANDLE), records, events.length, new Uint32Array(1));
    }
    // Shift makes the console deliver keys that arrived while it set up a read (microsoft/terminal#18816).
    async function typeIntoLineRead(y, text) {
      writeKeyEvents([...text].map(char => [1, 0x41, char.charCodeAt(0)]));
      while (!isOnRow(y, text)) {
        writeKeyEvents([[1, 0x10, 0]]);
        await Bun.sleep(1);
      }
    }
  `;
  // ConPTY redraws what the child prints, so the child reports over a socket with `send(value)`.
  // `await waitForContinue()` in the child resumes when the test calls `sendContinue()`.
  const prelude = `
    const fs = require("fs");
    const tty = require("tty");
    const control = require("net").connect(Number(process.env.CONTROL_PORT), "127.0.0.1").setNoDelay();
    const controlLines = require("readline").createInterface({ input: control })[Symbol.asyncIterator]();
    const send = (value, callback) => control.write(JSON.stringify(value) + "\\n", callback);
    const waitForContinue = () => controlLines.next();
    const settleEventLoop = async () => { for (let i = 0; i < 20; i++) await Bun.sleep(1); };
    const forwardData = stream => stream.on("data", chunk => send(["data", String(chunk)])).on("end", () => send(["data", "end"]));
    ${ffiPrelude}
    // CI agents run with Ctrl+C ignored, and child processes inherit that setting.
    if (k32) k32.SetConsoleCtrlHandler(null, 0);
  `;
  async function spawnChild(script: string, files: Record<string, string> = {}) {
    const dir = tempDir("tty-input", {
      ...files,
      "main.js": `${prelude}\nwaitForContinue().then(async () => { ${script} });`,
    });
    const server = createServer();
    await once(server.listen(0, "127.0.0.1"), "listening");
    const connected = once(server, "connection");
    let screen = "";
    const decoder = new TextDecoder();
    const proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      cwd: String(dir),
      env: { ...bunEnv, CONTROL_PORT: String((server.address() as AddressInfo).port) },
      windowsHide: true,
      terminal: { cols: 80, rows: 24, data: (_, chunk) => void (screen += decoder.decode(chunk, { stream: true })) },
    });
    const earlyExit = proc.exited.then(code => Promise.reject(new Error(`exited with ${code}:\n${screen}`)));
    const [control] = (await Promise.race([connected, earlyExit])) as [Socket];
    earlyExit.catch(() => {});
    control.on("error", () => {}).write("\n");
    const messages = createInterface({ input: control })[Symbol.asyncIterator]();
    const receive = async () => {
      const { done, value } = await messages.next();
      if (done) throw new Error(`control socket closed, exit code ${await proc.exited}:\n${screen}`);
      return JSON.parse(value);
    };
    return {
      proc,
      receive,
      screen: () => screen,
      async waitForScreen(text: string) {
        for (const deadline = Date.now() + 4000; !screen.includes(text) && Date.now() < deadline;) await Bun.sleep(2);
        expect(screen).toContain(text);
      },
      type: (keys: string) => void proc.terminal!.write(keys),
      sendContinue: () => void control.write("\n"),
      /** Collects data messages up to the length of `expected`. Any other message fails the test. */
      async expectData(expected: string, source = "data") {
        let received = "";
        while (received.length < expected.length) {
          const message = await receive();
          expect(message).toEqual([source, expect.any(String)]);
          received += message[1];
        }
        expect(received).toBe(expected);
      },
      async [Symbol.asyncDispose]() {
        proc.kill("SIGKILL");
        await proc.exited;
        proc.terminal?.close();
        control.destroy();
        server.close();
        dir[Symbol.dispose]();
      },
    };
  }
  const eol = isWindows ? "\r\n" : "\n";
  const STATUS_CONTROL_C_EXIT = 0xc000013a;

  describe("raw mode", () => {
    const rawReadScript = `process.stdin.setRawMode(true); process.stdin.setEncoding("utf8"); forwardData(process.stdin);`;

    it.each([
      ["a letter", "a"],
      ["Enter", "\r"],
      ["Tab", "\t"],
      ["Ctrl+C", "\x03"],
      ["Ctrl+D", "\x04"],
      ["Ctrl+Z", "\x1a"],
      ["arrow keys", "\x1b[A\x1b[B\x1b[C\x1b[D"],
      ["F1", "\x1bOP"],
      ["Delete", "\x1b[3~"],
      ["Alt+a", "\x1ba"],
      ["2- and 3-byte UTF-8 characters", "é世"],
      ["a 4-byte UTF-8 character", "\u{1F600}"],
    ])("delivers %s immediately and only once", async (_, keys) => {
      await using child = await spawnChild(
        `process.on("SIGINT", () => send("SIGINT")); ${rawReadScript} send("ready");`,
      );
      expect(await child.receive()).toBe("ready");
      child.type(keys);
      await child.expectData(keys);
      child.type("!");
      await child.expectData("!");
    });

    it("delivers a long paste in full", async () => {
      await using child = await spawnChild(`${rawReadScript} send("ready");`);
      expect(await child.receive()).toBe("ready");
      const paste = Buffer.alloc(isWindows ? 6000 : 900, "paste é|").toString();
      child.type(paste);
      await child.expectData(paste);
    });

    it("delivers input typed while paused after resume()", async () => {
      await using child = await spawnChild(`
        ${rawReadScript}
        await settleEventLoop();
        process.stdin.pause();
        send("paused");
        await waitForContinue();
        await settleEventLoop();
        send("resuming");
        process.stdin.resume();
      `);
      expect(await child.receive()).toBe("paused");
      child.type("kept");
      child.sendContinue();
      expect(await child.receive()).toBe("resuming");
      await child.expectData("kept");
    });

    it.each(["pause()", "unref()", "destroy()"])("%s lets the process exit during a raw read", async call => {
      await using child = await spawnChild(
        `${rawReadScript} await settleEventLoop(); process.stdin.${call}; control.end();`,
      );
      expect(await child.proc.exited).toBe(0);
    });

    it("emits 'resize' and SIGWINCH while reading", async () => {
      await using child = await spawnChild(`
        ${rawReadScript}
        process.stdout.on("resize", () => send(["resize", process.stdout.columns, process.stdout.rows]));
        process.on("SIGWINCH", () => send("SIGWINCH"));
        await settleEventLoop();
        send("ready");
      `);
      expect(await child.receive()).toBe("ready");
      child.proc.terminal!.resize(100, 30);
      expect([await child.receive(), await child.receive()]).toEqual([["resize", 100, 30], "SIGWINCH"]);
      child.type("!");
      await child.expectData("!");
    });
  });

  describe("line mode", () => {
    const lineReadScript = `process.stdin.setEncoding("utf8"); forwardData(process.stdin);`;

    it("delivers a line only after Enter", async () => {
      await using child = await spawnChild(
        `${lineReadScript} send("ready"); await waitForContinue(); await settleEventLoop(); send("nothing yet");`,
      );
      expect(await child.receive()).toBe("ready");
      child.type("héllo 世");
      child.sendContinue();
      expect(await child.receive()).toBe("nothing yet");
      child.type("\r");
      await child.expectData(`héllo 世${eol}`);
    });

    it("delivers type-ahead lines in order", async () => {
      await using child = await spawnChild(`send("ready"); await waitForContinue(); ${lineReadScript}`);
      expect(await child.receive()).toBe("ready");
      child.type("one\rtwo\r\rthree\r");
      child.sendContinue();
      await child.expectData(`one${eol}two${eol}${eol}three${eol}`);
    });

    it("delivers a long line of 3-byte characters intact", async () => {
      await using child = await spawnChild(`${lineReadScript} send("ready");`);
      expect(await child.receive()).toBe("ready");
      const text = Buffer.alloc(3 * (isWindows ? 2000 : 300), "世").toString();
      child.type(text + "\r");
      await child.expectData(text + eol);
    });

    it.each(["pause()", "unref()", "destroy()"])("%s lets the process exit during a line read", async call => {
      await using child = await spawnChild(
        `${lineReadScript} await settleEventLoop(); process.stdin.${call}; control.end();`,
      );
      expect(await child.proc.exited).toBe(0);
    });

    it("process.exit() does not wait for a pending read", async () => {
      await using child = await spawnChild(`${lineReadScript} await settleEventLoop(); process.exit(3);`);
      expect(await child.proc.exited).toBe(3);
    });

    it("pause() and resume() do not produce extra input", async () => {
      await using child = await spawnChild(`
        ${lineReadScript}
        for (let i = 0; i < 5; i++) {
          await settleEventLoop();
          process.stdin.pause();
          await settleEventLoop();
          process.stdin.resume();
        }
        await settleEventLoop();
        send("ready");
      `);
      expect(await child.receive()).toBe("ready");
      child.type("x\r");
      await child.expectData(`x${eol}`);
    });

    it("Ctrl+C raises SIGINT and does not end stdin", async () => {
      await using child = await spawnChild(
        `process.on("SIGINT", name => send(name)); ${lineReadScript} await settleEventLoop(); send("ready");`,
      );
      expect(await child.receive()).toBe("ready");
      for (const text of ["one", "two"]) {
        child.type("\x03");
        expect(await child.receive()).toBe("SIGINT");
        child.type(text + "\r");
        await child.expectData(text + eol);
      }
    });

    it("Ctrl+C terminates a process without a SIGINT listener", async () => {
      await using child = await spawnChild(`${lineReadScript} await settleEventLoop(); send("ready");`);
      expect(await child.receive()).toBe("ready");
      child.type("\x03");
      await child.proc.exited;
      if (isWindows) expect(child.proc.exitCode! & 0xff).toBe(STATUS_CONTROL_C_EXIT & 0xff);
      else expect(child.proc.signalCode).toBe("SIGINT");
    });

    it.skipIf(isWindows)("Ctrl+D at the start of a line ends process.stdin", async () => {
      await using child = await spawnChild(`${lineReadScript} send("ready");`);
      expect(await child.receive()).toBe("ready");
      child.type("one\r");
      await child.expectData(`one${eol}`);
      child.type("\x04");
      expect(await child.receive()).toEqual(["data", "end"]);
    });

    it.skipIf(!isWindows).each(["\x1a", "a\x1az"])("Ctrl+Z is delivered as data in the line %j", async line => {
      await using child = await spawnChild(`${lineReadScript} send("ready");`);
      expect(await child.receive()).toBe("ready");
      child.type(line + "\r");
      await child.expectData(line + "\r\n");
    });

    it.skipIf(!isWindows).each([
      ["Ctrl+Z at the start of a line", "\x1a\r"],
      ["Ctrl+C", "\x03"],
    ])("%s ends the input of the shell's cat", async (_, keys) => {
      await using child = await spawnChild(`
        process.on("SIGINT", () => {});
        const ended = Bun.$\`cat > out.txt\`.then(() => send(fs.readFileSync("out.txt", "utf8")));
        while (!fs.statSync("out.txt", { throwIfNoEntry: false })?.size) await Bun.sleep(1);
        await typeIntoLineRead(1, "?");
        writeKeyEvents([[1, 0x08, 0x08]]);
        while (isOnRow(1, "?")) await Bun.sleep(1);
        send("ready");
        await ended;
      `);
      child.type("one\r");
      expect(await child.receive()).toBe("ready");
      child.type(keys);
      expect(await child.receive()).toBe("one\r\n");
    });

    it("delivers a line with a 4-byte UTF-8 character", async () => {
      await using child = await spawnChild(`${lineReadScript} send("ready");`);
      expect(await child.receive()).toBe("ready");
      child.type("\u{1F600}\r");
      await child.expectData(`\u{1F600}${eol}`);
    });

    it("Ctrl+C discards the partially typed line", async () => {
      await using child = await spawnChild(
        `process.on("SIGINT", name => send(name)); ${lineReadScript} await settleEventLoop(); send("ready");`,
      );
      expect(await child.receive()).toBe("ready");
      child.type("dropped");
      await child.waitForScreen("dropped");
      child.type("\x03");
      expect(await child.receive()).toBe("SIGINT");
      child.type("kept\r");
      await child.expectData(`kept${eol}`);
    });

    it.each([
      ["fs.readFileSync(0)", `fs.readFileSync(0, "utf8")`],
      ["Bun.stdin.text()", `await Bun.stdin.text()`],
    ])("the EOF key ends %s", async (_, readExpression) => {
      await using child = await spawnChild(
        `await new Promise(resolve => send("ready", resolve)); send(${readExpression});`,
      );
      expect(await child.receive()).toBe("ready");
      child.type("one\rtwo\r" + (isWindows ? "\x1a\r" : "\x04"));
      expect(await child.receive()).toBe(`one${eol}two${eol}`);
    });
  });

  it("setRawMode() takes effect while a read is pending", async () => {
    await using child = await spawnChild(`
      process.stdin.setEncoding("utf8");
      forwardData(process.stdin);
      for (const isRaw of [true, false, true, true, false, false, true]) {
        await settleEventLoop();
        process.stdin.setRawMode(isRaw);
        send(isRaw);
        await waitForContinue();
      }
    `);
    for (let i = 0; i < 7; i++) {
      const isRaw = await child.receive();
      child.type(isRaw ? `${i}` : `${i}\r`);
      await child.expectData(isRaw ? `${i}` : `${i}${eol}`);
      child.sendContinue();
    }
  });

  it("setRawMode() takes effect inside a 'data' listener", async () => {
    await using child = await spawnChild(`
      process.stdin.on("data", () => process.stdin.setRawMode(!process.stdin.isRaw));
      forwardData(process.stdin);
      send("ready");
    `);
    expect(await child.receive()).toBe("ready");
    for (let i = 0; i < 6; i++) {
      child.type(i % 2 ? `${i}` : `${i}\r`);
      await child.expectData(i % 2 ? `${i}` : `${i}${eol}`);
    }
  });

  it.each([false, true])("a subprocess reads the input while stdin is paused (initially raw: %p)", async isRaw => {
    await using child = await spawnChild(
      `
        process.stdin.setRawMode(${isRaw});
        forwardData(process.stdin);
        await settleEventLoop();
        process.stdin.setRawMode(false);
        process.stdin.pause();
        const grandchild = Bun.spawn([process.execPath, "grandchild.js"], { stdio: ["inherit", "pipe", "inherit"] });
        for await (const chunk of grandchild.stdout) send(["grandchild", String(Buffer.from(chunk))]);
        await grandchild.exited;
        process.stdin.setRawMode(${isRaw});
        process.stdin.resume();
        send("resumed");
      `,
      {
        "grandchild.js": `process.stdin.once("data", chunk => process.stdout.write(chunk, () => process.exit(0))); process.stdout.write("ready|");`,
      },
    );
    await child.expectData("ready|", "grandchild");
    child.type("one\r");
    await child.expectData(`one${eol}`, "grandchild");
    expect(await child.receive()).toBe("resumed");
    child.type("two\r");
    await child.expectData(isRaw ? "two\r" : `two${eol}`);
  });

  it("readline edits a line and ends on Ctrl+D", async () => {
    await using child = await spawnChild(`
      const lines = require("readline").createInterface({ input: process.stdin, output: process.stdout });
      lines.on("line", line => send(line)).on("close", () => send("close"));
      send("ready");
    `);
    expect(await child.receive()).toBe("ready");
    child.type("ac\x1b[Db\r");
    expect(await child.receive()).toBe("abc");
    child.type("\x04");
    expect(await child.receive()).toBe("close");
  });

  it.each([
    ["process.stdout.write()", `await new Promise(resolve => process.stdout.write(text, resolve))`],
    ["console.log()", `console.log(text)`],
    ["Bun.write(Bun.stdout)", `await Bun.write(Bun.stdout, text)`],
    [
      "fs.writeSync(1)",
      `for (let offset = 0, bytes = Buffer.from(text); offset < bytes.length; ) offset += fs.writeSync(1, bytes, offset)`,
    ],
  ])("%s prints long output in full", async (_, printScript) => {
    await using child = await spawnChild(`
      process.stdout.write("");
      const text = Buffer.alloc(60_000, "\\u4e16 line\\n").toString() + "THE-END";
      ${printScript};
      send("printed");
    `);
    expect(await child.receive()).toBe("printed");
    await child.waitForScreen("THE-END");
    expect(child.screen()).not.toContain(String.fromCodePoint(0xfffd));
  });

  describe.skipIf(!isWindows)("Windows console", () => {
    const build = Number(release().split(".")[2]);
    const WINDOWS_SERVER_2019_BUILD = 17763;
    const WINDOWS_11_24H2_BUILD = 26100;
    const CTRL_C_EVENT = 0;
    const CTRL_BREAK_EVENT = 1;

    it("fstat reports fds 0-2 as console character devices", async () => {
      await using child = await spawnChild(
        `send([0, 1, 2].map(fd => { const { mode, nlink, rdev } = fs.fstatSync(fd); return [mode.toString(8), nlink, rdev >> 16, tty.isatty(fd)].join(); }))`,
      );
      // 80 is FILE_DEVICE_CONSOLE.
      expect(await child.receive()).toEqual(["20000,1,80,true", "20000,1,80,true", "20000,1,80,true"]);
    });

    it.each([
      ["SIGINT", CTRL_C_EVENT],
      ["SIGBREAK", CTRL_BREAK_EVENT],
    ])("%s reaches on() listeners every time and once() listeners once", async (signal, ctrlEvent) => {
      await using child = await spawnChild(`
        process.on("${signal}", name => send("first " + name));
        process.once("${signal}", name => send("once " + name));
        for (;;) {
          k32.GenerateConsoleCtrlEvent(${ctrlEvent}, 0);
          await waitForContinue();
        }
      `);
      expect([await child.receive(), await child.receive()]).toEqual([`first ${signal}`, `once ${signal}`]);
      child.sendContinue();
      expect(await child.receive()).toBe(`first ${signal}`);
      child.sendContinue();
      expect(await child.receive()).toBe(`first ${signal}`);
    });

    it.each([
      ["SIGINT", CTRL_C_EVENT, "SIGBREAK"],
      ["SIGBREAK", CTRL_BREAK_EVENT, "SIGINT"],
    ])("%s terminates the process after its listener is removed", async (signal, ctrlEvent, otherSignal) => {
      await using child = await spawnChild(`
        process.on("${otherSignal}", () => send("wrong"));
        process.once("${signal}", name => send(name));
        for (;;) {
          k32.GenerateConsoleCtrlEvent(${ctrlEvent}, 0);
          await waitForContinue();
        }
      `);
      expect(await child.receive()).toBe(signal);
      child.sendContinue();
      expect((await child.proc.exited) & 0xff).toBe(STATUS_CONTROL_C_EXIT & 0xff);
    });

    it("signal listeners do not keep the process alive", async () => {
      await using child = await spawnChild(
        `for (const name of ["SIGINT", "SIGBREAK", "SIGHUP", "SIGWINCH"]) process.on(name, () => {}); control.end();`,
      );
      expect(await child.proc.exited).toBe(0);
    });

    it.each([
      ["mid-screen", 3],
      ["last row", 40],
    ])("cancelling a line read does not move the cursor (%s)", async (_, lineCount) => {
      await using child = await spawnChild(`
        const getCursor = () => {
          const info = new Int16Array(11);
          k32.GetConsoleScreenBufferInfo(k32.GetStdHandle(STD_OUTPUT_HANDLE), info);
          return [info[2], info[3]];
        };
        fs.writeSync(1, Buffer.alloc(${lineCount}, "\\n") + "prompt> ");
        const cursorBefore = getCursor();
        forwardData(process.stdin);
        await settleEventLoop();
        process.stdin.setRawMode(true);
        await settleEventLoop();
        send([cursorBefore, getCursor()]);
      `);
      const [cursorBefore, cursorAfter] = await child.receive();
      expect(cursorBefore[0]).toBe(8);
      expect(cursorAfter).toEqual(cursorBefore);
    });

    // On earlier builds, close() does not close the console while a child is attached.
    it.skipIf(build < WINDOWS_11_24H2_BUILD)("closing the console raises SIGHUP", async () => {
      await using child = await spawnChild(
        `process.on("SIGHUP", name => { send(name); waitForContinue().then(() => process.exit(5)); }); send("ready");`,
      );
      expect(await child.receive()).toBe("ready");
      child.proc.terminal!.close();
      expect(await child.receive()).toBe("SIGHUP");
      child.sendContinue();
      expect(await child.proc.exited).toBe(5);
    });

    it.each([
      ["exits normally", "process.stdin.pause()"],
      ["calls process.exit()", "process.exit(0)"],
      ["throws", "throw new Error('expected')"],
      [
        "receives Ctrl+C",
        "require('bun:ffi').dlopen('kernel32.dll', { GenerateConsoleCtrlEvent: { args: ['u32', 'u32'], returns: 'i32' } }).symbols.GenerateConsoleCtrlEvent(0, 0)",
      ],
    ])("console modes and code pages are restored after a raw-mode process %s", async (_, exitScript) => {
      await using child = await spawnChild(
        `
          process.on("SIGINT", () => {});
          k32.SetConsoleCP(850);
          k32.SetConsoleOutputCP(850);
          const getConsoleState = () => [...[STD_INPUT_HANDLE, STD_OUTPUT_HANDLE].map(stdHandle => {
            const mode = new Uint32Array(1);
            k32.GetConsoleMode(k32.GetStdHandle(stdHandle), mode);
            return mode[0];
          }), k32.GetConsoleCP(), k32.GetConsoleOutputCP()];
          const before = getConsoleState();
          const grandchild = Bun.spawn([process.execPath, "grandchild.js"], { stdio: ["inherit", "inherit", "ignore"] });
          while (!fs.existsSync("raw")) await Bun.sleep(1);
          const during = getConsoleState();
          fs.writeFileSync("exit", "");
          await grandchild.exited;
          send({ before, during, after: getConsoleState() });
        `,
        {
          "grandchild.js": `
            const fs = require("fs");
            process.stdin.setRawMode(true).resume();
            fs.writeFileSync("raw", "");
            while (!fs.existsSync("exit")) Bun.sleepSync(1);
            setImmediate(() => { ${exitScript} });
          `,
        },
      );
      const { before, during, after } = await child.receive();
      const CP_UTF8 = 65001;
      expect(during[0]).not.toBe(before[0]);
      expect(during.slice(2)).toEqual([CP_UTF8, CP_UTF8]);
      expect(after).toEqual(before);
    });

    // Input typed before raw mode is enabled, or after another process changes the mode, arrives in this form.
    describe("KEY_EVENT records without ENABLE_VIRTUAL_TERMINAL_INPUT", () => {
      const keyEventPrelude = `
        process.stdin.setRawMode(true).setEncoding("utf8");
        k32.SetConsoleMode(k32.GetStdHandle(STD_INPUT_HANDLE), 0x8 /* ENABLE_WINDOW_INPUT */);
        forwardData(process.stdin);
      `;
      const LEFT_ALT_PRESSED = 0x2;
      const LEFT_CTRL_PRESSED = 0x8;
      const SHIFT_PRESSED = 0x10;
      const ENHANCED_KEY = 0x100;
      const RIGHT_ALT_PRESSED = 0x1;
      const VK = {
        MENU: 0x12,
        F1: 0x70,
        F5: 0x74,
        F12: 0x7b,
        UP: 0x26,
        LEFT: 0x25,
        HOME: 0x24,
        DELETE: 0x2e,
        SHIFT: 0x10,
      };
      const keystroke = (virtualKey: number, char = 0, controlKeyState = 0, repeatCount = 1) => [
        [1, virtualKey, char, controlKeyState, repeatCount],
        [0, virtualKey, char, controlKeyState],
      ];

      it.each([
        ["a letter", keystroke(0x41, 0x61), "a"],
        ["a repeated letter", keystroke(0x41, 0x61, 0, 3), "aaa"],
        ["a letter that is held down", keystroke(0x41, 0x61, 0, 300), Buffer.alloc(300, "a").toString()],
        ["a lone modifier to no input", keystroke(VK.SHIFT, 0, SHIFT_PRESSED), ""],
        ["F1", keystroke(VK.F1), "\x1b[[A"],
        ["F5", keystroke(VK.F5), "\x1b[[E"],
        ["F12", keystroke(VK.F12), "\x1b[24~"],
        ["Shift+F1", keystroke(VK.F1, 0, SHIFT_PRESSED), "\x1b[23~"],
        ["Up", keystroke(VK.UP, 0, ENHANCED_KEY), "\x1b[A"],
        ["repeated Up", keystroke(VK.UP, 0, ENHANCED_KEY, 2), "\x1b[A\x1b[A"],
        ["Ctrl+Left", keystroke(VK.LEFT, 0, ENHANCED_KEY | LEFT_CTRL_PRESSED), "\x1b[1;5D"],
        ["Shift+Home", keystroke(VK.HOME, 0, ENHANCED_KEY | SHIFT_PRESSED), "\x1b[1;2~"],
        ["Delete", keystroke(VK.DELETE, 0, ENHANCED_KEY), "\x1b[3~"],
        ["Alt+Up", keystroke(VK.UP, 0, ENHANCED_KEY | LEFT_ALT_PRESSED), "\x1b\x1b[A"],
        [
          "Alt+a",
          [[1, VK.MENU, 0, LEFT_ALT_PRESSED], ...keystroke(0x41, 0x61, LEFT_ALT_PRESSED), [0, VK.MENU, 0, 0]],
          "\x1ba",
        ],
        ["AltGr+e", keystroke(0x45, 0x20ac, RIGHT_ALT_PRESSED | LEFT_CTRL_PRESSED), "€"],
        [
          "Alt+numpad code",
          [
            [1, VK.MENU, 0, LEFT_ALT_PRESSED],
            ...[0x60, 0x61, 0x62, 0x68].flatMap(key => keystroke(key, 0, LEFT_ALT_PRESSED)),
            [0, VK.MENU, 0x20ac, 0],
          ],
          "€",
        ],
        ["a surrogate pair", [...keystroke(0, 0xd83d), ...keystroke(0, 0xde00)], "\u{1F600}"],
      ])("translates %s", async (_, events, expected) => {
        await using child = await spawnChild(
          `${keyEventPrelude} writeKeyEvents(${JSON.stringify([...events, ...keystroke(0x31, 0x21)])});`,
        );
        await child.expectData(expected + "!");
      });

      it("translates navigation and function keys with every Shift and Ctrl combination", async () => {
        const sequencesByKey: [number, string][] = [
          [0x21, "5~ 5;2~ 5;5~ 5;6~"],
          [0x22, "6~ 6;2~ 6;5~ 6;6~"],
          [0x23, "4~ 4;2~ 4;5~ 4;6~"],
          [0x24, "1~ 1;2~ 1;5~ 1;6~"],
          [0x25, "D 1;2D 1;5D 1;6D"],
          [0x26, "A 1;2A 1;5A 1;6A"],
          [0x27, "C 1;2C 1;5C 1;6C"],
          [0x28, "B 1;2B 1;5B 1;6B"],
          [0x0c, "G 1;2G 1;5G 1;6G"],
          [0x2d, "2~ 2;2~ 2;5~ 2;6~"],
          [0x2e, "3~ 3;2~ 3;5~ 3;6~"],
          [0x70, "[A 23~ 11^ 23^"],
          [0x71, "[B 24~ 12^ 24^"],
          [0x72, "[C 25~ 13^ 25^"],
          [0x73, "[D 26~ 14^ 26^"],
          [0x74, "[E 28~ 15^ 28^"],
          [0x75, "17~ 29~ 17^ 29^"],
          [0x76, "18~ 31~ 18^ 31^"],
          [0x77, "19~ 32~ 19^ 32^"],
          [0x78, "20~ 33~ 20^ 33^"],
          [0x79, "21~ 34~ 21^ 34^"],
          [0x7a, "23~ 23$ 23^ 23@"],
          [0x7b, "24~ 24$ 24^ 24@"],
        ];
        const events = sequencesByKey.flatMap(([key]) =>
          [0, SHIFT_PRESSED, LEFT_CTRL_PRESSED, SHIFT_PRESSED | LEFT_CTRL_PRESSED].flatMap(state =>
            keystroke(key, 0, state),
          ),
        );
        await using child = await spawnChild(`${keyEventPrelude} writeKeyEvents(${JSON.stringify(events)});`);
        await child.expectData(
          sequencesByKey.flatMap(([, sequences]) => sequences.split(" ").map(sequence => "\x1b[" + sequence)).join(""),
        );
      });
    });

    const openConinScript = `const input = new tty.ReadStream(fs.openSync("\\\\\\\\.\\\\CONIN$", "r+")).setEncoding("utf8");`;

    describe("line read in progress", () => {
      async function spawnWithLineReadInProgress(script: string, files?: Record<string, string>) {
        const child = await spawnChild(
          `forwardData(process.stdin); send("ready"); await waitForContinue(); ${script}`,
          files,
        );
        expect(await child.receive()).toBe("ready");
        child.type("abc");
        // The echo confirms that the line read is in progress.
        await child.waitForScreen("abc");
        child.sendContinue();
        return child;
      }

      it("delivers its input when raw mode is enabled", async () => {
        await using child = await spawnWithLineReadInProgress(`process.stdin.setRawMode(true);`);
        await child.expectData("abc");
        child.type("d");
        await child.expectData("d");
      });

      it("continues after pause() and resume()", async () => {
        await using child = await spawnWithLineReadInProgress(
          `process.stdin.pause(); await settleEventLoop(); send("paused"); await waitForContinue(); process.stdin.resume();`,
        );
        expect(await child.receive()).toBe("paused");
        child.type("def\r");
        child.sendContinue();
        await child.expectData("abcdef\r\n");
      });

      const [VK_PAUSE, VK_LEFT, VK_F7, VK_F9] = [0x13, 0x25, 0x76, 0x78];
      describe.each([
        ["the F7 popup open", [VK_LEFT, VK_F7]],
        ["the F9 popup open", [VK_LEFT, VK_F9]],
        ["the F7 and F9 popups open", [VK_LEFT, VK_F7, VK_F9]],
        ["output paused", [VK_LEFT, VK_PAUSE]],
        ["the F7 popup open and output paused", [VK_LEFT, VK_F7, VK_PAUSE]],
        // The console of Windows Server 2019 does not draw it again.
        ...(build > WINDOWS_SERVER_2019_BUILD ? [["the F7 popup scrolled away", [VK_LEFT, VK_F7], 50]] : []),
      ] as [string, number[], number?][])("with %s", (_, keys, lineCount = 0) => {
        const startScript = `
          forwardData(process.stdin);
          send("ready");
          await waitForContinue();
          for (const key of ${JSON.stringify(keys)}) writeKeyEvents([[1, key, 0]]);
          for (let i = 0; i < ${lineCount}; i++) console.log();
        `;
        async function typeInput(child: Awaited<ReturnType<typeof spawnChild>>) {
          expect(await child.receive()).toBe("ready");
          // F7 and F9 need a line in the history.
          child.type("first\r");
          await child.expectData("first\r\n");
          child.type("abc");
          await child.waitForScreen("abc");
          child.sendContinue();
        }

        it("ends when raw mode is enabled", async () => {
          await using child = await spawnChild(`${startScript} process.stdin.setRawMode(true);`);
          await typeInput(child);
          await child.expectData("abc");
          child.type("d");
          await child.expectData("d");
        });

        it("ends on pause()", async () => {
          await using child = await spawnChild(
            `
              ${startScript}
              process.stdin.pause();
              await new Promise(setImmediate);
              const grandchild = Bun.spawn([process.execPath, "grandchild.js"], { stdio: ["inherit", "pipe", "inherit"] });
              send(await grandchild.stdout.text());
              process.stdin.resume();
            `,
            {
              "grandchild.js": `console.error("grandchild"); for await (const line of console) { console.log(line); break; }`,
            },
          );
          await typeInput(child);
          await child.waitForScreen("grandchild");
          child.type("second\r");
          expect(await child.receive()).toBe("second\n");
          await child.expectData("abc");
        });
      });

      it.each([
        ["F7", VK_F7],
        ["F9", VK_F9],
      ])("ends when the %s popup is in the scrollback of a console window", async (_, key) => {
        using dir = tempDir("tty-scrollback", {
          "launcher.js": `
            const open = name => require("fs").openSync("\\\\\\\\.\\\\" + name, "r+");
            const stdio = [open("CONIN$"), open("CONOUT$"), "inherit"];
            process.exitCode = Bun.spawnSync([process.execPath, "main.js"], { stdio }).exitCode;
          `,
          "main.js": `
            ${ffiPrelude}
            const type = text => writeKeyEvents([...text].map(char => [1, char === "\\r" ? 0x0d : 0x41, char.charCodeAt(0)]));
            const chunks = process.stdin.setEncoding("utf8")[Symbol.asyncIterator]();
            const firstLine = chunks.next();
            type("first\\r");
            await firstLine;
            const rest = chunks.next();
            type("abc");
            while (!isOnRow(1, "abc")) await Bun.sleep(1);
            writeKeyEvents([[1, ${key}, 0]]);
            for (let i = 0; i < 100; i++) console.log();
            process.stdin.setRawMode(true);
            console.error((await rest).value);
            process.exit(0);
          `,
        });
        // A hidden process gets a console of its own, which has a scrollback, unlike ConPTY.
        await using proc = Bun.spawn({
          cmd: [bunExe(), "launcher.js"],
          cwd: String(dir),
          env: bunEnv,
          stdio: ["ignore", "ignore", "pipe"],
          windowsHide: true,
        });
        expect(await proc.stderr.text()).toBe("abc\n");
        expect(await proc.exited).toBe(0);
      });

      it("continues after repeated mode changes", async () => {
        await using child = await spawnWithLineReadInProgress(`
          for (let i = 0; i < 6; i++) {
            process.stdin.setRawMode(true);
            process.stdin.setRawMode(false);
            await Bun.sleep(1);
          }
          console.log("changed");
        `);
        await child.waitForScreen("changed");
        child.type("def\r");
        await child.expectData("abcdef\r\n");
      });

      it("continues after a subprocess reads a line", async () => {
        await using child = await spawnWithLineReadInProgress(
          `
            process.stdin.pause();
            const grandchild = Bun.spawn([process.execPath, "grandchild.js"], { stdio: ["inherit", "pipe", "inherit"] });
            send(await grandchild.stdout.text());
            process.stdin.resume();
          `,
          {
            "grandchild.js": `console.error("grandchild"); for await (const line of console) { console.log(line); break; }`,
          },
        );
        await child.waitForScreen("grandchild");
        child.type("second\r");
        expect(await child.receive()).toBe("second\n");
        await child.expectData("abc");
      });

      it.each(["process.stdin.pause()", "process.stdin.destroy()", "process.exit(0)"])(
        "does not keep the process alive after %s",
        async exitScript => {
          await using child = await spawnWithLineReadInProgress(`control.unref(); ${exitScript};`);
          expect(await child.proc.exited).toBe(0);
        },
      );
    });

    it.each([
      ["line", "false", "a\x1eb\r", "a\x1eb\r\n"],
      ["raw", "true", "a\x1eb", "a\x1eb"],
    ])("Ctrl+^ is delivered as data in %s mode", async (_, isRaw, keys, expected) => {
      await using child = await spawnChild(`forwardData(process.stdin.setRawMode(${isRaw})); send("ready");`);
      expect(await child.receive()).toBe("ready");
      child.type(keys);
      await child.expectData(expected);
    });

    it.skipIf(build < WINDOWS_11_24H2_BUILD)(
      "Ctrl+^ is delivered after a pause() during another line read",
      async () => {
        await using child = await spawnChild(`
        const other = Bun.spawn(["cmd.exe", "/d", "/c", "set /p line="], { stdio: ["inherit", "inherit", "inherit"] });
        await typeIntoLineRead(0, "?");
        forwardData(process.stdin);
        await settleEventLoop();
        process.stdin.pause();
        while (!isOnRow(0, "^^")) await Bun.sleep(1);
        writeKeyEvents([[1, 0x0d, 0x0d]]);
        await other.exited;
        process.stdin.resume();
        send("ready");
        await waitForContinue();
        process.stdin.setRawMode(true);
        send("raw");
      `);
        expect(await child.receive()).toBe("ready");
        child.type("a\r");
        await child.expectData("a\r\n");
        child.sendContinue();
        expect(await child.receive()).toBe("raw");
        child.type("b");
        await child.expectData("b");
        child.type("\x1ec");
        await child.expectData("\x1ec");
      },
    );

    it.skipIf(build < WINDOWS_11_24H2_BUILD)("exiting does not end the line read of another process", async () => {
      await using child = await spawnChild(
        `
          forwardData(process.stdin);
          await typeIntoLineRead(0, "a");
          await Bun.spawn([process.execPath, "other.js"], { stdio: ["inherit", "inherit", "inherit"] }).exited;
          send("ready");
        `,
        {
          // Frees handle values below that of the console connection.
          "other.js": `
            const k32 = require("bun:ffi").dlopen("kernel32.dll", {
              FreeConsole: { returns: "i32" },
              AttachConsole: { args: ["u32"], returns: "i32" },
              CreateEventW: { args: ["ptr", "i32", "i32", "ptr"], returns: "i64" },
              CloseHandle: { args: ["i64"], returns: "i32" },
            }).symbols;
            const createEvent = () => k32.CreateEventW(null, 0, 0, null);
            k32.FreeConsole();
            const events = Array.from({ length: 300 }, createEvent);
            k32.AttachConsole(process.ppid);
            // The handle table hands out freed values once its current page of 255 entries is full.
            while (createEvent() < 0x800n);
            for (let i = 0; i < 254; i++) createEvent();
            events.forEach(event => k32.CloseHandle(event));
            process.stdin.resume();
            for (let i = 0; i < 20; i++) await Bun.sleep(1);
            process.exit(0);
          `,
        },
      );
      expect(await child.receive()).toBe("ready");
      child.type("b\r");
      await child.expectData("ab\r\n");
    });

    // microsoft/terminal#18816
    it.each([
      ["the previous line", ``],
      ["leaving raw mode", `process.stdin.setRawMode(true).setRawMode(false);`],
      ["pause() and resume()", `process.stdin.pause(); await Bun.sleep(0); process.stdin.resume();`],
    ])("delivers a line typed immediately after %s", async (_, setupScript) => {
      await using child = await spawnChild(`
        const sendReady = async () => { ${setupScript} send("ready"); };
        forwardData(process.stdin).on("data", sendReady);
        sendReady();
      `);
      for (let i = 0, deadline = Date.now() + 1000; i < 300 && Date.now() < deadline; i++) {
        expect(await child.receive()).toBe("ready");
        child.type("a");
        for (const end = performance.now() + (i % 16) / 100; performance.now() < end;);
        child.type("\r");
        await child.expectData("a\r\n");
      }
    });

    it("echoes input while the event loop is blocked", async () => {
      await using child = await spawnChild(`
        forwardData(process.stdin);
        await settleEventLoop();
        send("ready", () => { while (!isOnRow(0, "abc")) Bun.sleepSync(1); send("echoed"); });
      `);
      expect(await child.receive()).toBe("ready");
      child.type("abc");
      expect(await child.receive()).toBe("echoed");
    });

    it("echoes input after leaving raw mode while the event loop is blocked", async () => {
      await using child = await spawnChild(`
        forwardData(process.stdin.setRawMode(true));
        await settleEventLoop();
        process.stdin.setRawMode(false);
        await settleEventLoop();
        send("ready", () => { while (!isOnRow(0, "abc")) Bun.sleepSync(1); send("echoed"); });
      `);
      expect(await child.receive()).toBe("ready");
      child.type("abc");
      expect(await child.receive()).toBe("echoed");
    });

    it.each([
      ["an empty screen", ""],
      ["text in the colors of a popup", "\x1b[35;107mtext\x1b[m"],
      ["a border in other colors", "\u250c\u2500\u2510\x1b[?25l"],
    ])("pause() does not end the line read of another process below %s", async (_, output) => {
      await using child = await spawnChild(
        `
          console.log(${JSON.stringify(output)});
          const grandchild = Bun.spawn(["cmd.exe", "/d", "/v:on", "/c", "read-line.cmd"], { stdio: ["inherit", "pipe", "inherit"] });
          await waitForContinue();
          process.stdin.resume();
          await settleEventLoop();
          process.stdin.pause();
          await settleEventLoop();
          send("paused");
          send(await grandchild.stdout.text());
        `,
        { "read-line.cmd": "@echo prompting 1>&2\r\n@set /p line=\r\n@echo [!line!]\r\n" },
      );
      await child.waitForScreen("prompting");
      for (const deadline = Date.now() + 4000; !child.screen().includes("#") && Date.now() < deadline;) {
        child.type("#");
        await Bun.sleep(10);
      }
      child.sendContinue();
      expect(await child.receive()).toBe("paused");
      child.type("c\r");
      expect(await child.receive()).toMatch(/^\[#+\x1e?#*c\]/);
    });

    it.each([false, true])("resets the input handle after a screen buffer switch (raw: %p)", async isRaw => {
      await using child = await spawnChild(`
        const input = k32.GetStdHandle(STD_INPUT_HANDLE);
        k32.WriteConsoleInputW(input, new Uint16Array(10).fill(8 /* MENU_EVENT */, 0, 1), 1, new Uint32Array(1));
        k32.SetConsoleActiveScreenBuffer(k32.GetStdHandle(STD_OUTPUT_HANDLE));
        send(k32.WaitForSingleObject(input, 0));
        forwardData(process.stdin.setRawMode(${isRaw}));
        while (k32.WaitForSingleObject(input, 0) === 0) await Bun.sleep(1);
        send("reset");
      `);
      expect(await child.receive()).toBe(0);
      expect(await child.receive()).toBe("reset");
      child.type("a\r");
      await child.expectData(isRaw ? "a\r" : "a\r\n");
    });

    it("a pending line read ends when the console host exits", async () => {
      await using child = await spawnChild(`
        const { dlopen } = require("bun:ffi");
        const ProcessConsoleHostProcess = 49;
        const hostPid = new BigUint64Array(1);
        dlopen("ntdll.dll", {
          NtQueryInformationProcess: { args: ["i64", "u32", "ptr", "u32", "ptr"], returns: "i32" },
        }).symbols.NtQueryInformationProcess(-1, ProcessConsoleHostProcess, hostPid, 8, null);
        forwardData(process.stdin);
        await settleEventLoop();
        // The two low bits are flags.
        process.kill(Number(hostPid[0] & ~3n));
      `);
      expect(await child.receive()).toEqual(["data", "end"]);
    });

    it("resizing a console from AllocConsole() raises SIGWINCH", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `require("bun:ffi").dlopen("kernel32.dll", { AllocConsole: { args: [], returns: "i32" } }).symbols.AllocConsole();
           process.on("SIGWINCH", () => { console.log("resized"); process.exit(); });
           let columns = 60;
           const resize = () => Bun.spawn(["mode.com", "con", "cols=" + columns++], { stdin: "inherit", onExit: resize });
           resize();`,
        ],
        env: bunEnv,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", "pipe", "inherit"],
      });
      expect(await proc.stdout.text()).toBe("resized\n");
      expect(await proc.exited).toBe(0);
    });

    it("reads a line after the process moves to another console", async () => {
      await using child = await spawnChild(`
        const { AllocConsole, FreeConsole, CreateFileA, SetStdHandle } = require("bun:ffi").dlopen("kernel32.dll", {
          AllocConsole: { args: [], returns: "i32" },
          FreeConsole: { args: [], returns: "i32" },
          CreateFileA: { args: ["ptr", "u32", "u32", "ptr", "u32", "u32", "ptr"], returns: "i64" },
          SetStdHandle: { args: ["i32", "i64"], returns: "i32" },
        }).symbols;
        forwardData(process.stdin).on("data", () => process.stdin.pause());
        await waitForContinue();
        FreeConsole();
        AllocConsole();
        const GENERIC_READ_WRITE = 0xc0000000;
        SetStdHandle(STD_INPUT_HANDLE, CreateFileA(Buffer.from("CONIN$\\0"), GENERIC_READ_WRITE, 3, null, 3, 0, null));
        writeKeyEvents([[1, 0, 0x62], [1, 0x0d, 0x0d]]);
        process.stdin.resume();
      `);
      child.type("a\r");
      await child.expectData("a\r\n");
      child.sendContinue();
      await child.expectData("b\r\n");
    });

    it("tty_wrap setRawMode() accepts uv_tty_mode_t values on the input handle only", async () => {
      await using child = await spawnChild(`
        const { TTY } = process.binding("tty_wrap");
        const consoleMode = new Uint32Array(1);
        const setMode = (fd, ttyMode) => {
          const errno = new TTY(fd, {}).setRawMode(ttyMode);
          k32.GetConsoleMode(k32.GetStdHandle(STD_INPUT_HANDLE), consoleMode);
          // ENABLE_VIRTUAL_TERMINAL_INPUT (0x200) and ENABLE_{PROCESSED,LINE,ECHO}_INPUT (0x7)
          return [errno, consoleMode[0] & 0x207];
        };
        send([setMode(0, 1), setMode(0, 3), setMode(0, 2), setMode(0, 9), setMode(1, 1), setMode(0, 0)]);
      `);
      const ENOTSUP = -4049;
      const EINVAL = -4071;
      expect(await child.receive()).toEqual([
        [0, 0],
        [0, 0x200],
        [ENOTSUP, 0x200],
        [EINVAL, 0x200],
        [EINVAL, 0x200],
        [0, 7],
      ]);
    });

    const ENABLE_WINDOW_AND_VT_INPUT = 0x208;
    const inputModePrelude = `
      const getInputMode = () => {
        const mode = new Uint32Array(1);
        k32.GetConsoleMode(k32.GetStdHandle(STD_INPUT_HANDLE), mode);
        return mode[0];
      };
    `;

    it("setRawMode(false) keeps the console mode if raw mode was never enabled", async () => {
      await using child = await spawnChild(`${inputModePrelude}
        k32.SetConsoleMode(k32.GetStdHandle(STD_INPUT_HANDLE), ${ENABLE_WINDOW_AND_VT_INPUT});
        process.stdin.setRawMode(false);
        send(getInputMode());
      `);
      expect(await child.receive()).toBe(ENABLE_WINDOW_AND_VT_INPUT);
    });

    it("setRawMode() fails on a read-only console handle", async () => {
      await using child = await spawnChild(`${inputModePrelude}
        const before = getInputMode();
        const grandchild = Bun.spawnSync({
          cmd: [process.execPath, "-e", "process.stdin.on('error', () => console.log('failed')).setRawMode(true)"],
          stdio: [fs.openSync("\\\\\\\\.\\\\CONIN$", "r"), "pipe", "inherit"],
        });
        send({ stdout: String(grandchild.stdout), isModeKept: getInputMode() === before });
      `);
      expect(await child.receive()).toEqual({ stdout: "failed\n", isModeKept: true });
    });

    it("delivers input that fills the read buffer while line input is off", async () => {
      await using child = await spawnChild(`
        k32.SetConsoleMode(k32.GetStdHandle(STD_INPUT_HANDLE), ${ENABLE_WINDOW_AND_VT_INPUT});
        writeKeyEvents(Array(8192).fill([1, 0, 0x61]));
        forwardData(process.stdin);
      `);
      await child.expectData(Buffer.alloc(8192, "a").toString());
    });

    it("pause() adds nothing to typed-ahead lines that are left for the next program", async () => {
      await using child = await spawnChild(
        `
          const leftover = new Set();
          for (let i = 0; i < 20; i++) {
            writeKeyEvents([..."a\\ra\\ra\\ra\\r"].map(char => [1, 0, char.charCodeAt(0)]));
            Bun.spawnSync([process.execPath, "grandchild.js"], { stdio: ["inherit", "inherit", "inherit"] });
            // Keeps the read below from blocking.
            writeKeyEvents([[1, 0, 0x61]]);
            const records = Buffer.alloc(INPUT_RECORD_SIZE * 64);
            const count = new Uint32Array(1);
            k32.ReadConsoleInputW(k32.GetStdHandle(STD_INPUT_HANDLE), records, 64, count);
            for (let j = 0; j < count[0]; j++) {
              const isKeyEvent = records.readUInt16LE(INPUT_RECORD_SIZE * j) === 1;
              if (isKeyEvent) leftover.add(records.readUInt16LE(INPUT_RECORD_SIZE * j + 14));
            }
          }
          send([...leftover].filter(char => char !== 0x61 && char !== 0x0d));
        `,
        { "grandchild.js": `process.stdin.once("data", () => setImmediate(() => process.stdin.pause()));` },
      );
      expect(await child.receive()).toEqual([]);
    });

    it("SIGWINCH reaches a listener added after the previous one was removed", async () => {
      await using child = await spawnChild(`
        const firstListener = () => {};
        process.on("SIGWINCH", firstListener).off("SIGWINCH", firstListener).on("SIGWINCH", () => send(process.stdout.getWindowSize()));
        process.stdin.resume();
        send("ready");
      `);
      expect(await child.receive()).toBe("ready");
      child.proc.terminal!.resize(70, 20);
      expect(await child.receive()).toEqual([70, 20]);
    });

    it("a process without a console can listen for SIGWINCH", async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", `process.on("SIGWINCH", () => {}); console.log("ok")`],
        env: bunEnv,
        detached: true,
        stdio: ["ignore", "pipe", "inherit"],
      });
      expect(await proc.stdout.text()).toBe("ok\n");
      expect(await proc.exited).toBe(0);
    });

    describe("Bun shell output", () => {
      const outputPrelude =
        `
        const ENABLE_VIRTUAL_TERMINAL_PROCESSING = 4;
        const DISABLE_NEWLINE_AUTO_RETURN = 8;
        const output = k32.GetStdHandle(STD_OUTPUT_HANDLE);
        const mode = new Uint32Array(1);
        const info = new Int16Array(11);
        const getMode = () => {
          k32.GetConsoleMode(output, mode);
          return mode[0];
        };
        const getCursorColumn = () => {
          k32.GetConsoleScreenBufferInfo(output, info);
          return info[2];
        };
      ` + "const write = bytes => Bun.$`cat < ${Buffer.from(bytes)}`;";

      it("adds carriage returns when DISABLE_NEWLINE_AUTO_RETURN is set", async () => {
        await using child = await spawnChild(`
          ${outputPrelude}
          k32.SetConsoleMode(output, getMode() | ENABLE_VIRTUAL_TERMINAL_PROCESSING | DISABLE_NEWLINE_AUTO_RETURN);
          const columns = [];
          for (const text of ["ab\\ncd", "\\r\\nefg", "\\n"]) {
            await write(text);
            columns.push(getCursorColumn());
          }
          send(columns);
        `);
        expect(await child.receive()).toEqual([2, 3, 0]);
      });

      it("sets ENABLE_VIRTUAL_TERMINAL_PROCESSING", async () => {
        await using child = await spawnChild(`
          ${outputPrelude}
          k32.SetConsoleMode(output, getMode() & ~ENABLE_VIRTUAL_TERMINAL_PROCESSING);
          await write("x");
          send(getMode() & ENABLE_VIRTUAL_TERMINAL_PROCESSING);
        `);
        expect(await child.receive()).toBe(4);
      });
    });

    it.each([
      [
        "Bun.stdout.writer()",
        `const sink = Bun.stdout.writer(); const write = bytes => { sink.write(bytes); return sink.flush(); };`,
      ],
      [
        "a FileSink on CONOUT$",
        `const sink = Bun.file("CONOUT$").writer(); const write = bytes => { sink.write(bytes); return sink.flush(); };`,
      ],
      [
        "a FileSink on a CONOUT$ fd",
        `const sink = Bun.file(fs.openSync("CONOUT$", "r+")).writer(); const write = bytes => sink.write(bytes);`,
      ],
      ["the Bun shell", "const write = bytes => Bun.$`cat < ${Buffer.from(bytes)}`;"],
    ])("%s does not split a surrogate pair in long output", async (_, writerScript) => {
      await using child = await spawnChild(`
        ${writerScript}
        await write(Buffer.alloc(8191, "x") + "\\u{1F600}" + Buffer.alloc(9000, "y") + "the end");
        send("written");
        await waitForContinue();
      `);
      expect(await child.receive()).toBe("written");
      await child.waitForScreen("the end");
      expect(child.screen()).toContain("\u{1F600}y");
    });

    it.each(["r+", "w", "w+"])("CONOUT$ can be opened with %j", async flags => {
      await using child = await spawnChild(
        `fs.writeSync(fs.openSync("CONOUT$", "${flags}"), "opened"); await waitForContinue();`,
      );
      await child.waitForScreen("opened");
    });

    it("prints a UTF-8 character split across two writes", async () => {
      await using child = await spawnChild(`
        const sink = Bun.file(fs.openSync("CONOUT$", "r+")).writer();
        const bytes = Buffer.from("<\\u4e16>");
        sink.write(bytes.subarray(0, 2));
        sink.write(bytes.subarray(2));
        await waitForContinue();
      `);
      await child.waitForScreen("\u4e16>");
    });

    it("a ReadStream on CONIN$ reads a line", async () => {
      await using child = await spawnChild(`${openConinScript} forwardData(input); send("ready");`);
      expect(await child.receive()).toBe("ready");
      // This stream uses ReadFile(), which returns only ASCII on earlier builds.
      const text = build < WINDOWS_11_24H2_BUILD ? "hello" : "h\u00e9llo";
      child.type(text + "\r");
      await child.expectData(text + "\r\n");
    });

    // setRawMode() emits "called on something that is not a TTY".
    it.todo("a ReadStream on CONIN$ supports setRawMode() and destroy()", async () => {
      await using child = await spawnChild(`
        ${openConinScript}
        forwardData(input.setRawMode(true));
        send("ready");
        await waitForContinue();
        input.setRawMode(false).destroy();
        control.end();
      `);
      expect(await child.receive()).toBe("ready");
      child.type("k");
      await child.expectData("k");
      child.sendContinue();
      expect(await child.proc.exited).toBe(0);
    });
  });
});

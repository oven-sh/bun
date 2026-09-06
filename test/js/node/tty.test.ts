import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";
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

// Runs `script` in a child attached to a fresh PTY and drives it through a
// phase protocol: the child prints a marker, the parent reads termios and
// types the next line. Resolves with the child's exit code. With
// `controllingTerminal` the PTY is created by the spawn itself, which is the
// only form that makes the child a session leader on it (so /dev/tty opens).
async function runInPty(
  script: string,
  phases: ((terminal: Bun.Terminal, output: () => string) => void | Promise<void>)[],
  opts: { markers: string[]; controllingTerminal?: boolean },
) {
  const decoder = new TextDecoder();
  let buffer = "";
  const waiters: { marker: string; resolve: () => void }[] = [];
  const terminalOptions = {
    data(_terminal: Bun.Terminal, chunk: Uint8Array) {
      buffer += decoder.decode(chunk, { stream: true });
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (buffer.includes(waiters[i].marker)) {
          waiters[i].resolve();
          waiters.splice(i, 1);
        }
      }
    },
  };
  await using ownTerminal = opts.controllingTerminal ? null : new Bun.Terminal(terminalOptions);
  const proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    terminal: ownTerminal ?? terminalOptions,
  });
  await using spawnedTerminal = ownTerminal ? null : proc.terminal!;
  const terminal = (ownTerminal ?? spawnedTerminal)!;
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
  for (let i = 0; i < phases.length; i++) {
    await phase(opts.markers[i]);
    await phases[i](terminal, () => buffer);
  }
  const code = await proc.exited;
  return { code, output: () => buffer };
}

describe.skipIf(isWindows)("tty.ReadStream is a net.Socket over a native TTY handle", () => {
  test("process.stdin has Node's shape under a PTY", async () => {
    const { code, output } = await runInPty(
      `
        const net = require("node:net");
        const tty = require("node:tty");
        const { Duplex } = require("node:stream");
        const { TTY } = process.binding("tty_wrap");
        // Before any ReadStream exists: Node's test-net-access-byteswritten reads this.
        const readStreamExtendsSocket = Object.getPrototypeOf(tty.ReadStream) === net.Socket;
        const s = process.stdin;
        const out = {
          isReadStream: s instanceof tty.ReadStream,
          isSocket: s instanceof net.Socket,
          isDuplex: s instanceof Duplex,
          constructor: s.constructor === tty.ReadStream,
          readStreamExtendsSocket,
          protoChain: Object.getPrototypeOf(tty.ReadStream.prototype) === net.Socket.prototype,
          handleIsTTY: s._handle instanceof TTY,
          handleMethods: ["readStart", "readStop", "setRawMode", "getWindowSize", "ref", "unref", "close"].every(
            m => typeof s._handle[m] === "function",
          ),
          highWaterMark: s.readableHighWaterMark,
          readingBeforeConsumer: s._handle.reading,
          fd: s.fd,
          isTTY: s.isTTY,
          isRaw: s.isRaw,
          bytesReadGetter: typeof Object.getOwnPropertyDescriptor(TTY.prototype, "bytesRead").get,
        };
        process.stdout.write("RESULT " + JSON.stringify(out) + "\\n");
        process.exit(0);
      `,
      [() => {}],
      { markers: ["RESULT "] },
    );
    expect(code).toBe(0);
    const match = Bun.stripANSI(output()).match(/RESULT (\{.*\})/);
    expect(JSON.parse(match![1])).toEqual({
      isReadStream: true,
      isSocket: true,
      isDuplex: true,
      constructor: true,
      readStreamExtendsSocket: true,
      protoChain: true,
      handleIsTTY: true,
      handleMethods: true,
      highWaterMark: 0,
      readingBeforeConsumer: false,
      fd: 0,
      isTTY: true,
      isRaw: false,
      bytesReadGetter: "function",
    });
  });

  // readableHighWaterMark: 0 makes every push() report backpressure, so the
  // handle stops reading after each chunk and only reads again when the
  // stream asks for more. That is what hands fd 0 to a child.
  test("the handle stops reading after every chunk and resumes on demand", async () => {
    const { code, output } = await runInPty(
      `
        const s = process.stdin;
        const log = [];
        const ack = () => new Promise(resolve => s.once("data", () => resolve()));
        (async () => {
          s.setRawMode(true);
          log.push(["idle", s._handle.reading]);
          process.stdout.write("P1\\n"); await ack();
          // The push() that delivered the byte stopped the handle; by the time
          // this continuation runs, the nextTick read(0) of flowing mode has
          // re-armed it. Same sequence as Node.
          log.push(["in-data", s._handle.reading]);
          await new Promise(r => setTimeout(r, 0));
          log.push(["flowing", s._handle.reading, s._handle.bytesRead]);
          s.pause();
          await new Promise(r => process.nextTick(r));
          log.push(["paused", s._handle.reading, s.readableFlowing]);
          s.resume();
          await new Promise(r => setTimeout(r, 0));
          log.push(["resumed", s._handle.reading]);
          s.unref();
          process.stdout.write("RESULT " + JSON.stringify(log) + "\\n");
        })();
      `,
      [
        terminal => {
          terminal.write("x");
        },
      ],
      { markers: ["P1"] },
    );
    expect(code).toBe(0);
    const match = Bun.stripANSI(output()).match(/RESULT (\[.*\])/);
    expect(JSON.parse(match![1])).toEqual([
      ["idle", false],
      ["in-data", true],
      ["flowing", true, 1],
      ["paused", false, false],
      ["resumed", true],
    ]);
  });

  // https://github.com/oven-sh/bun/issues/29126: a TUI reads stdin with a
  // 'readable' listener, removes it, then spawns an interactive child with
  // stdio: "inherit". Bun kept polling fd 0 for good and stole the child's
  // keystrokes. Node (and now Bun) keeps the handle armed until the next
  // chunk arrives: that chunk is the stream's, push() reports backpressure,
  // the handle stops, and everything after belongs to the child.
  test("a child with stdio: 'inherit' owns stdin once the handle stops after the last 'readable' listener is removed", async () => {
    const { code, output } = await runInPty(
      `
        const { spawn } = require("node:child_process");
        const s = process.stdin;
        s.setRawMode(true);
        const seen = [];
        const handler = () => {
          let c;
          while ((c = s.read()) !== null) seen.push(c.toString());
        };
        s.on("readable", handler);
        process.stdout.write("P1\\n");
        s.once("readable", () => setTimeout(() => {
          s.setRawMode(false);
          s.removeListener("readable", handler);
          const armed = s._handle.reading;
          // With no consumer left the next chunk is buffered in the stream and
          // stops the handle; nothing re-arms it. A listener here would.
          const timer = setInterval(() => {
            if (s._handle.reading) return;
            clearInterval(timer);
            process.stdout.write("P3 " + JSON.stringify({ armed, buffered: s.readableLength }) + "\\n");
            s.unref();
            const child = spawn(
              process.execPath,
              ["-e", "process.stdin.on('data', d => process.stdout.write('CHILD:' + d)); process.stdin.on('end', () => process.exit(0))"],
              { stdio: "inherit" },
            );
            child.on("exit", exitCode => {
              process.stdout.write("RESULT " + JSON.stringify({ parentSaw: seen, readingAtExit: s._handle.reading, childExit: exitCode }) + "\\n");
              process.exit(0);
            });
          }, 10);
          process.stdout.write("P2\\n");
        }, 50));
      `,
      [
        terminal => {
          terminal.write("a");
        },
        terminal => {
          // Cooked mode now: a whole line.
          terminal.write("b\n");
        },
        async terminal => {
          // Give the child time to start reading the shared terminal.
          await new Promise(r => setTimeout(r, 500));
          terminal.write("hello child\n");
          await new Promise(r => setTimeout(r, 200));
          terminal.write("\x04");
        },
      ],
      { markers: ["P1", "P2", "P3"] },
    );
    expect(code).toBe(0);
    const text = Bun.stripANSI(output());
    expect(JSON.parse(text.match(/P3 (\{.*\})/)![1])).toEqual({ armed: true, buffered: 2 });
    expect(JSON.parse(text.match(/RESULT (\{.*\})/)![1])).toEqual({
      parentSaw: ["a"],
      readingAtExit: false,
      childExit: 0,
    });
    expect(text).toContain("CHILD:hello child");
  });

  // Before, tty.ReadStream was an fs.ReadStream with a blocking read(2) on a
  // pool thread: destroy() could not cancel it, the process lived until the
  // next line, and that line vanished into the destroyed stream. Now close()
  // unregisters the poll, the loop empties, and the line is still in the
  // terminal's input queue for the next reader. The caller's fd stays open,
  // as in Node (libuv closes only the fd it reopened).
  test("destroy() with no input pending lets the process exit and leaves the next line to the next reader", async () => {
    const { code, output } = await runInPty(
      `
        const fs = require("node:fs");
        const tty = require("node:tty");
        const { spawn } = require("node:child_process");
        const fd = fs.openSync("/dev/tty", "r");
        const input = new tty.ReadStream(fd);
        const seen = [];
        input.on("data", d => seen.push(String(d)));
        let readingBeforeDestroy;
        input.on("close", () => {
          let fdOpen = true;
          try { fs.fstatSync(fd); } catch { fdOpen = false; }
          process.stdout.write("P1 " + JSON.stringify({ seen, readingBeforeDestroy, fdOpen, destroyed: input.destroyed }) + "\\n");
          const child = spawn(
            process.execPath,
            ["-e", "process.stdout.write('CHILDREADY\\\\n'); process.stdin.once('data', d => { process.stdout.write('CHILD:' + d); process.exit(0); })"],
            { stdio: "inherit" },
          );
          child.on("exit", exitCode => process.stdout.write("P2 " + exitCode + "\\n"));
        });
        const timer = setInterval(() => {
          if (input._handle && !input._handle.reading) return;
          clearInterval(timer);
          readingBeforeDestroy = input._handle ? input._handle.reading : null;
          input.destroy();
        }, 1);
      `,
      [
        () => {},
        terminal => {
          terminal.write("after destroy\n");
        },
      ],
      { markers: ["P1 ", "CHILDREADY"], controllingTerminal: true },
    );
    expect(code).toBe(0);
    const text = Bun.stripANSI(output());
    expect(JSON.parse(text.match(/P1 (\{.*\})/)![1])).toEqual({
      seen: [],
      readingBeforeDestroy: true,
      fdOpen: true,
      destroyed: true,
    });
    expect(text).toContain("CHILD:after destroy");
    expect(text).toContain("P2 0");
  });

  test("tty_wrap.TTY delivers reads through onread and reports EOF", async () => {
    const { code, output } = await runInPty(
      `
        const { TTY } = process.binding("tty_wrap");
        const handle = new TTY(0, {});
        const events = [];
        handle.onread = function (nread, buf) {
          events.push([nread, buf === undefined ? null : buf.toString(), this === handle]);
          if (nread === -4095) {
            process.stdout.write("RESULT " + JSON.stringify({ events, bytesRead: handle.bytesRead, fd: handle.fd }) + "\\n");
            handle.close();
            process.exit(0);
          }
        };
        process.stdout.write("started=" + handle.readStart() + "\\n");
      `,
      [
        async terminal => {
          // Cooked mode: a line per read, and ^D at the start of a line is EOF.
          terminal.write("abc\n");
          await new Promise(r => setTimeout(r, 100));
          terminal.write("\x04");
        },
      ],
      { markers: ["started=0"] },
    );
    expect(code).toBe(0);
    const match = Bun.stripANSI(output()).match(/RESULT (\{.*\})/);
    const result = JSON.parse(match![1]);
    expect(result.events.at(-1)).toEqual([-4095, null, true]);
    expect(
      result.events
        .slice(0, -1)
        .map(e => e[1])
        .join(""),
    ).toBe("abc\n");
    expect(result.events.every(e => e[2])).toBe(true);
    expect(result).toMatchObject({ bytesRead: 4, fd: 0 });
  });

  // https://github.com/oven-sh/bun/issues/33580: Node emits errnoException(err,
  // "setRawMode"), so code/errno/syscall are set. A pipe is accepted by
  // uv_tty_init. Closing fd 0 under the handle makes tcgetattr fail with EBADF
  // on every platform (a pipe alone gives ENOTTY on Linux, EOPNOTSUPP on macOS).
  test("setRawMode failure emits an ErrnoException", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const tty = require("node:tty");
          const s = new tty.ReadStream(0);
          s.on("error", err => {
            console.log(JSON.stringify({ code: err.code, errno: err.errno, syscall: err.syscall, message: err.message, isRaw: s.isRaw }));
            s.destroy();
          });
          require("node:fs").closeSync(0);
          s.setRawMode(true);
        `,
      ],
      env: bunEnv,
      stdin: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      code: "EBADF",
      errno: -9,
      syscall: "setRawMode",
      message: "setRawMode EBADF",
      isRaw: false,
    });
    expect(exitCode).toBe(0);
  });
});

// node-pty sets O_NONBLOCK on the pty master and wraps it in tty.ReadStream
// (https://github.com/oven-sh/bun/issues/41414). A read with no data then
// fails with EAGAIN. The stream must wait for data, as Node's does. libuv
// cannot reopen a pty master by name, so it owns that fd and closes it on
// close(); node-pty relies on that.
describe.skipIf(isWindows)("ReadStream on a non-blocking pty master", () => {
  // A separate process opens the path and writes one chunk. The fixture issues
  // its next read as soon as it says READY, and that read completes long
  // before a new process can start. So every chunk lands after a read that
  // found no data, which is the read the bug turned into EAGAIN.
  async function writeFromAnotherProcess(path: string, chunk: string) {
    await using writer = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const fs = require("fs");
         const fd = fs.openSync(process.argv[1], fs.constants.O_WRONLY | fs.constants.O_NOCTTY | fs.constants.O_NONBLOCK);
         fs.writeSync(fd, process.argv[2]);
         fs.closeSync(fd);`,
        path,
        chunk,
      ],
      env: bunEnv,
    });
    expect(await writer.exited).toBe(0);
  }

  // Runs the fixture, writes "one" and "two" to the slave after each READY,
  // then ends the stream the requested way. Returns the fixture's event log.
  async function runFixture(end: "destroy" | "hangup") {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "tty-readstream-nonblocking.fixture.ts")],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Drain stderr from the start so a chatty fixture cannot block on it.
    const stderr = proc.stderr.text();
    const chunks = ["one", "two"];
    const lines: string[] = [];
    let slavePath = "";
    let buffered = "";
    for await (const chunk of proc.stdout) {
      buffered += Buffer.from(chunk).toString();
      let newline: number;
      while ((newline = buffered.indexOf("\n")) !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line.startsWith("SLAVE ")) {
          slavePath = line.slice("SLAVE ".length);
          continue;
        }
        if (line !== "READY") {
          lines.push(line);
          continue;
        }
        const next = chunks.shift();
        if (next !== undefined) {
          await writeFromAnotherProcess(slavePath, next);
          continue;
        }
        proc.stdin.write(end + "\n");
        proc.stdin.end();
      }
    }

    const [, exitCode] = await Promise.all([stderr, proc.exited]);
    return { lines, exitCode };
  }

  // After each chunk the fixture resizes the pty through the master, as
  // node-pty's pty.resize() does. That ioctl failed with EBADF when the stream
  // had closed the fd on the first EAGAIN.
  test.concurrent("delivers data written after the first EAGAIN and destroy() closes the fd", async () => {
    const { lines, exitCode } = await runFixture("destroy");
    expect(lines).toEqual([
      'DATA "one"',
      "RESIZE ok",
      'DATA "two"',
      "RESIZE ok",
      "CLOSE destroyed=true masterOpen=false",
    ]);
    expect(exitCode).toBe(0);
  });

  test.concurrent("ends when the slave side hangs up", async () => {
    const { lines, exitCode } = await runFixture("hangup");
    // Linux reports the hangup as EIO, macOS as end of file.
    expect(["ERROR EIO", "END"]).toContain(lines[4]);
    expect([...lines.slice(0, 4), ...lines.slice(5)]).toEqual([
      'DATA "one"',
      "RESIZE ok",
      'DATA "two"',
      "RESIZE ok",
      "CLOSE destroyed=true masterOpen=false",
    ]);
    expect(exitCode).toBe(0);
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
});

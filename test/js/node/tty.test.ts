import { CString, dlopen, ptr } from "bun:ffi";
import { afterAll, describe, expect, it, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  isLinux,
  isMacOS,
  isRoot,
  isWindows,
  libcPathForDlopen,
  nodeExeOfReportedVersion,
  tempDir,
} from "harness";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs, { closeSync, constants, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { ReadStream, WriteStream, isatty } from "node:tty";

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
    const isRaw = (terminal: Bun.Terminal) => (terminal.localFlags & (ICANON | ECHO)) === 0;
    const observed: Record<string, boolean> = {};
    // Each phase says its name, and waits on stdin so the parent can read termios while the child is still alive.
    const phase = (name: string) => (terminal: Bun.Terminal) => {
      observed[name] = isRaw(terminal);
      terminal.write("\n");
    };
    const { code } = await runInPty(
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
      [
        phase("afterStdinRaw"),
        phase("afterSecondStreamCooked"),
        phase("afterSecondStreamRoundTrip"),
        phase("afterTTYWrapCooked"),
        phase("afterStdinCooked"),
      ],
      { markers: ["P1", "P2", "P3", "P4", "P5"] },
    );
    expect(observed).toEqual({
      afterStdinRaw: true,
      afterSecondStreamCooked: true,
      afterSecondStreamRoundTrip: true,
      afterTTYWrapCooked: true,
      afterStdinCooked: false,
    });
    expect(code).toBe(0);
  });
});

type PtyPhase = (
  terminal: Bun.Terminal,
  output: () => string,
  /** Resolves once the output matches. Rejects when the child fails, or says its last word first. */
  seen: (pattern: RegExp | string) => Promise<void>,
) => void | Promise<void>;

// Runs `script` in a child attached to a fresh PTY and drives it through a
// phase protocol: the child prints a marker, the parent reads termios and
// types the next line. Markers beyond the last phase (the child's final
// record) are awaited too, so `output()` is complete when this resolves.
// With `controllingTerminal` the PTY is created by the spawn itself, which is
// the only form that makes the child a session leader on it (so /dev/tty opens).
// With `unopenable` the child cannot open the device of its terminal by name,
// as after su or sudo -u: it runs as another user, or takes its own rights away.
async function runInPty(
  script: string,
  phases: PtyPhase[],
  opts: {
    markers: string[];
    controllingTerminal?: boolean;
    prefix?: string[];
    unopenable?: boolean;
    exitCode?: number;
    /** The runtime of the child: Bun, or a Node that answers the same. */
    exe?: string;
  },
) {
  if (opts.unopenable) {
    script = `
      ${isRoot ? "" : `require("node:fs").fchmodSync(0, 0);`}
      {
        const name = String(require("node:child_process").execFileSync("tty", { stdio: ["inherit", "pipe", "inherit"] })).trim();
        let refused;
        try { require("node:fs").closeSync(require("node:fs").openSync(name, "r")); } catch (err) { refused = err.code; }
        if (refused !== "EACCES") throw new Error("the open of " + name + " was to be refused with EACCES, and was " + refused);
      }
      ${script}`;
  }
  const decoder = new TextDecoder();
  let buffer = "";
  const waiters: { test: () => boolean; resolve: () => void; reject: (err: Error) => void }[] = [];
  const last = opts.markers[opts.markers.length - 1];
  const terminalOptions = {
    data(_terminal: Bun.Terminal, chunk: Uint8Array) {
      buffer += decoder.decode(chunk, { stream: true });
      // The last marker is the child's last word: nothing that is still awaited can follow it.
      const ended = buffer.includes(last);
      for (let i = waiters.length - 1; i >= 0; i--) {
        const waiter = waiters[i];
        if (waiter.test()) waiter.resolve();
        else if (ended) waiter.reject(new Error(`child ended early; terminal output: ${JSON.stringify(buffer)}`));
        else continue;
        waiters.splice(i, 1);
      }
    },
  };
  await using ownTerminal = opts.controllingTerminal ? null : new Bun.Terminal(terminalOptions);
  await using proc = Bun.spawn({
    cmd: [...(opts.prefix ?? []), opts.exe ?? bunExe(), "-e", script],
    env: bunEnv,
    terminal: ownTerminal ?? terminalOptions,
    // Root opens every device: the child is another user then, in a folder that every user can be in.
    ...(opts.unopenable && isRoot ? { cwd: "/", uid: 65534, gid: 65534 } : {}),
  });
  await using spawnedTerminal = ownTerminal ? null : proc.terminal!;
  const terminal = (ownTerminal ?? spawnedTerminal)!;
  // Nothing that is typed is echoed (ECHO is 0x8): an echo can land inside a line that the child prints.
  terminal.localFlags = terminal.localFlags & ~0x8;
  const entry = { proc, output: () => buffer };
  unfinished.add(entry);
  // A failing child rejects the marker waits instead of hanging them. A clean
  // exit can land before the PTY delivers the child's last output: the waits
  // get the time to read it. A last marker that is not there by then is an
  // error with the output, and not the time limit of the test.
  const exitedEarly = proc.exited.then(async code => {
    if (code !== (opts.exitCode ?? 0)) {
      throw new Error(`child exited early with code ${code}; terminal output: ${JSON.stringify(buffer)}`);
    }
    for (const deadline = Date.now() + 2000; !buffer.includes(last) && Date.now() < deadline;) await Bun.sleep(5);
    if (buffer.includes(last)) return new Promise<never>(() => {});
    throw new Error(
      `child exited with code ${code} before it printed ${JSON.stringify(last)}; terminal output: ${JSON.stringify(buffer)}`,
    );
  });
  exitedEarly.catch(() => {});
  const seen = (pattern: RegExp | string) => {
    const test = typeof pattern === "string" ? () => buffer.includes(pattern) : () => pattern.test(buffer);
    if (test()) return Promise.resolve();
    // The child has said its last word, and this was not in it.
    if (buffer.includes(last)) {
      return Promise.reject(new Error(`child ended early; terminal output: ${JSON.stringify(buffer)}`));
    }
    const found = new Promise<void>((resolve, reject) => waiters.push({ test, resolve, reject }));
    return Promise.race([found, exitedEarly]);
  };
  for (let i = 0; i < opts.markers.length; i++) {
    await seen(opts.markers[i]);
    if (i < phases.length) await phases[i](terminal, () => buffer, seen);
  }
  const code = await proc.exited;
  unfinished.delete(entry);
  return { code, output: () => buffer };
}

// A test that runs into its time limit says nothing of its child. What the terminal of such a child
// showed is printed here, and the child is ended.
const unfinished = new Set<{ proc: Bun.Subprocess; output: () => string }>();
afterAll(() => {
  for (const { proc, output } of unfinished) {
    if (proc.exitCode === null) proc.kill("SIGKILL");
    console.error(`a child of runInPty() did not finish. Its terminal showed: ${JSON.stringify(output())}`);
  }
});

// Each test types into a terminal and waits for what its child prints. The
// tables and the groups of children that do not depend on each other run
// concurrently, and the whole file takes 2 s on a release build. The other
// tests run one after the other on purpose: on a loaded machine the rows that
// run concurrently needed more than the 5 s of a test on a debug build, so
// more of them at once adds timeouts and no speed.
describe.skipIf(isWindows)("tty.ReadStream is a net.Socket over a native TTY handle", () => {
  // What is said to be as in Node runs under Node too, where the Node of the machine is the version that Bun says it is.
  const runtimes = [
    ["bun", bunExe()],
    ["node", nodeExeOfReportedVersion()],
  ] as const;

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
        // Node has the accessors of a handle on LibuvStreamWrap.prototype, one above TTY.prototype.
        const accessorOf = name => {
          for (let proto = TTY.prototype; proto; proto = Object.getPrototypeOf(proto)) {
            const descriptor = Object.getOwnPropertyDescriptor(proto, name);
            if (descriptor) return typeof descriptor.get;
          }
        };
        const out = {
          isReadStream: s instanceof tty.ReadStream,
          isSocket: s instanceof net.Socket,
          isDuplex: s instanceof Duplex,
          constructor: s.constructor === tty.ReadStream,
          readStreamExtendsSocket,
          protoChain: Object.getPrototypeOf(tty.ReadStream.prototype) === net.Socket.prototype,
          handleIsTTY: s._handle instanceof TTY,
          handleMethods: ["readStart", "readStop", "setRawMode", "getWindowSize", "ref", "unref", "hasRef", "getAsyncId", "setBlocking", "close"].every(
            m => typeof s._handle[m] === "function",
          ),
          highWaterMark: s.readableHighWaterMark,
          readingBeforeConsumer: s._handle.reading,
          fd: s.fd,
          isTTY: s.isTTY,
          isRaw: s.isRaw,
          bytesReadGetter: accessorOf("bytesRead"),
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

  // Nothing reads fd 0 before a consumer does. A 'data' listener takes every
  // chunk, so push() never reports backpressure and the handle stays armed, as
  // in Node: what stops it is pause(), through the 'pause' hook of process.stdin.
  // https://github.com/nodejs/node/blob/v26.12.1/lib/internal/bootstrap/switches/is_main_thread.js#L248-L249
  describe.each(runtimes)("as in Node (%s)", (_name, exe) => {
    test.skipIf(!exe)("process.stdin keeps its fd when it is destroyed, and a child can still get it", async () => {
      const { code, output } = await runInPty(
        `
          const s = process.stdin;
          const out = { own: Object.hasOwn(s, "fd"), open: s.fd };
          s.on("close", () => {
            out.closed = s.fd;
            const child = require("node:child_process").spawnSync(
              process.execPath,
              ["-e", "console.log(require('node:tty').isatty(0))"],
              { stdio: [s, "pipe", "inherit"] },
            );
            out.childHasTheTerminal = String(child.stdout).trim();
            process.stdout.write("RESULT " + JSON.stringify(out) + "\\n");
          });
          s.destroy();
        `,
        [],
        { markers: ["RESULT "], exe: exe! },
      );
      expect(JSON.parse(Bun.stripANSI(output()).match(/RESULT (\{.*\})/)![1])).toEqual({
        own: true,
        open: 0,
        closed: 0,
        childHasTheTerminal: "true",
      });
      expect(code).toBe(0);
    });
  });

  test("the handle reads while a 'data' listener flows, and pause() stops it", async () => {
    const { code, output } = await runInPty(
      `
        const s = process.stdin;
        const calls = { readStart: 0, readStop: 0 };
        for (const name of ["readStart", "readStop"]) {
          const method = s._handle[name];
          s._handle[name] = function () { calls[name]++; return method.call(this); };
        }
        const log = [];
        const note = name => log.push([name, s._handle.reading, calls.readStart, calls.readStop]);
        const ack = () => new Promise(resolve => s.once("data", () => resolve()));
        (async () => {
          s.setRawMode(true);
          note("idle");
          process.stdout.write("P1\\n"); await ack();
          note("in-data");
          await new Promise(r => setTimeout(r, 0));
          note("flowing");
          s.pause();
          await new Promise(r => process.nextTick(r));
          note("paused");
          s.resume();
          await new Promise(r => setTimeout(r, 0));
          note("resumed");
          s.unref();
          process.stdout.write("RESULT " + JSON.stringify({ log, bytesRead: s._handle.bytesRead, flowing: s.readableFlowing }) + "\\n");
        })();
      `,
      [
        terminal => {
          terminal.write("x");
        },
      ],
      { markers: ["P1", "RESULT "] },
    );
    expect(code).toBe(0);
    const match = Bun.stripANSI(output()).match(/RESULT (\{.*\})/);
    expect(JSON.parse(match![1])).toEqual({
      // name, handle.reading, calls of readStart(), calls of readStop()
      log: [
        ["idle", false, 0, 0],
        ["in-data", true, 1, 0],
        ["flowing", true, 1, 0],
        ["paused", false, 1, 1],
        ["resumed", true, 2, 1],
      ],
      bytesRead: 1,
      flowing: true,
    });
  });

  // https://github.com/oven-sh/bun/issues/29126: a TUI reads stdin with a
  // 'readable' listener, removes it, then spawns an interactive child with
  // stdio: "inherit". Bun kept polling fd 0 for good and stole the child's
  // keystrokes. Node (and now Bun) keeps the handle armed until its next
  // read(2): that chunk is the stream's, push() reports backpressure, the
  // handle stops, and everything after belongs to the child. Two lines are
  // queued here before the child exists: one read(2) takes the first alone.
  test("an armed handle with no consumer takes one read(2), then a child with stdio: 'inherit' owns stdin", async () => {
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
        s.once("readable", () => {
          s.setRawMode(false);
          s.removeListener("readable", handler);
          const armed = s._handle.reading;
          // With no consumer left the next chunk is buffered in the stream and
          // stops the handle. Nothing starts it again.
          const onread = s._handle.onread;
          s._handle.onread = function (nread, buffer) {
            onread.call(this, nread, buffer);
            process.stdout.write("P3 " + JSON.stringify({ armed, took: String(buffer), buffered: s.readableLength, reading: this.reading }) + "\\n");
            s.unref();
            const child = spawn(
              process.execPath,
              ["-e", "process.stdin.on('data', d => process.stdout.write('CHILD:' + d)); process.stdin.on('end', () => process.exit(0));"],
              { stdio: "inherit" },
            );
            child.on("exit", exitCode => {
              process.stdout.write("RESULT " + JSON.stringify({ parentSaw: seen, readingAtExit: s._handle.reading, childExit: exitCode }) + "\\n");
              process.exit(0);
            });
          };
          process.stdout.write("P2\\n");
        });
      `,
      [
        terminal => {
          terminal.write("a");
        },
        terminal => {
          // Cooked mode now: two whole lines, in one write.
          terminal.write("b\nc\n");
        },
        (_terminal, output) => {
          expect(JSON.parse(Bun.stripANSI(output()).match(/P3 (\{.*\})/)![1])).toEqual({
            armed: true,
            took: "b\n",
            buffered: 2,
            reading: false,
          });
        },
        terminal => {
          terminal.write("hello child\n");
        },
        terminal => {
          terminal.write("\x04");
        },
      ],
      { markers: ["P1", "P2", "P3", "CHILD:c", "CHILD:hello child", "RESULT "] },
    );
    expect(code).toBe(0);
    expect(JSON.parse(Bun.stripANSI(output()).match(/RESULT (\{.*\})/)![1])).toEqual({
      parentSaw: ["a"],
      readingAtExit: false,
      childExit: 0,
    });
  });

  // The parent reads one line of a terminal's stdin, lets go of it and, in the
  // same tick, spawns a child with stdio: "inherit". Eight lines are then typed,
  // each after the one before it arrived somewhere. "stopped": the child gets
  // all of them. "one more at most": the handle is still armed, so its read(2)
  // races the child's, and the first read that it wins stops it. Node v26.3.0
  // answers the same for every row without a Bun API.
  describe("a child with stdio: 'inherit' gets what is typed after the parent lets go of stdin", () => {
    const child = `process.stdin.setEncoding('utf8'); process.stdin.on('data', d => { for (const l of d.split('\\n').filter(Boolean)) process.stdout.write('CHILD:' + l + '\\n'); }); process.stdin.on('end', () => process.exit(0)); process.stdout.write('CHILDREADY\\n')`;
    const rows: [name: string, answer: "stopped" | "one more at most", reader: string, unopenable?: boolean][] = [
      [
        "a 'readable' listener that is removed",
        "one more at most",
        `const handler = () => { while (s.read() !== null); };
         s.on("readable", handler);
         s.once("readable", () => { s.removeListener("readable", handler); handoff(); });`,
      ],
      [
        "a 'readable' listener that is removed, and unref()",
        "one more at most",
        `const handler = () => { while (s.read() !== null); };
         s.on("readable", handler);
         s.once("readable", () => { s.removeListener("readable", handler); s.unref(); handoff(); });`,
      ],
      [
        "pause() in a 'data' listener",
        "stopped",
        `const handler = () => { s.pause(); s.removeListener("data", handler); handoff(); };
         s.on("data", handler);`,
      ],
      [
        "close() of a readline interface",
        "stopped",
        `const rl = require("node:readline").createInterface({ input: s });
         rl.once("line", () => { rl.close(); handoff(); });`,
      ],
      ["destroy()", "stopped", `s.once("data", () => { s.destroy(); handoff(); });`],
      [
        "releaseLock() of a Readable.toWeb() reader",
        "stopped",
        `const reader = require("node:stream").Readable.toWeb(s).getReader();
         reader.read().then(() => { reader.releaseLock(); handoff(); });`,
      ],
      [
        "a break out of the console iterator",
        "stopped",
        `(async () => { for await (const line of console) break; handoff(); })();`,
      ],
      [
        "releaseLock() of a Bun.stdin.stream() reader",
        "stopped",
        `const reader = Bun.stdin.stream().getReader();
         reader.read().then(() => { reader.releaseLock(); handoff(); });`,
      ],
    ];
    // There the handle reads a dup of the caller's fd, and that fd keeps its blocking mode.
    // Not the rows where the parent stays armed: there its read can block the thread until the next input, as libuv's does.
    for (const name of ["pause() in a 'data' listener", "a break out of the console iterator"]) {
      const [, answer, reader] = rows.find(row => row[0] === name)!;
      rows.push([`${name}, on a terminal that the process cannot open by name`, answer, reader, true]);
    }
    test.concurrent.each(rows)("%s: %s", async (_name, answer, reader, unopenable = false) => {
      const total = 8;
      const { code, output } = await runInPty(
        `
          const { spawn } = require("node:child_process");
          const s = process.stdin;
          // The handle is there, and the descriptor that it reads a dup of has no O_NONBLOCK.
          const overDup = () => {
            if (!${unopenable}) return undefined;
            const fs = require("node:fs");
            let flags;
            if (fs.existsSync("/proc/self/fdinfo/0")) flags = parseInt(/^flags:\\s*([0-7]+)/m.exec(fs.readFileSync("/proc/self/fdinfo/0", "utf8"))[1], 8) & 0o4000;
            else flags = require("bun:ffi").dlopen("libSystem.B.dylib", { fcntl: { args: ["i32", "i32", "i32"], returns: "i32" } }).symbols.fcntl(0, 3, 0) & 4;
            return { handle: !!s._handle, stdinBlocks: flags === 0 };
          };
          function handoff() {
            // What the parent's handle reads from here on was typed for the child.
            const handle = s._handle;
            if (handle) {
              const onread = handle.onread;
              handle.onread = function (nread, buffer) {
                process.stdout.write("PARENT:" + (nread > 0 ? String(buffer).trim() : "END") + "\\n");
                return onread.call(this, nread, buffer);
              };
            }
            const child = spawn(process.execPath, ["-e", ${JSON.stringify(child)}], { stdio: "inherit" });
            child.on("exit", code => {
              process.stdout.write("RESULT " + JSON.stringify({ buffered: s.readableLength, reading: !!(s._handle && s._handle.reading), code, overDup: overDup() }) + "\\n");
              process.exit(0);
            });
          }
          ${reader}
          process.stdout.write("P1\\n");
        `,
        [
          terminal => {
            terminal.write("first\n");
          },
          async (terminal, output, seen) => {
            for (let i = 1; i <= total; i++) {
              terminal.write(`L${i}\n`);
              await seen(new RegExp(`(CHILD|PARENT):L${i}\\r?\\n`));
            }
            // The end of input is the child's. A handle of the parent that is still armed can take it as its one read.
            terminal.write("\x04");
            await seen(/RESULT |PARENT:END/);
            if (!output().includes("RESULT ")) terminal.write("\x04");
          },
        ],
        { markers: ["P1", "CHILDREADY", "RESULT "], unopenable },
      );
      const text = Bun.stripANSI(output());
      const lines = Array.from({ length: total }, (_, i) => `L${i + 1}`);
      const childGot = [...text.matchAll(/CHILD:(L\d+)/g)].map(m => m[1]);
      const parentRead = [...text.matchAll(/PARENT:(\w+)/g)].map(m => m[1]);
      const parentGot = parentRead.filter(read => read !== "END");
      expect({
        // Every line arrived once, in the order it was typed.
        lines: [...childGot, ...parentGot].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))),
        childInOrder: childGot.every((line, i) => i === 0 || Number(line.slice(1)) > Number(childGot[i - 1].slice(1))),
        result: JSON.parse(text.match(/RESULT (\{.*\})/)![1]),
      }).toEqual({
        lines,
        childInOrder: true,
        result: {
          buffered: parentGot.length * "L1\n".length,
          // Armed until its one read. A handle that read the end of input is done, whatever `reading` says.
          reading: parentRead.includes("END") ? expect.any(Boolean) : answer !== "stopped" && parentRead.length === 0,
          code: 0,
          ...(unopenable ? { overDup: { handle: true, stdinBlocks: true } } : {}),
        },
      });
      // An armed handle takes the first read that it wins from the child: a line, the end of input, or nothing.
      expect(parentRead.length).toBeLessThanOrEqual(answer === "stopped" ? 0 : 1);
      expect(code).toBe(0);
    });
  });

  // On a terminal, process.stdin reads through its handle and Bun.stdin (the
  // console iterator too) through a reader of its own. The one that is let go
  // must leave every line that is typed afterwards to the other.
  describe("a second reader of the terminal gets what is typed after the first lets go", () => {
    const consoleBreak = `for await (const line of console) break;`;
    const stdinPause = `await new Promise(resolve => process.stdin.once("data", () => { process.stdin.pause(); resolve(); }));`;
    // Bun.stdin.stream() is one stream for the process, so each way to read it to its end is a row.
    const untilEnd = "first\n\x04";
    const expectFirst = (text: string) =>
      `if (${text} !== "first\\n") throw new Error("the first reader got " + JSON.stringify(${text}));`;
    const rows: [name: string, first: string, second: string, typed?: string][] = [
      [
        "a break out of the console iterator, then a 'data' listener of process.stdin",
        consoleBreak,
        `process.stdin.on("data", got);`,
      ],
      [
        "Bun.write() of Bun.stdin.stream() to the end of input, then a 'data' listener of process.stdin",
        `const file = require("node:path").join(require("node:os").tmpdir(), "tty-test-stdin-" + process.pid + ".txt");
         let written;
         try {
           await Bun.write(file, Bun.stdin.stream());
           written = await Bun.file(file).text();
         } finally {
           require("node:fs").rmSync(file, { force: true });
         }
         ${expectFirst("written")}`,
        `process.stdin.on("data", got);`,
        untilEnd,
      ],
      [
        "text() of Bun.stdin.stream() to the end of input, then a 'data' listener of process.stdin",
        `const whole = await Bun.stdin.stream().text();
         ${expectFirst("whole")}`,
        `process.stdin.on("data", got);`,
        untilEnd,
      ],
      [
        "a break out of Bun.stdin.stream() piped through a TextDecoderStream, then a 'data' listener of process.stdin",
        `for await (const chunk of Bun.stdin.stream().pipeThrough(new TextDecoderStream())) {
           ${expectFirst("chunk")}
           break;
         }`,
        `process.stdin.on("data", got);`,
      ],
      [
        "releaseLock() of a Bun.stdin.stream() reader, then a 'data' listener of process.stdin",
        `const reader = Bun.stdin.stream().getReader();
         await reader.read();
         reader.releaseLock();`,
        `process.stdin.on("data", got);`,
      ],
      [
        "a break out of the console iterator, then readline",
        consoleBreak,
        `require("node:readline").createInterface({ input: process.stdin }).on("line", line => got(line + "\\n"));`,
      ],
      [
        "pause() of process.stdin, then the console iterator",
        stdinPause,
        `for await (const line of console) got(line + "\\n");`,
      ],
      [
        "pause() of process.stdin, then a Bun.stdin.stream() reader",
        stdinPause,
        `for await (const chunk of Bun.stdin.stream()) got(chunk);`,
      ],
      [
        "a break out of the console iterator, then the console iterator again",
        consoleBreak,
        `for await (const line of console) got(line + "\\n");`,
      ],
    ];
    test.concurrent.each(rows)("%s", async (_name, first, second, typed = "first\n") => {
      const total = 8;
      const { code, output } = await runInPty(
        `
          const say = line => process.stdout.write(line + "\\n");
          const decoder = new TextDecoder();
          let text = "";
          function got(chunk) {
            text += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
            let end;
            while ((end = text.indexOf("\\n")) !== -1) {
              const line = text.slice(0, end);
              text = text.slice(end + 1);
              say("GOT:" + line);
              if (line === "L${total}") { say("RESULT"); process.exit(0); }
            }
          }
          say("P1");
          ${first}
          say("SECOND");
          ${second}
        `,
        [
          terminal => {
            terminal.write(typed);
          },
          async (terminal, _output, seen) => {
            for (let i = 1; i <= total; i++) {
              terminal.write(`L${i}\n`);
              await seen(new RegExp(`GOT:L${i}\\r?\\n`));
            }
          },
        ],
        { markers: ["P1", "SECOND", "RESULT"] },
      );
      expect([...Bun.stripANSI(output()).matchAll(/GOT:(L\d+)/g)].map(m => m[1])).toEqual(
        Array.from({ length: total }, (_, i) => `L${i + 1}`),
      );
      expect(code).toBe(0);
    });
  });

  // The split has a price: what process.stdin is told does not reach a read of
  // the console iterator, which waits for its line and keeps the process alive.
  test("pause(), unref() and destroy() of process.stdin leave a read of the console iterator waiting", async () => {
    const { code, output } = await runInPty(
      `
        (async () => {
          for await (const line of console) {
            process.stdout.write("RESULT " + JSON.stringify(line) + "\\n");
            break;
          }
        })();
        process.stdin.pause();
        process.stdin.unref();
        process.stdin.on("close", () => process.stdout.write("P1\\n"));
        process.stdin.destroy();
      `,
      [
        terminal => {
          terminal.write("for the console\n");
        },
      ],
      { markers: ["P1", "RESULT "] },
    );
    expect(Bun.stripANSI(output())).toContain('RESULT "for the console"');
    expect(code).toBe(0);
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
      { markers: ["P1 ", "CHILDREADY", "P2 "], controllingTerminal: true },
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

  // libuv keeps one snapshot for the process: the terminal from before the first
  // handle left normal mode. uv__tty_close() writes it back for the handle that
  // took it, in whatever mode that handle is by then, and for no other handle.
  // setRawMode(false) writes back what its own handle saw.
  // https://github.com/nodejs/node/blob/v26.12.1/deps/uv/src/unix/tty.c#L345-L373
  describe("the mode of the terminal after each setRawMode() and each close", () => {
    const ICANON = process.platform === "darwin" ? 0x100 : 0x2;
    const ECHO = 0x8;
    const modeOf = (terminal: Bun.Terminal) => {
      const flags = terminal.localFlags;
      // The getter answers 0 for a terminal that is closed. No mode of these tests has every flag off.
      if (terminal.closed || flags === 0) throw new Error("the mode of the terminal could not be read");
      return (flags & (ICANON | ECHO)) === 0 ? "raw" : "cooked";
    };
    // One child takes the rows one after the other. After each step it prints a marker and waits for a line,
    // and the parent reads the mode then. A, B are streams. "end" destroys the streams of the row.
    const stepsChild = (rows: string[], streamsOn: "fd 0" | "/dev/tty") => `
      const tty = require("node:tty");
      const fs = require("node:fs");
      const say = s => process.stdout.write(s + "\\n");
      const ack = () => new Promise(resolve => process.stdin.once("data", () => resolve()));
      // Nothing in the worker holds its stream, and Bun collects there at once what it can.
      const workerSource = 'const { parentPort } = require("node:worker_threads"); new (require("node:tty").ReadStream)(0).setRawMode(true); globalThis.Bun?.gc(true); parentPort.once("message", () => {}); parentPort.postMessage(0);';
      (async () => {
        let index = 0;
        for (const row of ${JSON.stringify(rows)}) {
          const fds = {}, streams = {}, workers = {}, graphs = {};
          let terminal;
          const stream = who => (streams[who] ??= new tty.ReadStream(${streamsOn === "fd 0" ? "0" : `(fds[who] = fs.openSync("/dev/tty", "r"))`}));
          for (const step of row.split(", ")) {
            const [who, what] = step.split(" ");
            if (who === "end") {
              for (const each of Object.values(streams)) each.destroy();
              for (const fd of Object.values(fds)) fs.closeSync(fd);
              if (terminal && !terminal.closed) terminal.close();
            } else if (who === "child") {
              const { status } = require("node:child_process").spawnSync("stty", ["raw", "-echo"], { stdio: "inherit" });
              if (status !== 0) throw new Error("stty ended with " + status);
            } else if (who === "terminal") {
              if (what === "raw") (terminal = new Bun.Terminal({})).setRawMode(true);
              else terminal.close();
            } else if (who.startsWith("worker")) {
              const { Worker } = require("node:worker_threads");
              if (what === "raw") await new Promise(resolve => (workers[who] = new Worker(workerSource, { eval: true })).once("message", resolve));
              else await new Promise(resolve => { workers[who].once("exit", resolve); workers[who].postMessage(0); });
            } else if (who.startsWith("graph")) {
              if (what === "raw") (graphs[who] = { graph: new Bun.ModuleGraph({}) }).graph.run(() => { (graphs[who].stream = new tty.ReadStream(0)).setRawMode(true); });
              else if (what === "drop") { graphs[who].stream = undefined; Bun.gc(true); }
              else graphs[who].graph.dispose();
            } else if (what === "raw") stream(who).setRawMode(true);
            else if (what === "normal") stream(who).setRawMode(false);
            else if (what === "closeFd") { fs.closeSync(fds[who]); delete fds[who]; }
            else stream(who).destroy();
            say("P" + String(++index).padStart(2, "0")); await ack();
          }
        }
        process.exit(0);
      })();
    `;
    async function modesAfterEachStep(
      rows: string[],
      streamsOn: "fd 0" | "/dev/tty",
      opts: { exe?: string; unopenable?: boolean } = {},
    ) {
      const steps = rows.flatMap(row => row.split(", "));
      const markers = steps.map((_, index) => "P" + String(index + 1).padStart(2, "0"));
      const modes: string[] = [];
      const { code } = await runInPty(
        stepsChild(rows, streamsOn),
        markers.map(() => (terminal: Bun.Terminal) => {
          modes.push(modeOf(terminal));
          terminal.write("\n");
        }),
        { markers, controllingTerminal: streamsOn === "/dev/tty", ...opts },
      );
      const observed: Record<string, string[]> = {};
      for (const row of rows) observed[row] = modes.splice(0, row.split(", ").length);
      return { observed, code };
    }

    // Every row is what Node v26.3.0 answers, and where CI has a Node the rows run under it too.
    describe.each(runtimes)("as in Node (%s)", (runtime, exe) => {
      test.skipIf(!exe).concurrent("streams on fd 0", async () => {
        const rows = {
          // A stream that never left normal mode writes nothing.
          "A raw, B destroy, A destroy, end": ["raw", "raw", "cooked", "cooked"],
          // B saw a raw terminal. Its close must not write that back.
          "A raw, B raw, A normal, B destroy, end": ["raw", "raw", "cooked", "cooked", "cooked"],
          "A raw, B raw, A destroy, B destroy, end": ["raw", "raw", "cooked", "cooked", "cooked"],
          "A raw, B raw, B destroy, A destroy, end": ["raw", "raw", "raw", "cooked", "cooked"],
          // Only the stream that took the snapshot puts the terminal back: B leaves it raw, and "end" closes A.
          "A raw, A normal, B raw, B destroy, end": ["raw", "cooked", "raw", "raw", "cooked"],
          // The snapshot of the process, not the one that A took the second time.
          "A raw, A normal, B raw, A raw, end": ["raw", "cooked", "raw", "raw", "cooked"],
          // The stream that took the snapshot writes it at its close in normal mode too, over what a child has set since.
          "A raw, A normal, child raw, A destroy, end": ["raw", "cooked", "raw", "cooked", "cooked"],
        };
        const { observed, code } = await modesAfterEachStep(Object.keys(rows), "fd 0", { exe: exe! });
        expect(observed).toEqual(rows);
        expect(code).toBe(0);
      });

      // The end of a Worker closes its streams as destroy() does. Nothing in the Worker holds its stream.
      // One after the other: a debug build takes seconds to start a Worker, and more with other children beside it.
      test.skipIf(!exe).each([
        ["that took the snapshot puts the terminal back", "worker1 raw, worker1 end, end", ["raw", "cooked", "cooked"]],
        [
          "that did not take it writes nothing",
          "A raw, A normal, worker1 raw, worker1 end, end",
          ["raw", "cooked", "raw", "raw", "cooked"],
        ],
      ])("the end of a Worker with a stream %s", async (_name, row, modes) => {
        const { observed, code } = await modesAfterEachStep([row], "fd 0", { exe: exe! });
        expect(observed).toEqual({ [row]: modes });
        expect(code).toBe(0);
      });

      // The handle sets the mode through a descriptor of its own, so the caller can close the one that it passed.
      // Not under Node on macOS: libuv reads /dev/tty through select() there, and its close compares the descriptor
      // of that fallback with the one that took the snapshot, so no close of such a stream puts the terminal back.
      // https://github.com/nodejs/node/blob/v26.12.1/deps/uv/src/unix/stream.c#L339-L366
      const skip = !exe || (runtime === "node" && isMacOS);
      test.skipIf(skip).concurrent("streams on descriptors of their own that the program closes first", async () => {
        const rows = {
          "A raw, A closeFd, A destroy, end": ["raw", "raw", "cooked", "cooked"],
          "A raw, B raw, A closeFd, A destroy, B destroy, end": ["raw", "raw", "raw", "cooked", "cooked", "cooked"],
        };
        const { observed, code } = await modesAfterEachStep(Object.keys(rows), "/dev/tty", { exe: exe! });
        expect(observed).toEqual(rows);
        expect(code).toBe(0);
      });
    });

    // Only a tty handle takes the snapshot of the process. A Bun.Terminal that went raw first must not keep it
    // from the stream. The end of a Bun.ModuleGraph closes the streams of the graph as destroy() does.
    test.concurrent("a Bun.Terminal in raw mode, and the end of a Bun.ModuleGraph", async () => {
      const rows = {
        "terminal raw, A raw, A destroy, end": ["cooked", "raw", "cooked", "cooked"],
        "terminal raw, terminal close, A raw, A destroy, end": ["cooked", "cooked", "raw", "cooked", "cooked"],
        "graph1 raw, graph1 dispose, end": ["raw", "cooked", "cooked"],
        // The stream of the graph took the snapshot, so its end puts the terminal back under the raw stream of the host.
        "graph1 raw, A raw, graph1 dispose, end": ["raw", "raw", "cooked", "cooked"],
        "A raw, graph1 raw, graph1 dispose, end": ["raw", "raw", "raw", "cooked"],
        "graph1 raw, graph2 raw, graph1 dispose, graph2 dispose, end": ["raw", "raw", "cooked", "cooked", "cooked"],
        // A stream that nothing holds and that took the snapshot is not collected: the end of its graph still closes it.
        "graph1 raw, graph1 drop, graph1 dispose, end": ["raw", "raw", "cooked", "cooked"],
      };
      const { observed, code } = await modesAfterEachStep(Object.keys(rows), "fd 0");
      expect(observed).toEqual(rows);
      expect(code).toBe(0);
    });

    // libuv has no descriptor of its own there: its two handles are one fd, and Node puts the terminal back
    // at the close of B in both rows. Here each handle has one, so the rows are those of a terminal that can be opened.
    test.concurrent("on a terminal that the process cannot open by name", async () => {
      const rows = {
        "A raw, B raw, B destroy, A destroy, end": ["raw", "raw", "raw", "cooked", "cooked"],
        "A raw, A normal, B raw, B destroy, end": ["raw", "cooked", "raw", "raw", "cooked"],
      };
      const { observed, code } = await modesAfterEachStep(Object.keys(rows), "fd 0", { unopenable: true });
      expect(observed).toEqual(rows);
      expect(code).toBe(0);
    });

    // With stdout in a pipe Bun leaves the descriptors 0 to 2 of a terminal alone when it ends (#29592), so what is
    // left is what the handles left. The shell says EXITED after the child, and holds the terminal for the parent to read.
    const behindAPipe = ["sh", "-c", '{ "$@"; echo "STATUS $?"; } | cat; echo EXITED; read line', "sh"];

    // A Bun.Terminal that went raw first does not keep the snapshot from the stream, and the end of the process writes it.
    test.concurrent("a stream that is raw when the process ends, after a Bun.Terminal went raw", async () => {
      const modes: string[] = [];
      const sample = (terminal: Bun.Terminal) => {
        modes.push(modeOf(terminal));
        terminal.write("\n");
      };
      const { code, output } = await runInPty(
        `
          const terminal = new Bun.Terminal({});
          terminal.setRawMode(true);
          terminal.close();
          const stream = new (require("node:tty").ReadStream)(require("node:fs").openSync("/dev/tty", "r"));
          stream.setRawMode(true);
          process.stdin.once("data", () => process.exit(0));
          process.stdout.write("RAW\\n");
        `,
        [sample, sample],
        { markers: ["RAW", "EXITED"], controllingTerminal: true, prefix: behindAPipe },
      );
      expect(modes).toEqual(["raw", "cooked"]);
      expect(Bun.stripANSI(output())).toContain("STATUS 0");
      expect(code).toBe(0);
    });

    // The snapshot of a Bun.Terminal is the one of its own pty. Written at the end of the process, it would go
    // to whatever has the number of the closed master by then: here the terminal of the user.
    test.concurrent("a Bun.Terminal that went raw and is closed leaves nothing to write at the end", async () => {
      let before: number | undefined;
      let after: number | undefined;
      const { code, output } = await runInPty(
        `
          const tty = require("node:tty");
          const fs = require("node:fs");
          process.stdin.once("data", () => {
            const stream = new tty.ReadStream(fs.openSync("/dev/tty", "r"));
            stream.setRawMode(true);
            stream.setRawMode(false);
            stream.destroy();
            const terminal = new Bun.Terminal({});
            terminal.setRawMode(true);
            terminal.close();
            // One of these takes the number that the master had.
            for (let i = 0; i < 8; i++) fs.openSync("/dev/tty", "r");
            process.exit(0);
          });
          process.stdout.write("READY\\n");
        `,
        [
          terminal => {
            // Not what a new pty has: a snapshot of another terminal would show.
            terminal.localFlags = terminal.localFlags & ~ECHO;
            before = terminal.localFlags & (ICANON | ECHO);
            terminal.write("\n");
          },
          terminal => {
            after = terminal.localFlags & (ICANON | ECHO);
            terminal.write("\n");
          },
        ],
        { markers: ["READY", "EXITED"], controllingTerminal: true, prefix: behindAPipe },
      );
      // Cooked and without echo, before and after.
      expect({ before, after }).toEqual({ before: ICANON, after: ICANON });
      expect(Bun.stripANSI(output())).toContain("STATUS 0");
      expect(code).toBe(0);
    });

    // The handle has its descriptor from the start, so setRawMode(true) takes none: the mode is set, and put
    // back at the close, with no descriptor free.
    test.concurrent("setRawMode() and destroy() with no descriptor free", async () => {
      const modes: string[] = [];
      const sample = (terminal: Bun.Terminal) => {
        modes.push(modeOf(terminal));
        terminal.write("\n");
      };
      const { code } = await runInPty(
        `
          const fs = require("node:fs");
          const step = marker => { fs.writeSync(1, marker + "\\n"); fs.readSync(0, Buffer.alloc(64)); };
          // The handle has its descriptor before the descriptors run out.
          const stream = new (require("node:tty").ReadStream)(0);
          const held = [];
          let atTheLimit;
          try { for (;;) held.push(fs.openSync("/dev/null", "r")); } catch (err) { atTheLimit = err.code; }
          stream.setRawMode(true);
          step("P1");
          stream.destroy();
          step("P2");
          // LeakSanitizer opens files when the process exits.
          for (const fd of held.splice(0)) fs.closeSync(fd);
          process.exit(atTheLimit === "EMFILE" ? 0 : 3);
        `,
        [sample, sample],
        { markers: ["P1", "P2"], prefix: ["sh", "-c", 'ulimit -n 64 && exec "$@"', "sh"] },
      );
      expect(modes).toEqual(["raw", "cooked"]);
      expect(code).toBe(0);
    });

    // The rows above read the mode a turn of the loop after the step. This child takes no turn: destroy()
    // has put the terminal back when it returns.
    test.concurrent("destroy() has put the terminal back when it returns", async () => {
      const modes: string[] = [];
      const sample = (terminal: Bun.Terminal) => {
        modes.push(modeOf(terminal));
        terminal.write("\n");
      };
      const { code } = await runInPty(
        `
          const fs = require("node:fs");
          const step = marker => { fs.writeSync(1, marker + "\\n"); fs.readSync(0, Buffer.alloc(64)); };
          const stream = new (require("node:tty").ReadStream)(0);
          stream.setRawMode(true);
          step("P1");
          stream.destroy();
          step("P2");
          process.exit(0);
        `,
        [sample, sample],
        { markers: ["P1", "P2"] },
      );
      expect(modes).toEqual(["raw", "cooked"]);
      expect(code).toBe(0);
    });
  });

  // Node starts the handle from _read() alone: a read() that the buffer serves
  // leaves it stopped, so a child spawned next gets every keystroke.
  test("read() served from the buffer leaves the handle stopped", async () => {
    const { code, output } = await runInPty(
      `
        const s = process.stdin;
        s.once("readable", () => {
          const before = s._handle.reading;
          const chunk = String(s.read());
          process.stdout.write("RESULT " + JSON.stringify({ before, chunk, after: s._handle.reading }) + "\\n");
          process.exit(0);
        });
        process.stdout.write("P1\\n");
      `,
      [terminal => void terminal.write("line\n")],
      { markers: ["P1", "RESULT "] },
    );
    expect(code).toBe(0);
    expect(JSON.parse(Bun.stripANSI(output()).match(/RESULT (\{.*\})/)![1])).toEqual({
      before: false,
      chunk: "line\n",
      after: false,
    });
  });

  // The stream holds the loop again when a read restarts the handle that a
  // buffered chunk stopped. Without that, the process ends after its first line.
  test("a 'readable' listener alone keeps the process reading to the end of input", async () => {
    const { code, output } = await runInPty(
      `
        const s = process.stdin;
        const events = [];
        s.on("readable", () => {
          let chunk;
          while ((chunk = s.read()) !== null) {
            events.push(String(chunk));
            process.stdout.write("GOT " + events.length + "\\n");
          }
        });
        s.on("end", () => events.push("end"));
        process.on("exit", () => process.stdout.write("RESULT " + JSON.stringify(events) + "\\n"));
        process.stdout.write("P1\\n");
      `,
      [
        terminal => void terminal.write("one\n"),
        terminal => void terminal.write("two\n"),
        terminal => void terminal.write("\x04"),
      ],
      { markers: ["P1", "GOT 1", "GOT 2", "RESULT "] },
    );
    expect(JSON.parse(Bun.stripANSI(output()).match(/RESULT (\[.*\])/)![1])).toEqual(["one\n", "two\n", "end"]);
    expect(code).toBe(0);
  });

  // The same restart must not take the loop back for a stream that the program unref'd.
  test("after unref(), a handle that a read restarts does not hold the process", async () => {
    const { code, output } = await runInPty(
      `
        const s = process.stdin;
        s.unref();
        const alive = setInterval(() => {}, 1000);
        s.on("readable", () => {
          const chunks = [];
          let chunk;
          while ((chunk = s.read()) !== null) chunks.push(String(chunk));
          if (chunks.length === 0) return;
          // The read() that found the buffer empty started the handle again.
          process.stdout.write("GOT " + JSON.stringify({ chunks, reading: s._handle.reading }) + "\\n");
          clearInterval(alive);
        });
        process.on("exit", code => process.stdout.write("RESULT " + code + "\\n"));
        process.stdout.write("P1\\n");
      `,
      [terminal => void terminal.write("one\n")],
      { markers: ["P1", "RESULT "] },
    );
    const text = Bun.stripANSI(output());
    expect(JSON.parse(text.match(/GOT (\{.*\})/)![1])).toEqual({ chunks: ["one\n"], reading: true });
    expect(text).toContain("RESULT 0");
    expect(code).toBe(0);
  });

  // What programs and libraries do with the stdin of a terminal. The same
  // calls over a pipe run through another stream, with tests of their own.
  describe("the calls of programs that read a terminal", () => {
    // libuv's uv_ref() holds the loop for an active handle alone, and a handle
    // that does not read is not active: each child ends by itself, as in Node.
    test.concurrent.each([
      ["alone", `s.ref();`],
      ["after unref()", `s.unref(); s.ref();`],
      ["a turn after pause()", `s.on("data", () => {}); s.pause(); setImmediate(() => s.ref());`],
    ])("ref() of a stdin that nothing reads does not hold the process: %s", async (_name, calls) => {
      const { code, output } = await runInPty(
        `
          const s = process.stdin;
          ${calls}
          process.on("exit", code => process.stdout.write("RESULT " + JSON.stringify({ code, reading: s._handle.reading }) + "\\n"));
        `,
        [],
        { markers: ["RESULT "] },
      );
      expect(JSON.parse(Bun.stripANSI(output()).match(/RESULT (\{.*\})/)![1])).toEqual({ code: 0, reading: false });
      expect(code).toBe(0);
    });

    // While the handle reads, the last of ref() and unref() decides. The same
    // files run over a pipe in readline/stdin_fell_asleep.test.ts.
    test.concurrent.each(["stdin_fell_asleep.js", "stdin_fell_asleep_2.js"])(
      "ref() after unref() holds a stdin that reads (%s)",
      async file => {
        const line = JSON.stringify("Hello, world!\n");
        const { code, output } = await runInPty(
          readFileSync(join(import.meta.dir, "readline", file), "utf8"),
          [terminal => void terminal.write("Hello, world!\n")],
          { markers: ["ready", line] },
        );
        // The line comes once from the program, and not a second time from a read that was left armed.
        expect(Bun.stripANSI(output()).split(line).length - 1).toBe(1);
        expect(code).toBe(0);
      },
    );

    // What `useInput` of Ink does when it mounts and when it unmounts: ink@5.2.1 build/components/App.js#L104-L138.
    // unmount() leaves the handle reading and unref'd. The ref() of the next mount has to hold the process again.
    test.concurrent("the call order of Ink's raw mode, mounted twice", async () => {
      const { code, output } = await runInPty(
        `
          const s = process.stdin;
          const say = line => process.stdout.write(line + "\\n");
          const keys = [];
          let onKey;
          const handleReadable = () => { let chunk; while ((chunk = s.read()) !== null) onKey(chunk); };
          const mount = () => { s.setEncoding("utf8"); s.ref(); s.setRawMode(true); s.addListener("readable", handleReadable); };
          const unmount = () => { s.setEncoding("utf8"); s.setRawMode(false); s.removeListener("readable", handleReadable); s.unref(); };
          process.on("exit", code => say("RESULT " + JSON.stringify({ keys, code, isRaw: s.isRaw })));
          (async () => {
            for (const round of [1, 2]) {
              mount();
              say("MOUNTED" + round);
              keys.push(await new Promise(resolve => { onKey = resolve; }));
              unmount();
              // Ink renders between the two: the loop turns with nothing but the unref'd handle.
              await new Promise(resolve => setImmediate(resolve));
            }
          })();
        `,
        // No line end: raw mode alone hands over a key at once.
        [terminal => void terminal.write("a"), terminal => void terminal.write("b")],
        { markers: ["MOUNTED1", "MOUNTED2", "RESULT "] },
      );
      expect(JSON.parse(Bun.stripANSI(output()).match(/RESULT (\{.*\})/)![1])).toEqual({
        keys: ["a", "b"],
        code: 0,
        isRaw: false,
      });
      expect(code).toBe(0);
    });

    // The rows of the table above end with the child. A loop over the lines of the console that runs a child
    // comes back: while the loop waits for the child it reads nothing, and then it reads again.
    test.concurrent(
      "a loop over the lines of the console hands the terminal to a child and takes it back",
      async () => {
        const child = `process.stdout.write('CHILDREADY\\n'); process.stdin.once('data', d => { process.stdout.write('CHILD:' + d); process.exit(0); })`;
        const { code, output } = await runInPty(
          `
          const { spawn } = require("node:child_process");
          const say = line => process.stdout.write(line + "\\n");
          const got = [];
          say("PARENT1");
          for await (const line of console) {
            got.push(line);
            if (got.length === 1) { say("PARENT2"); continue; }
            if (got.length === 4) break;
            got.push(await new Promise(resolve => spawn(process.execPath, ["-e", ${JSON.stringify(child)}], { stdio: "inherit" }).on("exit", resolve)));
            say("PARENT3");
          }
          say("RESULT " + JSON.stringify(got));
        `,
          [
            terminal => void terminal.write("one\n"),
            terminal => void terminal.write("two\n"),
            terminal => void terminal.write("three\n"),
            terminal => void terminal.write("four\n"),
          ],
          { markers: ["PARENT1", "PARENT2", "CHILDREADY", "PARENT3", "RESULT "] },
        );
        const text = Bun.stripANSI(output());
        expect({
          parent: JSON.parse(text.match(/RESULT (\[.*\])/)![1]),
          child: [...text.matchAll(/CHILD:(\w+)/g)].map(m => m[1]),
        }).toEqual({ parent: ["one", "two", 0, "four"], child: ["three"] });
        expect(code).toBe(0);
      },
    );

    // test/js/node/process/stdin/stdin-fixtures.test.ts runs this file over a pipe. On a terminal Node prints the same.
    test.concurrent.each([
      [
        "a 'readable' listener reads on across pause()",
        ["attachReadable\n", "abc\n", "pause\n", "def\n", "exit\n"],
        123,
        [
          "%READY%",
          'got stdin "attachReadable"',
          "%READY%",
          'got stdin "abc"',
          "%READY%",
          'got readable "abc\\n"',
          'got stdin "pause"',
          "%READY%",
          'got readable "pause\\n"',
          'got stdin "def"',
          "%READY%",
          'got readable "def\\n"',
          'got stdin "exit"',
          "exit with code 123",
        ],
      ],
      [
        "pause() with a 'data' listener alone lets the process exit",
        ["abc\n", "pause\n"],
        0,
        [
          "%READY%",
          'got stdin "abc"',
          "%READY%",
          'got stdin "pause"',
          "%READY%",
          "beforeExit with code 0",
          "exit with code 0",
        ],
      ],
    ])("%s", async (_name, typed, exitCode, printed) => {
      const { code, output } = await runInPty(
        readFileSync(join(import.meta.dir, "process/stdin/pause.fixture.js"), "utf8"),
        [
          async (terminal, _output, seen) => {
            for (const [index, text] of typed.entries()) {
              await seen(new RegExp(`(?:^%READY%\\r?\\n[^]*?){${index + 1}}`, "m"));
              terminal.write(text);
            }
          },
        ],
        { markers: ["%READY%", "exit with code"], exitCode },
      );
      const lines = Bun.stripANSI(output())
        .split(/\r?\n/)
        .filter(line => /^(%READY%$|got |beforeExit |exit with )/.test(line));
      expect(lines).toEqual(printed);
      expect(code).toBe(exitCode);
    });
  });

  // Node's MakeCallback runs 'data' listeners in the async context of the
  // handle, which is the one that first read process.stdin.
  test("listeners of process.stdin run in the async context that first read it", async () => {
    const { code, output } = await runInPty(
      `
        const { AsyncLocalStorage } = require("node:async_hooks");
        const als = new AsyncLocalStorage();
        const stores = {};
        als.run({ id: 1 }, () => {
          process.stdin.once("data", () => { stores.added_inside = als.getStore(); });
        });
        process.stdin.once("data", () => {
          stores.added_outside = als.getStore();
          process.stdout.write("P2\\n");
        });
        process.stdin.once("end", () => {
          stores.end = als.getStore();
          process.stdout.write("RESULT " + JSON.stringify(stores) + "\\n");
        });
        process.stdout.write("P1\\n");
      `,
      [terminal => void terminal.write("line\n"), terminal => void terminal.write("\x04")],
      { markers: ["P1", "P2", "RESULT "] },
    );
    expect(JSON.parse(Bun.stripANSI(output()).match(/RESULT (\{.*\})/)![1])).toEqual({
      added_inside: { id: 1 },
      added_outside: { id: 1 },
      end: { id: 1 },
    });
    expect(code).toBe(0);
  });

  // The startup answer for "is fd 0 a terminal" can be stale when stdin is first read.
  test("process.stdin is a stream after fd 0 is closed", async () => {
    const { code, output } = await runInPty(
      `
        require("node:fs").closeSync(0);
        let uncaught;
        process.on("uncaughtException", err => { uncaught = err.code; });
        const s = process.stdin;
        process.stdout.write("RESULT " + JSON.stringify({
          uncaught,
          readable: typeof s?.on === "function",
          isSocket: s instanceof require("node:net").Socket,
          // A terminal that has no handle says true, so this is the answer of isatty() at the first read.
          isTTY: s.isTTY === true,
          same: s === process.stdin,
        }) + "\\n");
        process.exit(0);
      `,
      [],
      { markers: ["RESULT "] },
    );
    expect(JSON.parse(Bun.stripANSI(output()).match(/RESULT (\{.*\})/)![1])).toEqual({
      readable: true,
      isSocket: false,
      isTTY: false,
      same: true,
    });
    expect(code).toBe(0);
  });

  // With no descriptor free the handle cannot be made (libuv's needs none). stdin
  // then reads through the stream of a fd that is no terminal, which needs none
  // either, and stays a terminal for its user: isTTY, and a raw mode.
  test("process.stdin of a terminal with no descriptor free", async () => {
    const { code, output } = await runInPty(
      `
        const fs = require("node:fs");
        // A debug build reads its built-in modules from files: load what the path takes while descriptors are free.
        void require("node:tty").ReadStream;
        // 'close', not 'end': the descriptor of this stream is closed by then, so none comes free after the loop below.
        await new Promise(resolve => {
          const warm = fs.createReadStream("/dev/null");
          warm.on("data", () => {});
          warm.on("close", () => process.stdout.write("WARM\\n", resolve));
        });
        const held = [];
        try { for (;;) held.push(fs.openSync("/dev/null", "r")); } catch {}
        let uncaught;
        process.on("uncaughtException", err => { uncaught = err.code ?? String(err); });
        const s = process.stdin;
        const shape = {
          atTheLimit: held.length > 0,
          isSocket: s instanceof require("node:net").Socket,
          isTTY: s.isTTY,
          raw: [s.setRawMode(true) === s, s.isRaw, s.setRawMode(false) === s, s.isRaw],
          refs: [typeof s.ref, typeof s.unref],
        };
        s.once("data", chunk => {
          // LeakSanitizer opens files when the process exits.
          for (const fd of held.splice(0)) fs.closeSync(fd);
          process.stdout.write("RESULT " + JSON.stringify({ ...shape, uncaught, chunk: String(chunk) }) + "\\n");
          process.exit(0);
        });
        fs.writeSync(1, "P1\\n");
      `,
      [terminal => void terminal.write("line\n")],
      { markers: ["P1", "RESULT "], prefix: ["sh", "-c", 'ulimit -n 64 && exec "$@"', "sh"] },
    );
    expect(JSON.parse(Bun.stripANSI(output()).match(/RESULT (\{.*\})/)![1])).toEqual({
      atTheLimit: true,
      isSocket: false,
      isTTY: true,
      raw: [true, true, true, false],
      refs: ["function", "function"],
      chunk: "line\n",
    });
    expect(code).toBe(0);
  });

  // The same stream, made here by a constructor that throws: ref() starts no
  // read, so a line that nothing in the parent asked for is the child's.
  test("a terminal's stdin that has no handle leaves a line to a child after ref() and unref()", async () => {
    const { code, output } = await runInPty(
      `
        const tty = require("node:tty");
        const ReadStream = tty.ReadStream;
        tty.ReadStream = function () {
          throw Object.assign(new Error("TTY initialization failed: uv_tty_init returned EMFILE (too many open files)"), {
            code: "ERR_TTY_INIT_FAILED",
          });
        };
        const s = process.stdin;
        tty.ReadStream = ReadStream;
        const got = [];
        s.on("data", chunk => got.push(String(chunk)));
        s.pause();
        s.ref();
        s.unref();
        const child = require("node:child_process").spawn(
          process.execPath,
          ["-e", "process.stdout.write('CHILDREADY\\\\n'); process.stdin.once('data', d => { process.stdout.write('CHILD:' + d); process.exit(0); })"],
          { stdio: "inherit" },
        );
        child.on("exit", exitCode => {
          process.stdout.write("RESULT " + JSON.stringify({ isSocket: s instanceof require("node:net").Socket, got, exitCode }) + "\\n");
          process.exit(0);
        });
      `,
      [terminal => void terminal.write("for the child\n")],
      { markers: ["CHILDREADY", "RESULT "] },
    );
    const text = Bun.stripANSI(output());
    expect(text).toContain("CHILD:for the child");
    expect(JSON.parse(text.match(/RESULT (\{.*\})/)![1])).toEqual({ isSocket: false, got: [], exitCode: 0 });
    expect(code).toBe(0);
  });

  // process.stdin is the host's, whichever script reads it first. A stream
  // that a graph's script makes is the graph's, as everything that it opens.
  test("disposing a Bun.ModuleGraph that read process.stdin first leaves its handle open", async () => {
    const { code, output } = await runInPty(
      `
        const tty = require("node:tty");
        const graph = new Bun.ModuleGraph({});
        let own;
        graph.run(() => {
          void process.stdin;
          own = new tty.ReadStream(0);
        });
        graph.dispose();
        const UV_EBADF = -9;
        const errors = [];
        process.stdin.on("error", err => errors.push(err.code));
        process.stdin.setRawMode(true);
        const report = chunk => {
          process.stdout.write("RESULT " + JSON.stringify({
            errors,
            raw: process.stdin.isRaw,
            chunk: String(chunk),
            ownIsClosed: own._handle.setRawMode(0) === UV_EBADF,
          }) + "\\n");
          process.exit(0);
        };
        // A closed handle reads nothing: say so at once.
        if (errors.length > 0) report("");
        process.stdin.once("data", report);
        process.stdout.write("P1\\n");
      `,
      [terminal => void terminal.write("x")],
      { markers: ["P1", "RESULT "] },
    );
    expect(JSON.parse(Bun.stripANSI(output()).match(/RESULT (\{.*\})/)![1])).toEqual({
      errors: [],
      raw: true,
      chunk: "x",
      ownIsClosed: true,
    });
    expect(code).toBe(0);
  });

  test("tty_wrap.TTY delivers reads through onread and reports EOF", async () => {
    const { code, output } = await runInPty(
      `
        const { TTY } = process.binding("tty_wrap");
        const handle = new TTY(0, {});
        const events = [];
        handle.onread = function (nread, buf) {
          events.push([nread, buf === undefined ? null : buf.toString(), this === handle]);
          process.stdout.write("READ " + events.length + "\\n");
          if (nread === -4095) {
            process.stdout.write("RESULT " + JSON.stringify({ events, bytesRead: handle.bytesRead, fd: handle.fd }) + "\\n");
            handle.close();
            process.exit(0);
          }
        };
        process.stdout.write("started=" + handle.readStart() + "\\n");
      `,
      [
        terminal => {
          // Cooked mode: a line per read, and ^D at the start of a line is EOF.
          terminal.write("abc\n");
        },
        terminal => {
          terminal.write("\x04");
        },
      ],
      { markers: ["started=0", "READ 1", "RESULT "] },
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

  // Node's TTYWrap::GetWindowSize(): 0 and the size, or a negative libuv errno
  // that leaves the array alone. Node v26.3.0 prints the same record.
  test("TTY.prototype.getWindowSize answers 0 or a negative libuv errno", async () => {
    using dir = tempDir("tty-window-size", {});
    const { code, output } = await runInPty(
      `
        const { TTY } = process.binding("tty_wrap");
        const fs = require("node:fs");
        const ask = handle => {
          const size = [-1, -1];
          return [handle.getWindowSize(size), size];
        };
        const terminalHandle = new TTY(0, {});
        const terminal = ask(terminalHandle);
        // On POSIX a pipe is a handle too, and it has no window size.
        const fifo = ${JSON.stringify(join(String(dir), "fifo"))};
        require("node:child_process").execFileSync("mkfifo", [fifo]);
        const pipeHandle = new TTY(fs.openSync(fifo, fs.constants.O_RDWR | fs.constants.O_NONBLOCK), {});
        const pipe = ask(pipeHandle);
        pipeHandle.close();
        terminalHandle.close();
        process.stdout.write("RESULT " + JSON.stringify({
          terminal,
          stdout: [process.stdout.columns, process.stdout.rows],
          pipe,
          closed: ask(terminalHandle),
        }) + "\\n");
      `,
      [],
      { markers: ["RESULT "] },
    );
    const result = JSON.parse(Bun.stripANSI(output()).match(/RESULT (\{.*\})/)![1]);
    expect(result).toEqual({
      terminal: [0, result.stdout],
      stdout: [expect.any(Number), expect.any(Number)],
      // What the kernel says of a FIFO: UV_ENOTTY on Linux, UV_EOPNOTSUPP on macOS.
      pipe: [isLinux ? -25 : -102, [-1, -1]],
      closed: [-9, [-1, -1]], // UV_EBADF
    });
    expect(code).toBe(0);
  });

  // What Node v26.3.0 prints, but for the fd of an open handle: Node names the
  // descriptor that it reopened, this handle the caller's.
  test("a TTY handle answers hasRef(), and readStart() and fd once it is closed, as Node's", async () => {
    using dir = tempDir("tty-closed-handle", { "file.txt": "x" });
    const { code, output } = await runInPty(
      `
        const { TTY } = process.binding("tty_wrap");
        const fs = require("node:fs");
        const handle = new TTY(0, {});
        const open = [handle.hasRef(), typeof handle.getAsyncId(), handle.setBlocking(true)];
        handle.unref();
        const unreffed = handle.hasRef();
        handle.close();
        const closed = [handle.readStart(), handle.fd, handle.hasRef()];
        const ctx = {};
        const fd = fs.openSync(${JSON.stringify(join(String(dir), "file.txt"))}, "r");
        const refused = new TTY(fd, ctx);
        const neverOpen = [ctx.code, refused.readStart(), refused.fd];
        fs.closeSync(fd);
        process.stdout.write("RESULT " + JSON.stringify({ open, unreffed, closed, neverOpen }) + "\\n");
      `,
      [],
      { markers: ["RESULT "] },
    );
    expect(JSON.parse(Bun.stripANSI(output()).match(/RESULT (\{.*\})/)![1])).toEqual({
      open: [true, "number", 0],
      unreffed: false,
      closed: [-22, -1, false], // UV_EINVAL
      neverOpen: ["EINVAL", -22, -22],
    });
    expect(code).toBe(0);
  });

  // Node's HandleWrap::Close(): the callback runs from the loop once the handle
  // has closed, with the handle as `this`. A handle that is closed already
  // takes no callback. Node v26.3.0 prints the same record.
  test("TTY.prototype.close(callback) calls back once, from the loop", async () => {
    const { code, output } = await runInPty(
      `
        const { TTY } = process.binding("tty_wrap");
        const handle = new TTY(0, {});
        const log = [];
        let returned = false;
        handle.close(function () {
          log.push(["closed", returned, this === handle]);
          // A callback of the second close() would run before this immediate.
          setImmediate(() => process.stdout.write("RESULT " + JSON.stringify({ log, length: handle.close.length }) + "\\n"));
        });
        handle.close(() => log.push(["second close"]));
        returned = true;
        process.nextTick(() => log.push(["tick"]));
        queueMicrotask(() => log.push(["microtask"]));
      `,
      [],
      { markers: ["RESULT "] },
    );
    expect(JSON.parse(Bun.stripANSI(output()).match(/RESULT (\{.*\})/)![1])).toEqual({
      log: [["tick"], ["microtask"], ["closed", true, true]],
      length: 0,
    });
    expect(code).toBe(0);
  });

  // libuv finishes from the loop what a tty that it reopened does not take at once. The handle has a descriptor
  // of its own for that, as a uv_tty_t has, and the caller's descriptor stays as the caller made it.
  // The child gets a pty pair of the test's own: the master as fd 3, nonblocking as node-pty opens it, and the
  // slave as fd 4, in raw mode so that what is written is what arrives.
  describe("a write that the pty does not take whole", () => {
    const size = 1 << 20;
    const fill = "abcdefghijklmnopqrstuvwxyz0123456789";
    const sha256 = createHash("sha256").update(Buffer.alloc(size, fill)).digest("hex");
    const prelude = `
      const tty = require("node:tty"), fs = require("node:fs"), crypto = require("node:crypto");
      const say = record => fs.writeSync(1, JSON.stringify(record) + "\\n");
      const size = ${size};
      const bytes = Buffer.alloc(size, ${JSON.stringify(fill)});
      const sha256 = ${JSON.stringify(sha256)};
    `;
    // For a row at the descriptor limit. The poll of a write that waits needs a descriptor. Where none is free a
    // timer drives the write, and libuv polls the descriptor that it has: the write goes out from the loop in both.
    // A debug build reads its built-in modules from files, so two are loaded while descriptors are free:
    // internal/async_context_frame, which a write that waits takes and which node:_http_agent loads, and node:util,
    // which a failed write takes.
    // Node makes process.stderr at its first read, and destroy() of a socket reads it. To open that pipe libuv
    // needs a descriptor on macOS, for a kqueue that it asks once. With none free the destroy() of Node never ends.
    const limit = `
      require("node:_http_agent"), require("node:util");
      void process.stderr;
      const taken = [];
      const takeAll = () => { try { for (;;) taken.push(fs.openSync("/dev/null", "r")); } catch (err) { return err.code; } };
      // LeakSanitizer opens files when the process exits.
      const giveBack = () => { for (const fd of taken.splice(0)) fs.closeSync(fd); };
      const whileTaken = () => (taken.length ? " with none free" : "");
    `;
    const fewDescriptors = { prefix: ["sh", "-c", 'ulimit -n 64 && exec "$@"', "sh"] };

    function openLibc() {
      return dlopen(libcPathForDlopen(), {
        posix_openpt: { args: ["int"], returns: "int" },
        grantpt: { args: ["int"], returns: "int" },
        unlockpt: { args: ["int"], returns: "int" },
        ptsname: { args: ["int"], returns: "ptr" },
        tcgetattr: { args: ["int", "ptr"], returns: "int" },
        cfmakeraw: { args: ["ptr"], returns: "void" },
        tcsetattr: { args: ["int", "int", "ptr"], returns: "int" },
      }).symbols;
    }
    let libc: ReturnType<typeof openLibc> | undefined;

    // A new pty pair. The master does not block. With `cooked` the slave keeps the mode of a new terminal.
    // The pair closes the numbers that it still owns. A number that a stream closed is not the pair's to close:
    // a test that runs beside this one can have that number by then. A tty.ReadStream over a master owns the
    // descriptor of its caller and closes it in destroy(). One over a slave opens the terminal again by name
    // and never closes the descriptor of its caller.
    function openPair(opts: { slaveFlags?: number; cooked?: boolean } = {}) {
      libc ??= openLibc();
      const master = libc.posix_openpt(constants.O_RDWR | constants.O_NOCTTY | constants.O_NONBLOCK);
      if (master < 0 || libc.grantpt(master) !== 0 || libc.unlockpt(master) !== 0) throw new Error("no pty");
      const path = new CString(libc.ptsname(master)!).toString();
      const first = openSync(path, constants.O_RDWR | constants.O_NOCTTY);
      if (!opts.cooked) {
        const termios = new Uint8Array(256);
        if (libc.tcgetattr(first, ptr(termios)) !== 0) throw new Error("tcgetattr failed");
        libc.cfmakeraw(ptr(termios));
        if (libc.tcsetattr(first, 0 /* TCSANOW */, ptr(termios)) !== 0) throw new Error("tcsetattr failed");
      }
      const slaveFlags = opts.slaveFlags ?? constants.O_RDWR;
      const slave = slaveFlags === constants.O_RDWR ? first : openSync(path, slaveFlags | constants.O_NOCTTY);
      if (slave !== first) closeSync(first);
      const owned = { master: true, slave: true };
      return {
        master,
        slave,
        /** Gives the number of `end` up and answers it. The caller closes it, or a stream of the caller does. */
        release(end: "master" | "slave") {
          owned[end] = false;
          return end === "master" ? master : slave;
        },
        [Symbol.dispose]() {
          if (owned.master) closeSync(master);
          if (owned.slave) closeSync(slave);
        },
      };
    }

    // A child that waits in a write never ends by itself, and a test that runs into its time limit says nothing
    // of it. What such a child wrote is printed here, and the child is ended.
    const unfinishedChildren = new Set<{ proc: Bun.Subprocess; output: () => string }>();
    afterAll(() => {
      for (const { proc, output } of unfinishedChildren) {
        console.error(`a child of withPair() did not finish. It wrote: ${output()}`);
        proc.kill("SIGKILL");
      }
    });

    type PairOptions = {
      /** The runtime of the child: Bun, or a Node that answers the same. */
      exe?: string;
      slaveFlags?: number;
      cooked?: boolean;
      env?: Record<string, string>;
      /** Goes before the command of the child, as in runInPty(). */
      prefix?: string[];
      /** The child is the only holder of both ends: the test closes its own right after the spawn. */
      childHoldsAlone?: boolean;
      /** The test reads this end while the child runs, and says how much came and whether it is what was written. */
      readEnd?: "master" | "slave";
      /** The test reads this descriptor of its own in place of an end. It does not block, and the stream closes it. */
      readFd?: number;
      /** The child writes less than `bytes`, and the test says how much came: as it comes, or only after the child. */
      part?: "while the child runs" | "after the child";
    };

    /** Runs `script` with the pair as fd 3 and fd 4. */
    async function withPair(script: string, opts: PairOptions = {}) {
      const { readEnd, part } = opts;
      // The end that the test reads does not block. What is left in it is read when the child has ended.
      const nonblocking = readEnd === "slave" ? constants.O_NONBLOCK : 0;
      using pair = openPair({ slaveFlags: opts.slaveFlags ?? constants.O_RDWR | nonblocking, cooked: opts.cooked });
      const readFd = opts.readFd ?? (readEnd && pair[readEnd]);
      const arrived = Promise.withResolvers<{ got: number; sameBytes?: boolean } | undefined>();
      const hash = createHash("sha256");
      let got = 0;
      let reading = readFd !== undefined;
      if (!reading) arrived.resolve(undefined);
      const stop = (result: { got: number; sameBytes?: boolean } | Error) => {
        if (!reading) return;
        reading = false;
        if (result instanceof Error) arrived.reject(result);
        else arrived.resolve(result);
      };
      const take = (chunk: Uint8Array) => {
        if (!reading) return;
        got += chunk.length;
        hash.update(chunk);
        if (!part && got >= size) stop({ got, sameBytes: hash.digest("hex") === sha256 });
      };
      const child = Bun.spawn({
        cmd: [...(opts.prefix ?? []), opts.exe ?? bunExe(), "-e", prelude + script],
        env: { ...bunEnv, TTY_TEST_LIBC: libcPathForDlopen(), ...opts.env },
        stdio: ["ignore", "pipe", "pipe", pair.master, pair.slave],
      });
      const said = { stdout: "", stderr: "" };
      const entry = { proc: child, output: () => JSON.stringify(said) };
      unfinishedChildren.add(entry);
      let reader: ReadStream | undefined;
      try {
        if (opts.childHoldsAlone) {
          closeSync(pair.release("master"));
          closeSync(pair.release("slave"));
        }
        if (readFd !== undefined && part !== "after the child") {
          reader = new ReadStream(readFd);
          // The stream closes a master. It never closes a slave.
          if (readEnd === "master") pair.release("master");
          reader.on("error", stop);
          reader.on("data", take);
        }
        const collect = async (name: "stdout" | "stderr") => {
          const decoder = new TextDecoder();
          for await (const chunk of child[name]) said[name] += decoder.decode(chunk, { stream: true });
        };
        const ended = Promise.all([child.exited, collect("stdout"), collect("stderr")]).then(([exitCode]) => {
          if (!reading) return exitCode;
          // Nothing writes this end now. What it still holds is all that can come. A stream that ended has closed it.
          if (!reader?.destroyed) {
            const buffer = Buffer.alloc(65536);
            try {
              for (let n: number; (n = readSync(readFd!, buffer)) > 0;) take(buffer.subarray(0, n));
            } catch (err) {
              if ((err as NodeJS.ErrnoException).code !== "EAGAIN") stop(err as Error);
            }
          }
          const less = `the child ended with code ${exitCode}, and ${got} of ${size} bytes came. It wrote: ${entry.output()}`;
          stop(part ? { got } : new Error(less));
          return exitCode;
        });
        const [exitCode, read] = await Promise.all([ended, arrived.promise]);
        const records = said.stdout
          .split("\n")
          .filter(line => line !== "")
          .map(line => JSON.parse(line));
        return { records, stderr: said.stderr, exitCode, ...(read && { read }) };
      } finally {
        reader?.destroy();
        if (child.exitCode !== null || child.signalCode !== null) unfinishedChildren.delete(entry);
      }
    }

    const rows: [name: string, opts: PairOptions, script: string, records: object[]][] = [
      ...(
        [
          ["a slave that the caller left blocking", constants.O_RDWR],
          ["a slave that the caller made nonblocking", constants.O_RDWR | constants.O_NONBLOCK],
        ] as const
      ).map(
        ([name, slaveFlags]) =>
          [
            `more than the pty holds goes out from the loop, to ${name}`,
            { slaveFlags },
            `
              const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
              const hash = crypto.createHash("sha256");
              let got = 0, cb = "not yet", drained = false;
              slave.on("drain", () => { drained = true; });
              master.on("data", chunk => {
                got += chunk.length;
                hash.update(chunk);
                if (got < size) return;
                setImmediate(() => {
                  say({ cb, drained, got, sameBytes: hash.digest("hex") === sha256, writableLength: slave.writableLength });
                  slave.destroy();
                  master.destroy();
                });
              });
              const ret = slave.write(bytes, err => { cb = err ? err.code : null; });
              say({ ret, writableLength: slave.writableLength, bytesWritten: slave.bytesWritten, cb });
            `,
            [
              { ret: false, writableLength: size, bytesWritten: size, cb: "not yet" },
              { cb: null, drained: true, got: size, sameBytes: true, writableLength: 0 },
            ],
          ] as [string, PairOptions, string, object[]],
      ),
      [
        "the stream writes and says the size of the window after the caller has closed its descriptor",
        {},
        `
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          let got = "";
          master.on("data", chunk => {
            got += chunk;
            if (got.length < 5) return;
            say({ got });
            slave.destroy();
            master.destroy();
          });
          slave.on("error", err => say({ error: err.code }));
          fs.closeSync(4);
          const windowSize = [];
          say({ getWindowSize: slave._handle.getWindowSize(windowSize), windowSize });
          slave.write("hello", err => say({ cb: err ? err.code : null }));
        `,
        [{ getWindowSize: 0, windowSize: [0, 0] }, { cb: null }, { got: "hello" }],
      ],
      [
        "a descriptor that is open for reading alone refuses a write with EPIPE",
        { slaveFlags: constants.O_RDONLY },
        `
          const slave = new tty.ReadStream(4);
          slave.on("error", err => say({ error: err.code, syscall: err.syscall, errno: err.errno }));
          slave.on("close", () => say({ closed: true }));
          // Node counts all of a Buffer that the stream refuses.
          slave.write(Buffer.from("hello"), err => say({ cb: err ? err.code : null, bytesWritten: slave.bytesWritten }));
        `,
        [{ cb: "EPIPE", bytesWritten: 5 }, { error: "EPIPE", syscall: "write", errno: -32 }, { closed: true }],
      ],
      [
        "a descriptor that is open for writing alone takes a write and refuses a read with ENOTCONN",
        { slaveFlags: constants.O_WRONLY },
        `
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          let got = "";
          master.on("data", chunk => {
            got += chunk;
            if (got.length < 5) return;
            say({ got });
            slave.resume();
          });
          slave.on("error", err => say({ error: err.code, syscall: err.syscall }));
          slave.on("close", () => {
            say({ closed: true });
            master.destroy();
          });
          slave.write("hello", err => say({ cb: err ? err.code : null }));
        `,
        [{ cb: null }, { got: "hello" }, { error: "ENOTCONN", syscall: "read" }, { closed: true }],
      ],
      [
        "destroy() cancels the writes that wait, then the stream closes, and no 'error' is emitted",
        {},
        `
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          const events = [];
          slave.on("error", err => events.push("error " + err.code));
          slave.on("close", hadError => {
            events.push("close " + hadError);
            say({ events });
            master.destroy();
          });
          const ret = slave.write(bytes, err => events.push("first " + (err ? err.code + " " + err.syscall : null)));
          slave.write("second", err => events.push("second " + (err ? err.code : null)));
          slave.destroy();
          say({ ret, destroyed: slave.destroyed, writableLength: slave.writableLength });
        `,
        [
          { ret: false, destroyed: true, writableLength: size + 6 },
          { events: ["first ECANCELED write", "second ECANCELED", "close false"] },
        ],
      ],
      [
        "a write that waits holds the loop after unref(), as a uv_write_t does",
        {},
        `
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          let cb = "not yet";
          master.on("data", () => {});
          const ret = slave.write(bytes, err => { cb = err ? err.code : null; });
          slave.unref();
          master.unref();
          process.on("exit", () => say({ ret, cb }));
        `,
        [{ ret: false, cb: null }],
      ],
      [
        "the callback of a write that went out from the loop runs in the async context of the write",
        {},
        `
          const storage = new (require("node:async_hooks").AsyncLocalStorage)();
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          let got = 0, store = "not yet";
          master.on("data", chunk => {
            got += chunk.length;
            if (got < size) return;
            setImmediate(() => {
              say({ store });
              slave.destroy();
              master.destroy();
            });
          });
          storage.run("of the write", () => {
            slave.write(bytes, () => { store = storage.getStore(); });
          });
        `,
        [{ store: "of the write" }],
      ],
      [
        "the callback of a write that destroy() cancels runs in the async context of the write",
        {},
        `
          const storage = new (require("node:async_hooks").AsyncLocalStorage)();
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          slave.on("close", () => master.destroy());
          storage.run("of the write", () => {
            slave.write(bytes, err => say({ cb: err ? err.code : null, store: storage.getStore() }));
          });
          storage.run("of the destroy", () => slave.destroy());
        `,
        [{ cb: "ECANCELED", store: "of the write" }],
      ],
      // The handle has a poll that reads and a poll for a write that waits, and epoll keys on the number of a
      // descriptor. Here both are armed at once, in either order.
      ...(
        [
          ["a stream that reads already", "listen(); setImmediate(write);"],
          ["a stream that starts to read behind it", "write(); listen();"],
        ] as const
      ).map(
        ([name, order]) =>
          [
            `the stream reads what the other side says while a write of its own waits, on ${name}`,
            {},
            `
              const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
              const hash = crypto.createHash("sha256");
              let got = 0, heard = "", cb = "not yet", asked = 0, said = false;
              const done = () => {
                if (said || got < size || heard.length < 3 || cb === "not yet") return;
                said = true;
                say({ cb, got, sameBytes: hash.digest("hex") === sha256, heard, writableLength: slave.writableLength });
                slave.destroy();
                master.destroy();
              };
              const listen = () => slave.on("data", chunk => { heard += chunk; done(); });
              const write = () => {
                const ret = slave.write(bytes, err => { cb = err ? err.code : null; done(); });
                say({ ret, reading: !!slave._handle.reading, writableLength: slave.writableLength });
              };
              slave.on("error", err => say({ error: err.code, syscall: err.syscall }));
              master.on("data", chunk => {
                got += chunk.length;
                hash.update(chunk);
                // Three times while the write of the slave waits, the master says a byte that the slave has to read.
                while (asked < 3 && got >= (asked + 1) * (size >> 2)) fs.writeSync(3, "abc"[asked++]);
                done();
              });
              ${order}
            `,
            [
              { ret: false, reading: order.startsWith("listen"), writableLength: size },
              { cb: null, got: size, sameBytes: true, heard: "abc", writableLength: 0 },
            ],
          ] as [string, PairOptions, string, object[]],
      ),
      [
        "a second write that the pty refuses holds the loop as the first did, and end() finishes behind it",
        {},
        `
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          const events = [];
          master.on("data", () => {});
          slave.on("error", err => events.push("error " + err.code));
          slave.on("finish", () => events.push("finish"));
          const first = slave.write(bytes, err => events.push("first " + (err ? err.code : null) + " " + slave.writableLength));
          // This one waits in the stream, and goes to the handle from the callback of the first.
          // It is more than the pty holds, so it is refused too.
          const second = slave.write(bytes.subarray(0, 1 << 16), err => events.push("second " + (err ? err.code : null) + " " + slave.writableLength));
          slave.end("TAIL", () => events.push("end"));
          // Only the write that waits holds the loop, the second time as the first.
          slave.unref();
          master.unref();
          process.on("exit", () => say({ first, second, events, bytesWritten: slave.bytesWritten }));
        `,
        [
          {
            first: false,
            second: false,
            events: ["first null 65540", "second null 0", "end", "finish"],
            bytesWritten: size + (1 << 16) + 4,
          },
        ],
      ],
      [
        "a write that waits fails with EIO when the master closes, and the stream closes with an error",
        { childHoldsAlone: true },
        `
          const slave = new tty.ReadStream(4);
          const events = [];
          slave.on("error", err => events.push("error " + err.code + " " + err.syscall + " " + err.errno));
          slave.on("close", hadError => {
            events.push("close " + hadError);
            say({ events, bytesWritten: slave.bytesWritten, writableLength: slave.writableLength });
          });
          const ret = slave.write(bytes, err => events.push("cb " + (err ? err.code : null)));
          say({ ret, writableLength: slave.writableLength });
          fs.closeSync(3);
        `,
        [
          { ret: false, writableLength: size },
          { events: ["cb EIO", "error EIO write -5", "close true"], bytesWritten: size, writableLength: 0 },
        ],
      ],
      // libuv reads before it writes in one turn of the loop. So the hangup reaches the reader before the write fails.
      [
        "when the master closes, a stream that reads gets 'end' first and then the EIO of its write",
        { childHoldsAlone: true },
        `
          const slave = new tty.ReadStream(4);
          const events = [];
          for (const name of ["end", "finish", "drain"]) slave.on(name, () => events.push(name));
          slave.on("error", err => events.push("error " + err.code + " " + err.syscall));
          slave.on("close", hadError => {
            events.push("close " + hadError);
            say({ events, bytesWritten: slave.bytesWritten, bytesRead: slave.bytesRead });
          });
          slave.on("data", () => events.push("data"));
          const ret = slave.write(bytes, err => events.push("cb " + (err ? err.code : null)));
          say({ ret, writableLength: slave.writableLength });
          fs.closeSync(3);
        `,
        [
          { ret: false, writableLength: size },
          { events: ["end", "cb EIO", "error EIO write", "close true"], bytesWritten: size, bytesRead: 0 },
        ],
      ],
      [
        "when the master closes, a stream that has read data gets 'end' first and then the EIO of its write",
        { childHoldsAlone: true },
        `
          const slave = new tty.ReadStream(4);
          const events = [];
          for (const name of ["end", "finish", "drain"]) slave.on(name, () => events.push(name));
          slave.on("error", err => events.push("error " + err.code + " " + err.syscall));
          slave.on("close", hadError => {
            events.push("close " + hadError);
            say({ events, bytesWritten: slave.bytesWritten, bytesRead: slave.bytesRead });
          });
          let started = false;
          slave.on("data", chunk => {
            events.push("data " + chunk);
            if (started) return;
            started = true;
            const ret = slave.write(bytes, err => events.push("cb " + (err ? err.code : null)));
            say({ ret, writableLength: slave.writableLength });
            setImmediate(() => setImmediate(() => fs.closeSync(3)));
          });
          fs.writeSync(3, "hi");
        `,
        [
          { ret: false, writableLength: size },
          { events: ["data hi", "end", "cb EIO", "error EIO write", "close true"], bytesWritten: size, bytesRead: 2 },
        ],
      ],
      [
        "a write to a slave whose master is closed fails with EIO at once",
        { childHoldsAlone: true },
        `
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          slave.on("error", err => say({ error: err.code, syscall: err.syscall, errno: err.errno }));
          slave.on("close", hadError => say({ closed: hadError }));
          master.on("close", () => {
            const ret = slave.write("hello", err => say({ cb: err ? err.code : null }));
            say({ ret });
          });
          master.destroy();
        `,
        [{ ret: false }, { cb: "EIO" }, { error: "EIO", syscall: "write", errno: -5 }, { closed: true }],
      ],
      // A new terminal sends "\r\n" for each "\n" that a program writes. How a write is cut has no part in that.
      [
        "a terminal in cooked mode gets every line of a write that it does not take whole",
        { cooked: true },
        `
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          const lines = 1024;
          let source = "";
          for (let i = 0; i < lines; i++) source += ("line " + i + " ").padEnd(63, "abcdefghij") + "\\n";
          let text = "", cb = "not yet";
          const newlines = () => text.split("\\n").length - 1;
          master.on("data", chunk => {
            text += chunk;
            if (newlines() < lines) return;
            setImmediate(() => {
              say({
                cb,
                newlines: newlines(),
                sameText: text.replace(/\\r+\\n/g, "\\n") === source,
                length: text.length,
                bytesWritten: slave.bytesWritten,
                writableLength: slave.writableLength,
              });
              slave.destroy();
              master.destroy();
            });
          });
          const ret = slave.write(source, err => { cb = err ? err.code : null; });
          say({ ret, writableLength: slave.writableLength });
        `,
        [
          { ret: false, writableLength: 1 << 16 },
          {
            cb: null,
            newlines: 1024,
            sameText: true,
            // One "\r" for each line on Linux. Another system can send more.
            length: isLinux ? (1 << 16) + 1024 : expect.any(Number),
            bytesWritten: 1 << 16,
            writableLength: 0,
          },
        ],
      ],
      [
        "a write that the pty refuses with no descriptor free goes out from the loop",
        fewDescriptors,
        `
          ${limit}
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          const hash = crypto.createHash("sha256");
          let got = 0, cb = "not yet", drained = false;
          slave.on("drain", () => { drained = true; });
          master.on("data", chunk => {
            got += chunk.length;
            hash.update(chunk);
            if (got < size) return;
            setImmediate(() => {
              say({ cb, drained, got, sameBytes: hash.digest("hex") === sha256, writableLength: slave.writableLength });
              slave.destroy();
              master.destroy();
            });
          });
          slave.write(Buffer.alloc(0), () => {
            const atTheLimit = takeAll();
            // The descriptors stay taken until the write is complete: no part of it goes out behind a poll.
            const ret = slave.write(bytes, err => { cb = (err ? err.code : null) + whileTaken(); giveBack(); });
            const waits = slave._handle.writeQueueSize;
            say({ atTheLimit, ret, writableLength: slave.writableLength, aPartWaits: waits > 0 && waits < size });
          });
        `,
        [
          { atTheLimit: "EMFILE", ret: false, writableLength: size, aPartWaits: true },
          { cb: "null with none free", drained: true, got: size, sameBytes: true, writableLength: 0 },
        ],
      ],
      [
        "a write that waits with no descriptor free holds the loop after unref()",
        fewDescriptors,
        `
          ${limit}
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          let cb = "not yet";
          master.on("data", () => {});
          slave.write(Buffer.alloc(0), () => {
            const atTheLimit = takeAll();
            const ret = slave.write(bytes, err => { cb = (err ? err.code : null) + whileTaken(); });
            slave.unref();
            master.unref();
            process.on("exit", () => {
              giveBack();
              say({ atTheLimit, ret, cb });
            });
          });
        `,
        [{ atTheLimit: "EMFILE", ret: false, cb: "null with none free" }],
      ],
      [
        "destroy() cancels the writes that wait with no descriptor free",
        fewDescriptors,
        `
          ${limit}
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          const events = [];
          slave.on("error", err => events.push("error " + err.code));
          slave.on("close", hadError => {
            events.push("close " + hadError + whileTaken());
            giveBack();
            say({ events });
            master.destroy();
          });
          slave.write(Buffer.alloc(0), () => {
            const atTheLimit = takeAll();
            const ret = slave.write(bytes, err => events.push("first " + (err ? err.code + " " + err.syscall : null)));
            slave.write("second", err => events.push("second " + (err ? err.code : null)));
            slave.destroy();
            say({ atTheLimit, ret, destroyed: slave.destroyed, writableLength: slave.writableLength });
          });
        `,
        [
          { atTheLimit: "EMFILE", ret: false, destroyed: true, writableLength: size + 6 },
          { events: ["first ECANCELED write", "second ECANCELED", "close false with none free"] },
        ],
      ],
      [
        "destroy() in the callback of a write that waited with no descriptor free cancels the write behind it",
        fewDescriptors,
        `
          ${limit}
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          const events = [];
          master.on("data", () => {});
          slave.on("error", err => events.push("error " + err.code));
          slave.on("close", hadError => {
            events.push("close " + hadError + whileTaken());
            giveBack();
            say({ events });
            master.destroy();
          });
          slave.write(Buffer.alloc(0), () => {
            const atTheLimit = takeAll();
            const ret = slave.write(bytes.subarray(0, size / 2), err => {
              events.push("first " + (err ? err.code : null));
              slave.destroy();
            });
            slave.write(bytes.subarray(size / 2), err => events.push("second " + (err ? err.code : null)));
            say({ atTheLimit, ret, writableLength: slave.writableLength });
          });
        `,
        [
          { atTheLimit: "EMFILE", ret: false, writableLength: size },
          { events: ["first null", "second ECANCELED", "close false with none free"] },
        ],
      ],
      [
        "a second write and end() wait behind a write that waits with no descriptor free",
        fewDescriptors,
        `
          ${limit}
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          const events = [];
          const told = name => err => events.push(name + " " + (err ? err.code : null) + " " + slave.writableLength);
          master.on("data", () => {});
          slave.on("error", err => events.push("error " + err.code));
          slave.on("finish", () => events.push("finish"));
          slave.write(Buffer.alloc(0), () => {
            const atTheLimit = takeAll();
            const first = slave.write(bytes, told("first"));
            const second = slave.write(bytes.subarray(0, 1 << 16), told("second"));
            slave.end("TAIL", () => events.push("end"));
            slave.unref();
            master.unref();
            process.on("exit", () => {
              const noneFree = taken.length > 0;
              giveBack();
              say({ atTheLimit, first, second, events, bytesWritten: slave.bytesWritten, noneFree });
            });
          });
        `,
        [
          {
            atTheLimit: "EMFILE",
            first: false,
            second: false,
            // With each callback, what still waits behind it.
            events: [`first null ${(1 << 16) + 4}`, "second null 0", "end", "finish"],
            bytesWritten: size + (1 << 16) + 4,
            noneFree: true,
          },
        ],
      ],
      [
        "the stream reads what the other side says while a write of its own waits with no descriptor free",
        fewDescriptors,
        `
          ${limit}
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          const hash = crypto.createHash("sha256");
          let got = 0, heard = "", cb = "not yet", asked = 0, said = false;
          const done = () => {
            if (said || got < size || heard.length < 3 || cb === "not yet") return;
            said = true;
            say({ cb, got, sameBytes: hash.digest("hex") === sha256, heard, writableLength: slave.writableLength });
            slave.destroy();
            master.destroy();
          };
          slave.on("data", chunk => { heard += chunk; done(); });
          slave.on("error", err => say({ error: err.code, syscall: err.syscall }));
          master.on("data", chunk => {
            got += chunk.length;
            hash.update(chunk);
            // The master says a letter at each quarter of what it has read.
            while (asked < 3 && got >= (asked + 1) * (size >> 2)) fs.writeSync(3, "abc"[asked++]);
            done();
          });
          setImmediate(() => {
            const atTheLimit = takeAll();
            const ret = slave.write(bytes, err => { cb = (err ? err.code : null) + whileTaken(); giveBack(); done(); });
            say({ atTheLimit, ret, reading: !!slave._handle.reading, writableLength: slave.writableLength });
          });
        `,
        [
          { atTheLimit: "EMFILE", ret: false, reading: true, writableLength: size },
          { cb: "null with none free", got: size, sameBytes: true, heard: "abc", writableLength: 0 },
        ],
      ],
      [
        "a write that waits with no descriptor free fails with EIO when the master closes",
        { childHoldsAlone: true, ...fewDescriptors },
        `
          ${limit}
          const slave = new tty.ReadStream(4);
          const events = [];
          slave.on("error", err => events.push("error " + err.code + " " + err.syscall + " " + err.errno));
          slave.on("close", hadError => {
            events.push("close " + hadError + whileTaken());
            giveBack();
            say({ events, bytesWritten: slave.bytesWritten, writableLength: slave.writableLength });
          });
          slave.write(Buffer.alloc(0), () => {
            const atTheLimit = takeAll();
            const ret = slave.write(bytes, err => events.push("cb " + (err ? err.code : null)));
            say({ atTheLimit, ret, writableLength: slave.writableLength });
            fs.closeSync(3);
          });
        `,
        [
          { atTheLimit: "EMFILE", ret: false, writableLength: size },
          {
            events: ["cb EIO", "error EIO write -5", "close true with none free"],
            bytesWritten: size,
            writableLength: 0,
          },
        ],
      ],
    ];

    /** Runs `script` with a FIFO of the test, whose path the child has as `fifo`. With `readFifo` the test reads it. */
    async function withFifo(script: string, opts: PairOptions & { readFifo?: boolean } = {}) {
      using dir = tempDir("tty-fifo", {});
      const fifo = join(String(dir), "fifo");
      execFileSync("mkfifo", [fifo]);
      const { readFifo, ...pairOptions } = opts;
      return await withPair(`const fifo = process.env.TTY_TEST_FIFO;` + script, {
        ...pairOptions,
        env: { ...opts.env, TTY_TEST_FIFO: fifo },
        ...(readFifo && { readFd: openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK) }),
      });
    }

    // fcntl() of the C library, for a child that is Bun. F_GETFL is 3 and F_SETFL is 4.
    const fcntlInChild = `
      const { fcntl } = require("bun:ffi").dlopen(process.env.TTY_TEST_LIBC, {
        fcntl: { args: ["int", "int", "int"], returns: "int" },
      }).symbols;
    `;

    // The loop finishes a write to a FIFO on Linux alone. On macOS the handle writes a FIFO in place, because
    // kqueue can stay silent for a FIFO.
    type FifoResult = { records: object[]; read?: { got: number; sameBytes: boolean } };
    const fifoRows: [name: string, opts: PairOptions & { readFifo?: boolean }, script: string, result: FifoResult][] = [
      [
        "a FIFO that does not block is finished from the loop too",
        {},
        `
          const reader = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
          const writer = fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
          const input = new tty.ReadStream(reader), output = new tty.ReadStream(writer);
          const hash = crypto.createHash("sha256");
          let got = 0;
          input.on("data", chunk => {
            got += chunk.length;
            hash.update(chunk);
            if (got < size) return;
            say({ got, sameBytes: hash.digest("hex") === sha256 });
            output.destroy();
            input.destroy();
          });
          const ret = output.write(bytes, err => say({ cb: err ? err.code : null }));
          say({ ret, writableLength: output.writableLength });
        `,
        { records: [{ ret: false, writableLength: size }, { cb: null }, { got: size, sameBytes: true }] },
      ],
      [
        "a write that waits fails with EPIPE when the reader of the FIFO closes",
        {},
        `
          const reader = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
          const writer = fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
          const output = new tty.ReadStream(writer);
          const events = [];
          output.on("error", err => events.push("error " + err.code + " " + err.syscall + " " + err.errno));
          output.on("close", hadError => {
            events.push("close " + hadError);
            say({ events, bytesWritten: output.bytesWritten, writableLength: output.writableLength });
          });
          const ret = output.write(bytes, err => events.push("cb " + (err ? err.code : null)));
          say({ ret, writableLength: output.writableLength });
          // The only reader goes away with the write waiting. The next write(2) of the loop answers EPIPE.
          fs.closeSync(reader);
        `,
        {
          records: [
            { ret: false, writableLength: size },
            { events: ["cb EPIPE", "error EPIPE write -32", "close true"], bytesWritten: size, writableLength: 0 },
          ],
        },
      ],
      // libuv makes the descriptor of a FIFO nonblocking in the constructor. The handle of Bun leaves it as the
      // caller made it, so under Bun the caller does that step. The write then gets EAGAIN, whatever the descriptor
      // was at the constructor.
      [
        "a FIFO that blocked at the constructor and does not block at the write is finished from the loop",
        {},
        `
          const { O_RDONLY, O_WRONLY, O_NONBLOCK } = fs.constants;
          const reader = fs.openSync(fifo, O_RDONLY | O_NONBLOCK);
          // A reader is there, so this open returns at once. The descriptor blocks.
          const writer = fs.openSync(fifo, O_WRONLY);
          const nonblocking = () =>
            (parseInt(/flags:\\s*([0-7]+)/.exec(fs.readFileSync("/proc/self/fdinfo/" + writer, "utf8"))[1], 8) & O_NONBLOCK) !== 0;
          const atOpen = nonblocking();
          const input = new tty.ReadStream(reader), output = new tty.ReadStream(writer);
          if (process.versions.bun) {
            ${fcntlInChild}
            fcntl(writer, 4, fcntl(writer, 3, 0) | O_NONBLOCK);
          }
          const hash = crypto.createHash("sha256");
          let got = 0;
          input.on("data", chunk => {
            got += chunk.length;
            hash.update(chunk);
            if (got < size) return;
            say({ got, sameBytes: hash.digest("hex") === sha256 });
            output.destroy();
            input.destroy();
          });
          const ret = output.write(bytes, err => say({ cb: err ? err.code : null }));
          say({ atOpen, atWrite: nonblocking(), ret, writableLength: output.writableLength });
        `,
        {
          records: [
            { atOpen: false, atWrite: true, ret: false, writableLength: size },
            { cb: null },
            { got: size, sameBytes: true },
          ],
        },
      ],
      // The reader is the test, in another process: a write that waits in place needs one that reads meanwhile.
      [
        "after setBlocking(true) a write to a FIFO that does not block is complete when write() returns",
        { readFifo: true },
        `
          const output = new tty.ReadStream(fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK));
          say({ setBlocking: output._handle.setBlocking(true) });
          output.write(bytes, err => {
            say({ cb: err ? err.code : null });
            output.destroy();
          });
          say({ writableLength: output.writableLength });
        `,
        {
          records: [{ setBlocking: 0 }, { writableLength: 0 }, { cb: null }],
          read: { got: size, sameBytes: true },
        },
      ],
      [
        "a write that a FIFO refuses with no descriptor free goes out from the loop",
        fewDescriptors,
        `
          ${limit}
          const reader = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
          const writer = fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
          const input = new tty.ReadStream(reader), output = new tty.ReadStream(writer);
          const hash = crypto.createHash("sha256");
          let got = 0, cb = "not yet";
          input.on("data", chunk => {
            got += chunk.length;
            hash.update(chunk);
            if (got < size) return;
            setImmediate(() => {
              say({ cb, got, sameBytes: hash.digest("hex") === sha256 });
              output.destroy();
              input.destroy();
            });
          });
          output.write(Buffer.alloc(0), () => {
            const atTheLimit = takeAll();
            const ret = output.write(bytes, err => { cb = (err ? err.code : null) + whileTaken(); giveBack(); });
            say({ atTheLimit, ret, writableLength: output.writableLength });
          });
        `,
        {
          records: [
            { atTheLimit: "EMFILE", ret: false, writableLength: size },
            { cb: "null with none free", got: size, sameBytes: true },
          ],
        },
      ],
    ];

    describe.each(runtimes)("as in Node (%s)", (_runtime, exe) => {
      test.skipIf(!exe).concurrent.each(rows)("%s", async (_name, opts, script, records) => {
        expect(await withPair(script, { exe: exe!, ...opts })).toEqual({ records, stderr: "", exitCode: 0 });
      });

      test.skipIf(!exe || !isLinux).concurrent.each(fifoRows)("%s", async (_name, opts, script, result) => {
        expect(await withFifo(script, { exe: exe!, ...opts })).toEqual({ stderr: "", exitCode: 0, ...result });
      });

      // On macOS tcsetattr(TCSADRAIN) on a pty slave sleeps in ttywait() of XNU until the master is read, and
      // this child reads the master on the same thread. A pty on Linux has no output to drain.
      test.skipIf(!exe || !isLinux).concurrent("setRawMode() sets the mode at once while a write waits", async () => {
        const script = `
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          let got = 0;
          master.on("data", chunk => {
            got += chunk.length;
            if (got < size) return;
            say({ got });
            slave.destroy();
            master.destroy();
          });
          const ret = slave.write(bytes, err => say({ cb: err ? err.code : null }));
          slave.setRawMode(true);
          say({ ret, isRaw: slave.isRaw, writableLength: slave.writableLength });
        `;
        expect(await withPair(script, { exe: exe! })).toEqual({
          records: [{ ret: false, isRaw: true, writableLength: size }, { cb: null }, { got: size }],
          stderr: "",
          exitCode: 0,
        });
      });

      // Node's tty.WriteStream asks for this: what it writes is out when write() returns.
      test.skipIf(!exe).concurrent("after setBlocking(true) a write is complete when write() returns", async () => {
        const script = `
          const slave = new tty.ReadStream(4);
          say({ setBlocking: slave._handle.setBlocking(true) });
          slave.write(bytes, err => {
            say({ cb: err ? err.code : null });
            slave.destroy();
          });
          say({ writableLength: slave.writableLength });
        `;
        expect(await withPair(script, { exe: exe!, readEnd: "master" })).toEqual({
          records: [{ setBlocking: 0 }, { writableLength: 0 }, { cb: null }],
          stderr: "",
          exitCode: 0,
          read: { got: size, sameBytes: true },
        });
      });

      // libuv cannot reopen a master, and writes to it in place. So all of a write is out before a destroy() behind it.
      // Under Node write() answers false and 'drain' follows. Under Bun the write is complete inside write().
      test.skipIf(!exe).concurrent("a pty master takes a write in place, before a destroy() behind it", async () => {
        const script = `
          const master = new tty.ReadStream(3);
          master.on("close", () => say({ closed: true }));
          master.write(bytes, err => say({ cb: err ? err.code : null }));
          master.destroy();
          say({ destroyed: master.destroyed });
        `;
        expect(await withPair(script, { exe: exe!, readEnd: "slave" })).toEqual({
          records: [{ destroyed: true }, { cb: null }, { closed: true }],
          stderr: "",
          exitCode: 0,
          read: { got: size, sameBytes: true },
        });
      });

      // The end of the process does not wait for a write that waits in the loop. The test reads the master only
      // when the child has ended, so the pty has what the child wrote at once and no more.
      test.skipIf(!exe).concurrent("process.exit() behind a write to a slave drops the part that waits", async () => {
        const script = `
          const slave = new tty.ReadStream(4);
          const ret = slave.write(bytes);
          say({ ret, writableLength: slave.writableLength });
          process.exit(0);
        `;
        const { read, ...result } = await withPair(script, { exe: exe!, readEnd: "master", part: "after the child" });
        // How much the pty takes at once is the kernel's number.
        expect({ ...result, aPartCame: read!.got > 0 && read!.got < size }).toEqual({
          records: [{ ret: false, writableLength: size }],
          stderr: "",
          exitCode: 0,
          aPartCame: true,
        });
      });

      // The same with no descriptor free at the write: the process ends with the timer of the write in the heap.
      test
        .skipIf(!exe)
        .concurrent(
          "process.exit() behind a write that waits with no descriptor free drops the part that waits",
          async () => {
            const script = `
            ${limit}
            const slave = new tty.ReadStream(4);
            slave.write(Buffer.alloc(0), () => {
              const atTheLimit = takeAll();
              const ret = slave.write(bytes);
              say({ atTheLimit, ret, writableLength: slave.writableLength });
              giveBack();
              process.exit(0);
            });
          `;
            const { read, ...result } = await withPair(script, {
              exe: exe!,
              readEnd: "master",
              part: "after the child",
              ...fewDescriptors,
            });
            expect({ ...result, aPartCame: read!.got > 0 && read!.got < size }).toEqual({
              records: [{ atTheLimit: "EMFILE", ret: false, writableLength: size }],
              stderr: "",
              exitCode: 0,
              aPartCame: true,
            });
          },
        );

      // A write to a master is complete when write() returns, so the end of the process behind it loses nothing.
      test.skipIf(!exe).concurrent("process.exit() behind a write to a master loses nothing", async () => {
        const script = `
          const master = new tty.ReadStream(3);
          master.write(bytes);
          process.exit(0);
        `;
        expect(await withPair(script, { exe: exe!, readEnd: "slave" })).toEqual({
          records: [],
          stderr: "",
          exitCode: 0,
          read: { got: size, sameBytes: true },
        });
      });
    });

    // Node answers a WriteWrap for a write that waits, and calls its oncomplete(status). This handle answers 1 and
    // calls its own onwritecomplete(status), with the handle as this.
    test.concurrent(
      "writeBuffer() answers 0 or 1, and onwritecomplete() runs once for each 1, in call order",
      async () => {
        const script = `
          const { TTY } = process.binding("tty_wrap");
          const master = new tty.ReadStream(3);
          const handle = new TTY(4, {});
          const completed = [];
          let got = 0, tail = "";
          master.on("data", chunk => {
            got += chunk.length;
            tail = (tail + chunk).slice(-8);
            if (got < size + 11) return;
            setImmediate(() => {
              say({ completed, tail, writeQueueSize: handle.writeQueueSize });
              handle.close();
              master.destroy();
            });
          });
          handle.onwritecomplete = function (status) {
            completed.push([status, this === handle, arguments.length]);
          };
          const small = handle.writeBuffer(null, Buffer.from("small"));
          const big = handle.writeBuffer(null, bytes);
          const waits = handle.writeQueueSize;
          // It has no bytes to wait for, and it still completes in its turn.
          const empty = handle.writeBuffer(null, Buffer.alloc(0));
          const behind = handle.writeBuffer(null, Buffer.from("BEHIND"));
          say({
            small,
            big,
            empty,
            behind,
            bytesWritten: handle.bytesWritten,
            // How much the first write(2) took is the kernel's number.
            aPartWaits: waits > 0 && waits < size,
            behindWaitsToo: handle.writeQueueSize === waits + 6,
          });
        `;
        expect(await withPair(script)).toEqual({
          records: [
            { small: 0, big: 1, empty: 1, behind: 1, bytesWritten: size + 11, aPartWaits: true, behindWaitsToo: true },
            {
              // The status, whether this is the handle, and the count of arguments: for big, empty and behind.
              completed: [
                [0, true, 1],
                [0, true, 1],
                [0, true, 1],
              ],
              tail: Buffer.alloc(size, fill).toString().slice(-2) + "BEHIND",
              writeQueueSize: 0,
            },
          ],
          stderr: "",
          exitCode: 0,
        });
      },
    );

    test.concurrent(
      "a write that waits goes out with no onwritecomplete set, and a closed handle answers EBADF and counts the chunk",
      async () => {
        const script = `
          const { TTY } = process.binding("tty_wrap");
          const master = new tty.ReadStream(3);
          const handle = new TTY(4, {});
          const hash = crypto.createHash("sha256");
          let got = 0;
          master.on("data", chunk => {
            got += chunk.length;
            hash.update(chunk);
            if (got < size) return;
            setImmediate(() => {
              say({ got, sameBytes: hash.digest("hex") === sha256, writeQueueSize: handle.writeQueueSize });
              handle.close(() => {
                const before = handle.bytesWritten;
                // Node's StreamBase::Write counts a chunk before it looks at the stream.
                say({ closed: handle.writeBuffer(null, Buffer.from("late")), counted: handle.bytesWritten - before });
                master.destroy();
              });
            });
          });
          say({ ret: handle.writeBuffer(null, bytes), onwritecomplete: typeof handle.onwritecomplete });
        `;
        expect(await withPair(script)).toEqual({
          records: [
            { ret: 1, onwritecomplete: "undefined" },
            { got: size, sameBytes: true, writeQueueSize: 0 },
            { closed: -9, counted: 4 }, // UV_EBADF
          ],
          stderr: "",
          exitCode: 0,
        });
      },
    );

    // The handle has one descriptor of its own, and one more for the poll of a write that it could not finish at
    // once. Every way that a handle ends closes both. It also closes a master and a FIFO, which the handle owns as
    // libuv owns a fd that it could not reopen. The child says which of its descriptors from before are closed,
    // and which it has more than before.
    const descriptors = `
      const { TTY } = process.binding("tty_wrap");
      const open = () => fs.readdirSync("/dev/fd").map(Number).filter(fd => {
        try { return fs.fstatSync(fd) !== undefined; } catch { return false; }
      });
      const held = before => open().filter(fd => !before.includes(fd)).length;
      const report = (before, more, names = {}) => {
        const after = open();
        say({
          ...more,
          closed: before.filter(fd => !after.includes(fd)).map(fd => names[fd] ?? fd),
          left: after.filter(fd => !before.includes(fd)),
        });
      };
      // The collector closes what a handle that nobody holds has. It gets turns of the loop for that.
      const collect = async done => {
        for (let turn = 0; turn < 100 && !done(); turn++) {
          Bun.gc(true);
          await new Promise(resolve => setImmediate(resolve));
        }
      };
    `;
    type DescriptorRow = [name: string, opts: PairOptions & { fifo?: boolean }, script: string, records: object[]];
    // The handle owns both descriptors of the FIFO. The loop finishes a write to a FIFO on Linux alone.
    const fifoDescriptorRow: DescriptorRow = [
      "destroy() of the streams over both ends of a FIFO",
      { fifo: true },
      `
        const reader = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        const writer = fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
        const before = open();
        const input = new tty.ReadStream(reader), output = new tty.ReadStream(writer);
        input.on("data", () => {});
        output.on("close", () => input.destroy());
        input.on("close", () => setImmediate(() => report(before, {}, { [reader]: "reader", [writer]: "writer" })));
        output.write(bytes, () => output.destroy());
      `,
      [{ closed: ["reader", "writer"], left: [] }],
    ];
    // The descriptor of the write poll takes the lowest free number, here the one that the caller closed. That
    // number is the handle's from then on, and the handle closes it once. A debug build reports a second close.
    const closedFifoDescriptorRow: DescriptorRow = [
      "destroy() of a stream over a FIFO whose caller closed its descriptor before a write that waits",
      { fifo: true },
      `
        const reader = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        const writer = fs.openSync(fifo, fs.constants.O_WRONLY | fs.constants.O_NONBLOCK);
        const before = open();
        const input = new tty.ReadStream(reader), output = new tty.ReadStream(writer);
        fs.closeSync(writer);
        input.on("data", () => {});
        output.on("close", () => input.destroy());
        input.on("close", () => setImmediate(() => report(before, {}, { [reader]: "reader", [writer]: "writer" })));
        const ret = output.write(bytes, err => {
          say({ cb: err ? err.code : null });
          output.destroy();
        });
        say({ ret, theNumberIsOpenAgain: open().includes(writer) });
      `,
      [{ ret: false, theNumberIsOpenAgain: true }, { cb: null }, { closed: ["reader", "writer"], left: [] }],
    ];
    const descriptorRows: DescriptorRow[] = [
      [
        "destroy() with a write that waits",
        {},
        `
          const before = open();
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          slave.setRawMode(true);
          master.on("data", () => {});
          slave.write(bytes);
          slave.on("close", () => master.destroy());
          master.on("close", () => setImmediate(() => report(before)));
          setImmediate(() => slave.destroy());
        `,
        [{ closed: [3], left: [] }],
      ],
      [
        "destroy() behind a write that went out from the loop",
        {},
        `
          const before = open();
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          master.on("data", () => {});
          slave.write(bytes, () => {
            // One descriptor of each handle, and the one of the write poll, which stays until the close.
            const count = held(before);
            slave.on("close", () => master.destroy());
            master.on("close", () => setImmediate(() => report(before, { held: count })));
            slave.destroy();
          });
        `,
        [{ held: 3, closed: [3], left: [] }],
      ],
      [
        "a hangup of the master, 'end' and 'close'",
        { childHoldsAlone: true },
        `
          const before = open();
          const slave = new tty.ReadStream(4);
          const events = [];
          slave.on("data", () => {});
          slave.on("error", err => events.push("error " + err.code));
          slave.on("end", () => events.push("end"));
          slave.on("close", hadError => {
            events.push("close " + hadError);
            setImmediate(() => report(before, { events }));
          });
          // The child has the only master. Its close hangs the slave up.
          fs.closeSync(3);
        `,
        [{ events: ["end", "close false"], closed: [3], left: [] }],
      ],
      [
        "the collector took a handle that nobody holds",
        {},
        `
          const before = open();
          (() => {
            const handle = new TTY(4, {});
            say({ held: held(before), fd: handle.fd });
          })();
          setImmediate(async () => {
            await collect(() => held(before) === 0);
            report(before);
          });
        `,
        [
          { held: 1, fd: 4 },
          { closed: [], left: [] },
        ],
      ],
      [
        "the collector took a handle whose write went out from the loop",
        {},
        `
          const before = open();
          const master = new tty.ReadStream(3);
          let got = 0, status = "not yet";
          master.on("data", chunk => {
            got += chunk.length;
            if (got < size) return;
            setImmediate(() => {
              // One descriptor of each handle, and the one of the write poll.
              const count = held(before);
              master.on("close", async () => {
                await collect(() => held(before) === 0);
                report(before, { status, held: count });
              });
              master.destroy();
            });
          });
          (() => {
            const handle = new TTY(4, {});
            handle.onwritecomplete = value => { status = value; };
            handle.writeBuffer(null, bytes);
          })();
        `,
        [{ status: 0, held: 3, closed: [3], left: [] }],
      ],
      [
        "destroy() of a stream over a slave that is open for writing alone",
        { slaveFlags: constants.O_WRONLY },
        `
          const before = open();
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          master.on("data", () => {});
          slave.on("close", () => master.destroy());
          master.on("close", () => setImmediate(() => report(before)));
          slave.write(bytes, () => slave.destroy());
        `,
        [{ closed: [3], left: [] }],
      ],
      ...(isLinux ? [fifoDescriptorRow, closedFifoDescriptorRow] : []),
    ];
    test.concurrent.each(descriptorRows)(
      "no descriptor of the handle is left after %s",
      async (_name, opts, script, records) => {
        const { fifo, ...pairOptions } = opts;
        const result = await (fifo ? withFifo : withPair)(descriptors + script, pairOptions);
        expect(result).toEqual({ records, stderr: "", exitCode: 0 });
      },
    );

    // The descriptor that the handle opens for itself stays above stdio, also where a stdio number is free. There it
    // would be the standard input of the process, which nothing closes.
    test.concurrent("a stream that is made while fd 0 is closed does not take that number", async () => {
      const script = `
        fs.closeSync(0);
        const slave = new tty.ReadStream(4);
        const atTheStart = tty.isatty(0);
        slave.on("close", () => setImmediate(() => say({ atTheStart, afterDestroy: tty.isatty(0) })));
        slave.destroy();
      `;
      expect(await withPair(script)).toEqual({
        records: [{ atTheStart: false, afterDestroy: false }],
        stderr: "",
        exitCode: 0,
      });
    });

    // Nothing but its queue holds the handle. The master does not hold the loop, so a handle that is collected
    // with its queue ends the child at once, with the completions that ran until then.
    test.concurrent.each([
      ["inside each completion", "Bun.gc(true);"],
      ["between the completions of one turn of the loop", "queueMicrotask(() => Bun.gc(true));"],
    ])("a handle that nobody holds keeps its queued writes through a collection %s", async (_name, collect) => {
      const script = `
        const { TTY } = process.binding("tty_wrap");
        const master = new tty.ReadStream(3);
        master.on("data", () => {});
        master.unref();
        const completed = [];
        (() => {
          const handle = new TTY(4, {});
          handle.onwritecomplete = status => {
            completed.push(status);
            ${collect}
          };
          for (const chunk of [bytes, Buffer.from("a"), Buffer.from("b"), Buffer.from("c")]) handle.writeBuffer(null, chunk);
        })();
        Bun.gc(true);
        setImmediate(() => Bun.gc(true));
        process.on("exit", () => say({ completed }));
      `;
      expect(await withPair(script)).toEqual({ records: [{ completed: [0, 0, 0, 0] }], stderr: "", exitCode: 0 });
    });

    // A timer needs no descriptor, and it drives its write to the end: no tick asks the loop for a poll. Here the
    // descriptors come free at the first chunk that the master reads, with most of the megabyte still queued. The
    // poll of the next refusal needs a descriptor, which the handle keeps until it closes.
    test.concurrent(
      "a write that waits with no descriptor free stays on its timer when descriptors come free, and the next refusal takes the one of the poll",
      async () => {
        const script = `
          ${limit}
          ${descriptors}
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          let freeWhileItWaits = false;
          master.on("data", () => {
            if (!taken.length) return;
            giveBack();
            freeWhileItWaits = slave._handle.writeQueueSize > 0;
          });
          slave.write(Buffer.alloc(0), () => {
            const before = open();
            const atTheLimit = takeAll();
            const first = slave.write(bytes, err => {
              const afterTheFirst = held(before);
              const second = slave.write(bytes, err => {
                say({ second, cb: err ? err.code : null, afterTheSecond: held(before) });
                slave.destroy();
                master.destroy();
              });
              say({ atTheLimit, first, cb: err ? err.code : null, freeWhileItWaits, afterTheFirst });
            });
          });
        `;
        expect(await withPair(script, fewDescriptors)).toEqual({
          records: [
            { atTheLimit: "EMFILE", first: false, cb: null, freeWhileItWaits: true, afterTheFirst: 0 },
            { second: false, cb: null, afterTheSecond: 1 },
          ],
          stderr: "",
          exitCode: 0,
        });
      },
    );

    // A poll wakes when the descriptor takes bytes. A tick of the timer comes by the clock, so it asks first. Here
    // the terminal is stopped as by Ctrl-S and the descriptor of the handle blocks: a tick that wrote would wait in
    // write(2), and the timeout that starts the terminal again would never run. No event says that a tick has run,
    // so the timeout is later than the first tick, which is due after 1 ms. A stopped pty of Linux takes nothing.
    test
      .skipIf(!isLinux)
      .concurrent("a tick of the timer does not write to a descriptor that blocks and takes nothing", async () => {
        const script = `
          ${limit}
          const { tcflow } = require("bun:ffi").dlopen(process.env.TTY_TEST_LIBC, {
            tcflow: { args: ["int", "int"], returns: "int" },
          }).symbols;
          const TCOOFF = 0, TCOON = 1;
          const slave = new tty.ReadStream(4);
          slave.write(Buffer.alloc(0), () => {
            const stopped = tcflow(4, TCOOFF);
            const atTheLimit = takeAll();
            let cb = "not yet";
            const ret = slave.write("hello", err => {
              cb = (err ? err.code : null) + whileTaken();
              giveBack();
              say({ cb });
              slave.destroy();
            });
            const waits = slave._handle.writeQueueSize;
            const blocking = slave._handle.setBlocking(true);
            setTimeout(() => say({ aTimeoutRan: true, cb, started: tcflow(4, TCOON) }), 5);
            say({ stopped, atTheLimit, ret, waits, blocking });
          });
        `;
        expect(await withPair(script, fewDescriptors)).toEqual({
          records: [
            { stopped: 0, atTheLimit: "EMFILE", ret: true, waits: 5, blocking: 0 },
            { aTimeoutRan: true, cb: "not yet", started: 0 },
            { cb: "null with none free" },
          ],
          stderr: "",
          exitCode: 0,
        });
      });

    // The completion of the first write closes the handle from inside the tick of the timer that told it, with the
    // second write still queued.
    test.concurrent("close() in a completion that a timer told cancels the write behind it", async () => {
      const script = `
        ${limit}
        const { TTY } = process.binding("tty_wrap");
        const master = new tty.ReadStream(3);
        master.on("data", () => {});
        const handle = new TTY(4, {});
        const completed = [];
        handle.onwritecomplete = status => {
          completed.push(status);
          if (completed.length > 1) return;
          handle.close(() => {
            const noneFree = taken.length > 0;
            giveBack();
            say({ completed, noneFree, fd: handle.fd });
            master.destroy();
          });
        };
        const atTheLimit = takeAll();
        const first = handle.writeBuffer(null, bytes.subarray(0, size / 2));
        const second = handle.writeBuffer(null, bytes.subarray(size / 2));
        say({ atTheLimit, first, second, bothWait: handle.writeQueueSize > size / 2 });
      `;
      expect(await withPair(script, fewDescriptors)).toEqual({
        records: [
          { atTheLimit: "EMFILE", first: 1, second: 1, bothWait: true },
          { completed: [0, isLinux ? -125 : -89], noneFree: true, fd: -1 }, // UV_ECANCELED
        ],
        stderr: "",
        exitCode: 0,
      });
    });

    // As the rows above for a poll: nothing but its queue holds the handle, and here a timer drives the queue.
    test.concurrent(
      "a handle that nobody holds keeps the writes that a timer drives through a collection",
      async () => {
        const script = `
          ${limit}
          const { TTY } = process.binding("tty_wrap");
          const master = new tty.ReadStream(3);
          master.on("data", () => {});
          master.unref();
          const completed = [];
          let atTheLimit;
          (() => {
            const handle = new TTY(4, {});
            handle.onwritecomplete = status => {
              completed.push(status + whileTaken());
              Bun.gc(true);
            };
            atTheLimit = takeAll();
            for (const chunk of [bytes, Buffer.from("a"), Buffer.from("b"), Buffer.from("c")]) handle.writeBuffer(null, chunk);
          })();
          Bun.gc(true);
          setImmediate(() => Bun.gc(true));
          process.on("exit", () => {
            giveBack();
            say({ atTheLimit, completed });
          });
        `;
        const toldWithNoneFree = "0 with none free";
        expect(await withPair(script, fewDescriptors)).toEqual({
          records: [
            {
              atTheLimit: "EMFILE",
              completed: [toldWithNoneFree, toldWithNoneFree, toldWithNoneFree, toldWithNoneFree],
            },
          ],
          stderr: "",
          exitCode: 0,
        });
      },
    );

    // The end of a Worker closes its handles, here with the timer of one in the heap of timers of the Worker. The
    // test does not read the master, so the write waits until then.
    // One at a time: a debug build takes seconds to start a Worker, and more with other children beside it.
    test("the end of a Worker ends a write that a timer drives", async () => {
      const inTheWorker = `
        const { parentPort } = require("node:worker_threads");
        const tty = require("node:tty"), fs = require("node:fs");
        ${limit}
        const slave = new tty.ReadStream(4);
        slave.write(Buffer.alloc(0), () => {
          const atTheLimit = takeAll();
          const ret = slave.write(Buffer.alloc(${size}, "x"));
          const waits = slave._handle.writeQueueSize;
          // The end of the Worker needs descriptors, and so does the thread of the program.
          giveBack();
          parentPort.postMessage({ atTheLimit, ret, aPartWaits: waits > 0 && waits < ${size} });
        });
      `;
      const script = `
        const { Worker } = require("node:worker_threads");
        const worker = new Worker(${JSON.stringify(inTheWorker)}, { eval: true });
        worker.on("error", err => say({ error: String(err) }));
        worker.once("message", async message => say({ ...message, terminated: await worker.terminate() }));
      `;
      expect(await withPair(script, fewDescriptors)).toEqual({
        records: [{ atTheLimit: "EMFILE", ret: false, aPartWaits: true, terminated: 1 }],
        stderr: "",
        exitCode: 0,
      });
    });

    // The handle has a descriptor of its own from the start, also where it could not open the terminal again.
    // libuv has the number of the caller alone there, and Node answers EBADF. destroy() closes the number of the
    // caller only while it still names the file of the handle: a number that the caller closed is no longer the
    // handle's, and another file of the program can have it.
    test.concurrent.each([
      ["and left the number closed", "const other = null;", { other: null, otherIsOpen: null }],
      [
        "and opened another file under its number",
        `const other = fs.openSync("/dev/null", "r");`,
        { other: 3, otherIsOpen: true },
      ],
    ])(
      "a stream over a descriptor that cannot be reopened writes, says the size of the window and closes after the caller has closed it %s",
      async (_name, reuse, { other, otherIsOpen }) => {
        const script = `
          const master = new tty.ReadStream(3);
          master.on("error", err => say({ error: err.code }));
          fs.closeSync(3);
          ${reuse}
          const windowSize = [];
          say({ other, getWindowSize: master._handle.getWindowSize(windowSize), windowSize });
          master.on("close", () => {
            let otherIsOpen = null;
            if (other !== null) {
              try { otherIsOpen = fs.fstatSync(other).isCharacterDevice(); } catch { otherIsOpen = false; }
            }
            say({ closed: true, otherIsOpen });
          });
          master.write(bytes, err => {
            say({ cb: err ? err.code : null });
            master.destroy();
          });
        `;
        expect(await withPair(script, { readEnd: "slave" })).toEqual({
          records: [{ other, getWindowSize: 0, windowSize: [0, 0] }, { cb: null }, { closed: true, otherIsOpen }],
          stderr: "",
          exitCode: 0,
          read: { got: size, sameBytes: true },
        });
      },
    );

    // libuv's uv_stream_set_blocking() changes O_NONBLOCK of the descriptor of the caller. This handle changes it
    // on a descriptor that it opened itself, and on no other.
    test.concurrent("setBlocking() never changes O_NONBLOCK of the descriptor of the caller", async () => {
      const script = `
        const { TTY } = process.binding("tty_wrap");
        ${fcntlInChild}
        const { O_RDONLY, O_WRONLY, O_NONBLOCK } = fs.constants;
        const nonblocking = fd => (fcntl(fd, 3, 0) & O_NONBLOCK) !== 0;
        const reader = fs.openSync(fifo, O_RDONLY | O_NONBLOCK);
        // A reader is there, so this open returns at once. The descriptor blocks.
        const writer = fs.openSync(fifo, O_WRONLY);
        const record = {};
        const handles = [];
        for (const [name, fd] of [["the master", 3], ["the slave", 4], ["a FIFO that blocks", writer], ["a FIFO that does not block", reader]]) {
          const handle = new TTY(fd, {});
          handles.push(handle);
          record[name] = [nonblocking(fd)];
          for (const enable of [true, false]) record[name].push(handle.setBlocking(enable), nonblocking(fd));
        }
        say(record);
        for (const handle of handles) handle.close();
      `;
      expect(await withFifo(script)).toEqual({
        records: [
          {
            // Before, then what setBlocking(true) answers and leaves, then the same for setBlocking(false).
            "the master": [true, 0, true, 0, true],
            "the slave": [false, 0, false, 0, false],
            "a FIFO that blocks": [false, 0, false, 0, false],
            "a FIFO that does not block": [true, 0, true, 0, true],
          },
        ],
        stderr: "",
        exitCode: 0,
      });
    });

    // The stream is the host's, whichever script writes to it. The end of the graph closes what the graph opened,
    // and this handle is not of those: its write goes out, and the host writes again.
    test.concurrent(
      "a write from a Bun.ModuleGraph to a stream of the host goes out after the graph is disposed",
      async () => {
        const script = `
          const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
          const events = [];
          slave.on("error", err => events.push("error " + err.code));
          slave.on("drain", () => events.push("drain"));
          const graph = new Bun.ModuleGraph({});
          graph.run(() => {
            const ret = slave.write(bytes, err => events.push("write of the graph " + (err ? err.code : null)));
            events.push("write of the graph returns " + ret);
          });
          graph.dispose();
          say({ destroyed: slave.destroyed, writableLength: slave.writableLength });
          let got = 0, tail = "", hostWrote = false;
          master.on("data", chunk => {
            got += chunk.length;
            tail = (tail + chunk).slice(-4);
            if (got >= size && !hostWrote) {
              hostWrote = true;
              // All of the write of the graph is out.
              setImmediate(() => {
                events.push("writableLength " + slave.writableLength);
                const ret = slave.write("host", err => events.push("write of the host " + (err ? err.code : null)));
                events.push("write of the host returns " + ret);
              });
            }
            if (got < size + 4) return;
            setImmediate(() => {
              say({ got, tail, events, writableLength: slave.writableLength });
              slave.destroy();
              master.destroy();
            });
          });
        `;
        expect(await withPair(script)).toEqual({
          records: [
            { destroyed: false, writableLength: size },
            {
              got: size + 4,
              tail: "host",
              events: [
                "write of the graph returns false",
                "drain",
                "write of the graph null",
                "writableLength 0",
                "write of the host returns true",
                "write of the host null",
              ],
              writableLength: 0,
            },
          ],
          stderr: "",
          exitCode: 0,
        });
      },
    );

    // libuv keeps the Buffer of a write that waits, so under Node the change below goes out. This handle copies
    // what the descriptor refused.
    test.concurrent("a change of the Buffer behind write() does not reach a write that waits", async () => {
      const script = `
        const master = new tty.ReadStream(3), slave = new tty.ReadStream(4);
        const hash = crypto.createHash("sha256");
        let got = 0;
        master.on("data", chunk => {
          got += chunk.length;
          hash.update(chunk);
          if (got < size) return;
          say({ got, sameBytes: hash.digest("hex") === sha256 });
          slave.destroy();
          master.destroy();
        });
        const ret = slave.write(bytes, err => say({ cb: err ? err.code : null }));
        bytes.fill("#");
        say({ ret, writableLength: slave.writableLength });
      `;
      expect(await withPair(script)).toEqual({
        records: [{ ret: false, writableLength: size }, { cb: null }, { got: size, sameBytes: true }],
        stderr: "",
        exitCode: 0,
      });
    });
  });

  // https://github.com/oven-sh/bun/issues/33580: Node emits errnoException(err,
  // "setRawMode"), so code/errno/syscall are set. A pipe is accepted by
  // uv_tty_init and has no mode to set: tcgetattr answers ENOTTY. The pipe is
  // one that the shell makes. The stdin of Bun.spawn is a socket pair, which
  // answers EOPNOTSUPP on macOS, and libuv has no name for that.
  test("setRawMode failure emits an ErrnoException", async () => {
    await using proc = Bun.spawn({
      cmd: [
        "sh",
        "-c",
        ': | "$@"',
        "sh",
        bunExe(),
        "-e",
        `
          const tty = require("node:tty");
          const s = new tty.ReadStream(0);
          s.on("error", err => {
            console.log(JSON.stringify({ code: err.code, errno: err.errno, syscall: err.syscall, message: err.message, isRaw: s.isRaw }));
            s.destroy();
          });
          s.setRawMode(true);
        `,
      ],
      env: bunEnv,
      stdin: "ignore",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      code: "ENOTTY",
      errno: -25,
      syscall: "setRawMode",
      message: "setRawMode ENOTTY",
      isRaw: false,
    });
    expect(exitCode).toBe(0);
  });
});

describe("ReadStream constructor", () => {
  // What libuv's uv_tty_init answers for a fd that it refuses: its Windows code
  // finds no console handle, its POSIX code refuses a file or a fd it does not know.
  const refused = isWindows
    ? { errno: -4083, code: "EBADF", message: "bad file descriptor" }
    : { errno: -22, code: "EINVAL", message: "invalid argument" };
  const ttyInitFailed = {
    name: "SystemError",
    code: "ERR_TTY_INIT_FAILED",
    message: `TTY initialization failed: uv_tty_init returned ${refused.code} (${refused.message})`,
    errno: refused.errno,
    syscall: "uv_tty_init",
    info: { errno: refused.errno, code: refused.code, syscall: "uv_tty_init", message: refused.message },
  };

  // Node's ERR_TTY_INIT_FAILED is a SystemError carrying the uv_tty_init context.
  test("a regular file fails with the SystemError shape Node uses", () => {
    using dir = tempDir("tty-init-failed", { "file.txt": "x" });
    const fd = openSync(join(String(dir), "file.txt"), "r");
    try {
      let err: any;
      try {
        new ReadStream(fd);
      } catch (e) {
        err = e;
      }
      expect({
        name: err?.name,
        code: err?.code,
        message: err?.message,
        errno: err?.errno,
        syscall: err?.syscall,
        info: err?.info,
      }).toEqual(ttyInitFailed);
    } finally {
      closeSync(fd);
    }
  });

  // https://github.com/nodejs/node/blob/v26.12.1/test/parallel/test-ttywrap-invalid-fd.js#L47-L57
  test("a fd that is not open fails the same way", () => {
    using dir = tempDir("tty-init-invalid-fd", { "file.txt": "x" });
    const fd = openSync(join(String(dir), "file.txt"), "r");
    closeSync(fd);
    let err: any;
    try {
      new ReadStream(fd);
    } catch (e) {
      err = e;
    }
    expect({
      name: err?.name,
      code: err?.code,
      message: err?.message,
      errno: err?.errno,
      syscall: err?.syscall,
      info: err?.info,
    }).toEqual(ttyInitFailed);
  });

  // `ctx` is the caller's object. Node stores into it with Set().
  test("new TTY(fd, ctx) stores the failure into ctx with [[Set]]", () => {
    using dir = tempDir("tty-init-ctx", { "file.txt": "x" });
    const fd = openSync(join(String(dir), "file.txt"), "r");
    try {
      const { TTY } = process.binding("tty_wrap" as never) as { TTY: new (fd: number, ctx: object) => object };
      const stored: [string, unknown][] = [];
      const ctx = new Proxy(
        {},
        {
          set(target, key, value) {
            stored.push([String(key), value]);
            return Reflect.set(target, key, value);
          },
        },
      );
      new TTY(fd, ctx);
      const { errno, code, message } = ttyInitFailed.info;
      expect(stored).toEqual([
        ["errno", errno],
        ["code", code],
        ["message", message],
        ["syscall", "uv_tty_init"],
      ]);

      let inherited: unknown;
      const heir = Object.create({
        set code(value: unknown) {
          inherited = value;
        },
      });
      new TTY(fd, heir);
      expect({ inherited, own: Object.keys(heir) }).toEqual({ inherited: code, own: ["errno", "message", "syscall"] });
    } finally {
      closeSync(fd);
    }
  });

  // libuv's uv_tty_init takes what uv_guess_handle names: of the sockets a
  // unix stream socket (a pipe to it), not a unix datagram socket.
  test.skipIf(isWindows)("a unix datagram socket is refused and a unix stream socket is not, as in Node", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { dlopen, ptr } = require("bun:ffi");
          const { ReadStream } = require("node:tty");
          const arch = process.arch === "x64" ? "x86_64" : process.arch === "arm64" ? "aarch64" : process.arch;
          const names = process.platform === "darwin" ? ["libSystem.B.dylib"] : ["libc.so.6", "libc.musl-" + arch + ".so.1"];
          let libc;
          for (const name of names) {
            try {
              libc = dlopen(name, { socketpair: { args: ["int", "int", "int", "ptr"], returns: "int" } }).symbols;
              break;
            } catch {}
          }
          const AF_UNIX = 1, SOCK_STREAM = 1, SOCK_DGRAM = 2;
          const made = type => {
            const fds = new Int32Array(2);
            if (libc.socketpair(AF_UNIX, type, 0, ptr(fds)) !== 0) throw new Error("socketpair failed");
            try {
              const stream = new ReadStream(fds[0]);
              stream.destroy();
              return "made";
            } catch (err) {
              return [err.code, err.info.code];
            }
          };
          console.log(JSON.stringify({ datagram: made(SOCK_DGRAM), stream: made(SOCK_STREAM) }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: JSON.stringify({ datagram: ["ERR_TTY_INIT_FAILED", "EINVAL"], stream: "made" }),
      stderr: "",
      exitCode: 0,
    });
  });

  // Node's getWindowSize() takes an array alone.
  test("TTY.prototype.getWindowSize refuses what is no array", () => {
    using dir = tempDir("tty-window-size", { "file.txt": "x" });
    const fd = openSync(join(String(dir), "file.txt"), "r");
    try {
      const { TTY } = process.binding("tty_wrap" as never) as {
        TTY: new (fd: number, ctx: object) => { getWindowSize(size: unknown): number };
      };
      const handle = new TTY(fd, {});
      for (const size of [{}, { 0: 0, 1: 0, length: 2 }, undefined, "ab"]) {
        expect(() => handle.getWindowSize(size)).toThrow(TypeError);
      }
      // A handle that uv_tty_init refused is closed: UV_EBADF.
      expect(handle.getWindowSize([0, 0])).toBe(isWindows ? -4083 : -9);
    } finally {
      closeSync(fd);
    }
  });

  test("rejects a negative or non-integer fd like Node", () => {
    for (const fd of [-1, 1.5]) {
      expect(() => new ReadStream(fd)).toThrow(
        expect.objectContaining({
          name: "RangeError",
          code: "ERR_INVALID_FD",
          message: `"fd" must be a positive integer: ${fd}`,
        }),
      );
    }
  });

  test("WriteStream rejects a negative or non-integer fd like Node", () => {
    for (const fd of [-1, 1.5, "1"]) {
      expect(() => new WriteStream(fd as number)).toThrow(
        expect.objectContaining({ name: "RangeError", code: "ERR_INVALID_FD" }),
      );
    }
  });
});

describe("isatty", () => {
  // Node asks the system only about an integer from 0 to 2147483647, and converts nothing.
  test("answers false for what is no file descriptor, without coercion", () => {
    const conversions: string[] = [];
    const object = {
      valueOf() {
        conversions.push("valueOf");
        return 0;
      },
    };
    const values = ["0", 1.5, -1, 2 ** 31, null, undefined, true, object];
    expect(values.map(value => isatty(value as number))).toEqual(values.map(() => false));
    expect(conversions).toEqual([]);
  });
});

describe("node:tty loads node:net only for ReadStream", () => {
  test("ReadStream is an accessor until its first read, then the class", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const tty = require("node:tty");
         const getter = () => typeof Object.getOwnPropertyDescriptor(tty, "ReadStream").get;
         const atLoad = getter();
         tty.isatty(1);
         void tty.WriteStream.prototype;
         const afterOtherExports = getter();
         const ReadStream = tty.ReadStream;
         const { value, enumerable, writable } = Object.getOwnPropertyDescriptor(tty, "ReadStream");
         console.log(JSON.stringify({
           atLoad,
           afterOtherExports,
           isClass: value === ReadStream,
           enumerable,
           writable,
           extendsSocket: Object.getPrototypeOf(ReadStream) === require("node:net").Socket,
           keys: Object.keys(tty),
         }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: JSON.parse(stdout), stderr, exitCode }).toEqual({
      stdout: {
        atLoad: "function",
        afterOtherExports: "function",
        isClass: true,
        enumerable: true,
        writable: true,
        extendsSocket: true,
        keys: ["ReadStream", "WriteStream", "isatty"],
      },
      stderr: "",
      exitCode: 0,
    });
  });
});

describe.skipIf(isWindows)("tty.ReadStream over the stream-wrap path of net.Socket", () => {
  // Node's net.Socket({ handle, onread }) hands every chunk to onread.callback
  // instead of push(); the stream-wrap read path must do the same.
  test("a Socket over a TTY handle honours the onread option", async () => {
    const { code, output } = await runInPty(
      `
        const net = require("node:net");
        const { TTY } = process.binding("tty_wrap");
        const seen = [];
        const s = new net.Socket({
          handle: new TTY(0, {}),
          onread: {
            buffer: Buffer.alloc(64),
            callback(nread, buf) {
              seen.push(buf.toString("utf8", 0, nread));
              if (seen.join("").includes("\\n")) {
                process.stdout.write("RESULT " + JSON.stringify({ seen, pushed: s.readableLength, bytesRead: s.bytesRead }) + "\\n");
                s.destroy();
              }
            },
          },
        });
        process.stdout.write("P1\\n");
      `,
      [
        terminal => {
          terminal.write("abc\n");
        },
      ],
      { markers: ["P1", "RESULT "] },
    );
    expect(code).toBe(0);
    const result = JSON.parse(Bun.stripANSI(output()).match(/RESULT (\{.*\})/)![1]);
    expect(result.seen.join("")).toBe("abc\n");
    expect(result).toMatchObject({ pushed: 0, bytesRead: 4 });
  });

  // A callback that returns false parks the rest of the chunk as a tail. EOF
  // must wait until resume() has delivered that tail, as on the usockets path.
  test("EOF after a paused onread callback is delivered after the buffered tail", async () => {
    const { code, output } = await runInPty(
      `
        const net = require("node:net");
        const { TTY } = process.binding("tty_wrap");
        const events = [];
        const s = new net.Socket({
          handle: new TTY(0, {}),
          onread: {
            buffer: Buffer.alloc(2),
            callback(nread, buf) {
              events.push("data:" + buf.toString("utf8", 0, nread));
              if (events.length === 1) {
                setImmediate(() => { events.push("resume"); s.resume(); });
                return false;
              }
            },
          },
        });
        s.on("end", () => {
          events.push("end");
          process.stdout.write("RESULT " + JSON.stringify(events) + "\\n");
        });
        process.stdout.write("P1\\n");
      `,
      [
        terminal => {
          // One cooked line then ^D: a 5-byte read split over a 2-byte onread buffer, then EOF.
          terminal.write("abcd\n");
          terminal.write("\x04");
        },
      ],
      { markers: ["P1", "RESULT "] },
    );
    expect(code).toBe(0);
    const events = JSON.parse(Bun.stripANSI(output()).match(/RESULT (\[.*\])/)![1]);
    expect(events[0]).toBe("data:ab");
    expect(events[1]).toBe("resume");
    expect(events.at(-1)).toBe("end");
    expect(
      events
        .filter((e: string) => e.startsWith("data:"))
        .map((e: string) => e.slice(5))
        .join(""),
    ).toBe("abcd\n");
  });

  // The handle counts what it writes, and destroy() keeps the count.
  test("bytesWritten survives destroy()", async () => {
    const { code, output } = await runInPty(
      `
        const s = process.stdin;
        s.write("hi", () => {
          const before = s.bytesWritten;
          s.on("close", () => {
            process.stdout.write("RESULT " + JSON.stringify({ before, after: s.bytesWritten }) + "\\n");
          });
          s.destroy();
        });
      `,
      [() => {}],
      { markers: ["RESULT "] },
    );
    expect(code).toBe(0);
    expect(JSON.parse(Bun.stripANSI(output()).match(/RESULT (\{.*\})/)![1])).toEqual({ before: 2, after: 2 });
  });

  // fd 3 of the child is a pipe, which libuv's uv_tty_init takes and cannot reopen: close() closes it.
  async function runOverPipe(script: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdio: ["ignore", "pipe", "pipe", "pipe"],
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  // Node closes a handle only when the program does. The collector gives up
  // what the handle opened for itself, and leaves the caller's fd alone.
  test("a stream that is collected without destroy() leaves the caller's fd open", async () => {
    const result = await runOverPipe(`
      const fs = require("node:fs");
      const tty = require("node:tty");
      let collected = false;
      const registry = new FinalizationRegistry(() => { collected = true; });
      (() => { registry.register(new tty.ReadStream(3)._handle, 0); })();
      (async () => {
        for (let i = 0; i < 100 && !collected; i++) {
          Bun.gc(true);
          await new Promise(resolve => setImmediate(resolve));
        }
        let open = true;
        try { fs.fstatSync(3); } catch { open = false; }
        console.log(JSON.stringify({ collected, open }));
      })();
    `);
    expect(result).toEqual({ stdout: JSON.stringify({ collected: true, open: true }), stderr: "", exitCode: 0 });
  });

  // https://github.com/nodejs/node/blob/v26.3.0/lib/net.js#L801-L815
  test("resetAndDestroy() refuses a handle that is no TCP handle", async () => {
    const result = await runOverPipe(`
      const fs = require("node:fs");
      const tty = require("node:tty");
      const stream = new tty.ReadStream(3);
      let code;
      try { stream.resetAndDestroy(); } catch (err) { code = err.code; }
      const destroyed = stream.destroyed;
      stream.on("close", () => {
        let open = true;
        try { fs.fstatSync(3); } catch { open = false; }
        console.log(JSON.stringify({ code, destroyed, openAfterDestroy: open }));
      });
      stream.destroy();
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({ code: "ERR_INVALID_HANDLE_TYPE", destroyed: false, openAfterDestroy: false }),
      stderr: "",
      exitCode: 0,
    });
  });

  // A TUI run as 'app < in > out' still has a controlling terminal and opens
  // /dev/tty. On macOS kqueue refuses the /dev/tty alias, and with no tty on
  // stdio the real device must come from the kernel, not from a stdio scan.
  test("reads /dev/tty from a process whose stdio are all pipes", async () => {
    const { code, output } = await runInPty(
      `
        const { spawn } = require("node:child_process");
        const child = spawn(process.execPath, ["-e", \`
          const fs = require("node:fs");
          const tty = require("node:tty");
          const input = new tty.ReadStream(fs.openSync("/dev/tty", "r"));
          input.on("error", err => { process.stdout.write("ERROR " + err.code + "\\\\n"); process.exit(1); });
          input.on("data", d => {
            process.stdout.write("DATA " + JSON.stringify(String(d)) + "\\\\n");
            input.destroy();
          });
          process.stdout.write("CHILDREADY\\\\n");
        \`], { stdio: ["pipe", "pipe", "pipe"] });
        child.stdout.on("data", d => process.stdout.write(d));
        child.stderr.on("data", d => process.stdout.write("STDERR " + d));
        child.on("exit", code => { process.stdout.write("RESULT " + code + "\\n"); process.exit(0); });
      `,
      [
        terminal => {
          terminal.write("from the terminal\n");
        },
      ],
      { markers: ["CHILDREADY", "RESULT "], controllingTerminal: true },
    );
    expect(code).toBe(0);
    const text = Bun.stripANSI(output());
    expect(text).toContain('DATA "from the terminal\\n"');
    expect(text).toContain("RESULT 0");
  });

  // `app </dev/tty`: fd 0 is the alias of the controlling terminal, which
  // kqueue refuses on macOS. Each reader of stdin opens the device behind it.
  test.concurrent.each([
    [
      "process.stdin",
      `process.stdin.once("data", chunk => { say("DATA " + JSON.stringify(String(chunk))); process.exit(0); });`,
    ],
    [
      "Bun.stdin.stream()",
      `Bun.stdin.stream().getReader().read().then(({ value }) => { say("DATA " + JSON.stringify(new TextDecoder().decode(value))); process.exit(0); });`,
    ],
    [
      "the console iterator",
      `(async () => { for await (const line of console) { say("DATA " + JSON.stringify(line + "\\n")); process.exit(0); } })();`,
    ],
  ])("%s reads a terminal through the /dev/tty alias on fd 0", async (_name, reader) => {
    const child = `const say = line => process.stdout.write(line + "\\n"); ${reader} say("CHILDREADY");`;
    const { code, output } = await runInPty(
      `
        const { spawn } = require("node:child_process");
        const alias = require("node:fs").openSync("/dev/tty", "r");
        const child = spawn(process.execPath, ["-e", ${JSON.stringify(child)}], { stdio: [alias, "pipe", "pipe"] });
        child.stdout.on("data", d => process.stdout.write(d));
        child.stderr.on("data", d => process.stdout.write("STDERR " + d));
        child.on("exit", code => { process.stdout.write("RESULT " + code + "\\n"); process.exit(0); });
      `,
      [
        terminal => {
          terminal.write("from the terminal\n");
        },
      ],
      { markers: ["CHILDREADY", "RESULT "], controllingTerminal: true },
    );
    expect(code).toBe(0);
    const text = Bun.stripANSI(output());
    expect(text).toContain('DATA "from the terminal\\n"');
    expect(text).toContain("RESULT 0");
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

  // Reads the slave until it has `size` bytes, and says how many it got and their SHA-256.
  async function readFromAnotherProcess(path: string, size: number) {
    await using reader = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const fs = require("fs");
         const fd = fs.openSync(process.argv[1], fs.constants.O_RDONLY | fs.constants.O_NOCTTY);
         const buffer = Buffer.alloc(65536);
         const hash = require("crypto").createHash("sha256");
         let total = 0;
         while (total < Number(process.argv[2])) {
           const n = fs.readSync(fd, buffer, 0, buffer.length, null);
           if (n === 0) break;
           hash.update(buffer.subarray(0, n));
           total += n;
         }
         console.log(total, hash.digest("hex"));`,
        path,
        String(size),
      ],
      env: bunEnv,
      stdout: "pipe",
    });
    return await reader.stdout.text();
  }

  // Runs the fixture, writes "one" and "two" to the slave after each READY,
  // then ends the stream the requested way. Returns the fixture's event log.
  async function runFixture(end: "destroy" | "hangup" | "last words" | "raw", written = ["one", "two"]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "tty-readstream-nonblocking.fixture.ts")],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Drain stderr from the start so a chatty fixture cannot block on it.
    const stderr = proc.stderr.text();
    const chunks = [...written];
    const lines: string[] = [];
    let ended = false;
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
        if (ended) continue;
        ended = true;
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
    expect(lines[4]).toBe(isLinux ? "ERROR EIO" : "END");
    expect([...lines.slice(0, 4), ...lines.slice(5)]).toEqual([
      'DATA "one"',
      "RESIZE ok",
      'DATA "two"',
      "RESIZE ok",
      "CLOSE destroyed=true masterOpen=false",
    ]);
    expect(exitCode).toBe(0);
  });

  // The stream owns the master: it has no name to open it by. close() puts the
  // pty back through a descriptor of the handle, and closes the master.
  test.concurrent("destroy() of a raw stream over a pty master puts the pty back and closes the master", async () => {
    const { lines, exitCode } = await runFixture("raw", []);
    expect(lines).toEqual(["MODE raw", "CLOSE destroyed=true masterOpen=false", "MODE cooked"]);
    expect(exitCode).toBe(0);
  });

  // A shell's last output and its exit reach the master together. libuv reads
  // neither of them for a stream that is stopped, so the EIO behind the output
  // cannot destroy the stream before the output is delivered. Linux only: on
  // macOS the last close of the slave waits until the master has read the
  // output or drops it (ttywait() in XNU's tty.c), so the two never wait together.
  test.concurrent.skipIf(!isLinux)(
    "a hangup that arrives with the last output does not drop it from a paused stream",
    async () => {
      const { lines, exitCode } = await runFixture("last words", ["one"]);
      expect(lines).toEqual([
        'DATA "one"',
        "RESIZE ok",
        'DATA "two"',
        "RESIZE ok",
        "ERROR EIO",
        "CLOSE destroyed=true masterOpen=false",
      ]);
      expect(exitCode).toBe(0);
    },
  );

  // libuv writes to a tty it could not reopen with blocking writes: it waits
  // for a full pty, where write(2) on the nonblocking master says EAGAIN.
  test.concurrent("a write larger than the pty holds completes once the slave is read", async () => {
    const size = 1024 * 1024;
    // 62 bytes, which divides no size the pty takes at once: a part that is written twice or left out changes the digest.
    const fill = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "tty-readstream-nonblocking.fixture.ts")],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = proc.stderr.text();
    const lines: string[] = [];
    let slavePath = "";
    let buffered = "";
    let asked = false;
    let read: Promise<string> | undefined;
    let received: string | undefined;
    for await (const chunk of proc.stdout) {
      buffered += Buffer.from(chunk).toString();
      let newline: number;
      while ((newline = buffered.indexOf("\n")) !== -1) {
        const line = buffered.slice(0, newline);
        buffered = buffered.slice(newline + 1);
        if (line.startsWith("SLAVE ")) {
          slavePath = line.slice("SLAVE ".length);
        } else if (line === "READY" && !asked) {
          asked = true;
          proc.stdin.write(`write ${fill}\n`);
        } else if (line === "WRITING") {
          // Only now does anything read the slave: the write is already waiting.
          read = readFromAnotherProcess(slavePath, size);
        } else {
          lines.push(line);
          if (line.startsWith("WRITTEN ")) {
            // The reader first: the close of the master takes with it what the slave has not read yet.
            received = await read;
            proc.stdin.write("destroy\n");
            proc.stdin.end();
          }
        }
      }
    }
    const [, exitCode] = await Promise.all([stderr, proc.exited]);
    expect(lines).toEqual([`WRITTEN ok bytesWritten=${size}`, "CLOSE destroyed=true masterOpen=false"]);
    expect(received).toBe(`${size} ${createHash("sha256").update(Buffer.alloc(size, fill)).digest("hex")}\n`);
    expect(exitCode).toBe(0);
  });
});

describe("ReadStream over a pipe", () => {
  async function runOverPipes(script: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      stdio: ["pipe", "pipe", "pipe", "pipe"],
      env: bunEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  // As in Node, whose tty.ReadStream wraps a libuv handle that never closes
  // descriptors 0-2: destroying a ReadStream on fd 0 leaves fd 0 open, and one
  // on a higher fd that libuv cannot reopen (a pipe) closes it.
  test.skipIf(isWindows)("destroy() leaves fd 0 open and closes a higher fd", async () => {
    const result = await runOverPipes(`
      const fs = require("fs");
      const tty = require("tty");
      const isOpen = fd => { try { fs.fstatSync(fd); return true; } catch { return false; } };
      const stdin = new tty.ReadStream(0);
      stdin.on("close", () => {
        const other = new tty.ReadStream(3);
        other.on("close", () => console.log(JSON.stringify({ fd0: isOpen(0), higherFd: isOpen(3) })));
        other.destroy();
      });
      stdin.destroy();
    `);
    expect(result).toEqual({ stdout: '{"fd0":true,"higherFd":false}', stderr: "", exitCode: 0 });
  });

  // `fd` is Bun's: in Node a tty.ReadStream has none, and process.stdin has one that getStdin() puts there.
  // It names the caller's descriptor while the handle is open. A stream that is closed names none, so it
  // cannot hand a child the descriptor that has the number by then.
  test.skipIf(isWindows)("fd is the descriptor of the open handle, and null once the handle is closed", async () => {
    const result = await runOverPipes(`
      const tty = require("tty");
      const { spawnSync } = require("child_process");
      const stream = new tty.ReadStream(3);
      const out = { own: Object.hasOwn(stream, "fd"), open: stream.fd };
      stream.on("close", () => {
        out.closed = stream.fd;
        try {
          spawnSync(process.execPath, ["-e", ""], { stdio: [stream, "ignore", "ignore"] });
          out.spawn = "ran";
        } catch (err) {
          out.spawn = /without an underlying file descriptor/.test(err.message) ? "has no descriptor" : err.message;
        }
        console.log(JSON.stringify(out));
      });
      stream.destroy();
      out.afterDestroy = stream.fd;
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({ own: true, open: 3, afterDestroy: null, closed: null, spawn: "has no descriptor" }),
      stderr: "",
      exitCode: 0,
    });
  });

  // Only a terminal's process.stdin is made in the context of the realm. A pipe's is the graph's, as on main.
  test("a disposed Bun.ModuleGraph that listened to a piped process.stdin does not hold the process", async () => {
    const result = await runOverPipes(`
      const graph = new Bun.ModuleGraph({});
      graph.run(() => { process.stdin.on("data", () => {}); });
      graph.dispose();
      console.log("disposed");
    `);
    expect(result).toEqual({ stdout: "disposed", stderr: "", exitCode: 0 });
  });

  // libuv's uv_tty_init for Windows takes a console handle alone.
  test.skipIf(!isWindows)("a pipe is refused on Windows, as in Node", async () => {
    const result = await runOverPipes(`
      const tty = require("tty");
      const failures = [0, 3].map(fd => {
        try {
          new tty.ReadStream(fd);
          return null;
        } catch (err) {
          return [err.code, err.info.code, err.info.errno];
        }
      });
      console.log(JSON.stringify({ failures, stdinIsSocket: process.stdin instanceof require("net").Socket }));
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({
        failures: [
          ["ERR_TTY_INIT_FAILED", "EBADF", -4083],
          ["ERR_TTY_INIT_FAILED", "EBADF", -4083],
        ],
        stdinIsSocket: false,
      }),
      stderr: "",
      exitCode: 0,
    });
  });

  // Over pipes: the handle refuses a file, as uv_tty_init does, and on Windows it takes a console alone.
  test.skipIf(isWindows)("runs a subclass's _destroy on fds 0-2", async () => {
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
      stdin: "pipe",
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
  test.skipIf(isWindows)("on fd 0 does not wait for a read in flight", async () => {
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
});

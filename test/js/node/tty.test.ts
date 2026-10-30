import { describe, expect, it, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
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
      if (code === 0) return new Promise<never>(() => {});
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
async function runInPty(
  script: string,
  phases: PtyPhase[],
  opts: { markers: string[]; controllingTerminal?: boolean; prefix?: string[] },
) {
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
  const proc = Bun.spawn({
    cmd: [...(opts.prefix ?? []), bunExe(), "-e", script],
    env: bunEnv,
    terminal: ownTerminal ?? terminalOptions,
  });
  await using spawnedTerminal = ownTerminal ? null : proc.terminal!;
  const terminal = (ownTerminal ?? spawnedTerminal)!;
  // A failing child rejects the marker waits instead of hanging them. A clean
  // exit can land before the PTY delivers the child's last output, so it does
  // not end the wait: the marker still arrives through `data`.
  const exitedEarly = proc.exited.then(code => {
    if (code === 0) return new Promise<never>(() => {});
    throw new Error(`child exited early with code ${code}; terminal output: ${JSON.stringify(buffer)}`);
  });
  exitedEarly.catch(() => {});
  const seen = (pattern: RegExp | string) => {
    const test = typeof pattern === "string" ? () => buffer.includes(pattern) : () => pattern.test(buffer);
    const found = test()
      ? Promise.resolve()
      : new Promise<void>((resolve, reject) => waiters.push({ test, resolve, reject }));
    return Promise.race([found, exitedEarly]);
  };
  for (let i = 0; i < opts.markers.length; i++) {
    await seen(opts.markers[i]);
    if (i < phases.length) await phases[i](terminal, () => buffer, seen);
  }
  const code = await proc.exited;
  return { code, output: () => buffer };
}

// Most tests here run one after the other on purpose. Each one types into a
// terminal and waits for what its child prints. The whole file takes 10 s on
// the ASAN lane and 1 s on a release build. On a loaded machine the rows that
// do run concurrently needed more than the 5 s of a test on a debug build, so
// more of them at once adds timeouts and no speed.
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
          handleMethods: ["readStart", "readStop", "setRawMode", "getWindowSize", "ref", "unref", "hasRef", "getAsyncId", "setBlocking", "close"].every(
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

  // Nothing reads fd 0 before a consumer does. A 'data' listener takes every
  // chunk, so push() never reports backpressure and the handle stays armed, as
  // in Node: what stops it is pause(), through the 'pause' hook of process.stdin.
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
    const rows: [name: string, answer: "stopped" | "one more at most", reader: string][] = [
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
    test.concurrent.each(rows)("%s: %s", async (_name, answer, reader) => {
      const total = 8;
      const { code, output } = await runInPty(
        `
          const { spawn } = require("node:child_process");
          const s = process.stdin;
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
              process.stdout.write("RESULT " + JSON.stringify({ buffered: s.readableLength, reading: !!(s._handle && s._handle.reading), code }) + "\\n");
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
        { markers: ["P1", "CHILDREADY", "RESULT "] },
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
    const rows: [name: string, first: string, second: string][] = [
      [
        "a break out of the console iterator, then a 'data' listener of process.stdin",
        consoleBreak,
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
    test.concurrent.each(rows)("%s", async (_name, first, second) => {
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
            terminal.write("first\n");
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

  // libuv's uv__tty_close() puts the terminal back when a handle is closed in raw mode.
  test("destroy() of a stream in raw mode restores the terminal", async () => {
    const ICANON = process.platform === "darwin" ? 0x100 : 0x2;
    const ECHO = 0x8;
    const isRaw = (terminal: Bun.Terminal) => (terminal.localFlags & (ICANON | ECHO)) === 0;
    const observed: Record<string, boolean> = {};
    const { code } = await runInPty(
      `
        const tty = require("node:tty");
        const say = s => process.stdout.write(s + "\\n");
        const ack = () => new Promise(resolve => process.stdin.once("data", () => resolve()));
        (async () => {
          const raw = new tty.ReadStream(0);
          raw.setRawMode(true);
          say("P1"); await ack();

          new tty.ReadStream(0).destroy(); // never raw: nothing to put back
          say("P2"); await ack();

          raw.destroy();
          say("P3"); await ack();
          process.exit(0);
        })();
      `,
      [
        terminal => {
          observed.afterSetRawMode = isRaw(terminal);
          terminal.write("\n");
        },
        terminal => {
          observed.afterOtherStreamDestroyed = isRaw(terminal);
          terminal.write("\n");
        },
        terminal => {
          observed.afterRawStreamDestroyed = isRaw(terminal);
          terminal.write("\n");
        },
      ],
      { markers: ["P1", "P2", "P3"] },
    );
    expect(observed).toEqual({
      afterSetRawMode: true,
      afterOtherStreamDestroyed: true,
      afterRawStreamDestroyed: false,
    });
    expect(code).toBe(0);
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
        await new Promise(resolve => {
          const warm = fs.createReadStream("/dev/null");
          warm.on("data", () => {});
          warm.on("end", () => process.stdout.write("WARM\\n", resolve));
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

  // Node closes the handles of a thread when the thread ends. libuv's
  // uv__tty_close() then puts the terminal back.
  test("a Worker that ends with a stream in raw mode restores the terminal", async () => {
    const ICANON = process.platform === "darwin" ? 0x100 : 0x2;
    const ECHO = 0x8;
    const isRaw = (terminal: Bun.Terminal) => (terminal.localFlags & (ICANON | ECHO)) === 0;
    const observed: Record<string, boolean> = {};
    const { code } = await runInPty(
      `
        const { Worker } = require("node:worker_threads");
        const say = s => process.stdout.write(s + "\\n");
        const ack = () => new Promise(resolve => process.stdin.once("data", () => resolve()));
        // The worker lives until the parent answers. It keeps its stream and never destroys it.
        const worker = new Worker(
          'const { parentPort } = require("node:worker_threads"); const stream = globalThis.stream = new (require("node:tty").ReadStream)(0); stream.setRawMode(true); parentPort.once("message", () => {}); parentPort.postMessage(stream.isRaw);',
          { eval: true },
        );
        worker.once("message", async isRaw => {
          say("P1 " + isRaw); await ack();
          worker.postMessage("end");
        });
        worker.once("exit", async () => {
          say("P2"); await ack();
          process.exit(0);
        });
      `,
      [
        terminal => {
          observed.whileTheWorkerLives = isRaw(terminal);
          terminal.write("\n");
        },
        terminal => {
          observed.afterTheWorkerEnded = isRaw(terminal);
          terminal.write("\n");
        },
      ],
      { markers: ["P1 true", "P2"] },
    );
    expect(observed).toEqual({ whileTheWorkerLives: true, afterTheWorkerEnded: false });
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
  async function runFixture(end: "destroy" | "hangup" | "last words", written = ["one", "two"]) {
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
            proc.stdin.write("destroy\n");
            proc.stdin.end();
          }
        }
      }
    }
    const [, exitCode] = await Promise.all([stderr, proc.exited]);
    expect(lines).toEqual([`WRITTEN ok bytesWritten=${size}`, "CLOSE destroyed=true masterOpen=false"]);
    expect(await read).toBe(`${size} ${createHash("sha256").update(Buffer.alloc(size, fill)).digest("hex")}\n`);
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

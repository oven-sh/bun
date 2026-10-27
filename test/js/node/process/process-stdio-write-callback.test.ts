import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";
import { childStdinRow, sequences } from "./process-stdio-write-callback-fixture.js";

// process.stdout, process.stderr and child.stdin hand each chunk to their sink inside
// write(). The callback of a write must still run after write() returned, and the callbacks
// must run in the order of the writes. Node's output for each script is the expected value.

// Every test starts a child that loads the stream modules, which takes seconds in a
// debug or ASAN build. That many at once run past the test timeout.
const concurrent = !(isASAN || isDebug);

// The stream that carries a report can also carry ASAN or debug output before it.
const lastLine = (text: string) => text.trim().split("\n").at(-1) ?? "";

async function run(script: string, stdout: "pipe" | number = "pipe", stderr: "pipe" | number = "pipe") {
  await using proc = spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdin: "ignore", stdout, stderr });
  const [out, err, exitCode] = await Promise.all([
    stdout === "pipe" ? (proc.stdout as ReadableStream<Uint8Array>).text() : "",
    stderr === "pipe" ? (proc.stderr as ReadableStream<Uint8Array>).text() : "",
    proc.exited,
  ]);
  return { out, err, exitCode };
}

describe("process.stdout and process.stderr write callbacks", () => {
  // `write("")` is here because the sink never sees an empty chunk.
  const insideWrite = (which: "stdout" | "stderr") => `
    const out = process.${which};
    const report = process.${which === "stdout" ? "stderr" : "stdout"};
    const events = [];
    let inside = true;
    out.write("A", () => events.push(inside ? "inside write()" : "after write()"));
    out.write("", () => events.push(inside ? "inside write()" : "after write()"));
    inside = false;
    events.push("write() returned");
    setImmediate(() => report.write(JSON.stringify(events) + "\\n"));`;
  const afterWrite = ["write() returned", "after write()", "after write()"];

  for (const which of ["stdout", "stderr"] as const) {
    test.concurrentIf(concurrent)(`process.${which} on a pipe: no callback runs inside write()`, async () => {
      const { out, err, exitCode } = await run(insideWrite(which));
      expect(JSON.parse(lastLine(which === "stdout" ? err : out))).toEqual(afterWrite);
      expect(exitCode).toBe(0);
    });
  }

  test.concurrentIf(concurrent)("process.stdout on a file: no callback runs inside write()", async () => {
    using dir = tempDir("stdio-write-callback-file", {});
    const fd = fs.openSync(path.join(String(dir), "out.txt"), "w");
    try {
      const { err, exitCode } = await run(insideWrite("stdout"), fd);
      expect(JSON.parse(lastLine(err))).toEqual(afterWrite);
      expect(exitCode).toBe(0);
    } finally {
      fs.closeSync(fd);
    }
  });

  // readline reports a cursor move that moves nothing from process.nextTick(). A write
  // callback that runs inside write() comes before it whatever the call order was.
  test.concurrentIf(concurrent)("write and readline cursor callbacks run in call order", async () => {
    const { out, err, exitCode } = await run(`
      const readline = require("node:readline");
      const order = [];
      let pending = 5;
      const done = name => {
        order.push(name);
        if (--pending === 0) process.stderr.write(order.join(",") + "\\n");
      };
      process.stdout.write("A", () => done("w1"));
      readline.moveCursor(process.stdout, 0, 0, () => done("m0"));
      process.stdout.write("B", () => done("w2"));
      readline.cursorTo(process.stdout, 3, undefined, () => done("c"));
      readline.moveCursor(process.stdout, 1, 0, () => done("m1"));`);
    // cursorTo(3) writes CSI 4G and moveCursor(1, 0) writes CSI 1C.
    expect({ out, order: lastLine(err), exitCode }).toEqual({
      out: "AB\x1b[4G\x1b[1C",
      order: "w1,m0,w2,c,m1",
      exitCode: 0,
    });
  });

  // Writable reports consecutive writes that pass the same function from one tick. A
  // tick queued between those writes comes after all of them.
  test.concurrentIf(concurrent)("consecutive writes with the same callback share a tick", async () => {
    const { err, exitCode } = await run(`
      const events = [];
      const w = () => events.push("w");
      process.stdout.write("a", w);
      process.nextTick(() => events.push("t1"));
      process.stdout.write("b", w);
      process.nextTick(() => events.push("t2"));
      process.stdout.write("c", () => events.push("x"));
      process.stdout.write("d", w);
      setImmediate(() => process.stderr.write(JSON.stringify(events) + "\\n"));`);
    expect(JSON.parse(lastLine(err))).toEqual(["w", "w", "t1", "t2", "x", "w"]);
    expect(exitCode).toBe(0);
  });

  // "a" fits in the pipe. 1 MiB does not, so the sink holds that write until the test has
  // read the pipe.
  for (const [what, chunk] of [
    ["the sink took at once", `"a"`],
    ["the sink held", `Buffer.alloc(1 << 20, "a")`],
  ]) {
    test.concurrentIf(concurrent)(
      `a throw from the callback of a write that ${what} is an uncaught exception, and later callbacks run`,
      async () => {
        const { err, exitCode } = await run(`
          const events = [];
          process.on("uncaughtException", e => events.push("uncaughtException:" + e.message));
          process.on("unhandledRejection", e => events.push("unhandledRejection:" + e.message));
          try {
            process.stdout.write(${chunk}, () => {
              events.push("w1");
              throw new Error("boom");
            });
          } catch (e) {
            events.push("write() threw:" + e.message);
          }
          process.stdout.write("b", () => {
            events.push("w2");
            process.stderr.write(JSON.stringify(events) + "\\n");
          });`);
        expect(JSON.parse(lastLine(err))).toEqual(["w1", "uncaughtException:boom", "w2"]);
        expect(exitCode).toBe(0);
      },
    );
  }

  // With the callback inside write(), each turn of such a loop ran one frame deeper, and
  // a long loop ended in "RangeError: Maximum call stack size exceeded".
  test.concurrentIf(concurrent)("a write(chunk, next) loop does not nest", async () => {
    const { out, err, exitCode } = await run(`
      let depth = 0, maxDepth = 0, n = 0;
      function next(error) {
        if (error) throw error;
        depth++;
        if (depth > maxDepth) maxDepth = depth;
        if (++n < 1000) process.stdout.write("x", next);
        else process.stderr.write(JSON.stringify({ n, maxDepth }) + "\\n");
        depth--;
      }
      next();`);
    expect({ report: JSON.parse(lastLine(err)), bytes: out.length, exitCode }).toEqual({
      report: { n: 1000, maxDepth: 1 },
      bytes: 999,
      exitCode: 0,
    });
  });

  // How mocha --exit and others flush stdout: exit from the callback of a last, empty
  // write. 1 MiB is more than a pipe holds, so the first write is still pending then.
  test.concurrentIf(concurrent)("write(data); write('', () => process.exit()) delivers all of data", async () => {
    const { out, exitCode } = await run(`
      process.stdout.write(Buffer.alloc(1 << 20, "A"));
      process.stdout.write("", () => process.exit(0));`);
    expect({ bytes: out.length, exitCode }).toEqual({ bytes: 1 << 20, exitCode: 0 });
  });

  // Node emits 'drain' when its buffer is empty again: once for all the writes it held.
  // 1 MiB is more than a pipe holds, so the sink holds both writes. On Windows the sink of
  // process.stdout writes synchronously and holds nothing.
  test.skipIf(isWindows).concurrentIf(concurrent)("writes that the sink holds together emit 'drain' once", async () => {
    const { out, err, exitCode } = await run(`
      let drains = 0;
      process.stdout.on("drain", () => drains++);
      process.stdout.write(Buffer.alloc(1 << 20, "a"));
      process.stdout.write(Buffer.alloc(1 << 20, "b"), () =>
        setImmediate(() => process.stderr.write(JSON.stringify({ drains }) + "\\n")),
      );`);
    expect({ report: JSON.parse(lastLine(err)), bytes: out.length, exitCode }).toEqual({
      report: { drains: 1 },
      bytes: 2 << 20,
      exitCode: 0,
    });
  });

  // end(chunk) and code that calls Writable.prototype.write() reach the sink through
  // _write(). Here that chunk waits in Writable behind the held write, and the write()
  // after it must not pass it. It passes without the ordering of write callbacks too.
  test.concurrentIf(concurrent)("write() after Writable.prototype.write() keeps the bytes in call order", async () => {
    const { out, exitCode } = await run(`
      const { Writable } = require("node:stream");
      process.stdout.write(Buffer.alloc(1 << 20, "a"), () => {});
      Writable.prototype.write.call(process.stdout, "B");
      process.stdout.write("C");`);
    expect({ bytes: out.length, end: out.slice(-2), exitCode }).toEqual({
      bytes: (1 << 20) + 2,
      end: "BC",
      exitCode: 0,
    });
  });

  // Passes without the ordering of write callbacks too. It is here so that it stays
  // that way: the end callback runs when a write after end() errors the stream.
  test.concurrentIf(concurrent)("the end callback still runs when a write follows end() (file)", async () => {
    using dir = tempDir("stdio-write-callback-after-end", {});
    const fd = fs.openSync(path.join(String(dir), "out.txt"), "w");
    try {
      const { err, exitCode } = await run(
        `
        const code = e => (e == null ? null : e.code);
        const events = [];
        process.stdout.on("error", e => events.push("error:" + code(e)));
        process.stdout.write("A", e => events.push("w1:" + code(e)));
        process.stdout.end("B", e => events.push("end:" + code(e)));
        process.stdout.write("C", e => events.push("w2:" + code(e)));
        setImmediate(() => setImmediate(() => process.stderr.write(JSON.stringify(events) + "\\n")));`,
        fd,
      );
      expect(JSON.parse(lastLine(err))).toEqual([
        "w1:null",
        "w2:ERR_STREAM_WRITE_AFTER_END",
        "end:ERR_STREAM_DESTROYED",
        "error:ERR_STREAM_WRITE_AFTER_END",
      ]);
      expect(exitCode).toBe(0);
    } finally {
      fs.closeSync(fd);
    }
  });
});

// Every row of the contract is a stream, the state of its pipe and a sequence of calls.
// The fixture says what each of them is, and how to get Node's report for a row.
describe("the write callback contract", () => {
  const fixture = path.join(import.meta.dir, "process-stdio-write-callback-fixture.js");
  const table: Record<string, { callbacks: string[]; states?: string[]; namesOnly?: boolean }> = sequences;
  const states = ["idle", "parked", "failing", "broken"] as const;
  const rows = states.flatMap(state =>
    Object.keys(table)
      .filter(sequence => (table[sequence].states ?? ["idle", "parked", "failing"]).includes(state))
      // Node itself does not settle what a failing pipe and destroy() report together.
      .filter(sequence => !(state === "failing" && sequence.includes("destroy()")))
      .map(sequence => [state, sequence] as const),
  );

  function expectReport(state: string, sequence: string, report: string[]) {
    const { callbacks, namesOnly } = table[sequence];
    if (namesOnly) {
      // What is left of the contract: each write callback runs once, in order, after the
      // calls. destroy() does not owe the end() callback.
      const writes = report.filter(entry => !/^(end|finish|error)\b/.test(entry)).map(entry => entry.split(":")[0]);
      expect(writes).toEqual(callbacks.filter(name => name !== "end"));
    } else if (state === "failing" || state === "broken") {
      // EPIPE on POSIX. Whatever the platform calls it, every callback gets the same one.
      const code = report[0]?.split(":")[1];
      expect(code).toMatch(/^E[A-Z]+$/);
      expect(report).toEqual([...callbacks.map(name => `${name}:${code}`), `error:${code}`]);
    } else {
      expect(report).toEqual(sequence.includes("end(") ? [...callbacks, "finish"] : callbacks);
    }
  }

  // On Windows one uv_write takes the whole chunk and the sink holds nothing, so a write
  // has reported before its pipe fails. Those rows say nothing there. A row on a pipe that
  // the child closed before the calls does not finish there.
  const posixOnly = ["failing", "broken"];
  describe.each(rows.filter(([state]) => !(isWindows && posixOnly.includes(state))))(
    "child.stdin, %s: %s",
    (state, sequence) => {
      test.concurrentIf(concurrent)("reports as Node does", async () => {
        expectReport(state, sequence, await childStdinRow(state, sequence, bunExe(), bunEnv));
      });
    },
  );

  // A FIFO is the one kind of pipe that a process can read by itself, which lets the
  // fixture decide when the pipe has room. process.stderr runs the same code, so it runs
  // one sequence.
  describe
    .skipIf(isWindows)
    .each([
      ...rows.map(row => ["stdout", ...row] as const),
      ...states.map(state => ["stderr", state, "write x3"] as const),
    ])("process.%s, %s: %s", (which, state, sequence) => {
    test.concurrentIf(concurrent)("reports as Node does", async () => {
      using dir = tempDir("stdio-write-callback-fifo", {});
      const fifo = path.join(String(dir), "fifo");
      expect(spawnSync({ cmd: ["mkfifo", fifo] }).exitCode).toBe(0);

      // Opened for reading first so that the open for writing does not block.
      const readFd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
      const writeFd = fs.openSync(fifo, fs.constants.O_WRONLY);
      let proc;
      try {
        proc = spawn({
          cmd: [bunExe(), fixture, which, state, sequence],
          env: { ...bunEnv, BUN_TEST_FIFO: fifo },
          stdin: "ignore",
          stdout: which === "stdout" ? writeFd : "pipe",
          stderr: which === "stderr" ? writeFd : "pipe",
        });
      } finally {
        // The fixture is the only reader and the only writer from here on.
        fs.closeSync(writeFd);
        fs.closeSync(readFd);
      }
      await using _ = proc;
      const output = (which === "stdout" ? proc.stderr : proc.stdout) as ReadableStream<Uint8Array>;
      const [text, exitCode] = await Promise.all([output.text(), proc.exited]);
      expectReport(state, sequence, JSON.parse(lastLine(text)));
      expect(exitCode).toBe(0);
    });
  });

  // The loop that every consumer of a stream writes: wait for 'drain' after a write that
  // returned false. It passes without the ordering of write callbacks too. It is here so
  // that it stays that way.
  for (const callback of [true, false]) {
    test.concurrentIf(concurrent)(
      `a write and wait for 'drain' loop completes ${callback ? "with" : "without"} write callbacks`,
      async () => {
        const { out, err, exitCode } = await run(`
          const { once } = require("node:events");
          const chunk = Buffer.alloc(64 * 1024, "a");
          let callbacks = 0, outOfOrder = 0, last = -1;
          (async () => {
            for (let i = 0; i < 200; i++) {
              const onWrite = err => {
                if (err) throw err;
                if (i !== last + 1) outOfOrder++;
                last = i;
                callbacks++;
              };
              if (!process.stdout.write(chunk, ${callback ? "onWrite" : "undefined"})) await once(process.stdout, "drain");
            }
            process.stdout.end(() => process.stderr.write(JSON.stringify({ callbacks, outOfOrder }) + "\\n"));
          })();`);
        expect({ report: JSON.parse(lastLine(err)), bytes: out.length, exitCode }).toEqual({
          report: { callbacks: callback ? 200 : 0, outOfOrder: 0 },
          bytes: 200 * 64 * 1024,
          exitCode: 0,
        });
      },
    );
  }
});

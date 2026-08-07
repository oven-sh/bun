import { spawn, spawnSync } from "bun";
import { cc, ptr } from "bun:ffi";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isPosix, tempDirWithFiles } from "harness";
import { closeSync, readSync } from "node:fs";
import path from "path";
import { isatty } from "tty";
describe.concurrent("process-stdio", () => {
  test("process.stdin", () => {
    expect(process.stdin).toBeDefined();
    expect(process.stdin.isTTY).toBe(isatty(0) ? true : undefined);
    expect(process.stdin.on("close", function () {})).toBe(process.stdin);
    expect(process.stdin.once("end", function () {})).toBe(process.stdin);
  });

  const files = {
    echo: path.join(import.meta.dir, "process-stdin-echo.js"),
  };

  test("process.stdin - read", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo],
      stdout: "pipe",
      stdin: "pipe",
      stderr: "inherit",
      env: {
        ...bunEnv,
      },
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe(lines.join("\n") + "ENDED");
  });

  test("process.stdin - resume", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo, "resume"],
      stdout: "pipe",
      stdin: "pipe",
      stderr: null,
      env: bunEnv,
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe("RESUMED" + lines.join("\n") + "ENDED");
  });

  test("process.stdin - close(#6713)", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo, "close-event"],
      stdout: "pipe",
      stdin: "pipe",
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe(lines.join("\n") + "ENDED-CLOSE");
  });

  test("process.stdout", () => {
    expect(process.stdout).toBeDefined();
    // isTTY returns true or undefined in Node.js
    expect(process.stdout.isTTY).toBe((isatty(1) || undefined) as any);
  });

  test("process.stderr", () => {
    expect(process.stderr).toBeDefined();
    // isTTY returns true or undefined in Node.js
    expect(process.stderr.isTTY).toBe((isatty(2) || undefined) as any);
  });

  test("process.stdout - write", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });

    expect(stdout?.toString()).toBe(`hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`);
  });

  test("process.stdout - write a lot (string)", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance-a-lot.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
        TEST_STDIO_STRING: "1",
      },
    });

    expect(stdout?.toString()).toBe(
      `hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`.repeat(9999),
    );
  });

  test("process.stdout - write a lot (bytes)", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance-a-lot.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });
    expect(stdout?.toString()).toBe(
      `hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`.repeat(9999),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// One sink per fd: console.*, process.stdout/stderr, Bun.stdout.writer(),
// console.write and Bun.write(Bun.stdout) all go through the same per-VM stdio
// sink, so they can never reorder against each other, never drop bytes when
// the description is O_NONBLOCK, and are fully written before the process
// exits — however the reader paces itself.
// ─────────────────────────────────────────────────────────────────────────────
describe.skipIf(!isPosix).concurrent("stdio sink", () => {
  // fcntl(2) is variadic; Apple's arm64 ABI passes variadic args on the stack,
  // so a fixed-arity dlopen binding gets F_SETFL wrong there. Compile tiny
  // non-variadic wrappers instead (shared with the spawned children).
  const dir = tempDirWithFiles("stdio-sink", {
    "fdutil.c": `
#include <fcntl.h>
#include <unistd.h>
int fd_is_nonblock(int fd) { int fl = fcntl(fd, F_GETFL); return fl >= 0 && (fl & O_NONBLOCK) != 0; }
int fd_set_nonblock(int fd, int on) { int fl = fcntl(fd, F_GETFL); if (fl < 0) return fl; return fcntl(fd, F_SETFL, on ? (fl | O_NONBLOCK) : (fl & ~O_NONBLOCK)); }
int fd_pipe(int* fds) { return pipe(fds); }
`,
  });
  const fdutil = path.join(dir, "fdutil.c");
  const prelude = `
const { fd_is_nonblock, fd_set_nonblock } = require("bun:ffi").cc({
  source: ${JSON.stringify(fdutil)},
  symbols: {
    fd_is_nonblock: { args: ["int"], returns: "int" },
    fd_set_nonblock: { args: ["int", "int"], returns: "int" },
  },
}).symbols;
const nonblock = fd => fd_is_nonblock(fd) !== 0;
`;
  const { fd_pipe, fd_set_nonblock } = cc({
    source: fdutil,
    symbols: {
      fd_pipe: { args: ["ptr"], returns: "int" },
      fd_set_nonblock: { args: ["int", "int"], returns: "int" },
    },
  }).symbols;

  /**
   * Run `src` in a child whose stdout is the write end of a raw pipe(2) that
   * only this function reads, a small slice at a time, so a child writing more
   * than the pipe holds is queued behind us for most of its life. (Tests that
   * need proof of backpressure assert on `write()`'s return value.)
   * `Bun.spawn({ stdout: "pipe" })` can't do this: it drains the child eagerly
   * into memory. Returns everything the child wrote to fd 1, its stderr, and
   * its exit code.
   */
  async function runWithSlowStdout(src: string, opts: { env?: Record<string, string> } = {}) {
    const fds = new Int32Array(2);
    expect(fd_pipe(ptr(fds))).toBe(0);
    const [r, w] = fds;
    fd_set_nonblock(r, 1);
    let wClosed = false;
    try {
      const proc = spawn({
        cmd: [bunExe(), "-e", prelude + src],
        env: { ...bunEnv, ...opts.env },
        stdio: ["ignore", w, "pipe"],
      });
      closeSync(w);
      wClosed = true;
      let exited = false;
      const exitedP = proc.exited.then(code => ((exited = true), code));
      const stderrP = proc.stderr.text();

      const chunks: Buffer[] = [];
      const slice = Buffer.alloc(16 * 1024);
      // Poll until EOF (bounded by the test timeout). Correctness never depends
      // on this pacing — only how much backpressure the child sees does.
      for (;;) {
        let n = 0;
        try {
          n = readSync(r, slice, 0, slice.length, null);
        } catch (e: any) {
          if (e?.code !== "EAGAIN") throw e;
          if (exited) {
            // Child is gone; anything left is already in the pipe.
            try {
              n = readSync(r, slice, 0, slice.length, null);
            } catch {
              break;
            }
            if (n === 0) break;
            chunks.push(Buffer.from(slice.subarray(0, n)));
            continue;
          }
          await Bun.sleep(2);
          continue;
        }
        if (n === 0) break;
        chunks.push(Buffer.from(slice.subarray(0, n)));
        await Bun.sleep(1);
      }
      const [stderr, exitCode] = await Promise.all([stderrP, exitedP]);
      return { stdout: Buffer.concat(chunks), stderr, exitCode };
    } finally {
      if (!wClosed) closeSync(w);
      closeSync(r);
    }
  }

  /** Collapse runs of a filler byte so mismatches print legibly. */
  const squash = (buf: Buffer) => buf.toString("latin1").replace(/([xyz])\1{15,}/g, (m, c) => `<${c}*${m.length}>`);

  const K256 = 256 * 1024;

  test("process.stdout.write / console.log interleaving keeps call order under pipe backpressure", async () => {
    const { stdout, stderr, exitCode } = await runWithSlowStdout(`
      const a = process.stdout.write(Buffer.alloc(${K256}, "x"));
      console.log("\\nMARK1");
      const b = process.stdout.write(Buffer.alloc(${K256}, "y"));
      console.log("\\nMARK2");
      process.stderr.write(JSON.stringify({ a, b, len: process.stdout.writableLength }));
    `);
    // write() reported backpressure (and writableLength counted the queued
    // bytes) — i.e. the sink really was backed up while console.log ran.
    expect(JSON.parse(stderr)).toEqual({ a: false, b: false, len: expect.any(Number) });
    expect(JSON.parse(stderr).len).toBeGreaterThan(0);
    expect(squash(stdout)).toBe(`<x*${K256}>\nMARK1\n<y*${K256}>\nMARK2\n`);
    expect(exitCode).toBe(0);
  });

  test("every stdout writer shares one queue: order is call order", async () => {
    // console.*, Bun.stdout.writer(), Bun.write(Bun.stdout) and console.write
    // hand their bytes to the sink directly; process.stdout.write() does too,
    // except for what its Writable is still holding after a write() returned
    // false — those chunks are behind the in-flight one *inside the stream*,
    // and console.* (being a write() on that stream, as in Node) queues behind
    // them. So: everything below is call-ordered, and the two console lines
    // issued while `y` is queued come out after `y`.
    const { stdout, stderr, exitCode } = await runWithSlowStdout(`
      const big = (c) => Buffer.alloc(${K256}, c);
      console.log("[console.log]");
      Bun.stdout.writer().write("[Bun.stdout.writer]\\n");
      await Bun.write(Bun.stdout, "[Bun.write]\\n");
      console.write("[console.write]\\n");
      process.stdout.write(big("x"));            // fills the pipe, rest queues in the sink
      console.log("\\n[after x]");             // drains the sink first, then writes
      process.stdout.write(big("y"));            // sink backed up -> held in the Writable
      console.error("(stderr is separate)");
      console.info("\\n[console.info]");       // a write() on the stream: behind y
      process.stdout.write("[end]\\n");
    `);
    expect(stderr).toBe("(stderr is separate)\n");
    expect(squash(stdout)).toBe(
      `[console.log]\n[Bun.stdout.writer]\n[Bun.write]\n[console.write]\n<x*${K256}>\n[after x]\n<y*${K256}>\n[console.info]\n[end]\n`,
    );
    expect(exitCode).toBe(0);
  });

  test.each(["process.exit(0)", "throw new Error('boom')", "/* natural */"])(
    "queued stdout is fully written before exit via %s",
    async how => {
      const { stdout, exitCode } = await runWithSlowStdout(`
        process.stdout.write(Buffer.alloc(${K256}, "x"));
        process.stdout.write(Buffer.alloc(${K256}, "y"));   // buffered in the Writable behind the first
        console.log("\\nlast console line");
        process.stdout.write("last stream line\\n");
        ${how};
      `);
      expect(squash(stdout)).toBe(`<x*${K256}><y*${K256}>\nlast console line\nlast stream line\n`);
      expect(exitCode).toBe(how.startsWith("throw") ? 1 : 0);
    },
  );

  test("an uncaught exception is printed after already-written stdout/stderr", async () => {
    const { stdout, stderr, exitCode } = await runWithSlowStdout(`
      process.stdout.write(Buffer.alloc(${K256}, "x"));
      process.stderr.write("before\\n");
      throw new Error("boom");
    `);
    expect(squash(stdout)).toBe(`<x*${K256}>`);
    expect(stderr.startsWith("before\n")).toBe(true);
    expect(stderr).toContain("error: boom");
    expect(exitCode).toBe(1);
  });

  test("materialising process.stdout / process.stderr does not touch fd flags of a tty/file, and stdio-inheriting children get blocking fds", async () => {
    // stdout here is a pipe: Bun may make *its* description non-blocking
    // (that is how a slow reader queues instead of stalling the loop), but a
    // child handed the fd must see it blocking, and stderr (a file below)
    // must never be touched.
    const errPath = path.join(tempDirWithFiles("stdio-sink-err", { "err.txt": "" }), "err.txt");
    const { stdout, exitCode } = await runWithSlowStdout(
      `
      const fs = require("node:fs");
      const errfd = fs.openSync(${JSON.stringify(errPath)}, "w");
      const before = { out: nonblock(1), file: nonblock(errfd) };
      void process.stdout; void process.stderr;
      process.stdout.write("x");
      const after = { file: nonblock(errfd) };
      // A child that inherits fd 1 must find it blocking regardless.
      const child = Bun.spawnSync([process.execPath, "-e", ${JSON.stringify(prelude + `process.stderr.write(String(nonblock(1)))`)}], { stdio: ["ignore", "inherit", "pipe"], env: process.env });
      console.log(JSON.stringify({ before, after, childSeesNonblock: child.stderr.toString() }));
    `,
    );
    const line = stdout.toString().trim().split("\n").pop()!;
    expect(JSON.parse(line.replace(/^x/, ""))).toEqual({
      before: { out: false, file: false },
      after: { file: false },
      childSeesNonblock: "false",
    });
    expect(exitCode).toBe(0);
  });

  test("console.log delivers every byte when something else made fd 1 O_NONBLOCK and the pipe is full", async () => {
    const { stdout, stderr, exitCode } = await runWithSlowStdout(`
      const fs = require("node:fs");
      fd_set_nonblock(1, 1);
      // Fill the pipe until the kernel refuses.
      const fill = Buffer.alloc(4096, "x");
      let filled = 0;
      for (;;) { try { filled += fs.writeSync(1, fill); } catch { break; } }
      process.stderr.write(String(filled));
      for (let i = 0; i < 10; i++) console.log("marker " + i);
    `);
    const filled = Number(stderr);
    expect(filled).toBeGreaterThan(0);
    expect(stdout.subarray(0, filled).equals(Buffer.alloc(filled, "x"))).toBe(true);
    expect(stdout.subarray(filled).toString()).toBe(Array.from({ length: 10 }, (_, i) => `marker ${i}\n`).join(""));
    expect(exitCode).toBe(0);
  });

  test("an idle Worker / worker_threads.Worker does not perturb the parent's stdio", async () => {
    const { stdout, stderr, exitCode } = await runWithSlowStdout(`
      const { Worker } = require("node:worker_threads");
      const before = [nonblock(1), nonblock(2)];
      const w = new Worker("setTimeout(() => {}, 10)", { eval: true });
      await new Promise(r => w.on("online", r));
      const during = [nonblock(1), nonblock(2)];
      await new Promise(r => w.on("exit", r));
      // and the parent's console still delivers everything afterwards
      const filler = Buffer.alloc(4000, "p").toString();
      for (let i = 0; i < 40; i++) console.log("line " + i + " " + filler);
      process.stderr.write(JSON.stringify({ before, during }));
    `);
    expect(JSON.parse(stderr)).toEqual({ before: [false, false], during: [false, false] });
    expect(stdout.toString().split("\n").filter(Boolean).length).toBe(40);
    expect(exitCode).toBe(0);
  });

  test("Bun.stdout.writer() is the shared sink: same object every time; end()/close() only flush; writes coalesce until flushed", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { spawnSync } = require("child_process");
        // A child inheriting fd 1 shows what has actually reached the fd.
        const probe = tag => spawnSync(process.execPath, ["-e", "process.stdout.write('<' + process.env.TAG + '>')"], { stdio: "inherit", env: { ...process.env, TAG: tag } });
        const a = Bun.stdout.writer(), b = Bun.stdout.writer(), c = Bun.file(1).writer();
        a.write("1 ");
        probe("before-flush");             // "1 " is still in the writer's buffer
        await a.end();
        console.log("2");
        a.close();                         // must not take stdout away from anyone
        process.stdout.write("3 ");        // process.stdout.write is a syscall now...
        probe("after-write");              // ...so the child lands after it
        b.write("4\\n");
        await b.flush();
        console.write("5\\n");
        process.stderr.write(JSON.stringify([a === b, a === c, Bun.stdout.writer() === a]));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("[true,true,true]");
    expect(stdout).toBe("<before-flush>1 2\n3 <after-write>4\n5\n");
    expect(exitCode).toBe(0);
  });

  test("FileSink.flush() / end-of-tick autoflush on a full pipe waits for the reader instead of spinning or stalling", async () => {
    const { stdout, stderr, exitCode } = await runWithSlowStdout(`
      process.stdout.write(Buffer.alloc(${K256}, "x"));      // pipe is now full, remainder queued
      const w = Bun.stdout.writer();
      w.write("\\n[coalesced]");                             // small: sits in the sink's buffer
      const flushed = await w.flush();                         // must arm the poll and wait
      w.write("\\n[autoflushed]\\n");                      // left for the end-of-tick flush
      await new Promise(r => setImmediate(r));
      process.stderr.write(JSON.stringify({ flushed: typeof flushed }));
    `);
    expect(JSON.parse(stderr)).toEqual({ flushed: "number" });
    expect(squash(stdout)).toBe(`<x*${K256}>\n[coalesced]\n[autoflushed]\n`);
    expect(exitCode).toBe(0);
  });

  test("Bun.write(Bun.stdout, x) resolves with its own byte count once written, in order, even while process.stdout is backed up", async () => {
    const { stdout, stderr, exitCode } = await runWithSlowStdout(`
      const backedUp = !process.stdout.write(Buffer.alloc(${K256}, "x"));
      const n = await Bun.write(Bun.stdout, "abc");
      const m = await Bun.write(Bun.stdout, new TextEncoder().encode("\\ndef!\\n"));
      console.log("after");
      process.stderr.write(JSON.stringify({ backedUp, n, m }));
    `);
    expect(JSON.parse(stderr)).toEqual({ backedUp: true, n: 3, m: 6 });
    expect(squash(stdout)).toBe(`<x*${K256}>abc\ndef!\nafter\n`);
    expect(exitCode).toBe(0);
  });

  test("writableLength / writableNeedDrain / cork() account for queued bytes, and 'drain' fires", async () => {
    const { stdout, stderr, exitCode } = await runWithSlowStdout(`
      const so = process.stdout;
      const facts = { hwm: so.writableHighWaterMark };
      facts.writeRet = so.write(Buffer.alloc(${K256}, "x"));
      facts.writableLength = so.writableLength;
      facts.writableNeedDrain = so.writableNeedDrain;
      so.cork();
      so.write(Buffer.alloc(1000, "y"));
      console.log("\\n(held by cork)");
      facts.corkedLength = so.writableLength;
      facts.writableCorked = so.writableCorked;
      so.uncork();
      so.once("drain", () => {
        facts.drained = { writableLength: so.writableLength, writableNeedDrain: so.writableNeedDrain };
        process.stderr.write(JSON.stringify(facts));
      });
    `);
    expect(JSON.parse(stderr)).toEqual({
      hwm: 65536,
      writeRet: false,
      writableLength: K256,
      writableNeedDrain: true,
      // 1000 corked bytes + "\\n(held by cork)\\n" (16) queued *behind* them
      corkedLength: K256 + 1000 + 16,
      writableCorked: 1,
      drained: { writableLength: 0, writableNeedDrain: false },
    });
    expect(squash(stdout)).toBe(`<x*${K256}><y*1000>\n(held by cork)\n`);
    expect(exitCode).toBe(0);
  });

  test("process.stdout.write() is inherited from the prototype (no own write), decodes its encoding argument", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        process.stdout.write("48490a", "hex");
        process.stdout.write("QUJD", "base64");
        process.stdout.setDefaultEncoding("hex");
        process.stdout.write("21");
        process.stderr.write(JSON.stringify({
          own: Object.prototype.hasOwnProperty.call(process.stdout, "write"),
          proto: process.stdout.write === Object.getPrototypeOf(process.stdout).write,
        }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stderr)).toEqual({ own: false, proto: true });
    expect(stdout).toBe("HI\nABC!");
    expect(exitCode).toBe(0);
  });

  test("write after end(): the sync write is ERR_STREAM_WRITE_AFTER_END; after finish the stream is undestroyed and writable again (Node file-stdio semantics)", async () => {
    // https://github.com/nodejs/node/blob/v24.0.0/lib/internal/bootstrap/switches/is_main_thread.js#L114-L128
    // (dummyDestroy -> _undestroy). Over a pipe Node additionally shuts the
    // socket down so later writes EPIPE; Bun keeps fd 1 open (pre-existing,
    // deliberate) so it behaves like Node's file case everywhere.
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        process.stdout.on("error", e => process.stderr.write("[" + e.code + "]"));
        process.stdout.write("A");
        process.stdout.end("B");
        process.stdout.write("C");             // still ending -> ERR_STREAM_WRITE_AFTER_END ...
        console.log("D");                      // ... whose errorOrDestroy -> _destroy -> _undestroy() already made it writable again
        setImmediate(() => {
          process.stdout.write("E");
          console.log("F");
          process.stderr.write("[done]");
        });
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("[ERR_STREAM_WRITE_AFTER_END][done]");
    expect(stdout).toBe("ABD\nEF\n");
    expect(exitCode).toBe(0);
  });

  describe("EPIPE", () => {
    // stdout's reader goes away before we write. Node: each failed write emits
    // 'error' on process.stdout (code EPIPE, syscall write) when listened to;
    // console.* never throws. Without a listener a failing process.stdout.write
    // is an uncaught 'error'; a failing console.log stays silent (Bun keeps the
    // process alive on uncaught errors, so it must not print one per call).
    async function run(which: "console.log" | "process.stdout.write", listen: boolean) {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          ${listen ? `process.stdout.on("error", e => process.stderr.write("[" + e.code + "/" + e.syscall + "]"));` : ""}
          process.on("exit", c => process.stderr.write("[exit " + c + "]"));
          // Wait until the parent has closed our stdout.
          const buf = Buffer.alloc(1);
          require("node:fs").readSync(0, buf, 0, 1, null);
          // One write per event-loop turn: an 'error' is delivered per turn
          // (destroy -> nextTick emit -> _undestroy), in Node and here alike;
          // several failing writes inside one tick coalesce into one 'error'.
          for (let i = 0; i < 3; i++) {
            ${which}("x" + i + "\\n");
            await new Promise(r => setImmediate(r));
          }
          `,
        ],
        env: bunEnv,
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });
      // Drop the read end, then let the child go.
      await proc.stdout.cancel();
      proc.stdin.write("g");
      await proc.stdin.end();
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      return { stderr, exitCode };
    }

    test("console.log with an 'error' listener: one 'error' per call, exit 0", async () => {
      expect(await run("console.log", true)).toEqual({
        stderr: "[EPIPE/write][EPIPE/write][EPIPE/write][exit 0]",
        exitCode: 0,
      });
    });
    test("process.stdout.write with an 'error' listener: one 'error' per call, exit 0", async () => {
      expect(await run("process.stdout.write", true)).toEqual({
        stderr: "[EPIPE/write][EPIPE/write][EPIPE/write][exit 0]",
        exitCode: 0,
      });
    });
    test("console.log without a listener is silent", async () => {
      expect(await run("console.log", false)).toEqual({ stderr: "[exit 0]", exitCode: 0 });
    });
    test("process.stdout.write without a listener: one uncaught EPIPE, exit 1", async () => {
      const { stderr, exitCode } = await run("process.stdout.write", false);
      expect(stderr.match(/EPIPE: broken pipe, write/g)?.length).toBe(1);
      expect(stderr).toContain("[exit 1]");
      expect(exitCode).toBe(1);
    });
  });
});

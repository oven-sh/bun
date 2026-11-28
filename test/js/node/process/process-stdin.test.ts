import { createSocketPair } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { exec, spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Writable } from "node:stream";

test.concurrent("pipe does the right thing", async () => {
  // Note: Bun.spawnSync uses memfd_create on Linux for pipe, which means we see
  // it as a file instead of a tty
  const result = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(typeof process.stdin.ref)"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
    env: bunEnv,
  });

  expect((await new Response(result.stdout).text()).trim()).toBe("function");
  expect(await result.exited).toBe(0);
});

test.concurrent("file does the right thing", async () => {
  const result = Bun.spawn({
    cmd: [bunExe(), "-e", "console.log(typeof process.stdin.ref)"],
    stdin: Bun.file(import.meta.path),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  expect(await result.stdout.text()).toMatchInlineSnapshot(`
    "undefined
    "
  `);
  expect(await result.stderr.text()).toMatchInlineSnapshot(`""`);
  expect(await result.exited).toBe(0);
});

test.concurrent("reading a file stdin to the end leaves fd 0 open", async () => {
  // Bun destroys stdin after 'end'. That must not close the process's fd 0, or
  // the next open() reuses it and children no longer inherit the real stdin.
  const script = `
    const fs = require("fs");
    process.stdin.on("data", () => {});
    process.stdin.on("close", () => {
      setTimeout(() => {
        fs.fstatSync(0);
        const fd = fs.openSync(process.execPath, "r");
        console.log(fd === 0 ? "fd 0 reused" : "fd 0 kept");
      }, 10);
    });
  `;
  const result = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    stdin: Bun.file(import.meta.path),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([result.stdout.text(), result.stderr.text(), result.exited]);
  expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "fd 0 kept", stderr: "" });
  expect(exitCode).toBe(0);
});

test.concurrent("stdin with 'readable' event handler should receive data when paused", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const chunks = [];
      const handleReadable = () => {
        let chunk;
        while ((chunk = process.stdin.read())) {
          chunks.push(chunk);
        }
      };
      
      process.stdin.on("readable", handleReadable);
      process.stdin.pause();
      
      setTimeout(() => {
        console.log("got", JSON.stringify(Buffer.concat(chunks)));
        process.exit(1);
      }, 1000);
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  proc.stdin.write("abc\n");
  proc.stdin.write("def\n");
  proc.stdin.end();

  await proc.exited;

  expect(await proc.stdout.text()).toMatchInlineSnapshot(`
    "got {"type":"Buffer","data":[97,98,99,10,100,101,102,10]}
    "
  `);
  expect(await proc.stderr.text()).toMatchInlineSnapshot(`""`);
  expect(proc.exitCode).toBe(1);
});

test.concurrent("stdin with 'data' event handler should NOT receive data when paused", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const handleData = chunk => {
        console.log("got chunk");
      };
      
      process.stdin.on("data", handleData);
      process.stdin.pause();
      
      setTimeout(() => {
        process.exit(1);
      }, 1000);
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  proc.stdin.write("abc\n");
  proc.stdin.write("def\n");
  proc.stdin.end();

  const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

  expect(stdout).toMatchInlineSnapshot(`""`);
  expect(await proc.stderr.text()).toMatchInlineSnapshot(`""`);
  // Reusing the already-consumed stdout stream now rejects (the stream is disturbed).
  await expect(proc.stdout.text()).rejects.toThrow("ReadableStream has already been used");
  expect(exitCode).toBe(1);
});

// Drains the child; its stderr joins the comparison only when it failed, so a
// crash shows up in the diff without asserting stderr empty on success (debug
// builds write benign noise there).
type StdioResult = { stdout: string; exitCode: number; stderr?: string };
async function stdioResult(proc: Bun.Subprocess<"pipe", "pipe", "pipe">): Promise<StdioResult> {
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, exitCode, stderr: exitCode === 0 ? undefined : stderr };
}

test.concurrent("paused mode read(n) returns the buffered remainder at EOF", async () => {
  // 8 bytes pulled 3 at a time: the final read(3) must return the 2 byte tail
  // once EOF is reached, and 'end' must mark readableEnded.
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const chunks = [];
      process.stdin.on("readable", () => {
        let chunk;
        while ((chunk = process.stdin.read(3)) !== null) chunks.push(chunk.toString());
      });
      process.stdin.on("end", () => {
        console.log(JSON.stringify({ chunks, readableEnded: process.stdin.readableEnded }));
      });`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("abcdefgh");
  proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({
    stdout: JSON.stringify({ chunks: ["abc", "def", "gh"], readableEnded: true }) + "\n",
    exitCode: 0,
  });
});

test.concurrent("explicit read(n) with no 'readable' listener still pulls from stdin", async () => {
  // read() must start the underlying stdin reader even when no 'readable'
  // listener or resume() ever ran.
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const chunks = [];
      process.stdin.on("end", () => {
        console.log(JSON.stringify({ chunks, readableEnded: process.stdin.readableEnded }));
      });
      const deadline = Date.now() + 4000;
      function poll() {
        let chunk;
        while ((chunk = process.stdin.read(3)) !== null) chunks.push(chunk.toString());
        if (process.stdin.readableEnded) return;
        // Bounded so a regression fails with output instead of spinning forever.
        if (Date.now() > deadline) {
          console.log(JSON.stringify({ chunks, readableEnded: false }));
          process.exit(1);
        }
        setImmediate(poll);
      }
      poll();`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("abcdefgh");
  proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({
    stdout: JSON.stringify({ chunks: ["abc", "def", "gh"], readableEnded: true }) + "\n",
    exitCode: 0,
  });
});

test.concurrent("a read() that throws does not keep the process alive", async () => {
  // stdin stays open for the child's whole lifetime: it only exits if the
  // failed read did not start (and ref) the native stdin reader.
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let code = "";
      try {
        process.stdin.read(2 ** 31);
      } catch (err) {
        code = err.code;
      }
      process.on("exit", () => console.log(code));`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const result = await stdioResult(proc);
  proc.stdin.end();
  expect(result).toEqual({ stdout: "ERR_OUT_OF_RANGE\n", exitCode: 0 });
});

test.concurrent("touching stdin again after 'end' does not keep the process alive", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `process.stdin.on("data", () => {});
      process.stdin.on("end", () => {
        console.log("END");
        process.stdin.resume();
        process.stdin.ref();
        process.stdin.on("readable", () => {});
      });
      process.on("exit", () => console.log("EXIT"));`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("abcdefgh");
  proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({ stdout: "END\nEXIT\n", exitCode: 0 });
});

test.concurrent("resume() after 'end' does not reset readableEnded", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const stdin = process.stdin;
      let ends = 0;
      stdin.on("data", () => {});
      stdin.on("end", () => {
        ends++;
        stdin.pause();
        stdin.resume();
        // One macrotask later the 'resume' event has run.
        setImmediate(() => {
          console.log(JSON.stringify({ ends, readableEnded: stdin.readableEnded, destroyed: stdin.destroyed }));
        });
      });`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("abcdefgh");
  proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({
    stdout: JSON.stringify({ ends: 1, readableEnded: true, destroyed: true }) + "\n",
    exitCode: 0,
  });
});

test.concurrent("'end' is not emitted when the buffer is never drained, and the process still exits", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `process.stdin.on("readable", () => {});
      process.stdin.on("end", () => console.log("END"));
      process.on("exit", () => console.log("EXIT " + process.stdin.readableLength));`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("abcdefgh");
  proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({ stdout: "EXIT 8\n", exitCode: 0 });
});

test.concurrent("resuming after EOF is buffered behind unread data still delivers the data and 'end'", async () => {
  // The child reads nothing until push(null) has run, then switches to flowing mode.
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const stdin = process.stdin;
      const result = { buffered: 0, data: "", end: false };
      stdin.on("readable", function onReadable() {
        // EOF always emits 'readable'.
        if (!stdin._readableState.ended) return;
        result.buffered = stdin.readableLength;
        stdin.removeListener("readable", onReadable);
        stdin.on("data", chunk => (result.data += chunk));
        stdin.on("end", () => (result.end = true));
      });
      process.on("exit", () => console.log(JSON.stringify({ ...result, readableEnded: stdin.readableEnded })));`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("abcdefgh");
  proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({
    stdout: JSON.stringify({ buffered: 8, data: "abcdefgh", end: true, readableEnded: true }) + "\n",
    exitCode: 0,
  });
});

// The same state as a consumer that pauses in 'data' reaches it, in flowing mode only.
// The chunk and EOF arrive together, 'data' pauses with a part of the chunk unread, and
// resume() comes after EOF was pushed (endedAtResume). Bun 1.3.14 emits 'end' here.
describe.skipIf(isWindows)("pause() in 'data', EOF, then resume()", () => {
  test.concurrent.each(["process.nextTick", "setImmediate"])("from %s still emits 'end'", async schedule => {
    using dir = tempDir("stdin-pause-eof", {});
    const gate = join(String(dir), "gate");
    const [childEnd, parentEnd] = createSocketPair();
    // A close() of parentEnd is not EOF while the child of a concurrent test, between fork and
    // exec, holds a copy of the descriptor. shutdown() is. The socket owns parentEnd.
    const writer = await Bun.connect({ fd: parentEnd, socket: { data() {} } } as any);
    let sent = false;
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const fs = require("node:fs");
          const stdin = process.stdin;
          const result = { data: "", endedAtResume: false, end: false };
          let first = true;
          stdin.on("data", chunk => {
            if (!first) return void (result.data += chunk);
            first = false;
            result.data += chunk.subarray(0, 4);
            stdin.pause();
            stdin.unshift(chunk.subarray(4));
            ${schedule}(() => {
              result.endedAtResume = stdin._readableState.ended;
              stdin.resume();
            });
          });
          stdin.on("end", () => (result.end = true));
          setImmediate(() => {
            // A 'resume' event leaves a second read in flight, so the chunk and EOF
            // are pushed back to back.
            stdin.pause();
            stdin.resume();
            setImmediate(() => {
              fs.writeSync(1, "READY\\n");
              // Blocks this thread until the chunk and EOF are both in the socket.
              while (!fs.existsSync(${JSON.stringify(gate)})) {}
            });
          });
          process.on("exit", () => fs.writeSync(1, JSON.stringify(result) + "\\n"));`,
        ],
        stdin: childEnd,
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
      });
      const stderr = proc.stderr.text();
      const decoder = new TextDecoder();
      let stdout = "";
      for await (const chunk of proc.stdout) {
        stdout += decoder.decode(chunk, { stream: true });
        if (!sent && stdout.includes("READY\n")) {
          sent = true;
          expect(writer.write("abcdefgh")).toBe(8);
          writer.shutdown();
          writeFileSync(gate, "");
        }
      }
      const exitCode = await proc.exited;
      const result: StdioResult = { stdout, exitCode, stderr: exitCode === 0 ? undefined : await stderr };
      expect(result).toEqual({
        stdout: "READY\n" + JSON.stringify({ data: "abcdefgh", endedAtResume: true, end: true }) + "\n",
        exitCode: 0,
      });
    } finally {
      closeSync(childEnd);
      writer.end();
    }
  });
});

// `bun filter.js < file | reader`: stdin is a file and the reader of stdout is slow. The
// reader here takes nothing until the child reports a write that met backpressure, then
// exactly what was written, so each large chunk pauses stdin. On Linux the last pause
// falls between the final chunk and EOF, and EOF is pushed behind a byte that is still
// buffered.
describe.skipIf(isWindows)("a file on stdin piped to a stdout under backpressure", () => {
  test.concurrent("pipeline() to process.stdout still emits 'end' and calls back", async () => {
    const size = 1024 * 1024 + 1;
    using dir = tempDir("stdin-file-backpressure", { "in.bin": Buffer.alloc(size, "x") });
    const [childEnd, parentEnd] = createSocketPair();
    let childEndOpen = true;
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const fs = require("node:fs");
          const { pipeline } = require("node:stream");
          const result = { callback: null, end: false };
          let written = 0;
          const write = process.stdout.write;
          process.stdout.write = function (chunk, ...rest) {
            written += chunk.length;
            const ok = write.call(this, chunk, ...rest);
            if (!ok) fs.writeSync(2, "full " + written + "\\n");
            return ok;
          };
          process.stdin.on("end", () => (result.end = true));
          pipeline(process.stdin, process.stdout, err => (result.callback = err ? err.code : "ok"));
          process.on("exit", () => fs.writeSync(2, "result " + JSON.stringify(result) + "\\n"));`,
        ],
        stdin: Bun.file(join(String(dir), "in.bin")),
        stdout: childEnd,
        stderr: "pipe",
        env: bunEnv,
      });
      closeSync(childEnd);
      childEndOpen = false;

      const buffer = Buffer.alloc(64 * 1024);
      let bytes = 0;
      // Reads the child's stdout up to `target` bytes in total, or to its end.
      async function take(target: number) {
        while (bytes < target) {
          let n: number;
          try {
            n = readSync(parentEnd, buffer, 0, Math.min(buffer.length, target - bytes), null);
          } catch (err) {
            // The socket is non-blocking: the child has not written the rest yet.
            if ((err as NodeJS.ErrnoException).code !== "EAGAIN") throw err;
            await new Promise<void>(resolve => setImmediate(resolve));
            continue;
          }
          if (n === 0) return;
          bytes += n;
        }
      }

      const decoder = new TextDecoder();
      let pending = "";
      let result: unknown;
      for await (const chunk of proc.stderr) {
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop()!;
        for (const line of lines) {
          if (line.startsWith("full ")) await take(Number(line.slice(5)));
          else if (line.startsWith("result ")) result = JSON.parse(line.slice(7));
        }
      }
      await take(Infinity);

      expect({ bytes, result, exitCode: await proc.exited }).toEqual({
        bytes: size,
        result: { callback: "ok", end: true },
        exitCode: 0,
      });
    } finally {
      if (childEndOpen) closeSync(childEnd);
      closeSync(parentEnd);
    }
  });
});

test.concurrent("stdin should allow process to exit when paused", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        process.stdin.on("data", () => {});
        process.stdin.pause();
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  await proc.exited;
  expect(await proc.stdout.text()).toMatchInlineSnapshot(`""`);
  expect(await proc.stderr.text()).toMatchInlineSnapshot(`""`);
  expect(proc.exitCode).toBe(0);
});

test.concurrent("stdin should not allow process to exit when not paused", async () => {
  const proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      process.stdin.on("data", () => {});
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  await Bun.sleep(1000);
  expect(proc.exitCode).toBe(null);
  proc.kill();
  await proc.exited;
  expect(await proc.stdout.text()).toMatchInlineSnapshot(`""`);
  expect(await proc.stderr.text()).toMatchInlineSnapshot(`""`);
});

// unref() drops stdin's hold on the event loop and ref() takes it back: after
// the pair the child has nothing else pending and must still receive every
// later byte up to EOF.
test.concurrent("stdin.ref() after unref() keeps the process alive until EOF", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      let total = 0;
      process.stdin.on("data", chunk => {
        if (total === 0) {
          process.stdin.unref();
          process.stdin.ref();
          process.stdout.write("ready\\n");
        }
        total += chunk.length;
      });
      process.stdin.on("end", () => {
        process.stdout.write("TOTAL " + total + "\\n");
      });
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  proc.stdin.write("x");
  while (!stdout.includes("ready\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += decoder.decode(value);
  }
  // The child is idle again with only stdin to wait for; these bytes must still reach it.
  const rest = Buffer.alloc(64 * 1024, "y");
  proc.stdin.write(rest);
  await proc.stdin.end();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    stdout += decoder.decode(value);
  }
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(`ready\nTOTAL ${1 + rest.length}\n`);
  expect(exitCode).toBe(0);
});

test.concurrent("a throw from a 'data' listener is an uncaughtException, and stdin keeps reading", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const seen = [];
      process.on("uncaughtException", (e, origin) => seen.push("uncaughtException:" + e.message + ":" + origin));
      process.stdin.on("error", e => seen.push("stream-error:" + e.message));
      let n = 0;
      process.stdin.on("data", d => {
        seen.push("data:" + d.toString());
        if (++n === 1) { console.log("GOT1"); throw new Error("handler-throw"); }
      });
      process.stdin.on("end", () => {
        console.log(JSON.stringify({ seen, destroyed: process.stdin.destroyed }));
      });`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("one");
  await proc.stdin.flush();
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let stdout = "";
  for (let r; !(r = await reader.read()).done;) {
    stdout += decoder.decode(r.value, { stream: true });
    if (stdout.includes("GOT1")) break;
  }
  proc.stdin.write("two");
  await proc.stdin.end();
  for (let r; !(r = await reader.read()).done;) stdout += decoder.decode(r.value, { stream: true });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode, ...(exitCode === 0 ? {} : { stderr }) }).toEqual({
    stdout:
      "GOT1\n" +
      JSON.stringify({
        seen: ["data:one", "uncaughtException:handler-throw:uncaughtException", "data:two"],
        destroyed: false,
      }) +
      "\n",
    exitCode: 0,
  });
});

test.concurrent("a throw from a 'readable' listener is an uncaughtException, including the EOF emission", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const seen = [];
      process.on("uncaughtException", e => seen.push("uncaughtException:" + e.message));
      process.stdin.on("error", e => seen.push("stream-error:" + e.message));
      let n = 0;
      process.stdin.on("readable", () => {
        n++;
        let chunk;
        while ((chunk = process.stdin.read()) !== null) seen.push("readable:" + chunk.toString());
        throw new Error("readable-throw-" + n);
      });
      process.stdin.on("end", () => seen.push("end"));
      process.on("exit", () => console.log(JSON.stringify(seen)));`,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  proc.stdin.write("hello");
  await proc.stdin.end();

  expect(await stdioResult(proc)).toEqual({
    stdout:
      JSON.stringify([
        "readable:hello",
        "uncaughtException:readable-throw-1",
        "end",
        "uncaughtException:readable-throw-2",
      ]) + "\n",
    exitCode: 0,
  });
});

test.concurrent("pause() and resume() churn while data is in flight never destroys stdin", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      let total = 0;
      process.stdin.on("data", d => { total += d.length; });
      process.stdin.on("error", err => { console.log("ERROR " + (err?.code || err?.message)); process.exit(1); });
      process.stdin.on("end", () => { console.log("TOTAL " + total); });
      const churn = setInterval(() => { process.stdin.pause(); process.stdin.resume(); }, 5);
      churn.unref();
      `,
    ],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  for (let i = 0; i < 20; i++) {
    proc.stdin.write("x".repeat(1024));
    await Bun.sleep(10);
  }
  await proc.stdin.end();
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe(`TOTAL ${20 * 1024}`);
  expect(exitCode).toBe(0);
});

// Not concurrent: this also keeps the 40 MB feeds below out of the concurrent batch above.
test("process.stdin over an anonymous pipe delivers each byte exactly once", async () => {
  const total = 10 * 1024 * 1024;
  using dir = tempDir("stdin-pipe-exactly-once", {
    "writer.js": `const chunk = Buffer.alloc(65536); let left = ${total}; (function pump() { while (left > 0) { left -= chunk.length; if (!process.stdout.write(chunk)) return process.stdout.once("drain", pump); } })();`,
    "reader.js": `const h = new Bun.CryptoHasher("sha1"); let n = 0; process.stdin.on("data", d => { n += d.length; h.update(d); }); process.stdin.on("close", () => process.stdout.write(n + " " + h.digest("hex")));`,
  });
  const { promise, resolve } = Promise.withResolvers<{ err: Error | null; stdout: string; stderr: string }>();
  exec(`"${bunExe()}" writer.js | "${bunExe()}" reader.js`, { cwd: String(dir), env: bunEnv }, (err, stdout, stderr) =>
    resolve({ err, stdout, stderr }),
  );
  const { err, stdout, stderr } = await promise;
  expect(stderr).toBe("");
  const expected = new Bun.CryptoHasher("sha1").update(Buffer.alloc(total)).digest("hex");
  expect(stdout).toBe(`${total} ${expected}`);
  expect(err).toBeNull();
});

// The native FileReader source over a pollable pipe used to drain the fd to
// EAGAIN regardless of JS demand, so an idle consumer still ingested the whole
// pipe into an internal buffer. The kernel pipe buffer filling up is the
// backpressure signal; these tests feed far more than that and check the
// child's resident set does not grow to match.
describe("pipe backpressure", () => {
  const feedMB = 40;
  // With no backpressure the child buffers the whole feed (Vec growth roughly
  // doubles that in RSS). With backpressure only the highwater mark plus the
  // kernel pipe buffer are resident in the child.
  const maxDeltaMB = isASAN || isDebug ? 24 : 16;

  async function run(consumer: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", consumer],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    // The child exits under backpressure having accepted only a few KB, so
    // the queued writes here fail with EPIPE; that is the expected outcome.
    const chunk = Buffer.alloc(1024 * 1024, 0x78);
    const ignoreEpipe = (e: any) => {
      if (e?.code !== "EPIPE") throw e;
    };
    for (let i = 0; i < feedMB; i++) {
      const r = proc.stdin.write(chunk);
      if (r && typeof (r as any).then === "function") (r as Promise<number>).catch(ignoreEpipe);
    }
    Promise.resolve(proc.stdin.flush()).catch(ignoreEpipe);
    Promise.resolve(proc.stdin.end()).catch(ignoreEpipe);
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout.trim());
    expect(exitCode).toBe(0);
    return result;
  }

  test.concurrent("Bun.stdin.stream(): a single read does not ingest the whole pipe", async () => {
    const { first, deltaMB } = await run(`
      const rss = process.memoryUsage.rss;
      const rd = Bun.stdin.stream().getReader();
      const c = await rd.read();
      const base = rss();
      // Give the event loop time to (incorrectly) drain the pipe. The loop is
      // native (no JS on the no-pending path), so debug/ASAN overhead is small.
      await new Promise(r => setTimeout(r, 1500));
      const deltaMB = Math.round((rss() - base) / 1048576);
      process.stdout.write(JSON.stringify({ first: c.value?.length ?? 0, deltaMB }));
      process.exit(0);
    `);
    expect(first).toBeGreaterThan(0);
    expect(deltaMB).toBeLessThan(maxDeltaMB);
  });

  test.concurrent("process.stdin.pause() stops the fd from being read", async () => {
    const { bytesAfter, deltaMB } = await run(`
      const rss = process.memoryUsage.rss;
      let bytes = 0, pausedAt = 0;
      process.stdin.on("data", chunk => {
        bytes += chunk.length;
        if (!pausedAt && bytes >= 1 << 20) {
          pausedAt = bytes;
          process.stdin.pause();
          const base = rss();
          setTimeout(() => {
            const deltaMB = Math.round((rss() - base) / 1048576);
            process.stdout.write(JSON.stringify({ bytesAtPause: pausedAt, bytesAfter: bytes, deltaMB }));
            process.exit(0);
          }, 1500);
        }
      });
    `);
    expect(bytesAfter).toBeLessThan(feedMB * 1024 * 1024);
    expect(deltaMB).toBeLessThan(maxDeltaMB);
  });

  // Stopped at the backstop, the reader's one-shot poll is left unarmed until
  // the next read, so it can observe nothing (not even the writer going away)
  // and must not keep the event loop alive on its own. Node behaves the same:
  // readStop() at the highWaterMark leaves the handle inactive.
  test.concurrent("a reader stopped at the highwater backstop does not keep the process alive", async () => {
    const { first } = await run(`
      const rd = Bun.stdin.stream().getReader();
      const c = await rd.read();
      process.stdout.write(JSON.stringify({ first: (c.value?.length ?? 0) > 0 }));
      // No further read and no exit(): once the backstop engages nothing is pending.
    `);
    expect(first).toBe(true);
  });

  // The same over an anonymous pipe (the blocking-pipe read path; Bun.spawn
  // stdio above is a socketpair). The writer keeps the pipe full until the
  // reader is gone, so EOF can never be what lets the reader exit.
  test.concurrent("over a shell pipe, a reader stopped at the backstop does not keep the process alive", async () => {
    using dir = tempDir("stdin-backstop-pipe", {
      "writer.js": `
        const chunk = Buffer.alloc(65536, 0x78);
        process.stdout.on("error", () => process.exit(0));
        (function pump() {
          while (process.stdout.write(chunk)) {}
          process.stdout.once("drain", pump);
        })();
      `,
      "reader.js": `
        const reader = Bun.stdin.stream().getReader();
        const { value } = await reader.read();
        process.on("exit", () => console.log("EXIT"));
        console.log("FIRST " + (value.byteLength > 0));
      `,
    });
    const { promise, resolve } = Promise.withResolvers<{ err: Error | null; stdout: string; stderr: string }>();
    exec(
      `"${bunExe()}" writer.js | "${bunExe()}" reader.js`,
      { cwd: String(dir), env: bunEnv },
      (err, stdout, stderr) => resolve({ err, stdout, stderr }),
    );
    expect(await promise).toEqual({ err: null, stdout: "FIRST true\nEXIT\n", stderr: "" });
  });

  // Stopping unregisters a fired one-shot poll without a syscall, which leaves
  // its disarmed registration in the kernel. Cancelling the stream must still
  // take it out: fd 0 stays open, and the next poll on it would hit EEXIST.
  test.concurrent("a reader cancelled at the highwater backstop frees fd 0 for the next reader", async () => {
    const { second } = await run(`
      const { getEventLoopStats } = require("bun:internal-for-testing");
      // Not top-level await: an unsettled entry-module promise would keep the process alive by itself.
      (async () => {
        const reader = Bun.stdin.stream().getReader();
        await reader.read();
        // The parent keeps the pipe full, so the reader soon stops and lets go of the loop.
        while (getEventLoopStats().loopActive) await new Promise(resolve => setImmediate(resolve));
        await reader.cancel();
        const next = await Bun.file(0).stream().getReader().read();
        process.stdout.write(JSON.stringify({ second: (next.value?.length ?? 0) > 0 }));
        process.exit(0);
      })();
    `);
    expect(second).toBe(true);
  });

  test.concurrent("reading resumes after the highwater backstop", async () => {
    // Stop reading long enough for the backstop to engage, then drain to EOF
    // and make sure every byte written by the parent is delivered.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const rd = Bun.stdin.stream().getReader();
        await rd.read().then(c => { globalThis.total = c.value?.length ?? 0; });
        await new Promise(r => setTimeout(r, 200));
        while (true) {
          const { value, done } = await rd.read();
          if (value) total += value.length;
          if (done) break;
        }
        process.stdout.write(String(total));
        `,
      ],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const chunk = Buffer.alloc(64 * 1024, 0x79);
    const n = 64;
    for (let i = 0; i < n; i++) proc.stdin.write(chunk);
    await proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(String(n * chunk.length));
    expect(exitCode).toBe(0);
  });
});

// On Windows these are a synchronous named pipe, a CreatePipe() pipe, an overlapped named pipe, and an
// overlapped named pipe that the intermediate process has already passed to net.connect().
const pipeKinds = ["spawn", "shell", ...(isWindows ? ["fd 3", "fd 3 after net.connect()"] : [])];
describe.concurrent.each(pipeKinds)("stdin pipe from %s", kind => {
  function spawnChild(files: Record<string, string>) {
    const dir = tempDir("stdin-kinds", {
      ...files,
      "relay.js": `
        const fs = require("fs");
        const buffer = Buffer.alloc(65536);
        for (let n; (n = fs.readSync(0, buffer)); )
          for (let offset = 0; offset < n; ) offset += fs.writeSync(1, buffer, offset, n - offset);
      `,
      "forward-fd.js": `
        if (process.argv[2]) require("net").connect({ fd: 3, pauseOnConnect: true }).unref();
        Bun.spawn([process.execPath, "main.js"], { stdio: [3, "inherit", "inherit"], onExit: (_, code) => process.exit(code) });
      `,
    });
    const options = { cwd: String(dir), env: bunEnv };
    const child =
      kind === "spawn"
        ? spawn(bunExe(), ["main.js"], options)
        : kind === "shell"
          ? spawn(`"${bunExe()}" relay.js | "${bunExe()}" main.js`, { ...options, shell: true })
          : spawn(bunExe(), ["forward-fd.js", ...(kind === "fd 3" ? [] : ["connect"])], {
              ...options,
              stdio: ["ignore", "pipe", "pipe", "pipe"],
            });
    const input = (child.stdin ?? child.stdio[3]) as Writable;
    input.on("error", () => {});
    let stdout = "";
    let stderr = "";
    let wake = () => {};
    child.stdout!.setEncoding("utf8").on("data", chunk => {
      stdout += chunk;
      wake();
    });
    child.stderr!.setEncoding("utf8").on("data", chunk => (stderr += chunk));
    // The child's 'close' event would also wait for fd 3.
    const finished = Promise.all([once(child, "exit"), once(child.stdout!, "end"), once(child.stderr!, "end")]);
    let isFinished = false;
    finished.finally(() => {
      isFinished = true;
      wake();
    });
    return {
      dir,
      input,
      async waitForStdout(text: string) {
        while (!stdout.includes(text)) {
          if (isFinished) throw new Error(`exited before printing ${JSON.stringify(text)}:\n${stdout}\n${stderr}`);
          await new Promise<void>(resolve => (wake = resolve));
        }
      },
      async result() {
        const [[exitCode, signal]] = await finished;
        return { stdout, stderr, exitCode, signal };
      },
      async [Symbol.asyncDispose]() {
        input.destroy();
        child.kill();
        await finished;
        dir[Symbol.dispose]();
      },
    };
  }
  const successResult = (stdout: string) => ({ stdout, stderr: "", exitCode: 0, signal: null });

  test.each([
    ["process.stdin 'data'", `process.stdin.on("data", onData).on("end", onEnd)`],
    ["for await (process.stdin)", `for await (const chunk of process.stdin) onData(chunk); onEnd()`],
    ["Bun.stdin.stream()", `for await (const chunk of Bun.stdin.stream()) onData(chunk); onEnd()`],
    ["fs.readFileSync(0)", `onData(fs.readFileSync(0)); onEnd()`],
    ["fs.createReadStream", `fs.createReadStream(null, { fd: 0 }).on("data", onData).on("end", onEnd)`],
  ])("%s receives every byte once, in order", (_, readScript) => expectAllBytesInOrder(readScript));

  test.skipIf(!isWindows)("process.stdin paused after every chunk receives every byte once, in order", () =>
    expectAllBytesInOrder(
      `process.stdin.on("data", chunk => { onData(chunk); process.stdin.pause(); setImmediate(() => process.stdin.resume()); }).on("end", onEnd)`,
    ),
  );

  async function expectAllBytesInOrder(readScript: string) {
    await using child = spawnChild({
      "main.js": `
        import fs from "fs";
        const hash = new Bun.CryptoHasher("sha1");
        let length = 0;
        const onData = chunk => { length += chunk.length; hash.update(chunk); };
        const onEnd = () => console.log(length, hash.digest("hex"));
        // The test writes after "ready", so the first read finds the pipe empty.
        ${readScript.includes("Sync") ? `console.log("ready")` : `setImmediate(() => console.log("ready"))`};
        ${readScript};
      `,
    });
    await child.waitForStdout("ready\n");
    const hash = new Bun.CryptoHasher("sha1");
    let length = 0;
    for (const size of [1, 7, 65535, 65536, 65537, 0, 300_000, 1, 700_000]) {
      const chunk = Buffer.alloc(size, `${length}|`);
      length += size;
      hash.update(chunk);
      child.input.write(chunk);
    }
    child.input.end();
    expect(await child.result()).toEqual(successResult(`ready\n${length} ${hash.digest("hex")}\n`));
  }

  test("readline yields each line as it arrives", async () => {
    await using child = spawnChild({
      "main.js": `for await (const line of require("readline").createInterface({ input: process.stdin })) console.log("<" + line + ">")`,
    });
    let expected = "";
    for (let i = 0; i < 50; i++) {
      child.input.write(`${i}\n`);
      await child.waitForStdout(`<${i}>\n`);
      expected += `<${i}>\n`;
    }
    child.input.end();
    expect(await child.result()).toEqual(successResult(expected));
  });

  test("emits 'end' without 'data' for empty input", async () => {
    await using child = spawnChild({
      "main.js": `process.stdin.on("data", () => console.log("data")).on("end", () => console.log("end")); console.log("ready")`,
    });
    await child.waitForStdout("ready\n");
    child.input.write("");
    child.input.end();
    expect(await child.result()).toEqual(successResult("ready\nend\n"));
  });

  test.each(["Bun.spawn", "Bun.spawnSync"])("is read by a %s subprocess while paused, then resumes", async api => {
    await using child = spawnChild({
      "grandchild.js": `
        console.log("grandchild ready");
        process.stdin.once("data", chunk => { console.log("grandchild " + chunk); process.exit(0); });
      `,
      "main.js": `
        process.stdin.once("data", async chunk => {
          process.stdin.pause();
          console.log("child " + chunk);
          await ${api}([process.execPath, "grandchild.js"], { stdio: ["inherit", "inherit", "inherit"] }).exited;
          process.stdin.on("data", chunk => console.log("child " + chunk)).resume();
          console.log("resumed");
        });
      `,
    });
    child.input.write("one");
    await child.waitForStdout("grandchild ready\n");
    child.input.write("two");
    await child.waitForStdout("resumed\n");
    child.input.end("three");
    expect(await child.result()).toEqual(
      successResult("child one\ngrandchild ready\ngrandchild two\nresumed\nchild three\n"),
    );
  });

  test("leaves data that arrives while paused for a subprocess spawned afterwards", async () => {
    await using child = spawnChild({
      "main.js": `
        process.stdin.once("data", async () => {
          process.stdin.pause();
          console.log("paused");
          for (const deadline = Date.now() + 30_000; !require("fs").existsSync("written") && Date.now() < deadline; ) await Bun.sleep(1);
          Bun.spawn([process.execPath, "-e", "process.stdin.on('data', chunk => console.log(String(chunk)))"], {
            stdio: ["inherit", "inherit", "inherit"],
          });
        });
      `,
    });
    child.input.write("one");
    await child.waitForStdout("paused\n");
    child.input.end("two");
    await once(child.input, "finish");
    await Bun.write(`${child.dir}/written`, "");
    expect(await child.result()).toEqual(successResult("paused\ntwo\n"));
  });

  test.skipIf(!isWindows)("does not block the event loop while a subprocess reads concurrently", async () => {
    await using child = spawnChild({
      "grandchild.js": `
        console.log("grandchild ready");
        while (require("fs").readSync(0, Buffer.alloc(8)));
      `,
      "main.js": `
        process.stdin.on("data", () => {});
        Bun.spawn([process.execPath, "grandchild.js"], { stdio: ["inherit", "inherit", "inherit"], onExit: () => process.exit(0) });
        const fs = require("fs");
        let round = 0;
        setInterval(() => fs.existsSync("round" + round) && console.log("round " + round++), 1);
      `,
    });
    await child.waitForStdout("grandchild ready\n");
    for (let round = 0; round < 40; round++) {
      await new Promise(resolve => child.input.write("x", resolve));
      await Bun.write(`${child.dir}/round${round}`, "");
      await child.waitForStdout(`round ${round}\n`);
    }
    child.input.end();
    expect(await child.result()).toMatchObject({ stderr: "", exitCode: 0 });
  });

  test.each([
    ["pause()", "process.stdin.pause()"],
    ["unref()", "process.stdin.unref()"],
    ["destroy()", "process.stdin.destroy()"],
    ["process.exit()", "process.exit(0)"],
  ])("%s lets the process exit while a read is pending", async (_, exitScript) => {
    await using child = spawnChild({
      "main.js": `
        process.on("exit", () => console.log("exited"));
        process.stdin.on("data", () => setImmediate(() => setImmediate(() => ${exitScript})));
      `,
    });
    child.input.write("one");
    await child.waitForStdout("exited\n");
    child.input.end();
    expect(await child.result()).toEqual(successResult("exited\n"));
  });

  test("is readable by fs.createReadStream after Bun.stdin.stream() is cancelled", async () => {
    await using child = spawnChild({
      "main.js": `
        const reader = Bun.stdin.stream().getReader();
        console.log("first " + Buffer.from((await reader.read()).value));
        const pendingRead = reader.read();
        await new Promise(setImmediate);
        await reader.cancel();
        await pendingRead;
        require("fs").createReadStream(null, { fd: 0 }).on("data", chunk => console.log("second " + chunk));
        console.log("switched");
      `,
    });
    child.input.write("one");
    await child.waitForStdout("switched\n");
    child.input.end("two");
    expect(await child.result()).toEqual(successResult("first one\nswitched\nsecond two\n"));
  });

  test("fstat reports a FIFO or socket and isatty() is false", async () => {
    await using child = spawnChild({
      "main.js": `const stat = require("fs").fstatSync(0); console.log(stat.isFIFO() || stat.isSocket(), require("tty").isatty(0))`,
    });
    child.input.end();
    expect(await child.result()).toEqual(successResult("true false\n"));
  });
});

test("file stdin is read to EOF when paused after every chunk", async () => {
  using dir = tempDir("stdin-file-pauses", { input: Buffer.alloc(1 << 20, "x") });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let n = 0;
       process.stdin.on("end", () => console.log(n)).on("data", chunk => {
         n += chunk.length;
         process.stdin.pause();
         setTimeout(() => process.stdin.resume(), 1);
       });`,
    ],
    env: bunEnv,
    stdin: Bun.file(`${dir}/input`),
    stderr: "inherit",
  });
  expect(await proc.stdout.text()).toBe(`${1 << 20}\n`);
  expect(await proc.exited).toBe(0);
});

test.skipIf(!isWindows)("timers run after a data listener has started another read of stdin", async () => {
  const script = `
    const fs = require("fs");
    let count = 0;
    process.stdin.on("data", () => {
      if (++count < 5) return console.log("more");
      setTimeout(() => console.log("timer"), 1);
      fs.read(0, Buffer.alloc(1), 0, 1, null, () => {});
    });
    fs.read(fs.openSync("\\\\\\\\.\\\\NUL"), Buffer.alloc(1), 0, 1, null, () => console.log("more"));
  `;
  async function waitForTimer() {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdin: "pipe" });
    for await (const chunk of proc.stdout) {
      if (Buffer.from(chunk).includes("timer")) return;
      proc.stdin.write("x");
      proc.stdin.flush();
    }
    throw new Error("exited before the timer");
  }
  await Promise.all(
    [0, 1].map(async () => {
      for (let i = 0; i < 20; i++) await waitForTimer();
    }),
  );
});

test.skipIf(!isWindows).each([
  ["Bun.spawn", `Bun.spawn(reader, { stdio: ["inherit", "inherit", "inherit"] }).exited`],
  ["Bun.$", "Bun.$`${reader}`"],
])("a %s subprocess that waits in a read gets the input, though stdin was not paused", async (_, start) => {
  using dir = tempDir("stdin-unpaused", {
    "reader.js": `
      const buffer = Buffer.alloc(8);
      require("fs").read(0, buffer, 0, 8, null, (error, length) => console.log("got " + buffer.subarray(0, length)));
      // Nothing reports that the other thread has entered its read.
      setTimeout(() => console.log("ready"), 50).unref();
    `,
    "main.js": `
      const reader = [process.execPath, "reader.js"];
      process.stdin.once("data", () => ${start}.then(() => process.exit()));
    `,
  });
  let receivedCount = 0;
  for (let i = 0; i < 8; i++) {
    await using proc = Bun.spawn({ cmd: [bunExe(), "main.js"], env: bunEnv, cwd: String(dir), stdin: "pipe" });
    proc.stdin.write("one");
    proc.stdin.flush();
    let stdout = "";
    for await (const chunk of proc.stdout) {
      stdout += Buffer.from(chunk);
      if (stdout !== "ready\n") continue;
      proc.stdin.write("two");
      proc.stdin.end();
    }
    if (stdout === "ready\ngot two\n") receivedCount++;
  }
  // As in Node.js, the order is likely but not certain.
  expect(receivedCount).toBeGreaterThanOrEqual(3);
});

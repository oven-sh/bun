import { createSocketPair } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { exec } from "node:child_process";
import { closeSync, readSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
      const handleReadable = () => {
        let chunk;
        while ((chunk = process.stdin.read())) {
          console.log("got chunk", JSON.stringify(chunk));
        }
      };
      
      process.stdin.on("readable", handleReadable);
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

  await proc.exited;

  expect(await proc.stdout.text()).toMatchInlineSnapshot(`
    "got chunk {"type":"Buffer","data":[97,98,99,10,100,101,102,10]}
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
      let spins = 0;
      function poll() {
        let chunk;
        while ((chunk = process.stdin.read(3)) !== null) chunks.push(chunk.toString());
        if (process.stdin.readableEnded) return;
        // Bounded so a regression fails with output instead of spinning forever.
        if (++spins > 20000) {
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

// A pipe, socket or terminal stdin ends the way Node's net.Socket does: push(null), then
// read(0). With an empty buffer 'end' and 'close' come even when nothing reads. Each child
// prints what process.stdin emitted and the state of the Readable at exit: `ended: true`
// shows that EOF was pushed.
describe("'end' at EOF on a pipe, socket or terminal", () => {
  const header = `
    const s = process.stdin;
    const out = [];
    const m = x => out.push(x);
    s.on("end", () => m("end"));
    s.on("close", () => m("close"));
    process.on("exit", () => {
      const { ended, length } = s._readableState;
      console.log(JSON.stringify({ events: out.join(" "), ended, length }));
    });`;
  const addedAndRemoved = `const f = () => m("r"); s.on("readable", f); s.removeListener("readable", f);`;
  const neverReads = `s.on("readable", () => m("r"));`;
  const throwsAtEof = `s.on("readable", () => { m("r"); throw new Error("x"); });`;
  const state = (events: string, length = 0) => JSON.stringify({ events, ended: true, length });

  // "pipe" gets the input and EOF at once, "ready pipe" when the child prints READY on stderr.
  // "open pipe" gets neither.
  type Stdin = "pipe" | "ready pipe" | "open pipe" | "file";
  async function run(stdin: Stdin, input: string, body: string) {
    using dir = tempDir("stdin-eof", { "empty": "" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", header + body],
      stdin: stdin === "file" ? Bun.file(join(String(dir), "empty")) : "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const decoder = new TextDecoder();
    let stderr = "";
    let sent = stdin !== "pipe" && stdin !== "ready pipe";
    const send = () => {
      sent = true;
      const sink = proc.stdin as Bun.FileSink;
      if (input) sink.write(input);
      sink.end();
    };
    if (stdin === "pipe") send();
    const drained = (async () => {
      for await (const chunk of proc.stderr) {
        stderr += decoder.decode(chunk, { stream: true });
        if (!sent && stderr.includes("READY\n")) send();
      }
    })();
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited, drained]);
    return { stdout: stdout.trim(), exitCode, stderr: exitCode === 0 ? undefined : stderr };
  }

  test.concurrent.each([
    // 'end' and 'close' were missing in these.
    ["'readable' added and removed", "pipe", "", addedAndRemoved, state("end close")],
    ["a 'readable' listener that never reads", "pipe", "", neverReads, state("r end close")],
    ["once('readable') that never reads", "pipe", "", `s.once("readable", () => m("r"));`, state("r end close")],
    [
      "setEncoding() and a listener that never reads",
      "pipe",
      "",
      `s.setEncoding("utf8"); ${neverReads}`,
      state("r end close"),
    ],
    ["one read()", "pipe", "", `m("read=" + s.read());`, state("read=null end close")],
    [
      "once('readable') that reads, then finished()",
      "pipe",
      "hello",
      `s.once("readable", () => m("read=" + s.read()));
      require("node:stream").finished(s, err => m("finished" + (err ? ":" + err.code : "")));`,
      state("read=hello end finished close"),
    ],
    // pause() does not hold a stream that has a 'readable' listener.
    ["a 'readable' listener, then pause()", "pipe", "", `${neverReads} s.pause();`, state("r end close")],
    [
      "once('readable'), then pause()",
      "pipe",
      "",
      `s.once("readable", () => m("r")); s.pause();`,
      state("r end close"),
    ],
    [
      "pause() inside the 'readable' listener at EOF",
      "pipe",
      "",
      `s.on("readable", () => { m("r"); s.pause(); });`,
      state("r end close"),
    ],
    // These print the same without the read(0), and the same in Node.
    ["unread bytes hold 'end' back", "pipe", "0123456789", addedAndRemoved, state("", 10)],
    [
      "a 'readable' listener that throws at EOF gets no 'end'",
      "pipe",
      "",
      `process.on("uncaughtException", () => m("uncaught")); ${throwsAtEof}`,
      state("r uncaught"),
    ],
    [
      "the same with two reads in flight",
      "ready pipe",
      "",
      `process.on("uncaughtException", () => m("uncaught"));
      s.on("data", () => {});
      setImmediate(() => {
        s.pause();
        s.resume();
        setImmediate(() => { ${throwsAtEof} require("node:fs").writeSync(2, "READY\\n"); });
      });`,
      state("r uncaught"),
    ],
    [
      "a drain on 'readable', then resume(), emits 'end' once",
      "pipe",
      "0123456789",
      `s.on("readable", function drain() {
        for (let chunk; (chunk = s.read()) !== null; ) m("d" + chunk.length);
        if (s._readableState.ended) { s.removeListener("readable", drain); s.resume(); }
      });`,
      state("d10 end close"),
    ],
    ["push(null) from user code while the pipe is open", "open pipe", "", `s.push(null);`, state("")],
    ["a file: 'readable' added and removed", "file", "", addedAndRemoved, state("")],
    ["a file: a 'readable' listener that never reads", "file", "", neverReads, state("r")],
  ] as const)("%s", async (_name, stdin, input, body, expected) => {
    expect(await run(stdin, input, body)).toEqual({ stdout: expected, exitCode: 0 });
  });

  // pause() holds the stream and nothing resumes it: these print `d10 i` and `d10 read=null`,
  // with no 'end'. Node ends a paused socket one poll after its last chunk.
  test.todo.each([
    [
      "pause() in 'data', then ref()",
      `s.on("data", v => { m("d" + v.length); s.pause(); setImmediate(() => { s.ref(); m("i"); }); });`,
      state("d10 i end close"),
    ],
    [
      "pause() in 'data', then read()",
      `s.on("data", v => { m("d" + v.length); s.pause(); setImmediate(() => m("read=" + s.read())); });`,
      state("d10 read=null end close"),
    ],
  ] as const)("%s", async (_name, body, expected) => {
    expect(await run("pipe", "0123456789", body)).toEqual({ stdout: expected, exitCode: 0 });
  });

  // EOF is pushed in the loop turn of the last chunk, so the read(0) ends the stream while the
  // body of the loop has not pushed its result: the 'end' listener prints `end:[]`. Node v26
  // reads EOF one poll later and prints `end:[3]`.
  test.todo("for await with one yield in its body: 'end' comes after the last result", async () => {
    const body = `
      const results = [];
      s.on("end", () => m("end:" + JSON.stringify(results)));
      (async () => {
        for await (const chunk of s) {
          await new Promise(resolve => setImmediate(resolve));
          results.push(chunk.length);
        }
      })();`;
    expect(await run("pipe", "abc", body)).toEqual({ stdout: state("end end:[3] close"), exitCode: 0 });
  });

  test.skipIf(isWindows).concurrent("a shell pipe: 'readable' added and removed", async () => {
    await using proc = Bun.spawn({
      cmd: ["sh", "-c", ': | "$0" -e "$1"', bunExe(), header + addedAndRemoved],
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode, stderr: exitCode === 0 ? undefined : stderr }).toEqual({
      stdout: state("end close"),
      exitCode: 0,
    });
  });

  test.skipIf(isWindows).concurrent("a terminal: a 'readable' listener that never reads, then Ctrl-D", async () => {
    const decoder = new TextDecoder();
    let output = "";
    const ready = Promise.withResolvers<void>();
    const done = Promise.withResolvers<void>();
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `${header} ${neverReads} require("node:fs").writeSync(1, "READY\\n");`],
      env: bunEnv,
      terminal: {
        data(_terminal, chunk: Uint8Array) {
          output += decoder.decode(chunk, { stream: true });
          if (output.includes("READY")) ready.resolve();
          if (output.includes('"length"')) done.resolve();
        },
        exit() {
          ready.resolve();
          done.resolve();
        },
      },
    });
    await ready.promise;
    proc.terminal!.write("\x04");
    await done.promise;
    const exitCode = await proc.exited;
    proc.terminal!.close();
    expect({ result: output.match(/\{"events".*\}/)?.[0], exitCode }).toEqual({
      result: state("r end close"),
      exitCode: 0,
    });
  });

  // A server that reads whole frames and stops when its client closes stdin. At EOF its
  // listener has nothing to read, so only the read(0) ends the stream.
  test.concurrent("a frame reader with a live timer exits when stdin ends", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const keepAlive = setInterval(() => {}, 1000);
        let total = 0;
        process.stdin.on("readable", () => {
          if (process.stdin.readableLength >= 4) total += process.stdin.read().length;
        });
        process.stdin.on("end", () => {
          console.log("end total=" + total);
          clearInterval(keepAlive);
        });`,
      ],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    proc.stdin.write("abcdefgh");
    proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode, signalCode: proc.signalCode, stderr: exitCode === 0 ? undefined : stderr }).toEqual({
      stdout: "end total=8\n",
      exitCode: 0,
      signalCode: null,
    });
  });

  // pause() holds a 'data' consumer: 'end' waits for its resume(). The handler pauses, awaits,
  // yields once to the loop, records and resumes. The last chunk and EOF are written together.
  test.concurrent.each([
    [
      "a 'data' listener",
      `process.stdin.on("data", async chunk => {
        process.stdin.pause();
        await yieldToLoop();
        results.push(String(chunk).trim());
        process.stdin.resume();
        fs.writeSync(2, "ACK\\n");
      });
      process.stdin.on("end", () => console.log(JSON.stringify(results)));`,
    ],
    [
      "a readline 'line' listener",
      `const rl = require("node:readline").createInterface({ input: process.stdin });
      rl.on("line", async line => {
        rl.pause();
        await yieldToLoop();
        results.push(line);
        rl.resume();
        fs.writeSync(2, "ACK\\n");
      });
      rl.on("close", () => console.log(JSON.stringify(results)));`,
    ],
  ])("pause() in %s: the last record is there at 'end'", async (_name, listener) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const fs = require("node:fs");
        const { setImmediate: yieldToLoop } = require("node:timers/promises");
        const results = [];
        ${listener}
        fs.writeSync(2, "READY\\n");`,
      ],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    const decoder = new TextDecoder();
    let stderr = "";
    let acks = 0;
    const drained = (async () => {
      for await (const chunk of proc.stderr) {
        stderr += decoder.decode(chunk, { stream: true });
        if (acks === 0 && stderr.includes("READY\n")) {
          acks = 1;
          proc.stdin.write("ab\n");
          proc.stdin.flush();
        }
        if (acks === 1 && stderr.includes("ACK\n")) {
          acks = 2;
          proc.stdin.write("cde\n");
          proc.stdin.end();
        }
      }
    })();
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited, drained]);
    expect({ stdout, exitCode, stderr: exitCode === 0 ? undefined : stderr }).toEqual({
      stdout: JSON.stringify(["ab", "cde"]) + "\n",
      exitCode: 0,
    });
  });

  // The same hold when the chunk and EOF are in the socket together and two reads are in
  // flight: EOF is pushed in the turn of the chunk, before the listener's setImmediate() runs.
  test.skipIf(isWindows).concurrent("pause() in 'data': work in a setImmediate() runs before 'end'", async () => {
    using dir = tempDir("stdin-eof-order", {});
    const gate = join(String(dir), "gate");
    const [childEnd, parentEnd] = createSocketPair();
    // shutdown() and not close(): see "pause() in 'data', EOF, then resume()". The socket owns parentEnd.
    const writer = await Bun.connect({ fd: parentEnd, socket: { data() {} } } as any);
    let sent = false;
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const fs = require("node:fs");
          const s = process.stdin;
          const out = [];
          s.on("end", () => out.push("end"));
          s.on("close", () => out.push("close"));
          s.on("data", chunk => {
            out.push("d" + chunk.length);
            s.pause();
            setImmediate(() => {
              out.push("work");
              s.resume();
            });
          });
          setImmediate(() => {
            s.pause();
            s.resume();
            setImmediate(() => {
              fs.writeSync(1, "READY\\n");
              // Blocks this thread until the chunk and EOF are both in the socket.
              while (!fs.existsSync(${JSON.stringify(gate)})) {}
            });
          });
          process.on("exit", () => fs.writeSync(1, out.join(" ") + "\\n"));`,
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
          expect(writer.write("0123456789")).toBe(10);
          writer.shutdown();
          writeFileSync(gate, "");
        }
      }
      const exitCode = await proc.exited;
      expect({ stdout, exitCode, stderr: exitCode === 0 ? undefined : await stderr }).toEqual({
        stdout: "READY\nd10 work end close\n",
        exitCode: 0,
      });
    } finally {
      closeSync(childEnd);
      writer.end();
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

// The native FileReader source over a pollable pipe used to drain the fd to
// EAGAIN regardless of JS demand, so an idle consumer still ingested the whole
// pipe into an internal buffer. The kernel pipe buffer filling up is the
// backpressure signal; these tests feed far more than that and check the
// child's resident set does not grow to match.
describe.skipIf(isWindows)("pipe backpressure", () => {
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

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { exec } from "node:child_process";
import { promises as fsPromises, writeSync } from "node:fs";
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

// process.stdin reads from the stream that Bun.stdin.stream() returns, and pauses its source when it lets go of it.
describe.each([
  ["pause()", `process.stdin.pause();`],
  ["resume() and pause()", `process.stdin.resume(); process.stdin.pause();`],
  [
    "one 'data' event and pause()",
    `await new Promise(resolve => process.stdin.once("data", chunk => { head = chunk.length; process.stdin.pause(); resolve(); }));`,
  ],
])("Bun.stdin.stream() after process.stdin's %s", (_, before) => {
  // Not concurrent: tests above depend on how soon this process writes to their children, and these keep it busy.
  test.each([
    ["for await", `for await (const chunk of Bun.stdin.stream()) rest += chunk.length;`],
    ["pipeTo()", `await Bun.stdin.stream().pipeTo(new WritableStream({ write(chunk) { rest += chunk.length; } }));`],
    ["tee()", `for await (const chunk of Bun.stdin.stream().tee()[0]) rest += chunk.length;`],
  ])("%s reads the rest of stdin", async (_, consume) => {
    // More than the pipe and the reader can buffer, so most of it is still unread when process.stdin pauses.
    const size = 4 * 1024 * 1024;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        let head = 0, rest = 0;
        ${before}
        // process.stdin lets go of the stream a tick after pause().
        await new Promise(resolve => setImmediate(resolve));
        ${consume}
        // What process.stdin read before it let go is in its own buffer.
        console.log(head + process.stdin.readableLength + rest);
        `,
      ],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    proc.stdin.write(Buffer.alloc(size, "x"));
    await proc.stdin.end();
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: size + "\n", stderr: "", exitCode: 0 });
  });
});

// The ways to let go of Bun.stdin.stream() without a cancel. Each one reads the first line into `got`.
// The source stops at the release, as it does when process.stdin pauses, and the next reader makes it read again.
const streamDoors = {
  "a break out of for await (console)": {
    first: "one\n",
    seen: ["console:one"],
    door: `for await (const line of console) { got.push("console:" + line); break; }`,
  },
  "reader.releaseLock()": {
    first: "one\n",
    seen: ["reader:one"],
    door: `
      {
        const reader = Bun.stdin.stream().getReader();
        got.push("reader:" + Buffer.from((await reader.read()).value).toString().trim());
        reader.releaseLock();
      }
    `,
  },
  "a break out of stream.values({ preventCancel: true })": {
    first: "one\n",
    seen: ["values:one"],
    door: `
      for await (const chunk of Bun.stdin.stream().values({ preventCancel: true })) {
        got.push("values:" + Buffer.from(chunk).toString().trim());
        break;
      }
    `,
  },
  "an aborted pipeTo() with preventCancel": {
    first: "one\n",
    seen: ["pipeTo:one"],
    door: `
      {
        const abort = new AbortController();
        const sink = new WritableStream({
          write(chunk) {
            got.push("pipeTo:" + Buffer.from(chunk).toString().trim());
            abort.abort();
          },
        });
        await Bun.stdin.stream().pipeTo(sink, { preventCancel: true, signal: abort.signal }).catch(() => {});
      }
    `,
  },
};

// The children above have a top-level await, which keeps them alive. These do not: the next reader has to
// keep the process alive until stdin ends, and it has to stop when it lets go of stdin too.
describe("the next reader of stdin after process.stdin or a stream reader lets go of it", () => {
  // Not concurrent, for the same reason as the tests above.
  const doors = {
    "pause()": { first: "", seen: [], door: `process.stdin.pause();` },
    "rl.close()": {
      first: "one\n",
      seen: ["rl:one"],
      door: `
        const rl = require("node:readline").createInterface({ input: process.stdin });
        got.push("rl:" + (await new Promise(resolve => rl.once("line", resolve))));
        rl.close();
      `,
    },
    "destroy()": { first: "", seen: [], door: `process.stdin.destroy();` },
    "a break out of for await (process.stdin)": {
      first: "one\n",
      seen: ["iter:one"],
      door: `
        for await (const chunk of process.stdin) {
          got.push("iter:" + chunk.toString().trim());
          break;
        }
      `,
    },
  };

  // `all` reads stdin to its end. `one` reads one chunk and lets go.
  const consumers = {
    "the console iterator": {
      all: `for await (const line of console) got.push(line);`,
      one: `for await (const line of console) { got.push(line); break; }`,
    },
    "a Bun.stdin.stream() reader": {
      all: `
        const reader = Bun.stdin.stream().getReader();
        let text = "";
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
          text += Buffer.from(chunk.value).toString();
        }
        got.push(...text.split("\\n"));
      `,
      one: `
        const reader = Bun.stdin.stream().getReader();
        got.push(Buffer.from((await reader.read()).value).toString().trim());
        reader.releaseLock();
      `,
    },
    "Readable.fromWeb(Bun.stdin.stream())": {
      all: `
        let text = "";
        for await (const chunk of require("node:stream").Readable.fromWeb(Bun.stdin.stream())) text += chunk;
        got.push(...text.split("\\n"));
      `,
      one: `
        const readable = require("node:stream").Readable.fromWeb(Bun.stdin.stream());
        got.push(String(await new Promise(resolve => readable.once("data", resolve))).trim());
        readable.destroy();
      `,
    },
  };

  const child = (door: string, consumer: string) => `
    const got = [];
    (async () => {
      ${door}
      // process.stdin lets go of the stream a tick after 'pause' or 'close'.
      await new Promise(resolve => setImmediate(resolve));
      // An unref'd timer fires only while something else keeps the process alive.
      setTimeout(() => console.log("READY"), 50).unref();
      ${consumer}
      console.log(JSON.stringify(got));
    })();
  `;

  // Each step waits for `marker` on the child's stdout (if any), then writes `input`.
  // With `end: false` stdin stays open, so the child has to exit by itself.
  // With `shellPipe` the child's stdin is an anonymous pipe, not a socket. The writer is not `cat`:
  // busybox `cat` uses sendfile(), which locks the pipe while it waits for input and stalls the reader.
  async function run(
    script: string,
    steps: [marker: string | null, input: string][],
    { end = true, shellPipe = false } = {},
  ) {
    await using proc = Bun.spawn({
      cmd: shellPipe
        ? ["sh", "-c", '"$0" -e "$2" | "$0" -e "$1"', bunExe(), script, "process.stdin.pipe(process.stdout)"]
        : [bunExe(), "-e", script],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });
    // Drained from the start, so a child that fails before its marker shows why.
    const stderr = proc.stderr.text();
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";
    for (const [marker, input] of steps) {
      while (marker && !stdout.includes(marker)) {
        const { value, done } = await reader.read();
        if (done) {
          const output = JSON.stringify({ stdout, stderr: await stderr });
          throw new Error(`stdout ended before ${JSON.stringify(marker)}: ${output}`);
        }
        stdout += decoder.decode(value, { stream: true });
      }
      proc.stdin.write(input);
      proc.stdin.flush();
    }
    if (end) await proc.stdin.end();
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      stdout += decoder.decode(chunk.value, { stream: true });
    }
    return { stdout, stderr: await stderr, exitCode: await proc.exited, signalCode: proc.signalCode };
  }

  describe.each(Object.entries({ ...doors, ...streamDoors }))("%s", (_, { first, seen, door }) => {
    const steps: [string | null, string][] = first ? [[null, first]] : [];

    test.each(Object.entries(consumers))("%s reads the rest of stdin", async (_, { all }) => {
      expect(await run(child(door, all), [...steps, ["READY\n", "two\nthree"]])).toEqual({
        stdout: "READY\n" + JSON.stringify([...seen, "two", "three"]) + "\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    test.each(Object.entries(consumers))("%s lets the process exit after one chunk", async (_, { one }) => {
      expect(await run(child(door, one), [...steps, ["READY\n", "two\n"]], { end: false })).toEqual({
        stdout: "READY\n" + JSON.stringify([...seen, "two"]) + "\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    test("the process exits when nothing reads stdin again", async () => {
      const script = `
        const got = [];
        (async () => {
          ${door}
          console.log(JSON.stringify(got));
        })();
      `;
      expect(await run(script, steps, { end: false })).toEqual({
        stdout: JSON.stringify(seen) + "\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });
  });

  test.each(["pause()", "destroy()"])("a reader taken in the tick of %s reads stdin", async call => {
    const script = `
      process.stdin.${call};
      const reader = Bun.stdin.stream().getReader();
      console.log("READY");
      (async () => {
        let text = "";
        for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) text += Buffer.from(chunk.value);
        console.log(JSON.stringify(text));
      })();
    `;
    expect(await run(script, [["READY\n", "one\ntwo"]])).toEqual({
      stdout: 'READY\n"one\\ntwo"\n',
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test.skipIf(isWindows)("the console iterator reads the rest of stdin over a shell pipe", async () => {
    const { first, seen, door } = doors["rl.close()"];
    const steps: [string | null, string][] = [
      [null, first],
      ["READY\n", "two\nthree"],
    ];
    expect(await run(child(door, consumers["the console iterator"].all), steps, { shellPipe: true })).toEqual({
      stdout: "READY\n" + JSON.stringify([...seen, "two", "three"]) + "\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test("process.stdin.unref() after a stream reader let go stays for the next reader", async () => {
    const { first, seen, door } = streamDoors["a break out of for await (console)"];
    const script = `
      const got = [];
      (async () => {
        ${door}
        process.stdin.unref();
        const reader = Bun.stdin.stream().getReader();
        console.log(JSON.stringify(got));
        await reader.read();
        console.log("unexpected read");
      })();
    `;
    expect(await run(script, [[null, first]], { end: false })).toEqual({
      stdout: JSON.stringify(seen) + "\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test("after process.stdin.unref(), the next reader does not keep the process alive", async () => {
    const script = `
      (async () => {
        await new Promise(resolve =>
          process.stdin.once("data", () => {
            process.stdin.unref();
            process.stdin.pause();
            resolve();
          }),
        );
        await new Promise(resolve => setImmediate(resolve));
        const reader = Bun.stdin.stream().getReader();
        // Stands in for the other work of a program that does not wait for stdin.
        const work = setInterval(() => {}, 60_000);
        console.log("READY");
        console.log(JSON.stringify(Buffer.from((await reader.read()).value).toString()));
        clearInterval(work);
        reader.read();
      })();
    `;
    expect(
      await run(
        script,
        [
          [null, "one\n"],
          ["READY\n", "two"],
        ],
        { end: false },
      ),
    ).toEqual({ stdout: 'READY\n"two"\n', stderr: "", exitCode: 0, signalCode: null });
  });

  describe.each([
    ["the console iterator", "for await (const line of console) break;"],
    [
      "a reader of Bun.stdin.stream()",
      "const reader = Bun.stdin.stream().getReader(); await reader.read(); reader.releaseLock();",
    ],
  ])("process.stdin.pause() after %s let go of stdin", (_, first) => {
    test("lets the process exit", async () => {
      expect(await run(`${first} process.stdin.pause();`, [[null, "one\n"]], { end: false })).toEqual({
        stdout: "",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    test.skipIf(isWindows)("leaves the rest of stdin to a child that inherits it", async () => {
      const script = `
        ${first}
        process.stdin.pause();
        process.on("message", message => {
          if (message === "ping") return process.send("pong");
          const cat = require("node:child_process").spawn("cat", [], { stdio: ["inherit", "pipe", "inherit"] });
          let length = 0;
          cat.stdout.on("data", chunk => (length += chunk.length));
          cat.on("close", () => {
            console.log(length);
            process.disconnect();
          });
        });
        process.send("paused");
      `;
      const paused = Promise.withResolvers<void>();
      const pong = Promise.withResolvers<void>();
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        env: bunEnv,
        ipc: message => (message === "paused" ? paused : pong).resolve(),
      });
      proc.stdin.write("one\n");
      proc.stdin.flush();
      await paused.promise;
      // It fits the kernel's buffer, and it has been there for a turn of the parent's loop when cat starts.
      const rest = Buffer.alloc(40_000, "r");
      proc.stdin.write(rest);
      await proc.stdin.flush();
      proc.send("ping");
      await pong.promise;
      proc.send("cat");
      await proc.stdin.end();
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: `${rest.length}\n`, stderr: "", exitCode: 0 });
    });
  });

  describe.each([
    "process.stdin.pause()",
    "process.stdin.destroy()",
    "require('node:stream').Readable.prototype.destroy.call(process.stdin)",
  ])("%s lets a program exit that holds a reader", call => {
    test.each([
      ["it never read from", ""],
      ["it read one chunk from", "await reader.read();"],
      ["with a read pending", "await reader.read(); reader.read();"],
    ])("%s", async (_, reads) => {
      const script = `const reader = (globalThis.reader = Bun.stdin.stream().getReader()); ${reads} ${call};`;
      expect(await run(script, [[null, "one\n"]], { end: false })).toEqual({
        stdout: "",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });
  });

  test("process.stdin takes stdin back after the next reader releases it", async () => {
    const script = `
      const got = [];
      (async () => {
        process.stdin.once("data", chunk => {
          got.push("data:" + chunk.toString().trim());
          process.stdin.pause();
        });
        await new Promise(resolve => process.stdin.once("pause", resolve));
        await new Promise(resolve => setImmediate(resolve));
        const reader = Bun.stdin.stream().getReader();
        setTimeout(() => console.log("READY"), 50).unref();
        got.push("web:" + Buffer.from((await reader.read()).value).toString().trim());
        reader.releaseLock();
        process.stdin.on("data", chunk => got.push("data:" + chunk.toString().trim()));
        process.stdin.on("end", () => console.log(JSON.stringify(got)));
        process.stdin.resume();
        console.log("AGAIN");
      })();
    `;
    expect(
      await run(script, [
        [null, "one\n"],
        ["READY\n", "two\n"],
        ["AGAIN\n", "three\n"],
      ]),
    ).toEqual({
      stdout: "READY\nAGAIN\n" + JSON.stringify(["data:one", "web:two", "data:three"]) + "\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // readline puts the terminal in raw mode for the prompt, and close() restores it and pauses stdin.
  test.skipIf(isWindows)("the console iterator after a readline prompt on a terminal", async () => {
    const script = `
      const got = [];
      (async () => {
        const rl = require("node:readline").createInterface({ input: process.stdin, output: process.stdout });
        got.push("rl:" + (await new Promise(resolve => rl.question("name? ", resolve))));
        rl.close();
        await new Promise(resolve => setImmediate(resolve));
        setTimeout(() => console.log("READY"), 50).unref();
        for await (const line of console) {
          got.push(line);
          if (got.length === 3) break;
        }
        console.log("GOT " + JSON.stringify(got));
      })();
    `;
    const decoder = new TextDecoder();
    let output = "";
    let waiting: { marker: string; resolve: () => void } | undefined;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      terminal: {
        data(_terminal, chunk) {
          output += decoder.decode(chunk, { stream: true });
          if (waiting && output.includes(waiting.marker)) waiting.resolve();
        },
      },
    });
    await using terminal = proc.terminal!;
    function waitFor(marker: string) {
      return new Promise<void>((resolve, reject) => {
        waiting = { marker, resolve };
        proc.exited.then(code =>
          reject(new Error(`child exited with ${code} before ${marker}; output=${JSON.stringify(output)}`)),
        );
        if (output.includes(marker)) resolve();
      });
    }
    await waitFor("name? ");
    terminal.write("one\r");
    await waitFor("READY");
    terminal.write("two\nthree\n");
    await waitFor("GOT ");
    expect(output).toContain('GOT ["rl:one","two","three"]');
    expect(await proc.exited).toBe(0);
  });
});

// Input that arrives while nothing holds the stream stays on fd 0 for the next reader of that descriptor: a dialog,
// a synchronous read, a child process.
describe("input that arrives after a stream reader let go of stdin", () => {
  // Not concurrent: concurrent children in this file turned the Windows lanes red before.
  // The other ways to end a console loop early.
  const consoleEnds = {
    "a return": `got.push("console:" + (await (async () => { for await (const line of console) return line; })()));`,
    "a throw in the loop body": `
      try {
        for await (const line of console) {
          got.push("console:" + line);
          throw new Error("stop");
        }
      } catch {}
    `,
    "iterator.return()": `
      {
        const iterator = console[Symbol.asyncIterator]();
        got.push("console:" + (await iterator.next()).value);
        await iterator.return();
      }
    `,
    "iterator.throw()": `
      {
        const iterator = console[Symbol.asyncIterator]();
        got.push("console:" + (await iterator.next()).value);
        await iterator.throw(new Error("stop")).catch(() => {});
      }
    `,
  };

  const prelude = `
    import fs from "node:fs";
    const got = [];
    // A child whose test is gone must not wait for an answer.
    process.on("disconnect", () => process.exit(1));
    // The test answers after it wrote more input, so that input is on stdin when this resolves.
    const ask = question => new Promise(resolve => { process.once("message", resolve); process.send(question); });
    // One line of fd 0, one byte per read, so the read takes nothing of the next line.
    function readLineSync() {
      const byte = Buffer.alloc(1);
      let line = "";
      while (fs.readSync(0, byte) === 1 && byte[0] !== 10) line += String.fromCharCode(byte[0]);
      return line;
    }
  `;

  // Runs `script` with `first` on its stdin. When the child asks `question` through process.send(), the test writes
  // `answers[question]` to the child's stdin and then answers. After the answer to `end` it closes the child's stdin.
  // When the child prints a key of `output`, the test writes that value: a read that lost a line gets this one and
  // does not hang. With `fifo` the child's stdin is a FIFO, as in `cmd | bun script`, and not a socket.
  async function drive(
    script: string,
    answers: Record<string, string | undefined>,
    {
      first = "one\n",
      output = {},
      end,
      fifo = false,
    }: { first?: string; output?: Record<string, string>; end?: string; fifo?: boolean } = {},
  ) {
    const ignoreEpipe = (e: any) => {
      if (e?.code !== "EPIPE") throw e;
    };
    using dir = fifo ? tempDir("stdin-fifo", {}) : undefined;
    const path = join(String(dir), "stdin");
    if (fifo) mkfifo(path);
    let writer: fsPromises.FileHandle | undefined;
    // Resolves when a socket took all of `input`. A write to the FIFO is in the pipe when it returns.
    const write = async (input: string) => {
      try {
        if (writer) writeSync(writer.fd, input);
        else {
          proc.stdin!.write(input);
          await proc.stdin!.flush();
        }
      } catch (e) {
        ignoreEpipe(e);
      }
    };
    const close = async () => {
      if (writer) await writer.close();
      else Promise.resolve(proc.stdin!.end()).catch(ignoreEpipe);
    };
    await using proc = Bun.spawn({
      cmd: fifo
        ? ["sh", "-c", 'exec "$0" -e "$1" < "$2"', bunExe(), prelude + script, path]
        : [bunExe(), "-e", prelude + script],
      stdin: fifo ? "ignore" : "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
      async ipc(question: string, child) {
        const input = answers[question];
        if (question === end) {
          // The child may read none of it before the answer, so the test does not wait for the socket here.
          if (input) void write(input);
          await close();
        } else if (input) {
          await write(input);
        }
        child.send("ok");
      },
    });
    const stderr = proc.stderr.text();
    if (fifo) writer = await fsPromises.open(path, "w");
    try {
      if (first) await write(first);
      const decoder = new TextDecoder();
      let stdout = "";
      const pending = new Set(Object.keys(output));
      for await (const chunk of proc.stdout) {
        stdout += decoder.decode(chunk, { stream: true });
        for (const marker of pending) {
          if (stdout.includes(marker)) {
            pending.delete(marker);
            void write(output[marker]);
          }
        }
      }
      return { stdout, stderr: await stderr, exitCode: await proc.exited };
    } finally {
      await writer?.close().catch(() => {});
    }
  }

  // "two" arrives after the door, and the event loop runs twice while nothing reads stdin.
  const lateLine = (door: string, read: string) => `
    ${door}
    await ask("let go");
    await ask("turn");
    console.log("READING");
    ${read}
    for await (const line of console) { got.push("console:" + line); break; }
    console.log(JSON.stringify(got));
    process.exit(0);
  `;

  test.each(Object.entries(streamDoors))(
    "a synchronous read of fd 0 gets the line that arrives after %s",
    async (_, { seen, door }) => {
      const script = lateLine(door, `got.push("sync:" + readLineSync());`);
      expect(await drive(script, { "let go": "two\n" }, { output: { "READING\n": "three\n" } })).toEqual({
        stdout: "READING\n" + JSON.stringify([...seen, "sync:two", "console:three"]) + "\n",
        stderr: "",
        exitCode: 0,
      });
    },
  );

  test.each(Object.entries(consoleEnds))(
    "a synchronous read of fd 0 gets the line that arrives after a console loop ends with %s",
    async (_, door) => {
      const script = lateLine(door, `got.push("sync:" + readLineSync());`);
      expect(await drive(script, { "let go": "two\n" }, { output: { "READING\n": "three\n" } })).toEqual({
        stdout: "READING\n" + JSON.stringify(["console:one", "sync:two", "console:three"]) + "\n",
        stderr: "",
        exitCode: 0,
      });
    },
  );

  test("confirm() reads the answer that arrives after a console loop ended", async () => {
    const { door } = streamDoors["a break out of for await (console)"];
    const script = lateLine(door, `got.push("confirm:" + confirm("ok?"));`);
    expect(await drive(script, { "let go": "y\n" }, { output: { "READING\n": "three\n" } })).toEqual({
      stdout: "READING\nok? [y/N] " + JSON.stringify(["console:one", "confirm:true", "console:three"]) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("every byte that arrives after a console loop ended stays on stdin", async () => {
    // 20,000 lines of 10 bytes: more than the source reads ahead, and the order shows in the hash.
    const late = Array.from({ length: 20_000 }, (_, i) => String(i).padStart(9, "0") + "\n").join("");
    const script = `
      for await (const line of console) break;
      await ask("let go");
      await ask("turn");
      const hash = new Bun.CryptoHasher("sha1");
      const chunk = Buffer.alloc(65536);
      let bytes = 0;
      for (let n; (n = fs.readSync(0, chunk)) > 0; bytes += n) hash.update(chunk.subarray(0, n));
      console.log(JSON.stringify({ bytes, sha1: hash.digest("hex") }));
      process.exit(0);
    `;
    expect(await drive(script, { "let go": late }, { end: "let go" })).toEqual({
      stdout:
        JSON.stringify({ bytes: late.length, sha1: new Bun.CryptoHasher("sha1").update(late).digest("hex") }) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // Each new reader makes the stopped source read again. That read has a limit, or every loop adds a chunk to the
  // buffer of the source.
  test("console loops that end early do not read more of stdin each time", async () => {
    const loops = 300;
    const feed = Buffer.alloc(8 * 1024 * 1024, "123456789\n").toString();
    const script = `
      await ask("feed");
      let lines = 0;
      for (let i = 0; i < ${loops}; i++) {
        for await (const line of console) {
          lines++;
          break;
        }
      }
      // What the stream did not take is still on stdin.
      const chunk = Buffer.alloc(65536);
      let left = 0;
      for (let n; (n = fs.readSync(0, chunk)) > 0; ) left += n;
      console.log(JSON.stringify({ lines, taken: ${"one\n".length + feed.length} - left }));
      process.exit(0);
    `;
    const { stdout, stderr, exitCode } = await drive(script, { feed }, { end: "feed" });
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const { lines, taken } = JSON.parse(stdout);
    expect(lines).toBe(loops);
    expect(taken).toBeLessThan(1024 * 1024);
  });

  // The read loop goes on after a chunk of 131,072 bytes or more. A release inside the delivery of that chunk has
  // to end the loop. Linux only: a socket of macOS does not hold that much, so the chunk cannot be put there whole.
  test.skipIf(!isLinux)("a release inside the delivery of a large chunk leaves the next chunk on stdin", async () => {
    const chunk = Buffer.alloc(131072, "1234567\n").toString();
    const script = `
      await ask("first chunk");
      const reader = Bun.stdin.stream().getReader();
      const first = (await reader.read()).value.length;
      // Still inside the delivery of the first chunk. The test writes the second chunk, and this takes 1 byte of it.
      fs.writeSync(1, "INSIDE\\n");
      fs.readSync(0, Buffer.alloc(1));
      reader.releaseLock();
      await ask("turn");
      await ask("turn");
      const rest = Buffer.alloc(65536);
      let left = 0;
      for (let n; (n = fs.readSync(0, rest)) > 0; ) left += n;
      console.log(JSON.stringify({ first, left }));
      process.exit(0);
    `;
    expect(
      await drive(script, { "first chunk": chunk }, { first: "", output: { "INSIDE\n": chunk }, end: "turn" }),
    ).toEqual({
      stdout: "INSIDE\n" + JSON.stringify({ first: chunk.length, left: chunk.length - 1 }) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // The price of the stop: the source does not watch stdin, so it learns that stdin ended from its next reader.
  test("a stopped stream sees the end of stdin when its next reader attaches", async () => {
    const { seen, door } = streamDoors["a break out of for await (console)"];
    const script = `
      import { finished } from "node:stream/promises";
      ${door}
      let ended = false;
      const end = finished(Bun.stdin.stream()).then(() => (ended = true));
      await ask("let go");
      await ask("turn");
      got.push("ended while stopped: " + ended);
      got.push("done: " + (await Bun.stdin.stream().getReader().read()).done);
      await end;
      got.push("ended: " + ended);
      console.log(JSON.stringify(got));
      process.exit(0);
    `;
    expect(await drive(script, {}, { end: "let go" })).toEqual({
      stdout: JSON.stringify([...seen, "ended while stopped: false", "done: true", "ended: true"]) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  describe.skipIf(isWindows)("stdin is a FIFO", () => {
    const { seen, door } = streamDoors["reader.releaseLock()"];

    test("a synchronous read of fd 0 gets the line that arrives next", async () => {
      const script = lateLine(door, `got.push("sync:" + readLineSync());`);
      expect(await drive(script, { "let go": "two\n" }, { output: { "READING\n": "three\n" }, fifo: true })).toEqual({
        stdout: "READING\n" + JSON.stringify([...seen, "sync:two", "console:three"]) + "\n",
        stderr: "",
        exitCode: 0,
      });
    });

    // The writer goes away while the source is stopped. The next reader gets what it left and then the end.
    // Linux only: kqueue doesn't tell a FIFO reader that the last writer closed.
    test.skipIf(!isLinux)("the next reader reads the rest after the writer closed", async () => {
      const script = `
        ${door}
        await ask("let go");
        await ask("turn");
        for await (const line of console) got.push(line);
        console.log(JSON.stringify(got));
        process.exit(0);
      `;
      expect(await drive(script, { "let go": "two\nthree" }, { end: "let go", fifo: true })).toEqual({
        stdout: JSON.stringify([...seen, "two", "three"]) + "\n",
        stderr: "",
        exitCode: 0,
      });
    });
  });

  // The child reads the terminal through its event loop, as an editor or a REPL does. A parent that still reads
  // takes some of the lines. Not on Windows: the source of a console does not stop at a release there.
  test.skipIf(isWindows).each(["a break out of for await (console)", "reader.releaseLock()"] as const)(
    "on a terminal, a child process gets every line after %s",
    async name => {
      using dir = tempDir("stdin-release-terminal", {
        "child.js": `
          console.log("CHILD-READY");
          process.stdin.on("data", chunk => {
            const line = chunk.toString().trim();
            console.log("child got " + line);
            if (line === "end") process.exit(0);
          });
        `,
        "parent.js": `
          const got = [];
          ${streamDoors[name].door}
          const child = Bun.spawn({ cmd: [process.execPath, "child.js"], stdio: ["inherit", "inherit", "inherit"] });
          await child.exited;
          console.log("PARENT-DONE " + JSON.stringify(got));
        `,
      });
      const decoder = new TextDecoder();
      let output = "";
      let waiting: { marker: string; resolve: () => void } | undefined;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "parent.js"],
        cwd: String(dir),
        env: bunEnv,
        terminal: {
          data(_terminal, chunk) {
            output += decoder.decode(chunk, { stream: true });
            if (waiting && output.includes(waiting.marker)) waiting.resolve();
          },
        },
      });
      await using terminal = proc.terminal!;
      function waitFor(marker: string) {
        return new Promise<void>((resolve, reject) => {
          waiting = { marker, resolve };
          proc.exited.then(code =>
            reject(new Error(`child exited with ${code} before ${marker}; output=${JSON.stringify(output)}`)),
          );
          if (output.includes(marker)) resolve();
        });
      }
      terminal.write("one\r");
      await waitFor("CHILD-READY");
      for (const line of ["l1", "l2", "l3", "l4", "l5", "l6", "l7", "l8", "end"]) {
        terminal.write(line + "\r");
        await waitFor("child got " + line);
      }
      await waitFor("PARENT-DONE");
      expect(output).toContain(`PARENT-DONE ${JSON.stringify(streamDoors[name].seen)}`);
      expect(await proc.exited).toBe(0);
    },
  );

  // Only a stream of this process's stdin, stdout or stderr stops at a release. Any other pipe is read to its end:
  // the source has to see the writer close it, or its descriptor stays open.
  test("a released reader of a child's stdout still sees the pipe end", async () => {
    const script = `
      import { finished } from "node:stream/promises";
      const child = Bun.spawn({
        cmd: [process.execPath, "-e", "console.log('one'); process.stdin.on('data', () => {});"],
        stdin: "pipe",
        stdout: "pipe",
        stderr: "inherit",
      });
      const reader = child.stdout.getReader();
      console.log(Buffer.from((await reader.read()).value).toString().trim());
      reader.releaseLock();
      // The child exits at the end of its stdin, and it writes nothing more.
      await child.stdin.end();
      await finished(child.stdout);
      console.log("ended");
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], stdout: "pipe", stderr: "pipe", env: bunEnv });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "one\nended\n", stderr: "", exitCode: 0 });
  });

  // The same for a pipe that is not fd 0, 1 or 2. The child reads it through Bun.file(fd), as it reads stdin.
  // Linux only: the pipe is a FIFO, and kqueue doesn't tell its reader that the last writer closed.
  test.skipIf(!isLinux)("a released reader of Bun.file(fd) over a pipe still sees the pipe end", async () => {
    using dir = tempDir("stdin-scope-fifo", {});
    const path = join(String(dir), "pipe");
    mkfifo(path);
    const script = `
      import fs from "node:fs";
      import { finished } from "node:stream/promises";
      const stream = Bun.file(fs.openSync(process.argv[1], "r")).stream();
      const reader = stream.getReader();
      console.log(Buffer.from((await reader.read()).value).toString().trim());
      reader.releaseLock();
      console.log("released");
      await finished(stream);
      console.log("ended");
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script, path], stdout: "pipe", stderr: "pipe", env: bunEnv });
    const stderr = proc.stderr.text();
    const writer = await fsPromises.open(path, "w");
    let stdout = "";
    const decoder = new TextDecoder();
    let closed = false;
    try {
      writeSync(writer.fd, "one\n");
      for await (const chunk of proc.stdout) {
        stdout += decoder.decode(chunk, { stream: true });
        // The writer closes the pipe only after the child released its reader.
        if (!closed && stdout.includes("released\n")) {
          closed = true;
          await writer.close();
        }
      }
    } finally {
      if (!closed) await writer.close();
    }
    expect({ stdout, stderr: await stderr, exitCode: await proc.exited }).toEqual({
      stdout: "one\nreleased\nended\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // A source that reads on after a release drops its ref, or a released reader of a silent child holds the process.
  test("a released reader of a child's stdout lets the process exit", async () => {
    const script = `
      (async () => {
        // The child stays until its stdin ends, and that is when this process is gone.
        const child = Bun.spawn({
          cmd: [process.execPath, "-e", "console.log('one'); process.stdin.on('data', () => {});"],
          stdin: "pipe",
          stdout: "pipe",
          stderr: "inherit",
        });
        const reader = child.stdout.getReader();
        const read = reader.read();
        // Now only the source keeps the process alive.
        child.unref();
        console.log(Buffer.from((await read).value).toString().trim());
        reader.releaseLock();
      })();
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], stdout: "pipe", stderr: "pipe", env: bunEnv });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stdout: "one\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
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

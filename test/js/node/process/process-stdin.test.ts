import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { exec } from "node:child_process";

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

// The children above have a top-level await, which keeps them alive. These do not: the next reader has to
// keep the process alive until stdin ends, and it has to stop when it lets go of stdin too.
describe("the next reader of stdin after process.stdin lets go of it", () => {
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

  describe.each(Object.entries(doors))("%s", (_, { first, seen, door }) => {
    const steps: [string | null, string][] = first ? [[null, first]] : [];

    test.concurrent.each(Object.entries(consumers))("%s reads the rest of stdin", async (_, { all }) => {
      expect(await run(child(door, all), [...steps, ["READY\n", "two\nthree"]])).toEqual({
        stdout: "READY\n" + JSON.stringify([...seen, "two", "three"]) + "\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    test.concurrent.each(Object.entries(consumers))("%s lets the process exit after one chunk", async (_, { one }) => {
      expect(await run(child(door, one), [...steps, ["READY\n", "two\n"]], { end: false })).toEqual({
        stdout: "READY\n" + JSON.stringify([...seen, "two"]) + "\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });

    test.concurrent("the process exits when nothing reads stdin again", async () => {
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

  test.skipIf(isWindows).concurrent("the console iterator reads the rest of stdin over a shell pipe", async () => {
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

  test.concurrent("after process.stdin.unref(), the next reader does not keep the process alive", async () => {
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

  test.concurrent("process.stdin takes stdin back after the next reader releases it", async () => {
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
  test.skipIf(isWindows).concurrent("the console iterator after a readline prompt on a terminal", async () => {
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

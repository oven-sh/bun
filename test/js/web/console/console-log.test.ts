import { file, spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";

it("should log to console correctly", async () => {
  const { stdout, stderr, exited } = spawn({
    cmd: [bunExe(), join(import.meta.dir, "console-log.js")],
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });
  const exitCode = await exited;
  const err = (await stderr.text()).replaceAll("\r\n", "\n");
  const out = (await stdout.text()).replaceAll("\r\n", "\n");
  const expected = (await new Response(file(join(import.meta.dir, "console-log.expected.txt"))).text()).replaceAll(
    "\r\n",
    "\n",
  );

  const errMatch = err === "uh oh\n";
  const outmatch = out === expected;

  if (errMatch && outmatch && exitCode === 0) {
    expect().pass();
    return;
  }

  console.error(err);
  console.log("Length of output:", out.length);
  console.log("Length of expected:", expected.length);
  console.log("Exit code:", exitCode);

  expect(out).toBe(expected);
  expect(err).toBe("uh oh\n");
  expect(exitCode).toBe(0);
});

it("long arrays get cutoff", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(Array(1000).fill(0))).toEqual(
    "[\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  ... 900 more items\n" +
      "]",
  );
});

it("long arrays get cutoff at a nested indent", () => {
  const row = "          4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4,\n";
  expect(Bun.inspect([[[[Array(1000).fill(4)]]]], { depth: 5 })).toEqual(
    "[\n  [\n    [\n      [\n        [\n" +
      row +
      row +
      row +
      row +
      "          4, 4, 4, 4,\n" +
      "          ... 900 more items\n" +
      "        ]\n      ]\n    ]\n  ]\n]",
  );
});

it("console.group", async () => {
  const filepath = join(import.meta.dir, "console-group.fixture.js").replaceAll("\\", "/");
  const proc = Bun.spawnSync({
    cmd: [bunExe(), filepath],
    env: { ...bunEnv, "BUN_JSC_showPrivateScriptsInStackTraces": "0" },
    stdio: ["inherit", "pipe", "pipe"],
  });
  expect(proc.exitCode).toBe(0);
  let stdout = proc.stdout
    .toString("utf8")
    .replaceAll("\r\n", "\n")
    .replaceAll("\\", "/")
    .trim()
    .replaceAll(filepath, "<file>");
  let stderr = proc.stderr
    .toString("utf8")
    .replaceAll("\r\n", "\n")
    .replaceAll("\\", "/")
    .trim()
    .replaceAll(filepath, "<file>")
    // Normalize line numbers for consistency between debug and release builds
    .replace(/\(\d+:\d+\)/g, "(N:NN)")
    .replace(/<file>:\d+:\d+/g, "<file>:NN:NN");
  expect(stdout).toMatchInlineSnapshot(`
"Basic group
  Inside basic group
Outer group
  Inside outer group
  Inner group
    Inside inner group
  Back to outer group
Level 1
  Level 2
    Level 3
      Deep inside
undefined
Empty nested
Test extra end
  Inside
Different logs
  Regular log
  Info log
  Debug log
Complex types
  {
    a: 1,
    b: 2,
  }
  [ 1, 2, 3 ]
null
  undefined
    0
      false
        
          Inside falsy groups
🎉 Unicode!
  Inside unicode group
  Tab\tNewline
Quote"Backslash
    Special chars"
`);
  expect(stderr).toMatchInlineSnapshot(`
"Warning log
  warn: console.warn an error
      at <file>:NN:NN

  52 | console.group("Different logs");
53 | console.log("Regular log");
54 | console.info("Info log");
55 | console.warn("Warning log");
56 | console.warn(new Error("console.warn an error"));
57 | console.error(new Error("console.error an error"));
                       ^
error: console.error an error
      at <file>:NN:NN

  53 | console.log("Regular log");
54 | console.info("Info log");
55 | console.warn("Warning log");
56 | console.warn(new Error("console.warn an error"));
57 | console.error(new Error("console.error an error"));
58 | console.error(new NamedError("console.error a named error"));
                   ^
NamedError: console.error a named error
      at <file>:NN:NN

  NamedError: console.warn a named error
      at <file>:NN:NN

  Error log"
`);
});

it("console.log with SharedArrayBuffer", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(new ArrayBuffer(0))).toBe("ArrayBuffer(0) []");
  expect(Bun.inspect(new SharedArrayBuffer(0))).toBe("SharedArrayBuffer(0) []");
  expect(Bun.inspect(new ArrayBuffer(3))).toBe("ArrayBuffer(3) [ 0, 0, 0 ]");
  expect(Bun.inspect(new SharedArrayBuffer(3))).toBe("SharedArrayBuffer(3) [ 0, 0, 0 ]");
});

// A console call formats its whole message first and then hands it to the fd once, as Node does. A second
// process or thread that writes to the same file or pipe can then never land inside the line.
describe.concurrent("one console call is one write", () => {
  const custom = `Symbol.for("nodejs.util.inspect.custom")`;

  async function run(script: string) {
    await using proc = spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // Runs `script` with stdout and stderr as regular files. The script reports through $REPORT.
  async function runToFiles(script: string) {
    using dir = tempDir("console-one-write", {});
    const path = (name: string) => join(String(dir), name);
    await using proc = spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, REPORT: path("report.json") },
      stdout: file(path("stdout.txt")),
      stderr: file(path("stderr.txt")),
    });
    const exitCode = await proc.exited;
    const [stdout, stderr] = await Promise.all([file(path("stdout.txt")).text(), file(path("stderr.txt")).text()]);
    const report = await file(path("report.json"))
      .json()
      .catch(() => undefined);
    return { stdout, stderr, report, exitCode };
  }

  // A value with an inspect hook reads the size of the stream's file while its own console call still
  // formats. Any byte that left before the end of the call shows up as a size above 0.
  it.each([
    ["log", 1],
    ["error", 2],
  ] as const)("console.%s writes nothing before the whole call is formatted", async (method, fd) => {
    const { stdout, stderr, report, exitCode } = await runToFiles(`
      const fs = require("fs");
      let during;
      const probe = { [${custom}]() { during = fs.fstatSync(${fd}).size; return "probe"; } };
      const a = Buffer.alloc(5000, "a").toString(), b = Buffer.alloc(5000, "b").toString();
      console.${method}(a, probe, b);
      fs.writeFileSync(process.env.REPORT, JSON.stringify({ during, after: fs.fstatSync(${fd}).size }));
    `);
    const line = Buffer.alloc(5000, "a") + " probe " + Buffer.alloc(5000, "b") + "\n";
    expect({ stdout, stderr }).toEqual(fd === 1 ? { stdout: line, stderr: "" } : { stdout: "", stderr: line });
    expect(report).toEqual({ during: 0, after: line.length });
    expect(exitCode).toBe(0);
  });

  it("a console call made while another one formats is written first, and the outer line stays whole", async () => {
    expect(
      await run(`
        const hook = { [${custom}]() { console.log("inner"); return "hook"; } };
        console.log("outer-start", hook, "outer-end");
      `),
    ).toEqual({ stdout: "inner\nouter-start hook outer-end\n", stderr: "", exitCode: 0 });
  });

  it("a console call whose formatting throws writes nothing", async () => {
    expect(
      await run(`
        const hook = { [${custom}]() { throw new Error("boom"); } };
        try {
          console.log("before", hook, "after");
        } catch (e) {
          console.error("caught", e.message);
        }
      `),
    ).toEqual({ stdout: "", stderr: "caught boom\n", exitCode: 0 });
  });

  it("process.exit() while a console call formats leaves nothing of that call", async () => {
    expect(
      await run(`
        const hook = { [${custom}]() { process.exit(0); } };
        console.log(Buffer.alloc(5000, "a").toString(), hook);
      `),
    ).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("console.groupCollapsed() with no label prints nothing", async () => {
    const { stdout, stderr, exitCode } = await run(`console.groupCollapsed(); console.log("next");`);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("next");
    expect(exitCode).toBe(0);
  });

  // Each Worker is inside a console call (its inspect hook runs), waits until the other Worker is inside its
  // own console call, and then logs to the other stream. No lock may be held while the hook runs.
  it("two threads that log to each other's stream from an inspect hook do not block each other", async () => {
    using dir = tempDir("console-two-workers", {
      "main.mjs": `
        const flags = new SharedArrayBuffer(8);
        let done = 0;
        for (const kind of ["stdout-first", "stderr-first"]) {
          const worker = new Worker(new URL("./worker.mjs", import.meta.url).href);
          worker.addEventListener("message", () => {
            if (++done === 2) process.exit(0);
          });
          worker.postMessage({ flags, kind });
        }
      `,
      "worker.mjs": `
        self.onmessage = ({ data: { flags, kind } }) => {
          const inside = new Int32Array(flags);
          const me = kind === "stdout-first" ? 0 : 1;
          const hook = {
            [${custom}]() {
              Atomics.store(inside, me, 1);
              Atomics.notify(inside, me);
              while (Atomics.load(inside, 1 - me) !== 1) Atomics.wait(inside, 1 - me, 0);
              if (kind === "stdout-first") console.error("inner-stderr");
              else console.log("inner-stdout");
              return kind;
            },
          };
          if (kind === "stdout-first") console.log(hook);
          else console.error(hook);
          postMessage("done");
        };
      `,
    });
    await using proc = spawn({
      cmd: [bunExe(), "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({
      stdout: stdout.split("\n").sort(),
      stderr: stderr.split("\n").sort(),
    }).toEqual({
      stdout: ["", "inner-stdout", "stdout-first"],
      stderr: ["", "inner-stderr", "stderr-first"],
    });
    expect(exitCode).toBe(0);
  });

  // A line of 256 KiB fits no pipe or socket buffer. process.stdout puts O_NONBLOCK on the fd, so the one write
  // of a console call stops somewhere inside the line and the rest follows after EAGAIN. The payload does not
  // repeat within a pipe buffer, so a range that is skipped or sent twice changes the hash.
  const makePayload = `const pattern = Buffer.alloc(65521);
    for (let i = 0; i < pattern.length; i++) pattern[i] = 48 + ((Math.imul(i, 2654435761) >>> 16) % 75);
    const payload = Buffer.alloc(256 * 1024, pattern).toString("latin1");`;
  const payload: string = new Function(`${makePayload} return payload;`)();
  const logLargeLines = `console.log(payload);
    console.log(payload, 1);
    console.log("head", payload, "tail");
    console.log(payload, payload);`;
  const largeLines = `${payload}\n${payload} 1\nhead ${payload} tail\n${payload} ${payload}\n`;
  // Length and hash instead of the bytes: a mismatch would otherwise print megabytes of diff.
  const digest = (bytes: Uint8Array | string) => ({ length: bytes.length, hash: Bun.hash(bytes) });

  it.skipIf(isWindows)("large lines arrive whole and in order over a nonblocking socket", async () => {
    await using proc = spawn({
      cmd: [bunExe(), "-e", `${makePayload} void process.stdout.isTTY; ${logLargeLines}`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(digest(stdout)).toEqual(digest(largeLines));
    expect(exitCode).toBe(0);
  });

  it.skipIf(isWindows)("large lines arrive whole and in order over a nonblocking pipe", async () => {
    await using proc = spawn({
      cmd: ["sh", "-c", `"$0" -e "$1" | cat`, bunExe(), `${makePayload} void process.stdout.isTTY; ${logLargeLines}`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(digest(stdout)).toEqual(digest(largeLines));
    expect(exitCode).toBe(0);
  });

  // /proc/thread-self/io has the number of write-family syscalls of the calling thread. Only Linux has it, and
  // only with task I/O accounting in the kernel.
  const hasWriteCounter = isLinux && existsSync("/proc/thread-self/io");
  const countWrites = `
    const fs = require("fs");
    const syscw = () => Number(fs.readFileSync("/proc/thread-self/io", "utf8").match(/^syscw: (\\d+)$/m)[1]);
    const writes = {};
    const count = (name, call) => {
      const before = syscw();
      call();
      (writes[name] ??= []).push(syscw() - before);
    };
  `;

  it.skipIf(!hasWriteCounter)("every console method is one write(2) for a message of any size", async () => {
    // 70000 bytes: more than a pipe holds, so a writer that hands over a full 64 KiB buffer early fails too.
    const sizes = [4095, 4096, 4097, 20000, 70000];
    const { report, exitCode } = await runToFiles(`
      ${countWrites}
      for (const size of ${JSON.stringify(sizes)}) {
        const s = Buffer.alloc(size, "x").toString();
        count("log", () => console.log(s));
        count("info", () => console.info(s));
        count("debug", () => console.debug(s));
        count("warn", () => console.warn(s));
        count("error", () => console.error(s));
        count("dir", () => console.dir({ s }));
        count("dirxml", () => console.dirxml(s));
        count("table", () => console.table([{ s }]));
        count("trace", () => console.trace(s));
        count("assert", () => console.assert(false, s));
        count("group", () => console.group(s));
        console.groupEnd();
        count("groupCollapsed", () => console.groupCollapsed(s));
        console.groupEnd();
        count("count", () => console.count(s));
        console.time("t");
        count("timeLog", () => console.timeLog("t", s));
        console.time(s);
        count("timeEnd", () => console.timeEnd(s));
        count("several arguments", () => console.log(s, 1, s, { s }));
        count("format string", () => console.log("%s%s", s, s));
        count("error object", () => console.error(new Error(s)));
        console.group("group");
        count("inside a group", () => console.log(s));
        console.groupEnd();
      }
      count("log, 1 MiB", () => console.log(Buffer.alloc(1 << 20, "x").toString()));
      count("trace, short", () => console.trace("short"));
      count("timeLog, short", () => console.timeLog("t", "short"));
      fs.writeFileSync(process.env.REPORT, JSON.stringify(writes));
    `);
    const once = sizes.map(() => 1);
    expect(report).toEqual({
      "log": once,
      "info": once,
      "debug": once,
      "warn": once,
      "error": once,
      "dir": once,
      "dirxml": once,
      "table": once,
      "trace": once,
      "assert": once,
      "group": once,
      "groupCollapsed": once,
      "count": once,
      "timeLog": once,
      "timeEnd": once,
      "several arguments": once,
      "format string": once,
      "error object": once,
      "inside a group": once,
      "log, 1 MiB": [1],
      "trace, short": [1],
      "timeLog, short": [1],
    });
    expect(exitCode).toBe(0);
  });

  it.skipIf(!hasWriteCounter)("bun --print writes its value with one write(2)", async () => {
    const { report, stdout, stderr, exitCode } = await runPrint();
    expect(stderr).toBe("");
    expect(stdout.length).toBe(5001);
    expect(report).toEqual({ writes: 1 });
    expect(exitCode).toBe(0);

    async function runPrint() {
      using dir = tempDir("console-print-writes", {});
      const path = (name: string) => join(String(dir), name);
      await using proc = spawn({
        cmd: [
          bunExe(),
          "--print",
          `(() => {
            const fs = require("fs");
            const syscw = () => Number(fs.readFileSync("/proc/thread-self/io", "utf8").match(/^syscw: (\\d+)$/m)[1]);
            const before = syscw();
            process.on("exit", () => fs.writeFileSync(process.env.REPORT, JSON.stringify({ writes: syscw() - before })));
            return Buffer.alloc(5000, "x").toString();
          })()`,
        ],
        env: { ...bunEnv, REPORT: path("report.json") },
        stdout: file(path("stdout.txt")),
        stderr: file(path("stderr.txt")),
      });
      const exitCode = await proc.exited;
      const [stdout, stderr] = await Promise.all([file(path("stdout.txt")).text(), file(path("stderr.txt")).text()]);
      return { stdout, stderr, exitCode, report: await file(path("report.json")).json() };
    }
  });
});

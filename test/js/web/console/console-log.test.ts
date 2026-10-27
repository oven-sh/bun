import { file, spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { closeSync, existsSync, openSync } from "node:fs";
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

it("console.dir treats a BigInt depth like the same number", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `let o = {}, c = o; for (let i = 0; i < 40; i++) { c.n = {}; c = c.n; }
       for (const depth of [7n, 7, -1n, -1]) {
         console.dir(o, { depth, colors: false });
         console.log("--");
       }`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const [big7, num7, bigNegative, numNegative] = stdout.split("--\n");
  expect(big7).toBe(num7);
  expect(bigNegative).toBe(numNegative);
  expect(exitCode).toBe(0);
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

it("console.groupCollapsed starts a group, as console.group does", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `console.groupCollapsed("Collapsed");
       console.log("in collapsed");
       console.warn("warn in collapsed");
       console.groupCollapsed();
       console.log("in collapsed with no label");
       console.groupEnd();
       console.group("Group in collapsed");
       console.log("in group in collapsed");
       console.groupEnd();
       console.groupEnd();
       console.group("Group");
       console.groupCollapsed("Collapsed in group");
       console.log("in collapsed in group");
       console.error("error in collapsed in group");
       console.groupEnd();
       console.groupCollapsed(undefined);
       console.log("in collapsed with an undefined label");
       console.groupEnd();
       console.log("back in group");
       console.groupEnd();
       console.groupCollapsed("%s has %d args", "label", 3);
       console.groupEnd();
       console.groupCollapsed();
       console.groupEnd();
       console.log("after");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout: stdout.replaceAll("\r\n", "\n"),
    stderr: stderr.replaceAll("\r\n", "\n"),
    exitCode,
  }).toEqual({
    stdout: [
      "Collapsed",
      "  in collapsed",
      "    in collapsed with no label",
      "  Group in collapsed",
      "    in group in collapsed",
      "Group",
      "  Collapsed in group",
      "    in collapsed in group",
      "  undefined",
      "    in collapsed with an undefined label",
      "  back in group",
      "label has 3 args",
      "after",
      "",
    ].join("\n"),
    stderr: ["  warn in collapsed", "    error in collapsed in group", ""].join("\n"),
    exitCode: 0,
  });
});

it("console.log with SharedArrayBuffer", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(new ArrayBuffer(0))).toBe("ArrayBuffer(0) []");
  expect(Bun.inspect(new SharedArrayBuffer(0))).toBe("SharedArrayBuffer(0) []");
  expect(Bun.inspect(new ArrayBuffer(3))).toBe("ArrayBuffer(3) [ 0, 0, 0 ]");
  expect(Bun.inspect(new SharedArrayBuffer(3))).toBe("SharedArrayBuffer(3) [ 0, 0, 0 ]");
});

// As in Node, a console message reaches the stream when it is complete. Formatting runs user code (an
// inspect hook, toJSON, toString, valueOf). A console call made from there prints first, a message whose
// formatting throws prints nothing, and the stream lock is not held while that code runs.
describe("a console message reaches the stream whole", () => {
  const big = Buffer.alloc(5001, "x").toString();
  const prelude = `
    const custom = Symbol.for("nodejs.util.inspect.custom");
    const error = new Error("boom");
    const boom = () => { throw error; };
    // %d converts with valueOf; %i, %f and %s convert with toString.
    const thrower = { valueOf: boom, toString: boom };
    const throwingHook = { [custom]: boom };
    const inner = { [custom]() { console.log("inner"); return "x"; } };
    const big = Buffer.alloc(5001, "x").toString();
  `;
  // What console.time prints, and the frames of console.trace.
  const normalize = (text: string) =>
    text
      .replaceAll(big, "<big>")
      .replace(/^\[[\d.]+m?s\] /gm, "[time] ")
      .replace(/(^ +at .*\n)+/gm, "<at>\n");

  async function run(source: string, env: Record<string, string | undefined> = {}) {
    await using proc = spawn({
      cmd: [bunExe(), "-e", prelude + source],
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: normalize(stdout), stderr: normalize(stderr), exitCode };
  }

  // Runs `source` with stdout and stderr as regular files. The script reports through $REPORT.
  async function runToFiles(source: string) {
    using dir = tempDir("console-whole-message", {});
    const path = (name: string) => join(String(dir), name);
    await using proc = spawn({
      cmd: [bunExe(), "-e", prelude + source],
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

  // Runs main.js of `files`, which starts Workers.
  async function runWorkers(files: Record<string, string>, env: Record<string, string | undefined> = {}) {
    using dir = tempDir("console-whole-message-workers", files);
    await using proc = spawn({
      cmd: [bunExe(), "main.js"],
      env: { ...bunEnv, ...env },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      // A thread that waits for a stream lock that is never released waits forever. The child is stopped
      // then, and signalCode shows it. No child of a correct build comes near this bound.
      timeout: isDebug || isASAN ? 60_000 : 10_000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // signalCode is null when the child exited by itself.
    return { stdout, stderr, exitCode, signalCode: proc.signalCode };
  }

  // Length and hash in place of the bytes: a mismatch would print hundreds of kilobytes of diff.
  const digest = (text: string) => ({ length: text.length, hash: Bun.hash(text) });

  // An object that prints about 2 KB for each key: 35 keys are over 64 KiB.
  const wide = (keys: number): Record<string, unknown> =>
    Object.fromEntries(
      Array.from({ length: keys }, (_, i) => ["key" + String(i).padStart(5, "0"), Buffer.alloc(2000, "v").toString()]),
    );
  const wideSource = `const wide = ${wide};`;
  // `object` as console.log prints it, up to the value of `key`.
  const upTo = (object: Record<string, unknown>, key: string) => {
    const text = Bun.inspect(object);
    return text.slice(0, text.indexOf(key + ": ") + key.length + 2);
  };

  describe.concurrent("with user code that runs inside it", () => {
    it("a console call made while a message is formatted prints first", async () => {
      // [call, what it prints on stdout, what it prints on stderr]
      const calls: Record<string, [string, string, string?]> = {
        "inspect.custom": [`console.log("outer", inner, "end")`, "inner\nouter x end\n"],
        "%o": [`console.log("outer %o end", inner)`, "inner\nouter x end\n"],
        "%j": [`console.log("outer %j end", { toJSON() { console.log("inner"); return 1; } })`, "inner\nouter 1 end\n"],
        "%j of a BigInt": [
          `BigInt.prototype.toJSON = function () { console.log("inner"); return 1; };
         try { console.log("outer %j end", 1n); } finally { delete BigInt.prototype.toJSON; }`,
          "inner\nouter 1 end\n",
        ],
        "%s": [
          `console.log("outer %s end", { toString() { console.log("inner"); return "x"; } })`,
          "inner\nouter x end\n",
        ],
        "%d": [
          `console.log("outer %d end", { valueOf() { console.log("inner"); return 1; } })`,
          "inner\nouter 1 end\n",
        ],
        "in an object": [`console.log({ a: 1, b: inner })`, "inner\n{\n  a: 1,\n  b: x,\n}\n"],
        "in an array": [`console.log([1, inner, 3])`, "inner\n[ 1, x, 3 ]\n"],
        "three calls deep": [
          `console.log("a %d z", { valueOf() { console.log("b %d y", { valueOf() { console.log("c"); return 2; } }); return 1; } })`,
          "c\nb 2 y\na 1 z\n",
        ],
        "an inner call that throws": [
          `console.log("a %d z", { valueOf() { try { console.log("b %d y", thrower); } catch {} return 1; } })`,
          "a 1 z\n",
        ],
        "an outer message over 4096 bytes": [`console.log(big, inner, "end")`, "inner\n<big> x end\n"],
        "an inner message over 4096 bytes": [
          `console.log("outer", { [custom]() { console.log(big, 1); return "x"; } }, "end")`,
          "<big> 1\nouter x end\n",
        ],
        "both over 4096 bytes": [
          `console.log(big, { [custom]() { console.log(big, 1); return "x"; } }, "end")`,
          "<big> 1\n<big> x end\n",
        ],
        "console.count inside": [
          `console.log("outer", { [custom]() { console.count("n"); return "x"; } }, "end")`,
          "n: 1\nouter x end\n",
        ],
        "console.dir inside": [
          `console.log("outer", { [custom]() { console.dir([1]); return "x"; } }, "end")`,
          "[ 1 ]\nouter x end\n",
        ],
        "console.log() inside": [
          `console.log("outer", { [custom]() { console.log(); return "x"; } }, "end")`,
          "\nouter x end\n",
        ],
        "console.debug inside console.info": [
          `console.info("outer", { [custom]() { console.debug("inner"); return "x"; } }, "end")`,
          "inner\nouter x end\n",
        ],
        "console.warn inside console.error": [
          `console.error("outer", { [custom]() { console.warn("inner"); return "x"; } }, "end")`,
          "",
          "inner\nouter x end\n",
        ],
        "console.timeEnd inside console.error": [
          `console.time("te"); console.error("outer", { [custom]() { console.timeEnd("te"); return "x"; } }, "end")`,
          "",
          "[time] te\nouter x end\n",
        ],
        "console.trace": [`console.trace("outer", inner, "end")`, "inner\nouter x end\n<at>\n"],
        "a group label": [`console.group("outer", inner, "end"); console.groupEnd()`, "inner\nouter x end\n"],
      };
      const { stdout, stderr, exitCode } = await run(`
      const calls = { ${Object.entries(calls)
        .map(([name, [call]]) => `${JSON.stringify(name)}() { ${call}; }`)
        .join(", ")} };
      for (const name in calls) {
        calls[name]();
        console.log(name);
        console.error(name);
      }
    `);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: Object.entries(calls)
          .map(([name, [, out]]) => out + name + "\n")
          .join(""),
        stderr: Object.entries(calls)
          .map(([name, [, , err = ""]]) => err + name + "\n")
          .join(""),
        exitCode: 0,
      });
    });

    it("a message whose formatting throws prints nothing", async () => {
      const calls: Record<string, string> = {
        "%d": `console.log("a %d z", thrower)`,
        "%i": `console.log("a %i z", thrower)`,
        "%f": `console.log("a %f z", thrower)`,
        "%s": `console.log("a %s z", thrower)`,
        "%s with Symbol.toPrimitive": `console.log("a %s z", { [Symbol.toPrimitive]: boom })`,
        "%o": `console.log("a %o z", throwingHook)`,
        "%O": `console.log("a %O z", throwingHook)`,
        "%j": `console.log("a %j z", { toJSON: boom })`,
        // Only a message of one string goes out before it ends: a BigInt converts with user code too.
        "%j of a BigInt after 5001 bytes": `BigInt.prototype.toJSON = boom;
        try { console.log(big + " %j z", 1n); } finally { delete BigInt.prototype.toJSON; }`,
        "the second specifier": `console.log("a %d b %d z", 1, thrower)`,
        "no format string": `console.log("a", throwingHook, "z")`,
        "in an object": `console.log({ a: 1, b: throwingHook })`,
        "in an array": `console.log([1, throwingHook, 3])`,
        "in a Map": `console.log(new Map([["a", throwingHook]]))`,
        "in a Set": `console.log(new Set([1, throwingHook]))`,
        "a hook that returns a String object": `console.log("a", { [custom]: () => Object.assign(new String("s"), { toString: boom }) }, "z")`,
        "after 5001 bytes": `console.log(big + " %d z", thrower)`,
        "console.info": `console.info("a %d z", thrower)`,
        "console.debug": `console.debug("a %d z", thrower)`,
        "console.warn": `console.warn("a %d z", thrower)`,
        "console.error": `console.error("a %d z", thrower)`,
        "console.trace": `console.trace("a %d z", thrower)`,
        "console.dir": `console.dir({ a: 1, b: throwingHook })`,
        "console.dirxml": `console.dirxml("a", throwingHook)`,
        "console.table": `console.table([{ a: throwingHook }])`,
        "console.group": `try { console.group("a %d z", thrower); } finally { console.groupEnd(); }`,
      };
      const { stdout, stderr, exitCode } = await run(`
      const calls = { ${Object.entries(calls)
        .map(([name, call]) => `${JSON.stringify(name)}() { ${call}; }`)
        .join(", ")} };
      for (const name in calls) {
        let thrown;
        try { calls[name](); } catch (e) { thrown = e; }
        const line = thrown === error ? name : name + ": did not throw";
        console.log(line);
        console.error(line);
      }
      // The engine throws this one.
      try { console.log(big + " %j z", 1n); } catch (e) { console.log(e instanceof TypeError); }
    `);
      const names = Object.keys(calls).join("\n") + "\n";
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: names + "true\n", stderr: names, exitCode: 0 });
    });

    it("console.assert", async () => {
      expect(
        await run(`
        try { console.assert(false, "a %d z", thrower); } catch {}
        console.error("after a throw");
        console.assert(false, "outer", { [custom]() { console.error("inner"); return "x"; } }, "end");
        console.error("outer", { [custom]() { console.assert(false); return "x"; } }, "end");
      `),
      ).toEqual({
        stdout: "",
        stderr: "after a throw\ninner\nouter x end\nAssertion failed\nouter x end\n",
        exitCode: 0,
      });
    });

    it("console.group", async () => {
      expect(
        await run(`
        console.group("group");
        console.log("outer", inner, "end");
        try { console.log("a %d z", thrower); } catch {}
        console.log("inside");
        console.groupEnd();
        console.group("label", inner);
        console.log("in the group");
      `),
      ).toEqual({
        stdout: "group\n  inner\n  outer x end\n  inside\ninner\nlabel x\n  in the group\n",
        stderr: "",
        exitCode: 0,
      });
    });

    it("console.error that throws leaves no colour open", async () => {
      expect(
        await run(`try { console.error("a %d z", thrower); } catch {} console.error("next");`, {
          NO_COLOR: undefined,
          FORCE_COLOR: "1",
        }),
      ).toEqual({ stdout: "", stderr: "\x1b[0m\x1b[31mnext\x1b[0m\n", exitCode: 0 });
    });

    it("process.exit() while a message is formatted prints nothing of it", async () => {
      expect(await run(`console.log(big, { [custom]() { process.exit(0); } });`)).toEqual({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });
    });

    // console.trace reads the `stack` of an Error after it formats its arguments. That is user code too.
    it("console.trace of one string is complete before it prints", async () => {
      expect(
        await run(`
        Error.stackTraceLimit = 0;
        Object.defineProperty(Error.prototype, "stack", {
          configurable: true,
          get() { console.log("inner"); return "Error: x\\n    at fake (/fake/file.js:1:1)"; },
        });
        console.trace(big);
      `),
      ).toEqual({ stdout: "inner\n<big>\n<at>\n", stderr: "", exitCode: 0 });
    });
  });

  // One test at a time: each child has two or three threads that run at once.
  describe("with another thread", () => {
    it("a Worker can log while another thread is inside a hook", async () => {
      expect(
        await runWorkers({
          "main.js": `
          const ia = new Int32Array(new SharedArrayBuffer(8));
          const worker = new Worker(new URL("./worker.js", import.meta.url).href);
          await new Promise(resolve => (worker.onmessage = resolve));
          worker.postMessage(ia.buffer);
          console.log("main %s end", {
            toString() {
              // ia[0]: this thread is inside its hook. ia[1]: the worker has logged.
              Atomics.store(ia, 0, 1);
              Atomics.notify(ia, 0);
              // A build that holds the stream lock here keeps the worker out, and this wait does not end.
              Atomics.wait(ia, 1, 0);
              return "woke";
            },
          });
          worker.terminate();
        `,
          "worker.js": `
          self.onmessage = ({ data }) => {
            const ia = new Int32Array(data);
            Atomics.wait(ia, 0, 0);
            console.log("worker line");
            Atomics.store(ia, 1, 1);
            Atomics.notify(ia, 1);
          };
          postMessage("ready");
        `,
        }),
      ).toEqual({ stdout: "worker line\nmain woke end\n", stderr: "", exitCode: 0, signalCode: null });
    });

    // Each Worker is inside a console call (its inspect hook runs), waits until the other Worker is inside
    // its own console call, and then logs to the other stream. With a stream lock held while the hook runs,
    // each thread waits for the lock of the other.
    it("two threads that log to each other's stream from a hook do not block each other", async () => {
      const { stdout, stderr, exitCode, signalCode } = await runWorkers({
        "main.js": `
        const flags = new SharedArrayBuffer(8);
        let done = 0;
        for (const kind of ["stdout-first", "stderr-first"]) {
          const worker = new Worker(new URL("./worker.js", import.meta.url).href);
          worker.addEventListener("message", () => {
            if (++done === 2) process.exit(0);
          });
          worker.postMessage({ flags, kind });
        }
      `,
        "worker.js": `
        self.onmessage = ({ data: { flags, kind } }) => {
          const inside = new Int32Array(flags);
          const me = kind === "stdout-first" ? 0 : 1;
          const hook = {
            [Symbol.for("nodejs.util.inspect.custom")]() {
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
      expect({ stdout: stdout.split("\n").sort(), stderr: stderr.split("\n").sort(), exitCode, signalCode }).toEqual({
        stdout: ["", "inner-stdout", "stdout-first"],
        stderr: ["", "inner-stderr", "stderr-first"],
        exitCode: 0,
        signalCode: null,
      });
    });
    // A Worker prints short lines while the main thread prints messages over 64 KiB. No line of the Worker
    // lands inside a message of the main thread.
    it("console.count and console.timeLog of another thread do not land inside a message", async () => {
      const { stdout, stderr, exitCode, signalCode } = await runWorkers({
        "main.js": `
        ${wideSource}
        // flags[0]: how many times the Worker printed. flags[1]: the main thread is done.
        const flags = new Int32Array(new SharedArrayBuffer(8));
        const worker = new Worker(new URL("./worker.js", import.meta.url).href);
        worker.postMessage(flags.buffer);
        Atomics.wait(flags, 0, 0);
        const object = wide(35);
        // Until the Worker printed 20 more times: it then printed while this thread did.
        const start = Atomics.load(flags, 0);
        for (let round = 0; round < 40 && Atomics.load(flags, 0) - start < 20; round++) {
          console.log(object);
          console.error(object);
        }
        Atomics.store(flags, 1, 1);
        worker.terminate();
      `,
        "worker.js": `
        self.onmessage = ({ data }) => {
          const flags = new Int32Array(data);
          console.time("t");
          while (Atomics.load(flags, 1) === 0) {
            console.count("WORKER");
            console.timeLog("t", "WORKER");
            Atomics.add(flags, 0, 1);
            Atomics.notify(flags, 0);
          }
        };
      `,
      });
      const message = Bun.inspect(wide(35)) + "\n";
      // The lines of the Worker, and the messages of the main thread that are left without them.
      const split = (text: string, workerLine: RegExp) => {
        let inside = 0;
        let open = false;
        const rest: string[] = [];
        for (const line of text.split("\n")) {
          if (workerLine.test(line)) {
            if (open) inside++;
            continue;
          }
          if (line === "{") open = true;
          if (line === "}") open = false;
          rest.push(line);
        }
        const messages = rest.join("\n");
        const rounds = messages.length / message.length;
        return { inside, rounds: rounds >= 1, messages: messages === message.repeat(rounds) };
      };
      expect({
        stdout: split(stdout, /^WORKER: \d+$/),
        stderr: split(stderr, /^\[[\d.]+m?s\] t WORKER$/),
        exitCode,
        signalCode,
      }).toEqual({
        stdout: { inside: 0, rounds: true, messages: true },
        stderr: { inside: 0, rounds: true, messages: true },
        exitCode: 0,
        signalCode: null,
      });
    });

    // A message that went out before its end holds the stream lock to its end. Only another thread can see
    // that the lock was given back.
    it("the stream lock is given back after a message over 64 KiB or of one long string", async () => {
      const object = wide(42);
      const line = Buffer.alloc(5001, "x").toString();
      const { stdout, stderr, exitCode, signalCode } = await runWorkers({
        "main.js": `
        const worker = new Worker(new URL("./worker.js", import.meta.url).href);
        worker.onmessage = () => {
          console.log("main line");
          console.error("main line");
          worker.terminate();
        };
      `,
        "worker.js": `
        ${wideSource}
        const object = wide(42);
        const line = Buffer.alloc(5001, "x").toString();
        for (const log of [console.log, console.error]) {
          log(object);
          log(line);
          // What went out before the throw stays on the stream: the message up to the value that threw.
          const value = object.key00035;
          object.key00035 = { [Symbol.for("nodejs.util.inspect.custom")]() { throw new Error("boom"); } };
          try { log(object); } catch {}
          object.key00035 = value;
          log("");
        }
        postMessage("done");
      `,
      });
      const expected = digest(`${Bun.inspect(object)}\n${line}\n${upTo(object, "key00035")}\nmain line\n`);
      expect({ stdout: digest(stdout), stderr: digest(stderr), exitCode, signalCode }).toEqual({
        stdout: expected,
        stderr: expected,
        exitCode: 0,
        signalCode: null,
      });
    });

    it.each(["exits", "is terminated"])(
      "the stream lock is given back when a Worker %s inside a message over 64 KiB",
      async how => {
        const object = wide(42);
        const { stdout, stderr, exitCode, signalCode } = await runWorkers({
          "main.js": `
            const worker = new Worker(new URL("./worker.js", import.meta.url).href, { argv: [${JSON.stringify(how)}] });
            worker.addEventListener("message", () => worker.terminate());
            worker.addEventListener("close", () => console.log("\\nafter the Worker"));
          `,
          "worker.js": `
            ${wideSource}
            const object = wide(42);
            object.key00035 = {
              [Symbol.for("nodejs.util.inspect.custom")]() {
                if (process.argv[2] === "exits") process.exit(0);
                postMessage("inside the hook");
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
              },
            };
            console.log(object);
          `,
        });
        expect({ stdout: digest(stdout), stderr, exitCode, signalCode }).toEqual({
          stdout: digest(`${upTo(object, "key00035")}\nafter the Worker\n`),
          stderr: "",
          exitCode: 0,
          signalCode: null,
        });
      },
    );

    // process.exit() on the main thread does not return to the message. With BUN_DESTRUCT_VM_ON_EXIT the exit
    // then waits for the Worker, and the Worker waits for the stream lock.
    it("the stream lock is given back when process.exit() runs inside a message over 64 KiB", async () => {
      const object = wide(42);
      const { stdout, stderr, exitCode, signalCode } = await runWorkers(
        {
          "main.js": `
          ${wideSource}
          const worker = new Worker(new URL("./worker.js", import.meta.url).href);
          await new Promise(resolve => (worker.onmessage = resolve));
          const object = wide(42);
          object.key00035 = { [Symbol.for("nodejs.util.inspect.custom")]() { process.exit(0); } };
          console.log(object);
        `,
          "worker.js": `
          postMessage("ready");
          for (;;) console.log("worker line");
        `,
        },
        { BUN_DESTRUCT_VM_ON_EXIT: "1" },
      );
      // The lines of the Worker are before the message or after what the exit left of it.
      expect({ stdout: digest(stdout.replaceAll("worker line\n", "")), stderr, exitCode, signalCode }).toEqual({
        stdout: digest(upTo(object, "key00035")),
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    });
  });

  describe.concurrent("of any length", () => {
    // The inspect hook reads the size of the stream's file while its own console call still formats. Any
    // byte that left before the end of the call shows up as a size above 0.
    it.each([
      ["log", 1],
      ["error", 2],
    ] as const)("console.%s writes nothing before the message is complete", async (method, fd) => {
      const { stdout, stderr, report, exitCode } = await runToFiles(`
      const fs = require("fs");
      let during;
      const probe = { [custom]() { during = fs.fstatSync(${fd}).size; return "probe"; } };
      console.${method}(big, probe, big);
      fs.writeFileSync(process.env.REPORT, JSON.stringify({ during, after: fs.fstatSync(${fd}).size }));
    `);
      const line = `${big} probe ${big}\n`;
      expect({ stdout, stderr, report, exitCode }).toEqual({
        stdout: fd === 1 ? line : "",
        stderr: fd === 2 ? line : "",
        report: { during: 0, after: line.length },
        exitCode: 0,
      });
    });

    // A message over 4096 bytes ends with a write of its last byte alone. A write of more than a page can fill
    // the last page of a pipe. What process.stdout.write() then finds no room for on a nonblocking pipe is
    // queued, and the next console message would overtake it. The write of one byte leaves a page with room.
    //
    // /proc/thread-self/io has the number of write-family syscalls of the calling thread. Only Linux has it,
    // and only with task I/O accounting in the kernel.
    it.skipIf(!(isLinux && existsSync("/proc/thread-self/io")))(
      "a message of up to 64 KiB is written when it is complete, with its last byte alone when it is over 4096 bytes",
      async () => {
        const sizes = [5000, 20000, 60000];
        const { report, exitCode } = await runToFiles(`
        const fs = require("fs");
        const syscw = () => Number(fs.readFileSync("/proc/thread-self/io", "utf8").match(/^syscw: (\\d+)$/m)[1]);
        const writes = {};
        const count = (name, call) => {
          const before = syscw();
          call();
          (writes[name] ??= []).push(syscw() - before);
        };
        console.time("t");
        for (const size of ${JSON.stringify(sizes)}) {
          const s = Buffer.alloc(size, "x").toString();
          count("two arguments", () => console.log(s, 1));
          count("format string", () => console.log("%s!", s));
          count("object", () => console.dir({ s }));
          count("error", () => console.error("label", s));
          count("trace", () => console.trace(s, 1));
          count("count", () => console.count(s));
          count("timeLog", () => console.timeLog("t", s, 1));
          console.time(s);
          count("timeEnd", () => console.timeEnd(s));
        }
        // " 1" and the line feed are 3 more bytes.
        count("4096 bytes", () => console.log(Buffer.alloc(4096 - 3, "x").toString(), 1));
        count("4097 bytes", () => console.log(Buffer.alloc(4097 - 3, "x").toString(), 1));
        count("64 KiB", () => console.log(Buffer.alloc(65536 - 3, "x").toString(), 1));
        fs.writeFileSync(process.env.REPORT, JSON.stringify(writes));
      `);
        const twice = sizes.map(() => 2);
        expect({ report, exitCode }).toEqual({
          report: {
            "two arguments": twice,
            "format string": twice,
            "object": twice,
            "error": twice,
            "trace": twice,
            "count": twice,
            "timeLog": twice,
            "timeEnd": twice,
            "4096 bytes": [1],
            "4097 bytes": [2],
            "64 KiB": [2],
          },
          exitCode: 0,
        });
      },
    );

    // The first 4096 bytes of a message are on the stack of its console call.
    it("messages of 4094 to 4098 bytes", async () => {
      const sizes = [4094, 4095, 4096, 4097, 4098];
      const { stdout, stderr, exitCode } = await run(`
      console.time("t");
      for (const size of ${JSON.stringify(sizes)}) {
        const s = Buffer.alloc(size, "s").toString();
        console.log(s);
        console.error(s);
        console.group();
        console.log(s);
        console.groupEnd();
        console.log(s, 1);
        console.log({ [custom]: () => s });
        console.dir({ s });
        console.trace(s);
        console.assert(false, s);
        console.timeLog("t", s);
      }
    `);
      expect({ stdout, stderr, exitCode }).toEqual({
        stdout: sizes
          .map(size => Buffer.alloc(size, "s").toString())
          .map(s => `${s}\n  ${s}\n${s} 1\n${s}\n{\n  s: "${s}",\n}\n${s}\n<at>\n`)
          .join(""),
        stderr: sizes
          .map(size => Buffer.alloc(size, "s").toString())
          .map(s => `${s}\n${s}\n[time] t ${s}\n`)
          .join(""),
        exitCode: 0,
      });
    });

    // The hook runs after the string and one space. One byte past 64 KiB, the message is on the stream
    // before it is complete.
    it("a message is held up to 64 KiB", async () => {
      const { stdout, stderr, exitCode } = await run(`
      for (const size of [65535, 65536]) console.log(Buffer.alloc(size, "s").toString(), inner, "end");
    `);
      const string = (size: number) => Buffer.alloc(size, "s").toString();
      expect({ stdout: digest(stdout), stderr, exitCode }).toEqual({
        stdout: digest(`inner\n${string(65535)} x end\n${string(65536)} inner\nx end\n`),
        stderr: "",
        exitCode: 0,
      });
    });

    // Past 64 KiB a message goes out in blocks, as before.
    it("messages over 64 KiB arrive complete and in order", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `${wideSource}
        const string = Buffer.alloc(100_000, "s").toString();
        // A nonblocking pipe or socket takes a large write in pieces. process.stdout makes fd 1
        // nonblocking, and so does this, without the stream modules.
        const sink = Bun.stdout.writer();
        console.log(wide(35));
        console.log(string);
        console.log("label", string, wide(35), string);
        console.log(wide(21), string);
        console.log("end");`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const string = Buffer.alloc(100_000, "s").toString();
      expect({ stdout: digest(stdout), stderr, exitCode }).toEqual({
        stdout: digest(
          [
            Bun.inspect(wide(35)),
            string,
            `label ${string} ${Bun.inspect(wide(35))} ${string}`,
            `${Bun.inspect(wide(21))} ${string}`,
            "end",
            "",
          ].join("\n"),
        ),
        stderr: "",
        exitCode: 0,
      });
    });

    // The hook is at key 35 of 42: about 70 KB of the message are on the stream when it runs. What the hook
    // prints lands after them, on either stream. stdout and stderr are one open file here.
    it("output made inside a message over 64 KiB lands where its hook ran", async () => {
      using dir = tempDir("console-whole-message-one-file", {});
      const path = join(String(dir), "out.txt");
      const fd = openSync(path, "a");
      let exitCode: number;
      try {
        await using proc = spawn({
          cmd: [
            bunExe(),
            "-e",
            `${wideSource}
          const custom = Symbol.for("nodejs.util.inspect.custom");
          const object = wide(42);
          object.key00035 = {
            [custom]() {
              console.log("inner log", wide(3));
              console.error("inner error");
              console.count("inner count");
              console.clear();
              console.log(Buffer.alloc(5001, "x").toString());
              try { console.log("inner", { [custom]() { throw new Error("boom"); } }); } catch {}
              console.time("inner time");
              console.timeEnd("inner time");
              console.error(wide(38));
              return "hook";
            },
          };
          console.log(object);
          console.log("end");`,
          ],
          env: bunEnv,
          stdout: fd,
          stderr: fd,
        });
        exitCode = await proc.exited;
      } finally {
        closeSync(fd);
      }
      const object = wide(42);
      object.key00035 = { [Symbol.for("nodejs.util.inspect.custom")]: () => "hook" };
      const innerLines = [
        `inner log ${Bun.inspect(wide(3))}`,
        "inner error",
        "inner count: 1",
        big,
        "[time] inner time",
        Bun.inspect(wide(38)),
        "hook",
      ].join("\n");
      const output = (await file(path).text()).replace(/^\[[\d.]+m?s\] /gm, "[time] ");
      expect({ output: digest(output), exitCode }).toEqual({
        output: digest(Bun.inspect(object).replace("key00035: hook", "key00035: " + innerLines) + "\nend\n"),
        exitCode: 0,
      });
    });
  });
});

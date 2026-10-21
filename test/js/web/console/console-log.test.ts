import { file, spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

// Node formats the whole line, then writes it once. A conversion that throws leaves no text, and a
// conversion that logs puts its line in front.
describe.concurrent("a console call writes its line after the last conversion", () => {
  const big = Buffer.alloc(5001, "x").toString();
  const prelude = `
    const error = new Error("boom");
    const boom = () => { throw error; };
    const custom = Symbol.for("nodejs.util.inspect.custom");
    // %d converts with valueOf; %i, %f and %s convert with toString.
    const thrower = { valueOf: boom, toString: boom };
    const inspectable = { [custom]: boom };
    const inner = { [custom]() { console.log("inner"); return "x"; } };
    const big = Buffer.alloc(5001, "x").toString();
  `;

  async function run(source: string, env: Record<string, string | undefined> = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", prelude + source],
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.replaceAll(big, "<big>"), stderr: stderr.replaceAll(big, "<big>"), exitCode };
  }

  it("a call whose conversion throws writes nothing", async () => {
    const calls: Record<string, string> = {
      "%d": `console.log("a %d z", thrower)`,
      "%i": `console.log("a %i z", thrower)`,
      "%f": `console.log("a %f z", thrower)`,
      "%s": `console.log("a %s z", thrower)`,
      "%s with Symbol.toPrimitive": `console.log("a %s z", { [Symbol.toPrimitive]: boom })`,
      "%o": `console.log("a %o z", inspectable)`,
      "%O": `console.log("a %O z", inspectable)`,
      "%j": `console.log("a %j z", { toJSON: boom })`,
      "the second specifier": `console.log("a %d b %d z", 1, thrower)`,
      "no format string": `console.log("a", inspectable, "z")`,
      "in an object": `console.log({ a: 1, b: inspectable })`,
      "in an array": `console.log([1, inspectable, 3])`,
      "in a Map": `console.log(new Map([["a", inspectable]]))`,
      "in a Set": `console.log(new Set([1, inspectable]))`,
      "after 5001 bytes": `console.log(big + " %d z", thrower)`,
      "console.info": `console.info("a %d z", thrower)`,
      "console.debug": `console.debug("a %d z", thrower)`,
      "console.warn": `console.warn("a %d z", thrower)`,
      "console.error": `console.error("a %d z", thrower)`,
      "console.trace": `console.trace("a %d z", thrower)`,
      "console.dir": `console.dir({ a: 1, b: inspectable })`,
      "console.dirxml": `console.dirxml("a", inspectable)`,
      "console.table": `console.table([{ a: inspectable }])`,
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
    `);
    const names = Object.keys(calls).join("\n") + "\n";
    expect({ stdout, stderr }).toEqual({ stdout: names, stderr: names });
    expect(exitCode).toBe(0);
  });

  it("a call whose conversion logs writes its line after the inner line", async () => {
    const logs = (value: unknown) => `{ valueOf() { console.log("inner"); return ${value}; } }`;
    // [call, what it prints on stdout, what it prints on stderr]
    const calls: Record<string, [string, string, string?]> = {
      "%d": [`console.log("outer %d end", ${logs(1)})`, "inner\nouter 1 end\n"],
      "%s": [
        `console.log("outer %s end", { toString() { console.log("inner"); return "x"; } })`,
        "inner\nouter x end\n",
      ],
      "%o": [`console.log("outer %o end", inner)`, "inner\nouter x end\n"],
      "%j": [`console.log("outer %j end", { toJSON() { console.log("inner"); return 1; } })`, "inner\nouter 1 end\n"],
      "no format string": [`console.log("outer", inner, "end")`, "inner\nouter x end\n"],
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
      "an outer line over 4096 bytes": [`console.log(big + " %d end", ${logs(1)})`, "inner\n<big> 1 end\n"],
      "an inner line over 4096 bytes": [
        `console.log("outer %d end", { valueOf() { console.log(big, 1); return 1; } })`,
        "<big> 1\nouter 1 end\n",
      ],
      "console.count inside": [
        `console.log("outer %d end", { valueOf() { console.count("n"); return 1; } })`,
        "n: 1\nouter 1 end\n",
      ],
      "console.dir inside": [
        `console.log("outer %d end", { valueOf() { console.dir([1]); return 1; } })`,
        "[ 1 ]\nouter 1 end\n",
      ],
      "console.log() inside": [
        `console.log("outer %d end", { valueOf() { console.log(); return 1; } })`,
        "\nouter 1 end\n",
      ],
      "console.warn inside console.warn": [
        `console.warn("outer %d end", { valueOf() { console.warn("inner"); return 1; } })`,
        "",
        "inner\nouter 1 end\n",
      ],
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
    expect({ stdout, stderr }).toEqual({
      stdout: Object.entries(calls)
        .map(([name, [, out]]) => out + name + "\n")
        .join(""),
      stderr: Object.entries(calls)
        .map(([name, [, , err = ""]]) => err + name + "\n")
        .join(""),
    });
    expect(exitCode).toBe(0);
  });

  it("console.assert", async () => {
    const { stdout, stderr, exitCode } = await run(
      `
        try { console.assert(false, "a %d z", thrower); } catch {}
        console.error("after a throw");
        console.assert(false, "outer %d end", { valueOf() { console.error("inner"); return 1; } });
        console.error("outer %d end", { valueOf() { console.assert(false); return 1; } });
      `,
      // A failing console.assert stops a build that validates exception checks (#44950).
      { BUN_JSC_validateExceptionChecks: undefined },
    );
    expect({ stdout, stderr }).toEqual({
      stdout: "",
      stderr: "after a throw\ninner\nouter 1 end\nAssertion failed\nouter 1 end\n",
    });
    expect(exitCode).toBe(0);
  });

  it("a throw leaves the group indent as it was", async () => {
    const { stdout, stderr, exitCode } = await run(`
      console.group("group");
      try { console.log("a %d z", thrower); } catch {}
      console.log("inside");
      console.groupEnd();
      try { console.group("label %d", thrower); } catch {}
      console.log("after a label that threw");
    `);
    expect({ stdout, stderr }).toEqual({ stdout: "group\n  inside\nafter a label that threw\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  it("console.error that throws leaves no colour open", async () => {
    const { stdout, stderr, exitCode } = await run(
      `try { console.error("a %d z", thrower); } catch {} console.error("next");`,
      { NO_COLOR: undefined, FORCE_COLOR: "1" },
    );
    expect({ stdout, stderr }).toEqual({ stdout: "", stderr: "\x1b[0m\x1b[31mnext\x1b[0m\n" });
    expect(exitCode).toBe(0);
  });

  it("a call that runs no user code prints the same bytes", async () => {
    const { stdout, stderr, exitCode } = await run(`
      console.log();
      console.log(big);
      console.log("body:", big, big, 1);
      console.log("%s and %d", big, 2);
      console.error(big, 3);
      console.error("short");
    `);
    expect({ stdout, stderr }).toEqual({
      stdout: "\n<big>\nbody: <big> <big> 1\n<big> and 2\n",
      stderr: "<big> 3\nshort\n",
    });
    expect(exitCode).toBe(0);
  });

  it("a Worker can log while the main thread is inside a conversion", async () => {
    using dir = tempDir("console-line-worker", {
      "main.js": `
        const ia = new Int32Array(new SharedArrayBuffer(8));
        const worker = new Worker(new URL("./worker.js", import.meta.url).href);
        await new Promise(resolve => (worker.onmessage = resolve));
        worker.postMessage(ia.buffer);
        console.log("main %s end", {
          toString() {
            // ia[0]: this thread is inside its conversion. ia[1]: the worker has logged.
            Atomics.store(ia, 0, 1);
            Atomics.notify(ia, 0);
            // A build that holds the stream lock here keeps the worker out until this wait runs out.
            Atomics.wait(ia, 1, 0, 10_000);
            return "x";
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
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "worker line\nmain x end\n", stderr: "" });
    expect(exitCode).toBe(0);
  });
});

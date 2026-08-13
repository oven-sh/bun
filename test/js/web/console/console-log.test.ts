import { file, spawn } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
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

// Bun.$ is a lazy property whose initializer evaluates the shell builtin, so
// each of these clobbers makes it throw while the formatter behind console.log
// and Bun.inspect is reifying it mid-enumeration. The first three throw at
// different points of the builtin (its first Symbol() call, process.env, and
// the ShellPromise class extending the global Promise) before anything else
// has happened, so they cover clearing the pending exception: debug builds
// used to abort on the next lazy property and release builds dropped every
// property after $. The last one reifies another Bun property before it
// throws, which transitions Bun's structure in the middle of the lookup; that
// used to trip Structure::storedPrototype's stale-structure assertion in the
// prototype walk even once the exception was cleared. `sorted` routes through
// the second enumeration loop, which has the same two problems.
describe.each([
  ["Symbol", "globalThis.Symbol = NaN;"],
  ["process", "globalThis.process = undefined;"],
  ["Promise", "globalThis.Promise = undefined;"],
  [
    "Symbol with a hook that reifies Bun.semver and then throws",
    "globalThis.Symbol = () => { Bun.semver; throw new Error('boom'); };",
  ],
])("inspecting Bun after clobbering %s", (_label, clobber) => {
  for (const sorted of [false, true]) {
    it.concurrent(
      `skips the lazy property that failed to initialize and prints the rest (sorted: ${sorted})`,
      async () => {
        await using proc = Bun.spawn({
          cmd: [
            bunExe(),
            "-e",
            `${clobber}
const out = Bun.inspect(Bun, { sorted: ${sorted} });
console.log(JSON.stringify({
  shell: out.includes("$: [Function"),
  archive: out.includes("Archive:"),
  argv: out.includes("argv: ["),
  gc: out.includes("gc: [Function: gc]"),
  semver: out.includes("semver:"),
  zstdDecompress: out.includes("zstdDecompress:"),
}));`,
          ],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

        expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
          stdout: JSON.stringify({
            shell: false,
            archive: true,
            argv: true,
            gc: true,
            semver: true,
            zstdDecompress: true,
          }),
          stderr: "",
          exitCode: 0,
        });
      },
    );
  }
});

it("Bun.inspect with sorted: true propagates an exception thrown by a custom inspect like the unsorted walk does", () => {
  const thrower = {
    [Bun.inspect.custom]() {
      throw new Error("boom");
    },
  };
  // The sorted walk used to leave the exception pending and carry on, so it
  // surfaced (or not) depending on which property threw.
  expect(() => Bun.inspect({ a: thrower, b: 1, c: 2 })).toThrow("boom");
  expect(() => Bun.inspect({ a: thrower, b: 1, c: 2 }, { sorted: true })).toThrow("boom");
  expect(() => Bun.inspect({ a: 1, b: 2, c: thrower }, { sorted: true })).toThrow("boom");
});

// The native formatter loads util.inspect lazily the first time it meets a
// custom inspect function, and used to abort the process if that failed. It
// reads the function from the internal inspect module, so reassigning
// util.inspect (or breaking node:util, whose top level needs process) does not
// affect it, and a custom inspect function still gets the real inspect as its
// third argument, as in Node. Only when the internal module itself cannot be
// evaluated does the formatter fall back to a stub: the custom inspect still
// runs, options.stylize returns its input unchanged (console.log's own colored
// path via FORCE_COLOR as well as an explicit colors: true), and calling the
// stub throws a catchable TypeError.
const green = (text: string) => `\x1b[32m${text}\x1b[39m`;
describe.each([
  ["util.inspect replaced with a non-function", `require("node:util").inspect = 42;`, { inspectAvailable: true }],
  [
    "util.inspect replaced with a throwing getter",
    `Object.defineProperty(require("node:util"), "inspect", { get() { throw new Error("boom"); } });`,
    { inspectAvailable: true },
  ],
  ["process clobbered, so node:util cannot load", `globalThis.process = undefined;`, { inspectAvailable: true }],
  [
    "Map clobbered, so the internal inspect module cannot load",
    `globalThis.Map = undefined;`,
    { inspectAvailable: false },
  ],
])("console.log with a custom inspect function and %s", (_label, sabotage, { inspectAvailable }) => {
  it.concurrent("keeps printing", async () => {
    const stylized = inspectAvailable ? green : (text: string) => text;
    const expected = [
      "custom",
      stylized("styled by console.log"),
      stylized("styled by Bun.inspect"),
      inspectAvailable ? "1" : "caught TypeError",
      "ok",
      "",
    ].join("\n");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `${sabotage}
console.log({ [Bun.inspect.custom]() { return "custom"; } });
console.log({ [Bun.inspect.custom](d, o) { return o.stylize("styled by console.log", "string"); } });
console.log(Bun.inspect({ [Bun.inspect.custom](d, o) { return o.stylize("styled by Bun.inspect", "string"); } }, { colors: true }));
try { console.log({ [Bun.inspect.custom](d, o, inspect) { return inspect(1); } }) } catch (e) { console.log("caught " + e.constructor.name) }
console.log("ok")`,
      ],
      env: { ...bunEnv, FORCE_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode }).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
  });
});

it("console.log with SharedArrayBuffer", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(new ArrayBuffer(0))).toBe("ArrayBuffer(0) []");
  expect(Bun.inspect(new SharedArrayBuffer(0))).toBe("SharedArrayBuffer(0) []");
  expect(Bun.inspect(new ArrayBuffer(3))).toBe("ArrayBuffer(3) [ 0, 0, 0 ]");
  expect(Bun.inspect(new SharedArrayBuffer(3))).toBe("SharedArrayBuffer(3) [ 0, 0, 0 ]");
});

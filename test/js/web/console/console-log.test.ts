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
// and Bun.inspect is reifying it mid-enumeration, at a different point of the
// builtin: Symbol is the first thing it calls, process.env comes after that,
// and ShellPromise extends the global Promise before any of it runs. The
// pending exception has to be cleared (debug builds otherwise abort on the
// next lazy property), and the walk has to keep going, so everything after $
// still prints.
describe.each([
  ["Symbol", "globalThis.Symbol = NaN;"],
  ["process", "globalThis.process = undefined;"],
  ["Promise", "globalThis.Promise = undefined;"],
])("inspecting Bun with %s clobbered", (_label, clobber) => {
  it.concurrent("skips the lazy property that failed to initialize and prints the rest", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `${clobber}
const out = Bun.inspect(Bun);
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
  });
});

describe.each([
  ["replaced with a non-function", `require("node:util").inspect = 42;`],
  [
    "a throwing getter",
    `Object.defineProperty(require("node:util"), "inspect", { get() { throw new Error("boom"); } });`,
  ],
  // node:util's top level reads the process binding, so requiring it throws.
  ["unavailable because node:util failed to load", `globalThis.process = undefined;`],
])("console.log with node:util inspect %s", (_label, sabotage) => {
  it.concurrent("degrades gracefully instead of crashing", async () => {
    // util.inspect is cached lazily the first time a custom inspect runs. With
    // it unavailable the custom inspect still runs, options.stylize returns its
    // input unchanged (both console.log's own colored path, via FORCE_COLOR,
    // and an explicit colors: true), and only calling the inspect argument
    // throws.
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

    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "custom\nstyled by console.log\nstyled by Bun.inspect\ncaught TypeError\nok\n",
      stderr: "",
      exitCode: 0,
    });
  });
});

it("console.log with SharedArrayBuffer", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(new ArrayBuffer(0))).toBe("ArrayBuffer(0) []");
  expect(Bun.inspect(new SharedArrayBuffer(0))).toBe("SharedArrayBuffer(0) []");
  expect(Bun.inspect(new ArrayBuffer(3))).toBe("ArrayBuffer(3) [ 0, 0, 0 ]");
  expect(Bun.inspect(new SharedArrayBuffer(3))).toBe("SharedArrayBuffer(3) [ 0, 0, 0 ]");
});

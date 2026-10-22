import { file, spawn } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "node:path";
import { createLogClientJS } from "../../../../src/codegen/client-js";

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

it("console.log with SharedArrayBuffer", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(new ArrayBuffer(0))).toBe("ArrayBuffer(0) []");
  expect(Bun.inspect(new SharedArrayBuffer(0))).toBe("SharedArrayBuffer(0) []");
  expect(Bun.inspect(new ArrayBuffer(3))).toBe("ArrayBuffer(3) [ 0, 0, 0 ]");
  expect(Bun.inspect(new SharedArrayBuffer(3))).toBe("SharedArrayBuffer(3) [ 0, 0, 0 ]");
});

// https://console.spec.whatwg.org/#logger
// Only a primitive-string first argument is a format string. A "%d" in any
// other argument is data and does not consume the arguments after it.
const head70 = Buffer.alloc(70, "h").toString();
const formatStringCalls: [call: string, stdout: string[], stderr?: string[]][] = [
  [`console.log("a", "100%foo", 42)`, ["a 100%foo 42"]],
  [`console.log("l", "%d %s", 1, "t")`, ["l %d %s 1 t"]],
  [`console.log("x", "%%", 1)`, ["x %% 1"]],
  [`console.log("x", "%c", "color:red", "y")`, ["x %c color:red y"]],
  [`console.log("x", "%j", 7)`, ["x %j 7"]],
  [`console.log("", "%d", 5)`, [" %d 5"]],
  [`console.log("%s %s", "a", "b", "%s", "c")`, ["a b %s c"]],
  // A first argument that is not a primitive string is a value too.
  [`console.log(1, "%d", 2)`, ["1 %d 2"]],
  [`console.log({}, "%d", 2)`, ["{} %d 2"]],
  [`console.log(/%d/, 1)`, ["/%d/ 1"]],
  [`console.log(new String("%d"), 1)`, [`[String: "%d"] 1`]],
  [`console.log(new (class extends String {})("%d"), 1)`, [`[String: "%d"] 1`]],
  [`console.log("a", new String("b"), 1)`, [`a [String: "b"] 1`]],
  [`console.log("a", /%d/, 1)`, ["a /%d/ 1"]],
  // The value after a later "%d" is printed, not converted to a number.
  [
    `let calls = 0; console.log("p", "%d", Object.setPrototypeOf([], { [Symbol.toPrimitive]: () => (calls++, 7) })); console.log(calls)`,
    ["p %d []", "0"],
  ],
  [`console.log("GET", "/wiki/%d0%a0", 12n, "ms")`, ["GET /wiki/%d0%a0 12n ms"]],
  [`console.log("x", "%s", Symbol("q"), 1)`, ["x %s Symbol(q) 1"]],
  // The first argument is still a format string.
  [`console.log("%d/%s", 7, "k")`, ["7/k"]],
  [`console.log("%s", "%d", 5)`, ["%d 5"]],
  [`console.log("%s %s", "a")`, ["a %s"]],
  [`console.log("%%", 1)`, ["% 1"]],
  [`console.log("%s")`, ["%s"]],
  // A 70-column format string still wraps the array after it.
  [`console.log("${head70}", [1, 2, 3, 4, 5, 6])`, [`${head70} [ 1, 2, 3,`, "  4, 5, 6", "]"]],
  // A later string counts its characters toward the line width, not its UTF-8 bytes.
  [
    `console.log("a", "\\u00e9".repeat(40), [1, 2, 3, 4, 5, 6])`,
    [`a ${Buffer.alloc(80, "é").toString()} [ 1, 2, 3, 4, 5, 6 ]`],
  ],
  // Every console method that prints its arguments follows the same rule.
  [`console.info("i", "%d", 1)`, ["i %d 1"]],
  [`console.debug("d", "%d", 1)`, ["d %d 1"]],
  [`console.group("g", "%d", 1); console.groupEnd()`, ["g %d 1"]],
  [`console.groupCollapsed("gc", "%d", 1); console.groupEnd()`, ["gc %d 1"]],
  [`console.dirxml("x", "%d", 1)`, ["x %d 1"]],
  [`console.trace("t", "%d", 1)`, ["t %d 1"]],
  [`console.error("e", "%d", 1)`, [], ["e %d 1"]],
  [`console.warn("w", "%d", 1)`, [], ["w %d 1"]],
];

it.concurrent.each([false, true])(
  "console reads format specifiers from its first argument only (colors: %p)",
  async colors => {
    await using proc = spawn({
      cmd: [bunExe(), "-e", formatStringCalls.map(([call]) => call).join(";\n")],
      env: colors ? { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" } : bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // console.trace also prints its stack frames, which are not under test.
    const lines = (text: string) =>
      Bun.stripANSI(text)
        .replaceAll("\r\n", "\n")
        .replace(/^ +at .*\n/gm, "")
        .split("\n");
    expect({ stdout: lines(stdout), stderr: lines(stderr), exitCode }).toEqual({
      stdout: [...formatStringCalls.flatMap(([, out]) => out), ""],
      stderr: [...formatStringCalls.flatMap(([, , err = []]) => err), ""],
      exitCode: 0,
    });
  },
);

it.concurrent("console.error wraps a multi-argument line in red once", async () => {
  await using proc = spawn({
    cmd: [bunExe(), "-e", `console.error("E", "%d", 1)`],
    env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "",
    stderr: "\x1b[0m\x1b[31mE %d \x1b[0m\x1b[33m1\x1b[0m\x1b[0m\n",
    exitCode: 0,
  });
});

// The test runner sets BUN_JSC_validateExceptionChecks=1 for debug and ASAN builds. There console.assert(false) aborts:
// "This scope can throw a JS exception: messageWithTypeAndLevel ... But the exception was unchecked as of this scope:
// consoleProtoFuncAssert". #44950 (oven-sh/WebKit#790) releases that scope. Remove the gate with it.
it.todoIf(isDebug || isASAN)(
  "console.assert reads format specifiers from its first message argument only",
  async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `console.assert(false, "as", "%d", 1); console.assert(false, {}, "%d", 5); console.assert(false, "%d/%s", 7, "k")`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "as %d 1\n{} %d 5\n7/k\n", exitCode: 0 });
  },
);

// $debug is compiled into the built-in modules of debug builds only, so this test evaluates the wrapper's source.
it.concurrent("$debug passes the caller's format string to console as its first argument", async () => {
  const calls = `
$debug_log("connect to %s:%d", "127.0.0.1", 80);
$debug_log(1, "%d", 2);
$debug_log("x", "100%foo", 42);`;
  await using proc = spawn({
    cmd: [bunExe(), "-e", createLogClientJS("probe/wrapper", "probe") + calls],
    env: { ...bunEnv, DEBUG_PROBE_WRAPPER: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: "",
    stderr: "[probe] connect to 127.0.0.1:80\n[probe] 1 %d 2\n[probe] x 100%foo 42\n",
    exitCode: 0,
  });
});

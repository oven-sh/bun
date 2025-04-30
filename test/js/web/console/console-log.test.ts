import { file, spawn } from "bun";
import { expect, it } from "bun:test";
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
  const err = (await new Response(stderr).text()).replaceAll("\r\n", "\n");
  const out = (await new Response(stdout).text()).replaceAll("\r\n", "\n");
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
  const proc = Bun.spawnSync({
    cmd: [bunExe(), "-e", `console.log(Array(1000).fill(0))`],
    env: bunEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });
  expect(proc.exitCode).toBe(0);
  expect(proc.stderr.toString("utf8")).toBeEmpty();
  expect(proc.stdout.toString("utf8")).toEqual(
    "[\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,\n" +
      "  ... 900 more items\n" +
      "]\n" +
      "",
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
    .replaceAll(filepath, "<file>");
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
      at <file>:56:14
      at loadAndEvaluateModule (2:1)

  52 | console.group("Different logs");
53 | console.log("Regular log");
54 | console.info("Info log");
55 | console.warn("Warning log");
56 | console.warn(new Error("console.warn an error"));
57 | console.error(new Error("console.error an error"));
                   ^
error: console.error an error
      at <file>:57:15
      at loadAndEvaluateModule (2:1)

  41 | console.groupEnd(); // Extra
42 | console.groupEnd(); // Extra
43 | 
44 | class NamedError extends Error {
45 |   constructor(message) {
46 |     super(message);
         ^
NamedError: console.error a named error
      at new NamedError (<file>:46:5)
      at <file>:58:15
      at loadAndEvaluateModule (2:1)

  NamedError: console.warn a named error
      at new NamedError (<file>:46:5)
      at <file>:59:14
      at loadAndEvaluateModule (2:1)

  Error log"
`);
});

it("console.log with SharedArrayBuffer", () => {
  const proc = Bun.spawnSync({
    cmd: [
      bunExe(),
      "-e",
      `
      console.log(new ArrayBuffer(0));
      console.log(new SharedArrayBuffer(0));
      console.log(new ArrayBuffer(3));
      console.log(new SharedArrayBuffer(3));
    `,
    ],
    env: bunEnv,
    stdio: ["inherit", "pipe", "pipe"],
  });
  expect(proc.stderr.toString("utf8")).toBeEmpty();
  expect(proc.exitCode).toBe(0);
  expect(proc.stdout.toString("utf8")).toMatchInlineSnapshot(`
    "ArrayBuffer(0) []
    SharedArrayBuffer(0) []
    ArrayBuffer(3) [ 0, 0, 0 ]
    SharedArrayBuffer(3) [ 0, 0, 0 ]
    "
  `);
});

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

async function runConsole(args: string[], env = bunEnv) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // console.timeLog and console.timeEnd print a different elapsed time in each run.
  const normalize = (text: string) => text.replaceAll("\r\n", "\n").replace(/\d+\.\d\dm?s\b/g, "<time>");
  return { stdout: normalize(stdout), stderr: normalize(stderr), exitCode };
}

// What `text` looks like when the console prints it inside `depth` groups.
function insideGroups(text: string, depth: number) {
  const indent = Buffer.alloc(depth * 2, " ").toString();
  const lines = text.split("\n");
  return lines.map((line, i) => (i === lines.length - 1 ? line : indent + line)).join("\n");
}

const groupIndentFixture = join(import.meta.dir, "console-group-indent.fixture.js");

// Node prints the output of every console method through one function, which
// puts the group indent in front of every line:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/console/constructor.js#L294-L299
it.concurrent.each([
  ["without colors", [groupIndentFixture], bunEnv],
  ["with colors", [groupIndentFixture], { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" }],
  ["in a Worker", ["-e", "new Worker(process.argv[1], { argv: [process.argv[2]] })", groupIndentFixture], bunEnv],
])("console.group indents each line of every console message, %s", async (_, args, env) => {
  const [outside, inOneGroup, inTwoGroups] = await Promise.all(
    [0, 1, 2].map(depth => runConsole([...args, String(depth)], env)),
  );
  expect(outside.stdout).toEndWith("done\n");
  expect(outside.exitCode).toBe(0);
  expect(inOneGroup).toEqual({
    stdout: insideGroups(outside.stdout, 1),
    stderr: insideGroups(outside.stderr, 1),
    exitCode: 0,
  });
  expect(inTwoGroups).toEqual({
    stdout: insideGroups(outside.stdout, 2),
    stderr: insideGroups(outside.stderr, 2),
    exitCode: 0,
  });
});

it.concurrent("console.group indents count, time, table and the lines after a line feed", async () => {
  expect(
    await runConsole([
      "-e",
      `console.group("G");
       console.log("log");
       console.count("cnt");
       console.time("t");
       console.timeLog("t", { a: 1 });
       console.timeEnd("t");
       console.timeEnd("not started");
       console.table([{ a: 1 }]);
       console.log("two\\nlines");
       console.log();
       console.warn();
       console.group("Nested");
       console.count("cnt");
       console.groupEnd();
       console.groupEnd();
       console.count("cnt");`,
    ]),
  ).toEqual({
    stdout: [
      "G",
      "  log",
      "  cnt: 1",
      "  ┌───┬───┐",
      "  │   │ a │",
      "  ├───┼───┤",
      "  │ 0 │ 1 │",
      "  └───┴───┘",
      "  two",
      "  lines",
      "  ",
      "  Nested",
      "    cnt: 2",
      "cnt: 3",
      "",
    ].join("\n"),
    stderr: ["  [<time>] t {", "    a: 1,", "  }", "  [<time>] t", "  ", ""].join("\n"),
    exitCode: 0,
  });
});

it.concurrent("console.group indents a console.assert that fails with no message", async () => {
  expect(
    await runConsole(["-e", `console.group("G"); console.assert(false); console.groupEnd(); console.assert(false);`], {
      ...bunEnv,
      // A console.assert that fails aborts a build that validates exception checks: #44950.
      BUN_JSC_validateExceptionChecks: undefined,
      BUN_JSC_dumpSimulatedThrows: undefined,
    }),
  ).toEqual({ stdout: "G\n", stderr: "  Assertion failed\nAssertion failed\n", exitCode: 0 });
});

it.concurrent("console.warn and console.error with no arguments print their line to stderr", async () => {
  expect(
    await runConsole(["-e", "console.log(); console.info(); console.debug(); console.warn(); console.error();"]),
  ).toEqual({ stdout: "\n\n\n", stderr: "\n\n", exitCode: 0 });
});

it.concurrent.each([
  ["outside a group", "", ""],
  ["inside a group", "console.group();", "  "],
])("console.timeLog ends its line when an argument throws, %s", async (_, group, indent) => {
  expect(
    await runConsole([
      "-e",
      // `$$typeof` is the property that the formatter reads before it prints an object.
      `${group}
       console.time("t");
       try {
         console.timeLog("t", "a", { get $$typeof() { throw new Error("thrown"); } }, "b");
       } catch (e) {
         console.log(e.message);
       }`,
    ]),
  ).toEqual({ stdout: `${indent}thrown\n`, stderr: `${indent}[<time>] t a\n`, exitCode: 0 });
});

it.concurrent("bun -p prints its result inside a group that is still open", async () => {
  expect(await runConsole(["-p", `console.group("G"); "two\\nlines"`])).toEqual({
    stdout: "G\n  two\n  lines\n",
    stderr: "",
    exitCode: 0,
  });
});

it.concurrent("console.group does not indent process.stdout.write or console.write", async () => {
  expect(
    await runConsole([
      "-e",
      `console.group("G");
       process.stdout.write("process.stdout.write\\n");
       console.write("console.write\\n");
       console.log("log");`,
    ]),
  ).toEqual({ stdout: "G\nprocess.stdout.write\nconsole.write\n  log\n", stderr: "", exitCode: 0 });
});

it("console.log with SharedArrayBuffer", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(new ArrayBuffer(0))).toBe("ArrayBuffer(0) []");
  expect(Bun.inspect(new SharedArrayBuffer(0))).toBe("SharedArrayBuffer(0) []");
  expect(Bun.inspect(new ArrayBuffer(3))).toBe("ArrayBuffer(3) [ 0, 0, 0 ]");
  expect(Bun.inspect(new SharedArrayBuffer(3))).toBe("SharedArrayBuffer(3) [ 0, 0, 0 ]");
});

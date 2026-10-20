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

// Each row is a console call and the line that the call prints.
type ConsoleRow = [call: string, printed: string];

async function runConsoleRows(rows: ConsoleRow[], env: NodeJS.Dict<string> = bunEnv) {
  const script = rows.map(([call]) => call).join(";\n");
  await using proc = spawn({ cmd: [bunExe(), "-e", script], env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const printedBy = (rows: ConsoleRow[]) => rows.map(([, line]) => line + "\n").join("");

it.concurrent("%o and %O print a string in quotes", async () => {
  const stdout: ConsoleRow[] = [
    [`console.log("%O", "str")`, `"str"`],
    [`console.log("%o", "str")`, `"str"`],
    [`console.log("%O|%O", 1, "a b")`, `1|"a b"`],
    [`console.log("[%O]", "")`, `[""]`],
    [String.raw`console.log("%O", "two\nlines")`, String.raw`"two\nlines"`],
    [String.raw`console.log("%O", "\x1b[31mred")`, String.raw`"\u001B[31mred"`],
    // The same text as inside an array: https://github.com/oven-sh/bun/issues/25234
    [String.raw`console.log("%O", 'say "hi"')`, String.raw`"say \"hi\""`],
    [String.raw`console.log("%O", "caf\u00e9")`, `"café"`],
    [String.raw`console.log("%O", "\u{1F44B} wave")`, `"👋 wave"`],
    [`console.log("%s is %O", "name", "str")`, `name is "str"`],
    [`console.log("%O then %s", "a", "b")`, `"a" then b`],
    [`console.log("%O", "a", "b")`, `"a" b`],
    [`console.log("%O %O", "only")`, `"only" %O`],
    [`console.info("%O", "str")`, `"str"`],
    [`console.debug("%o", "str")`, `"str"`],
    [`console.dirxml("%O", "str")`, `"str"`],
    [`console.group("%O", "label"), console.groupEnd()`, `"label"`],
    // Message text stays bare.
    [`console.log("%s", "str")`, `str`],
    [`console.log("str", "str")`, `str str`],
    // Every other value prints as before.
    [`console.log("%O", new String("boxed"))`, `[String: "boxed"]`],
    [`console.log("%O", /re/g)`, `/re/g`],
    [`console.log("%O", ["str"])`, `[ "str" ]`],
  ];
  const stderr: ConsoleRow[] = [
    [`console.warn("%O", "str")`, `"str"`],
    [`console.error("%o", "str")`, `"str"`],
  ];
  expect(await runConsoleRows([...stdout, ...stderr])).toEqual({
    stdout: printedBy(stdout),
    stderr: printedBy(stderr),
    exitCode: 0,
  });
});

it.concurrent("console.dir prints a string in quotes", async () => {
  const stdout: ConsoleRow[] = [
    [`console.dir("str")`, `"str"`],
    [`console.dir("")`, `""`],
    [String.raw`console.dir("two\nlines")`, String.raw`"two\nlines"`],
    [`console.dir("str", { depth: 0 })`, `"str"`],
    [`console.dir("%O", "not an argument")`, `"%O"`],
    // console.dirxml is console.log.
    [`console.dirxml("str")`, `str`],
    // Every other value prints as before.
    [`console.dir(new String("boxed"))`, `[String: "boxed"]`],
    [`console.dir(/re/g)`, `/re/g`],
    [`console.dir(["str"])`, `[ "str" ]`],
  ];
  expect(await runConsoleRows(stdout)).toEqual({ stdout: printedBy(stdout), stderr: "", exitCode: 0 });
});

it.concurrent("%O and console.dir print a string in green when colors are on", async () => {
  const green = `\x1b[0m\x1b[32m"str"\x1b[0m`;
  const stdout: ConsoleRow[] = [
    [`console.log("%O", "str")`, green],
    [`console.dir("str")`, green],
    [`console.dir("str", { colors: false })`, `"str"`],
    [`console.log("%s", "str")`, `str`],
  ];
  expect(await runConsoleRows(stdout, { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" })).toEqual({
    stdout: printedBy(stdout),
    stderr: "",
    exitCode: 0,
  });
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

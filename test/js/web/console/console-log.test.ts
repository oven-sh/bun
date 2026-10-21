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

// The arguments of one console.log call, and the line that Node.js prints for that call.
const formatStringCases: [args: string, expected: string][] = [
  // `%%` after the last argument, for each specifier that takes an argument
  [`"%s %%", "x"`, "x %"],
  [`"%d %%", 5`, "5 %"],
  [`"%i %%", 5`, "5 %"],
  [`"%f %%", 1.5`, "1.5 %"],
  [`"%o %%", 5`, "5 %"],
  [`"%O %%", 5`, "5 %"],
  [`"%c %%", "color: red"`, " %"],
  [`"%j %%", 5`, "5 %"],
  [`"%i %%", "x"`, "NaN %"],
  [`"%f %%", 2`, "2 %"],
  [`"%d%%", 50`, "50%"],
  [`"%d %f %j %%", 1, 2, 3`, "1 2 3 %"],
  [`"%sbc%%def", "a"`, "abc%def"],
  [`"%s %% %% %%", "x"`, "x % % %"],
  [`"%s and some more text%%", "x"`, "x and some more text%"],
  [`"%s is 50% of the total, not 100%%", "x"`, "x is 50% of the total, not 100%"],
  [`"%s 50% %% %%", "x"`, "x 50% % %"],
  [`"%s %2F%2F %% %2F %%%% %", "x"`, "x %2F%2F % %2F %% %"],
  // a specifier with no argument left stays as text
  [`"%s %s %% end", "a"`, "a %s % end"],
  [`"%s %% %d %% %i", "x"`, "x % %d % %i"],
  [`"%s %c%%", "a"`, "a %c%"],
  [`"%s %x %%", "a"`, "a %x %"],
  [`"[%j][%j]", 1`, "[1][%j]"],
  // `%%` pairs next to each other, and a `%` at the end
  [`"%s %%%%", "a"`, "a %%"],
  [`"%s%%%%%%", "a"`, "a%%%"],
  [`"%s%%%", "a"`, "a%%"],
  [`"%s%", "x"`, "x%"],
  [`"%i %%%%", "x"`, "NaN %%"],
  [`"%f%%%%", 2`, "2%%"],
  // `%j` of a value for which JSON.stringify returns undefined
  [`"[%j]", undefined`, "[undefined]"],
  [`"[%j]", function () {}`, "[undefined]"],
  [`"[%j]", Symbol("s")`, "[undefined]"],
  [`"[%j]", { toJSON() {} }`, "[undefined]"],
  [`"%j %%", undefined`, "undefined %"],
  [`"[%j]", null`, "[null]"],
  [`"[%j]", ""`, '[""]'],
  [`"[%j]", { a: 1 }`, '[{"a":1}]'],
  // controls: a lone first argument is not a format string, `%%` collapses while an argument is left, and the last argument is not scanned
  [`"%%"`, "%%"],
  [`"%s %%"`, "%s %%"],
  [`"%%", "x"`, "% x"],
  [`"%s %%", "x", "y"`, "x % y"],
  [`"100%%", "extra"`, "100% extra"],
  [`"%s", "100%%"`, "100%%"],
  [`"%s", "100%%", "y"`, "100%% y"],
  [`"a", "100%%"`, "a 100%%"],
];

it.concurrent("a format string is scanned to its end after its last argument is used", async () => {
  await using proc = spawn({
    cmd: [bunExe(), "-e", formatStringCases.map(([args]) => `console.log(${args});`).join("\n")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = stdout.replaceAll("\r\n", "\n").split("\n");
  expect({
    printed: Object.fromEntries(formatStringCases.map(([args], i) => [args, lines[i]])),
    rest: lines.slice(formatStringCases.length),
    stderr,
    exitCode,
  }).toEqual({
    printed: Object.fromEntries(formatStringCases),
    rest: [""],
    stderr: "",
    exitCode: 0,
  });
});

it.concurrent("`%%` after the last argument collapses at every length of the rest", async () => {
  // Four rests for each length: no `%`, a `%%` at the end, a `%` alone in front of that, and only the `%` alone.
  const rests: string[] = [];
  for (let length = 0; length <= 130; length++) {
    const text = Buffer.alloc(length, "a").toString();
    rests.push(text, text + "%%", "%" + text + "%%", "%" + text);
  }
  await using proc = spawn({
    // The list goes through stdin, because it is longer than a command line can be on Windows.
    cmd: [bunExe(), "-e", `for (const rest of await Bun.stdin.json()) console.log("%s" + rest, "x");`],
    env: bunEnv,
    stdin: Buffer.from(JSON.stringify(rests)),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ lines: stdout.replaceAll("\r\n", "\n").split("\n"), stderr, exitCode }).toEqual({
    lines: [...rests.map(rest => "x" + rest.replaceAll("%%", "%")), ""],
    stderr: "",
    exitCode: 0,
  });
});

// console.assert is not covered: a failing assert aborts under the exception validator that ASAN lanes set (#44950).
it.concurrent("console methods other than assert and trace scan the same way", async () => {
  const src = `
    import nodeConsole from "node:console";
    console.log("log %s %%", "x");
    console.info("info %s %%", "x");
    console.debug("debug %s %%", "x");
    console.dirxml("dirxml %s %%", "x");
    console.group("group %s %%", "x");
    console.groupEnd();
    console.groupCollapsed("groupCollapsed %s %%", "x");
    console.groupEnd();
    console.error("error %s %%", "x");
    console.warn("warn %s %%", "x");
    nodeConsole.error("node:console %s %%", "x");
  `;
  await using proc = spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({
    stdout: stdout.replaceAll("\r\n", "\n").split("\n"),
    stderr: stderr.replaceAll("\r\n", "\n").split("\n"),
    exitCode,
  }).toEqual({
    stdout: ["log x %", "info x %", "debug x %", "dirxml x %", "group x %", "groupCollapsed x %", ""],
    stderr: ["error x %", "warn x %", "node:console x %", ""],
    exitCode: 0,
  });
});

it.concurrent("trace scans the same way", async () => {
  await using proc = spawn({
    cmd: [bunExe(), "-e", `console.trace("trace %s %%", "x");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The stream, the stack frames and the "Trace: " prefix of Node.js are not the subject here.
  const lines = (stdout + stderr)
    .split(/\r?\n/)
    .filter(line => line !== "" && !/^\s+at /.test(line))
    .map(line => line.replace(/^Trace: /, ""));
  expect({ lines, exitCode }).toEqual({ lines: ["trace x %"], exitCode: 0 });
});

it.concurrent("%j of undefined is printed without a color", async () => {
  await using proc = spawn({
    cmd: [bunExe(), "-e", `console.log("[%j]", undefined);`],
    env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.replaceAll("\r\n", "\n"), stderr, exitCode }).toEqual({
    stdout: "[undefined]\n",
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

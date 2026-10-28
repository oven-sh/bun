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

describe("a console message reaches its stream once, after its formatting returned", () => {
  async function run(cmd: string[], env = bunEnv) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...cmd], env, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.replaceAll("\r\n", "\n"), stderr: stderr.replaceAll("\r\n", "\n"), exitCode };
  }

  const thrower = `{ [Symbol.for("nodejs.util.inspect.custom")]() { throw new Error("hook"); } }`;

  // Three tests below are not concurrent. Their children do the most work, and
  // on a debug build they reach the test timeout when they run beside the others.
  it("a call whose formatting throws prints nothing, and a message from a hook comes first", async () => {
    const { stdout, stderr, exitCode } = await run([join(import.meta.dir, "console-print-fails.fixture.js")]);
    expect({ stdout: stdout.split("\n"), stderr: stderr.split("\n"), exitCode }).toEqual({
      stdout: [
        "-- log: threw hook",
        "-- info: threw hook",
        "-- debug: threw hook",
        "-- warn: threw hook",
        "-- error: threw hook",
        "-- dir: threw hook",
        "-- dirxml: threw hook",
        "-- trace: threw hook",
        "-- assert: threw hook",
        "-- table: threw hook",
        "-- group: threw hook",
        "-- groupCollapsed: threw hook",
        "-- Map value: threw hook",
        "-- Set value: threw hook",
        "-- class field: threw hook",
        "-- %s toString: threw toString",
        "-- %d valueOf: threw valueOf",
        "-- %j toJSON: threw toJSON",
        "-- %o: threw hook",
        "-- second hook: threw hook",
        "group",
        "  -- in a group: threw hook",
        "-- 4000 bytes, then a throw: threw hook",
        "-- 4088 bytes, then a throw: threw hook",
        "-- 4089 bytes, then a throw: threw hook",
        "-- 5000 bytes, then a throw: threw hook",
        "-- 100000 bytes, then a throw: threw hook",
        "-- many lines, then a throw: threw hook",
        "INNER",
        "[ 1, x, 3 ]",
        "-- hook logs: returned",
        "INNER",
        "a x b",
        "-- hook logs, %s: returned",
        "[ 1, x, 3 ]",
        "-- hook logs on the other stream: returned",
        "INNER",
        "-- hook logs, other stream first: returned",
        "ONE",
        "TWO",
        "[ 1, x, 3 ]",
        "-- hook logs twice: returned",
        "INNERMOST",
        "[ 2, b ]",
        "[ 1, a ]",
        "-- two levels: returned",
        "INNER",
        "-- hook logs, then throws: threw after INNER",
        "[ 1, y ]",
        "-- hook catches its own failed log: returned",
        "",
        "[ 1, x ]",
        "-- hook calls log(): returned",
        "c: 1",
        "[ 1, x ]",
        "-- hook calls count(): returned",
        "INNER",
        "[ 1, x ]",
        "-- hook writes to process.stdout: returned",
        "INNER",
        "-- hook logs after 5000 bytes, then throws: threw after INNER",
        "done",
        "",
      ],
      stderr: [
        "-- log",
        "-- info",
        "-- debug",
        "-- warn",
        "-- error",
        "-- dir",
        "-- dirxml",
        "-- trace",
        "-- assert",
        "-- table",
        "-- group",
        "-- groupCollapsed",
        "-- Map value",
        "-- Set value",
        "-- class field",
        "-- %s toString",
        "-- %d valueOf",
        "-- %j toJSON",
        "-- %o",
        "-- second hook",
        "  -- in a group",
        "-- 4000 bytes, then a throw",
        "-- 4088 bytes, then a throw",
        "-- 4089 bytes, then a throw",
        "-- 5000 bytes, then a throw",
        "-- 100000 bytes, then a throw",
        "-- many lines, then a throw",
        "-- hook logs",
        "-- hook logs, %s",
        "INNER",
        "-- hook logs on the other stream",
        "[ 1, x, 3 ]",
        "-- hook logs, other stream first",
        "-- hook logs twice",
        "-- two levels",
        "-- hook logs, then throws",
        "-- hook catches its own failed log",
        "-- hook calls log()",
        "-- hook calls count()",
        "-- hook writes to process.stdout",
        "-- hook logs after 5000 bytes, then throws",
        "",
      ],
      exitCode: 0,
    });
  });

  it.concurrent("a failed console.error leaves no color code behind", async () => {
    const { stderr, exitCode } = await run(
      ["-e", `console.error("NEXT"); try { console.error("first", ${thrower}); } catch {} console.error("NEXT");`],
      { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
    );
    // The line after the failed call is the line before it, byte for byte.
    const line = stderr.slice(0, stderr.length / 2);
    expect(line).toContain("NEXT");
    expect({ stderr, exitCode }).toEqual({ stderr: line + line, exitCode: 0 });
  });

  it.concurrent("an uncaught error from a hook leaves no part of the message on stdout", async () => {
    const { stdout, stderr, exitCode } = await run(["-e", `console.log("BEFORE"); console.log([1, ${thrower}]);`]);
    expect(stderr).toContain("error: hook");
    expect({ stdout, exitCode }).toEqual({ stdout: "BEFORE\n", exitCode: 1 });
  });

  it.concurrent("process.exit() in a hook writes no part of the message", async () => {
    expect(
      await run([
        "-e",
        `console.log([Buffer.alloc(5000, "x").toString(), { [Symbol.for("nodejs.util.inspect.custom")]() { process.exit(0); } }]);`,
      ]),
    ).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  it("in a Worker", async () => {
    const worker = `try { console.log([1, ${thrower}]); } catch {} console.log("NEXT"); postMessage("done");`;
    expect(
      await run([
        "-e",
        `const worker = new Worker(URL.createObjectURL(new Blob([${JSON.stringify(worker)}], { type: "text/javascript" })));
         worker.onmessage = () => worker.terminate();`,
      ]),
    ).toEqual({ stdout: "NEXT\n", stderr: "", exitCode: 0 });
  });

  it.concurrent.each([
    ["a value", `[1, ${thrower}]`],
    ["a rejected promise", `Promise.reject([1, ${thrower}])`],
  ])("bun --print of %s whose formatting throws reports the error", async (_, expression) => {
    const { stdout, stderr, exitCode } = await run(["--print", expression]);
    expect(stderr).toContain("error: hook");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  // Runs in the child. It prints each message with console.log, then writes
  // the text that stdout must show to stderr.
  function largeMessages() {
    // A pattern with a period of 251 bytes: a chunk that is lost, repeated or
    // moved by the size of a buffer or of a block changes the text.
    const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
    const pattern = Array.from({ length: 251 }, (_, i) => alphabet[(i * i + i) % 36]).join("");
    const text = (length: number) => Buffer.alloc(length, pattern).toString();

    // Messages with an object in them are held until they are complete.
    const held: unknown[] = [];
    // Small chunks around the end of the stream buffer (4096 bytes).
    for (let keys = 330; keys <= 370; keys += 20) {
      held.push(Object.fromEntries(Array.from({ length: keys }, (_, i) => ["key" + i, i])));
    }
    // One string around the end of the first block (64 KiB).
    for (let length = 65536 - 1; length <= 65536 + 1; length++) {
      held.push([text(length)]);
    }
    // Many chunks around the end of the first block.
    for (let shift = 0; shift < 2; shift++) {
      held.push(Array.from({ length: 95 }, (_, i) => text(790 + i + shift)));
    }
    // Several blocks, then a message that fits the stream buffer again.
    held.push([text(150_000)], { small: 1 });

    let expected = "";
    for (const value of held) {
      console.log(value);
      // Bun.inspect formats into memory: console.log(x) === Bun.inspect(x) + "\n".
      expected += Bun.inspect(value) + "\n";
    }

    // Messages of strings and numbers only are written as they are formatted.
    const large = text(60_000);
    console.log(large);
    console.log("body:", large, 1, true, null, undefined);
    console.log("%s and %d", large, 2);
    console.log("after");
    expected += `${large}\nbody: ${large} 1 true null undefined\n${large} and 2\nafter\n`;

    process.stderr.write(expected);
  }

  it("a message larger than the buffer is written whole and in order", async () => {
    const { stdout, stderr, exitCode } = await run(["-e", `(${largeMessages})();`]);
    // A megabyte: report where the two differ, not the text.
    let differsAt = -1;
    if (stdout !== stderr) {
      differsAt = 0;
      while (stdout[differsAt] === stderr[differsAt]) differsAt++;
    }
    expect(stderr.length).toBeGreaterThan(600_000);
    expect({ differsAt, length: stdout.length, exitCode }).toEqual({
      differsAt: -1,
      length: stderr.length,
      exitCode: 0,
    });
  });
});

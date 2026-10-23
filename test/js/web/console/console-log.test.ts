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

describe("%j with a cyclic value", () => {
  async function run(script: string, env: Record<string, string | undefined> = bunEnv) {
    await using proc = spawn({
      cmd: [bunExe(), "-e", script],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.replaceAll("\r\n", "\n"), stderr: stderr.replaceAll("\r\n", "\n"), exitCode };
  }

  it.concurrent("prints [Circular] from log, info, debug, dirxml, warn, error, group and groupCollapsed", async () => {
    expect(
      await run(`
        const c = { a: 1 }; c.self = c;
        const list = [1]; list.push(list);
        console.log("%j", c);
        console.log("%j", list);
        console.log("%j", { nested: { c } });
        console.info("info %j", c);
        console.debug("debug %j", c);
        console.dirxml("dirxml %j", c);
        console.warn("warn %j", c);
        console.error("error %j", c);
        console.group("group %j", c);
        console.log("inside %j", c);
        console.groupEnd();
        console.groupCollapsed("collapsed %j", c);
        console.groupEnd();
      `),
    ).toEqual({
      stdout:
        "[Circular]\n[Circular]\n[Circular]\ninfo [Circular]\ndebug [Circular]\ndirxml [Circular]\n" +
        "group [Circular]\n  inside [Circular]\ncollapsed [Circular]\n",
      stderr: "warn [Circular]\nerror [Circular]\n",
      exitCode: 0,
    });
  });

  // console.assert is not covered: a failing assert aborts under the exception validator that ASAN lanes set (#44950).
  it.concurrent("prints [Circular] from trace", async () => {
    const { stdout, stderr, exitCode } = await run(`
      const c = { a: 1 }; c.self = c;
      console.trace("trace %j", c);
    `);
    const lines = (stdout + stderr).split("\n").filter(line => line !== "" && !/^\s+at /.test(line));
    expect({ lines, exitCode }).toEqual({ lines: ["trace [Circular]"], exitCode: 0 });
  });

  it.concurrent("keeps the text and the arguments around the specifier", async () => {
    expect(
      await run(`
        const c = { a: 1 }; c.self = c;
        console.log("user %s: %j", "x", c);
        console.log("%j|%s|%j", c, "mid", c);
        console.log("%j after %s", c, "s");
        console.log("%j %j", c);
        console.log("%j", c, "tail", 5);
      `),
    ).toEqual({
      stdout: "user x: [Circular]\n[Circular]|mid|[Circular]\n[Circular] after s\n[Circular] %j\n[Circular] tail 5\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it.concurrent("decides from the one JSON.stringify call", async () => {
    expect(
      await run(`
        const c = { a: 1 }; c.self = c;
        let toJSONCalls = 0, getterCalls = 0;
        const viaToJSON = { toJSON() { toJSONCalls++; return c; } };
        const viaGetter = { get self() { getterCalls++; return viaGetter; } };
        const escapes = { toJSON() { return 1; } }; escapes.self = escapes;
        console.log("%j", viaToJSON);
        console.log("%j", viaGetter);
        console.log("%j", escapes);
        console.log("%j", { toJSON() { return JSON.stringify(c); } });
        console.log(\`toJSON calls \${toJSONCalls}, getter calls \${getterCalls}\`);
      `),
    ).toEqual({
      stdout: "[Circular]\n[Circular]\n1\n[Circular]\ntoJSON calls 1, getter calls 1\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it.concurrent("passes every other failure on unchanged", async () => {
    expect(
      await run(`
        const c = { a: 1 }; c.self = c;
        const thrownBy = value => { try { console.log("%j", value); return "no throw"; } catch (e) { return e; } };
        console.log("%j", c);
        const saved = new Error("tj"); const stack = saved.stack;
        let e = thrownBy({ toJSON() { throw saved; } });
        console.log(\`toJSON throw: same object \${e === saved}, same stack \${e.stack === stack}\`);
        e = thrownBy(10n);
        console.log(\`BigInt: \${e.constructor.name}: \${e.message}\`);
        const wrongType = new Error("JSON.stringify cannot serialize cyclic structures.");
        console.log(\`Error with the cycle message: same object \${thrownBy({ toJSON() { throw wrongType; } }) === wrongType}\`);
        const noMessage = new TypeError();
        console.log(\`TypeError without a message: same object \${thrownBy({ toJSON() { throw noMessage; } }) === noMessage}\`);
        const numberMessage = new TypeError("x"); numberMessage.message = 1;
        console.log(\`TypeError with a number message: same object \${thrownBy({ toJSON() { throw numberMessage; } }) === numberMessage}\`);
      `),
    ).toEqual({
      stdout:
        "[Circular]\n" +
        "toJSON throw: same object true, same stack true\n" +
        "BigInt: TypeError: JSON.stringify cannot serialize BigInt.\n" +
        "Error with the cycle message: same object true\n" +
        "TypeError without a message: same object true\n" +
        "TypeError with a number message: same object true\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // Node reads err.name and err.message: it prints [Circular] for such an object and throws its own TypeError for null.
  it.concurrent("runs no code of the thrown value to decide", async () => {
    expect(
      await run(`
        const c = { a: 1 }; c.self = c;
        console.log("%j", c);
        let nameReads = 0, messageReads = 0;
        const lookalike = {
          get name() { nameReads++; return "TypeError"; },
          get message() { messageReads++; return "JSON.stringify cannot serialize cyclic structures."; },
        };
        let thrown = "no throw";
        try { console.log("%j", { toJSON() { throw lookalike; } }); } catch (e) { thrown = e; }
        console.log(\`lookalike: same object \${thrown === lookalike}, name reads \${nameReads}, message reads \${messageReads}\`);
        thrown = "no throw";
        try { console.log("%j", { toJSON() { throw null; } }); } catch (e) { thrown = e; }
        console.log(\`null: \${thrown}\`);
      `),
    ).toEqual({
      stdout: "[Circular]\nlookalike: same object true, name reads 0, message reads 0\nnull: null\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it.concurrent("prints it without color", async () => {
    expect(
      await run(`const c = { a: 1 }; c.self = c; console.log("%j", c);`, {
        ...bunEnv,
        NO_COLOR: undefined,
        FORCE_COLOR: "1",
      }),
    ).toEqual({ stdout: "[Circular]\n", stderr: "", exitCode: 0 });
  });
});

it("console.log with SharedArrayBuffer", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(new ArrayBuffer(0))).toBe("ArrayBuffer(0) []");
  expect(Bun.inspect(new SharedArrayBuffer(0))).toBe("SharedArrayBuffer(0) []");
  expect(Bun.inspect(new ArrayBuffer(3))).toBe("ArrayBuffer(3) [ 0, 0, 0 ]");
  expect(Bun.inspect(new SharedArrayBuffer(3))).toBe("SharedArrayBuffer(3) [ 0, 0, 0 ]");
});

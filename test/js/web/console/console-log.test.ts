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

it("console.log with SharedArrayBuffer", () => {
  // console.log(x) === Bun.inspect(x) + "\n" written to stdout.
  expect(Bun.inspect(new ArrayBuffer(0))).toBe("ArrayBuffer(0) []");
  expect(Bun.inspect(new SharedArrayBuffer(0))).toBe("SharedArrayBuffer(0) []");
  expect(Bun.inspect(new ArrayBuffer(3))).toBe("ArrayBuffer(3) [ 0, 0, 0 ]");
  expect(Bun.inspect(new SharedArrayBuffer(3))).toBe("SharedArrayBuffer(3) [ 0, 0, 0 ]");
});

it.concurrent("console methods print every argument of a call with more than 255 arguments", async () => {
  // Not console.assert: a failing one aborts under BUN_JSC_validateExceptionChecks until #44950.
  const methods = ["log", "info", "debug", "warn", "error", "trace", "group", "groupCollapsed", "dirxml", "timeLog"];
  const counts = [255, 256, 300];
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `console.time("timer");
       for (const method of ${JSON.stringify(methods)}) {
         for (const count of ${JSON.stringify(counts)}) {
           // The values of one call are "log300_0" to "log300_299".
           const values = Array.from({ length: count }, (_, i) => method + count + "_" + i);
           if (method === "timeLog") console.timeLog("timer", ...values);
           else console[method](...values);
           if (method.startsWith("group")) console.groupEnd();
         }
       }`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // What one call prints: its values with a space between them.
  const line = (method: string, count: number) =>
    Array.from({ length: count }, (_, i) => method + count + "_" + i).join(" ") + "\n";
  // The lines of these methods, in the order of the calls.
  const lines = (names: string[], prefix = "") =>
    names.flatMap(name => counts.map(count => prefix + line(name, count))).join("");
  expect({
    stdout: stdout.replace(/^ +at .+\n/gm, ""),
    stderr: stderr.replace(/^\[.+?s\]/gm, "[elapsed]"),
    exitCode,
  }).toEqual({
    stdout: lines(["log", "info", "debug", "trace", "group", "groupCollapsed", "dirxml"]),
    stderr: lines(["warn", "error"]) + lines(["timeLog"], "[elapsed] timer "),
    exitCode: 0,
  });
});

it.concurrent("console.log fills in a format specifier from an argument past the 255th", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const values = Array.from({ length: 300 }, (_, i) => "v" + i);
       console.log(values.map(() => "%s").join(" "), ...values);`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    stdout: Array.from({ length: 300 }, (_, i) => "v" + i).join(" ") + "\n",
    stderr: "",
    exitCode: 0,
  });
});

it.concurrent("console.log throws what the inspect hook of an argument past the 255th throws", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const values = Array.from({ length: 300 }, (_, i) => i);
       values[299] = {
         [Symbol.for("nodejs.util.inspect.custom")]() {
           throw new Error("from argument 299");
         },
       };
       try {
         console.log(...values);
       } catch (e) {
         console.error(e.message);
       }`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({
    // The arguments before the one that throws are already written.
    stdout: Array.from({ length: 299 }, (_, i) => i + " ").join(""),
    stderr: "from argument 299\n",
    exitCode: 0,
  });
});

it.concurrent("console.log prints every argument of a call with 70000 arguments", async () => {
  // More arguments than a 16-bit count can hold.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.log(...Array.from({ length: 70000 }, (_, i) => i));`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const expected = Array.from({ length: 70000 }, (_, i) => i).join(" ") + "\n";
  const printed = stdout.trimEnd().split(" ");
  // `exact` checks every byte. The count and the last value keep the failure message short.
  expect({ exact: stdout === expected, count: printed.length, last: printed.at(-1), stderr, exitCode }).toEqual({
    exact: true,
    count: 70000,
    last: "69999",
    stderr: "",
    exitCode: 0,
  });
});

it.concurrent("console.log gives every argument to an attached inspector and to the terminal", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--inspect=ws://127.0.0.1:0/", "-e", "setInterval(() => {}, 1000);"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  // The inspector prints its WebSocket URL to stderr.
  let stderr = "";
  let url: string | undefined;
  const stderrDecoder = new TextDecoder();
  for await (const chunk of proc.stderr) {
    stderr += stderrDecoder.decode(chunk, { stream: true });
    url = stderr.match(/ws:\/\/\S+/)?.[0];
    if (url) break;
  }
  if (!url) throw new Error(`No inspector URL in stderr:\n${stderr}`);

  const ws = new WebSocket(url);
  const opened = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<never>();
  const added = Promise.withResolvers<{ message: { parameters: { value: string }[] } }>();
  const evaluated = Promise.withResolvers<{ wasThrown: boolean }>();
  closed.promise.catch(() => {});
  ws.addEventListener("open", () => opened.resolve());
  ws.addEventListener("close", () => closed.reject(new Error("The inspector closed the socket")));
  ws.addEventListener("error", () => closed.reject(new Error("The inspector socket failed")));
  ws.addEventListener("message", ({ data }) => {
    const { id, method, params, result } = JSON.parse(String(data));
    if (method === "Console.messageAdded") added.resolve(params);
    if (id === 2) evaluated.resolve(result);
  });
  await Promise.race([opened.promise, closed.promise]);
  ws.send(JSON.stringify({ id: 1, method: "Console.enable" }));
  ws.send(
    JSON.stringify({
      id: 2,
      method: "Runtime.evaluate",
      params: { expression: `console.log(...Array.from({ length: 300 }, (_, i) => "v" + i))` },
    }),
  );
  const { message } = await Promise.race([added.promise, closed.promise]);

  // The terminal gets the call as one line on stdout.
  let stdout = "";
  const stdoutDecoder = new TextDecoder();
  for await (const chunk of proc.stdout) {
    stdout += stdoutDecoder.decode(chunk, { stream: true });
    if (stdout.includes("\n")) break;
  }
  // The call returned, and the process is still there.
  const { wasThrown } = await Promise.race([evaluated.promise, closed.promise]);
  const exitCode = proc.exitCode;
  ws.close();

  const values = Array.from({ length: 300 }, (_, i) => "v" + i);
  expect({
    inspector: message.parameters.map(parameter => parameter.value),
    terminal: stdout.trimEnd().split(" "),
    wasThrown,
    exitCode,
  }).toEqual({ inspector: values, terminal: values, wasThrown: false, exitCode: null });
});

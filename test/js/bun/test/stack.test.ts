import { $ } from "bun";
import { drainMicrotasks } from "bun:jsc";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "node:path";

test("name property is used for function calls in Error.stack", () => {
  function WRONG() {
    return new Error().stack;
  }
  expect(WRONG()).not.toContain("at RIGHT");
  expect(WRONG()).toContain("at WRONG");
  Object.defineProperty(WRONG, "name", { value: "RIGHT" });
  expect(WRONG()).not.toContain("at WRONG");
  expect(WRONG()).toContain("at RIGHT");
});

test("name property is used for function calls in Bun.inspect", () => {
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  function WRONG() {
    try {
      throw new Error();
    } catch (e) {
      return Bun.inspect(e);
    }
  }
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  expect(WRONG()).not.toContain("at RIGHT");
  expect(WRONG()).toContain("at WRONG");
  Object.defineProperty(WRONG, "name", { value: "RIGHT" });
  expect(WRONG()).not.toContain("at WRONG");
  expect(WRONG()).toContain("at RIGHT");
});

test.todo("name property is used for function calls in Bun.inspect with bound object", () => {
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  let WRONG = function WRONG() {
    try {
      throw new Error();
    } catch (e) {
      return Bun.inspect(e);
    }
  };
  WRONG = WRONG.bind({});
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  // ** whitespace **
  expect(WRONG()).not.toContain("at RIGHT");
  expect(WRONG()).toContain("at WRONG");
  Object.defineProperty(WRONG, "name", { value: "RIGHT", writable: true, configurable: true });
  console.log(WRONG());
  expect(WRONG()).not.toContain("at WRONG");
  expect(WRONG()).toContain("at RIGHT");
});

test("err.line and err.column are set", async () => {
  expect(await bunRun(join(import.meta.dir, "err-stack-fixture.js"))).toSpawn(
    JSON.stringify(
      {
        line: 3,
        column: 17,
        originalLine: 1,
        originalColumn: 18,
      },
      null,
      2,
    ),
  );
});

test("throwing inside an error suppresses the error and prints the stack", async () => {
  $.throws(false);
  $.env(bunEnv);
  const result = await $`${bunExe()} run ${join(import.meta.dir, "err-custom-fixture.js")}`;

  const { stderr, exitCode } = result;

  expect(stderr.toString().trim().split("\n").slice(0, -1).join("\n").trim()).toMatchInlineSnapshot(`
"error: My custom error message
{
  message: "My custom error message",
  name: [Getter],
  line: 42,
  sourceURL: "http://example.com/test.js",
}
      at http://example.com/test.js:42"
`);
  expect(exitCode).toBe(1);
});

test("uncaught error thrown from a data: URL module longer than a path buffer is annotated for GitHub Actions", async () => {
  // Longer than a path buffer on every platform (98302 bytes on Windows).
  const padding = 100_000;
  const dataUrlModule = 'export default function fromDataUrl() { throw new Error("boom"); }//';
  const base64 = btoa(dataUrlModule + Buffer.alloc(padding, "x").toString());

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const source = ${JSON.stringify(dataUrlModule)} + Buffer.alloc(${padding}, "x").toString();
       const m = await import("data:text/javascript;base64," + btoa(source));
       m.default();`,
    ],
    env: { ...bunEnv, GITHUB_ACTIONS: "true" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  const annotation = stderr.split("\n").find(line => line.startsWith("::error"));
  expect(annotation).toStartWith(`::error file=data%3Atext/javascript;base64%2C${base64},line=1,col=`);
  expect(annotation).toContain(`%0A      at fromDataUrl (data:text/javascript;base64,${base64}:1:`);
  expect(exitCode).toBe(1);
});

test("throwing inside an error suppresses the error and continues printing properties on the object", async () => {
  $.throws(false);
  $.env(bunEnv);
  const fixture = join(import.meta.dir, "err-fd-fixture.js");
  const result = await $`${bunExe()} run ${fixture}`;

  const { stderr, exitCode } = result;

  // The module awaits the promise that native code rejects. Its frame is the position of the error.
  expect(stderr.toString().trim().replaceAll("\\", "/")).toStartWith(`1 | try {
2 |   await require("fs").promises.readFile("this-file-path-is-bad");
                                   ^
ENOENT: no such file or directory, open 'this-file-path-is-bad'
    path: "this-file-path-is-bad",
 syscall: "open",
   errno: ${process.binding("uv").UV_ENOENT},
    code: "ENOENT"

      at async ${fixture.replaceAll("\\", "/")}:2:32
`);
  expect(exitCode).toBe(1);
});

test("Async functions frame should be included in stack trace", async () => {
  async function foo() {
    return await bar();
  }
  async function bar() {
    return await baz();
  }
  async function baz() {
    await 1;
    return await qux();
  }
  async function qux() {
    return new Error("error from qux");
  }

  const error = await foo();

  console.log(error.stack);

  expect(normalizeBunSnapshot(error.stack!)).toMatchInlineSnapshot(`
    "Error: error from qux
        at qux (file:NN:NN)
        at baz (file:NN:NN)
        at async bar (file:NN:NN)
        at async foo (file:NN:NN)
        at async <anonymous> (file:NN:NN)"
  `);
});

// The last four states give promise reactions another layout: an async context, or a realm whose
// fast paths for promises are off. The frames are the same in each.
// Not concurrent: five debug builds at once take three times as long each.
test.each(["default", "async context", "then() replaced", "constructor written", "prototype frozen"])(
  "async frames follow the promises that settle each other (%s)",
  async state => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "async-stack-frames-fixture.mjs"), state],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Node v26 prints the same frames of the fixture for every shape, except where a comment says so.
    const callers = (shape: string) => [`async ${shape}`, "async caller", "async <module>"];
    const made = (top: string, shapes: string[]) =>
      Object.fromEntries(shapes.map(shape => [shape, [top, ...callers(shape)]]));
    expect({ frames: stdout && JSON.parse(stdout), stderr }).toEqual({
      frames: {
        ...made("failing", [
          "direct",
          "all",
          "race",
          "then",
          "thenBoth",
          "catch_",
          "finally_",
          "thenWithoutHandlers",
          "thenCatchFinally",
          "returnWithoutAwait",
          "resolveOfConstructor",
          "resolveOfWithResolvers",
          "handlerReturnsPromise",
          "finallyHandlerReturnsPromise",
          "thenWithResolvingFunctions",
          "thenable",
          "constructorFunctionsAsHandlers",
          "constructorFunctionsInThenAndCatch",
          "allOfThen",
          "thenOfAll",
          "raceOfThen",
          "thenOfRace",
          "allOfAll",
          "subclassResolvedWithPromise",
          "allSettledOfSubclass",
          "forAwaitOfArray",
          // Node also prints `async generator` in front of the callers.
          "asyncGeneratorAwaits",
        ]),
        ...made("thrower", [
          "handlerThrows",
          "catchHandlerThrows",
          "finallyHandlerThrows",
          "handlerOfPendingPromiseThrows",
          "handlerThrowsThenThen",
          "boundHandlerThrows",
          "handlerInForAwaitThrows",
        ]),
        // Node names the frame `Object.then`.
        thenOfThenableThrows: ["thrower", "then", ...callers("thenOfThenableThrows")],
        asyncGeneratorBodyThrows: ["thrower", "generator", ...callers("asyncGeneratorBodyThrows")],
        // No callers, as in Node: the promise has two reactions, the handlers are resolve and reject
        // functions of a promise that nothing waits for, the handler is a reject function, the
        // handler settles a capability, and return() of an async generator is no link.
        twoReactions: ["failing"],
        resultOfThenWithResolvingFunctions: ["failing"],
        rejectFunctionAsFulfillHandler: ["failing"],
        handlerOnSubclassThrows: ["thrower"],
        returnOfAsyncGenerator: ["failing"],
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  },
);

test.each([
  {
    // https://github.com/oven-sh/bun/issues/23760
    name: "from a then() handler",
    file: "blowup.ts",
    source: [
      `function unwrap(x: unknown) {`,
      `  if (x == null) {`,
      `    throw new Error("failed to unwrap");`,
      `  }`,
      `  return x;`,
      `}`,
      ``,
      `await Promise.resolve(null).then(unwrap);`,
    ],
    frames: ["at unwrap (/blowup.ts:3:15)", "at async /blowup.ts:8:29"],
  },
  {
    // The printer reads the frames from the string of error.stack once something has read it.
    name: "from a then() handler, after its stack was read,",
    file: "read.ts",
    source: [
      `function unwrap(x: unknown) {`,
      `  if (x == null) {`,
      `    const error = new Error("failed to unwrap");`,
      `    void error.stack;`,
      `    throw error;`,
      `  }`,
      `  return x;`,
      `}`,
      ``,
      `await Promise.resolve(null).then(unwrap);`,
    ],
    frames: ["at unwrap (/read.ts:3:23)", "at async /read.ts:10:29"],
  },
  {
    // https://github.com/oven-sh/bun/issues/10483
    name: "from an async function",
    file: "check.mjs",
    source: [
      `export function throwSome(b) {`,
      `    return async () => {`,
      `        await b()`,
      `        throw new Error('asd')`,
      `    }`,
      `}`,
      `export const some = throwSome(async () => {})`,
      `await some()`,
    ],
    frames: ["at <anonymous> (/check.mjs:4:19)", "at async /check.mjs:8:7"],
  },
  {
    // The job runs inside processTicksAndRejections(), whose frame is not a frame of the file.
    name: "from a then() handler that the nextTick queue runs",
    file: "tick.mjs",
    source: [
      `function thrower() {`,
      `  throw new Error("thrower");`,
      `}`,
      `async function chain() {`,
      `  await new Promise(resolve => process.nextTick(resolve)).then(thrower);`,
      `}`,
      `async function caller() {`,
      `  await chain();`,
      `}`,
      `await caller();`,
    ],
    frames: [
      "at thrower (/tick.mjs:2:13)",
      "at async chain (/tick.mjs:5:59)",
      "at async caller (/tick.mjs:8:9)",
      "at async /tick.mjs:10:7",
    ],
  },
])("an uncaught error $name has the frame of the module that awaits it", async ({ file, source, frames }) => {
  using dir = tempDir("async-module-frame", { [file]: source.join("\n") });
  await using proc = Bun.spawn({
    cmd: [bunExe(), file],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const printed = stderr
    .split("\n")
    .filter(line => line.trimStart().startsWith("at ") && line.includes(file))
    .map(line => line.trim().replaceAll(String(dir), "").replaceAll("\\", "/"));
  expect({ stdout, frames: printed }).toEqual({ stdout: "", frames });
  expect(exitCode).toBe(1);
});

test("the frame of a module that waits at a top-level await in error.stack and as a call site", async () => {
  using dir = tempDir("async-module-frame", {
    "main.mjs": [
      `async function failing() {`,
      `  await new Promise(resolve => setImmediate(resolve));`,
      `  throw new Error("failing");`,
      `}`,
      `let error;`,
      `try {`,
      `  await failing();`,
      `} catch (e) {`,
      `  error = e;`,
      `}`,
      `const stack = error.stack.replaceAll(import.meta.dirname, "").replaceAll("\\\\", "/");`,
      `Error.prepareStackTrace = (_, callSites) => callSites;`,
      `let callSites;`,
      `try {`,
      `  await failing();`,
      `} catch (e) {`,
      `  callSites = e.stack;`,
      `}`,
      `const last = callSites.at(-1);`,
      `console.log(JSON.stringify({`,
      `  stack,`,
      `  count: callSites.length,`,
      `  last: {`,
      `    isAsync: last.isAsync(),`,
      `    functionName: last.getFunctionName(),`,
      `    function: last.getFunction() === undefined,`,
      `    fileName: last.getFileName().replaceAll(import.meta.dirname, "").replaceAll("\\\\", "/"),`,
      `    lineNumber: last.getLineNumber(),`,
      `    isToplevel: last.isToplevel(),`,
      `    isNative: last.isNative(),`,
      `  },`,
      `}));`,
    ].join("\n"),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ result: stdout && JSON.parse(stdout), stderr }).toEqual({
    result: {
      stack: "Error: failing\n    at failing (/main.mjs:3:13)\n    at async /main.mjs:7:9",
      count: 2,
      last: {
        isAsync: true,
        functionName: "",
        function: true,
        fileName: "/main.mjs",
        lineNumber: 15,
        isToplevel: true,
        isNative: false,
      },
    },
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

test("the frame of a module that waits keeps the file when a collection takes the code of the module", async () => {
  using dir = tempDir("async-module-frame", {
    "main.mjs": [
      `// The module waits, so its code is not on the stack. The collection takes it.`,
      `async function lateError() {`,
      `  const gate = Promise.withResolvers();`,
      `  setTimeout(() => {`,
      `    Bun.gc(true);`,
      `    gate.resolve();`,
      `  });`,
      `  await gate.promise;`,
      `  return new Error("late");`,
      `}`,
      `const withoutDirectory = text => text.replaceAll(import.meta.dirname, "").replaceAll("\\\\", "/");`,
      `const stack = withoutDirectory((await lateError()).stack);`,
      `Error.prepareStackTrace = (_, callSites) => callSites.at(-1);`,
      `const callSite = (await lateError()).stack;`,
      `console.log(JSON.stringify({`,
      `  stack,`,
      `  callSite: {`,
      `    string: withoutDirectory(String(callSite)),`,
      `    isAsync: callSite.isAsync(),`,
      `    isNative: callSite.isNative(),`,
      `    fileName: withoutDirectory(callSite.getFileName()),`,
      `  },`,
      `}));`,
    ].join("\n"),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    env: { ...bunEnv, BUN_JSC_forceCodeBlockToJettisonDueToOldAge: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ result: stdout && JSON.parse(stdout), stderr }).toEqual({
    result: {
      stack: "Error: late\n    at lateError (/main.mjs:9:14)\n    at async /main.mjs",
      callSite: { string: "async /main.mjs", isAsync: true, isNative: false, fileName: "/main.mjs" },
    },
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

// expect().rejects drains the microtask queue inside the test function. The handler runs as a job
// above the frame of the test, and it keeps the async frames of what waits for it.
test("an Error from a then() handler keeps its async callers under expect().rejects", async () => {
  function thrower() {
    throw new Error("from the handler");
  }
  async function chain() {
    await Promise.resolve().then(thrower);
  }
  async function caller() {
    await chain();
  }
  const namesOf = (error: Error) =>
    error
      .stack!.split("\n")
      .slice(1)
      .map(line => /^\s*at (async )?(\S+)/.exec(line))
      .filter(match => match && ["thrower", "chain", "caller"].includes(match[2]))
      .map(match => (match![1] ?? "") + match![2]);

  let error: Error | undefined;
  const seen = (e: Error) => {
    error = e;
    throw e;
  };
  // Once before the first await of the test function, and once after it.
  await expect(caller().catch(seen)).rejects.toThrow("from the handler");
  const before = namesOf(error!);
  await expect(caller().catch(seen)).rejects.toThrow("from the handler");
  expect({ before, after: namesOf(error!) }).toEqual({
    before: ["thrower", "async chain", "async caller"],
    after: ["thrower", "async chain", "async caller"],
  });
});

test("Error.captureStackTrace finds a caller below the frames of a job inside a job", () => {
  // drainMicrotasks() runs resumed() as a job above the frame of drains(). The async frame of
  // awaitsResumed() is between the frame of resumed() and the frame of drains().
  const target: { stack?: string } = {};
  async function resumed() {
    await 0;
    Error.captureStackTrace(target, drains);
  }
  async function awaitsResumed() {
    await resumed();
  }
  function drains() {
    awaitsResumed();
    drainMicrotasks();
  }
  function callsDrains() {
    drains();
  }
  callsDrains();

  const names = target
    .stack!.split("\n")
    .filter(line => line.trimStart().startsWith("at "))
    .map(line => line.trim().split(" ").slice(1, -1).join(" "));
  expect(names[0]).toBe("callsDrains");
  expect(names).not.toContain("async awaitsResumed");
});

test("the string of a call site of an async frame starts with async", async () => {
  async function inner() {
    await 0;
    return new Error("inner");
  }
  async function outer() {
    return await inner();
  }
  const prepareStackTrace = Error.prepareStackTrace;
  Error.prepareStackTrace = (_, callSites) => callSites.map(String);
  try {
    const strings = (await outer()).stack as unknown as string[];
    expect(strings.slice(0, 2)).toEqual([
      expect.stringMatching(/^inner \(.*\)$/),
      expect.stringMatching(/^async outer \(.*\)$/),
    ]);
  } finally {
    Error.prepareStackTrace = prepareStackTrace;
  }
});

// The three printers of a failure of bun test: the frames on stderr, the annotation for GitHub
// Actions, and the JUnit report.
test("bun test prints the async frames of a failure", async () => {
  using dir = tempDir("async-frames-of-a-failure", {
    "then.test.ts": [
      `import { expect, test } from "bun:test";`,
      `function check(x: unknown) {`,
      `  expect(x).toBe(1);`,
      `}`,
      `async function helper() {`,
      `  await 0;`,
      `  return 2;`,
      `}`,
      `test("handler", async () => {`,
      `  await helper().then(check);`,
      `});`,
      `test("module that waits", async () => {`,
      `  await import("./waits.mjs");`,
      `});`,
    ].join("\n"),
    "waits.mjs": [
      `async function failing() {`,
      `  await 0;`,
      `  throw new Error("from the module");`,
      `}`,
      `await failing();`,
    ].join("\n"),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "then.test.ts", "--reporter=junit", "--reporter-outfile=junit.xml"],
    env: { ...bunEnv, GITHUB_ACTIONS: "true" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  const framesIn = (lines: string[]) =>
    lines
      .map(line => line.trim().replaceAll(String(dir), "").replaceAll("\\", "/"))
      .filter(line => line.startsWith("at "));
  const printed: Record<string, string[]> = {};
  const annotated: Record<string, string[]> = {};
  let frames: string[] = [];
  let annotation: string[] = [];
  for (const line of stderr.split("\n")) {
    if (line.startsWith("::error ")) annotation = framesIn(line.split("%0A"));
    else if (line.startsWith("(fail) ")) {
      const name = line.slice("(fail) ".length).replace(/ \[.*$/, "");
      printed[name] = frames;
      annotated[name] = annotation;
      frames = [];
    } else frames.push(...framesIn([line]));
  }
  const junit: Record<string, string[]> = {};
  const report = await Bun.file(join(String(dir), "junit.xml")).text();
  for (const [, name, body] of report.matchAll(/<testcase name="([^"]+)"[^>]*>\s*<failure[^>]*>([^<]*)<\/failure>/g))
    junit[name] = framesIn(body.split("&#10;"));

  const handler = ["at check (/then.test.ts:3:13)", "at async <anonymous> (/then.test.ts:10:18)"];
  const moduleThatWaits = ["at failing (/waits.mjs:3:13)", "at async /waits.mjs:5:7"];
  expect({ printed, annotated, junit }).toEqual({
    printed: { "handler": handler, "module that waits": moduleThatWaits },
    annotated: { "handler": handler, "module that waits": moduleThatWaits },
    // The report has paths from the directory of the run, and no name for a function without one.
    junit: {
      "handler": ["at check (then.test.ts:3:13)", "at async then.test.ts:10:18"],
      "module that waits": ["at failing (waits.mjs:3:13)", "at async waits.mjs:5:7"],
    },
  });
  expect(exitCode).toBe(1);
});

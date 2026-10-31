import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { endChildren, spawn } from "../../../cli/children";

// A top-level await that nothing can settle anymore: no task is queued and
// nothing ref'd is left on the event loop. Like Node, Bun emits 'beforeExit',
// prints "Detected unsettled top-level await" with the place of each stalled
// await, and exits with code 13 unless an exit code is already chosen.
// https://github.com/oven-sh/bun/issues/14951

type Result = { stdout: string; stderr: string; exitCode: number | null; signalCode: string | null };

async function run(files: Record<string, string>, args: string[], env: Record<string, string> = {}): Promise<Result> {
  using dir = tempDir("unsettled-tla", files);
  return await spawned([bunExe(), ...args], String(dir), env);
}

// A build without the fix polls for ever in these children. Their tests time out, and this ends them with the file.
afterAll(endChildren);

async function spawned(cmd: string[], cwd: string, env: Record<string, string> = {}, stdin?: string): Promise<Result> {
  await using proc = spawn({
    cmd,
    env: { ...bunEnv, ...env },
    cwd,
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The directory differs from run to run, and the warning names the module by its file URL.
  return { stdout, stderr: stderr.replace(/file:\/\/\S*\//g, "file://<dir>/"), exitCode, signalCode: proc.signalCode };
}

/** What the warning prints for an `await` at the start of `source`, which is line `line` of `file`. */
function warning(file: string, line: number, source: string, indent = "") {
  return `Warning: Detected unsettled top-level await at file://<dir>/${file}:${line}\n${source}\n${indent}^\n\n`;
}

const dead = "await new Promise(() => {});";

describe.concurrent("an unsettled top-level await in the entry module", () => {
  test("exits with code 13 and a warning, and runs nothing after the await", async () => {
    expect(await run({ "a.mjs": `console.log("before");\n${dead}\nconsole.log("after");\n` }, ["a.mjs"])).toEqual({
      stdout: "before\n",
      stderr: warning("a.mjs", 2, dead),
      exitCode: 13,
      signalCode: null,
    });
  });

  test("exits only after a ref'd timer has fired", async () => {
    expect(
      await run(
        {
          "a.mjs": `console.log("before");\nsetTimeout(() => console.log("timer"), 50);\n${dead}\nconsole.log("after");\n`,
        },
        ["a.mjs"],
      ),
    ).toEqual({ stdout: "before\ntimer\n", stderr: warning("a.mjs", 3, dead), exitCode: 13, signalCode: null });
  });

  test("a promise that a timer resolves is not reported", async () => {
    expect(
      await run(
        {
          "a.mjs": `console.log("before");\nawait new Promise(resolve => setTimeout(resolve, 50));\nconsole.log("after");\n`,
        },
        ["a.mjs"],
      ),
    ).toEqual({ stdout: "before\nafter\n", stderr: "", exitCode: 0, signalCode: null });
  });

  test("'beforeExit' fires first, and an 'exit' listener sees code 13", async () => {
    expect(
      await run(
        {
          "a.mjs": `process.on("beforeExit", code => console.log("beforeExit", code, process.exitCode));
process.on("exit", code => console.log("exit", code, process.exitCode));
${dead}
`,
        },
        ["a.mjs"],
      ),
    ).toEqual({
      stdout: "beforeExit 0 undefined\nexit 13 13\n",
      stderr: warning("a.mjs", 3, dead),
      exitCode: 13,
      signalCode: null,
    });
  });

  test("an exit code that is already chosen wins, without a warning", async () => {
    expect(
      await run(
        { "a.mjs": `process.on("exit", code => console.log("exit", code));\nprocess.exitCode = 42;\n${dead}\n` },
        ["a.mjs"],
      ),
    ).toEqual({ stdout: "exit 42\n", stderr: "", exitCode: 42, signalCode: null });
  });

  test("an exit code of 0 that the program set does not count as chosen", async () => {
    expect(await run({ "a.mjs": `process.exitCode = 0;\n${dead}\n` }, ["a.mjs"])).toEqual({
      stdout: "",
      stderr: warning("a.mjs", 2, dead),
      exitCode: 13,
      signalCode: null,
    });
  });

  test("an 'exit' listener can replace code 13", async () => {
    expect(
      await run({ "a.mjs": `process.on("exit", () => { process.exitCode = 0; });\n${dead}\n` }, ["a.mjs"]),
    ).toEqual({ stdout: "", stderr: warning("a.mjs", 2, dead), exitCode: 0, signalCode: null });
  });

  test("a 'beforeExit' listener that resolves the promise lets the module finish", async () => {
    expect(
      await run(
        {
          "a.mjs": `let resolve;
process.on("beforeExit", () => { console.log("beforeExit"); resolve(); });
await new Promise(r => { resolve = r; });
console.log("after");
`,
        },
        ["a.mjs"],
      ),
    ).toEqual({ stdout: "beforeExit\nafter\n", stderr: "", exitCode: 0, signalCode: null });
  });

  test("a module that a 'beforeExit' listener resumed can wait for more work", async () => {
    expect(
      await run(
        {
          "a.mjs": `let resolve;
process.on("beforeExit", () => { console.log("beforeExit"); resolve?.(); resolve = undefined; });
await new Promise(r => { resolve = r; });
console.log("resumed");
await new Promise(r => setTimeout(r, 20));
console.log("done");
`,
        },
        ["a.mjs"],
      ),
    ).toEqual({ stdout: "beforeExit\nresumed\ndone\nbeforeExit\n", stderr: "", exitCode: 0, signalCode: null });
  });

  test("the wait goes on while 'beforeExit' listeners schedule work", async () => {
    expect(
      await run(
        {
          "a.mjs": `let turns = 0;
process.on("beforeExit", () => {
  console.log("beforeExit", ++turns);
  if (turns < 3) setTimeout(() => console.log("timer", turns), 10);
});
${dead}
`,
        },
        ["a.mjs"],
      ),
    ).toEqual({
      stdout: "beforeExit 1\ntimer 1\nbeforeExit 2\ntimer 2\nbeforeExit 3\n",
      stderr: warning("a.mjs", 6, dead),
      exitCode: 13,
      signalCode: null,
    });
  });

  test("a 'beforeExit' listener that rejects the promise gives the error and code 1", async () => {
    const result = await run(
      {
        "a.mjs": `let reject;
process.on("beforeExit", () => reject(new Error("rejected from beforeExit")));
await new Promise((_, r) => { reject = r; });
console.log("after");
`,
      },
      ["a.mjs"],
    );
    expect(result.stderr).toContain("error: rejected from beforeExit");
    expect(result.stderr).not.toContain("unsettled top-level await");
    expect({ ...result, stderr: "" }).toEqual({ stdout: "", stderr: "", exitCode: 1, signalCode: null });
  });

  test("process.exit() in a 'beforeExit' listener gives its code, without a warning", async () => {
    expect(await run({ "a.mjs": `process.on("beforeExit", () => process.exit(7));\n${dead}\n` }, ["a.mjs"])).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 7,
      signalCode: null,
    });
  });

  test.each([
    ["an error that a timer throws", `setTimeout(() => { throw new Error("thrown beside the await"); }, 10);`],
    ["a rejection that nothing handles", `Promise.reject(new Error("thrown beside the await"));`],
  ])("%s gives the error and code 1, without a warning", async (_, statement) => {
    const result = await run({ "a.mjs": `${statement}\n${dead}\n` }, ["a.mjs"]);
    expect(result.stderr).toContain("error: thrown beside the await");
    expect(result.stderr).not.toContain("unsettled top-level await");
    expect({ ...result, stderr: "" }).toEqual({ stdout: "", stderr: "", exitCode: 1, signalCode: null });
  });

  // The listeners of 'unhandledRejection' and 'uncaughtException' run at the end of a turn of the event loop.
  // What they do counts: the wait does not end between a listener and the jobs that it queued.
  test.each([
    ["settles the promise", `process.on("unhandledRejection", () => { console.log("listener"); resolve(); });`],
    [
      "settles it in a tick",
      `process.on("unhandledRejection", () => { console.log("listener"); process.nextTick(resolve); });`,
    ],
    [
      "settles it in a microtask",
      `process.on("unhandledRejection", () => { console.log("listener"); queueMicrotask(resolve); });`,
    ],
    [
      "settles it behind an await",
      `process.on("unhandledRejection", async () => { console.log("listener"); await null; resolve(); });`,
    ],
    [
      "throws, and an 'uncaughtException' listener settles it",
      `process.on("uncaughtException", () => resolve());
process.on("unhandledRejection", () => { console.log("listener"); throw new Error("from the listener"); });`,
    ],
  ])("an 'unhandledRejection' listener that %s lets the module finish", async (_, listeners) => {
    expect(
      await run(
        {
          "a.mjs": `let resolve;
${listeners}
Promise.reject(new Error("rejected beside the await"));
await new Promise(r => { resolve = r; });
console.log("after");
`,
        },
        ["a.mjs"],
      ),
    ).toEqual({ stdout: "listener\nafter\n", stderr: "", exitCode: 0, signalCode: null });
  });

  test("each await that a listener settles goes on in its turn", async () => {
    expect(
      await run(
        {
          "a.mjs": `let next;
process.on("unhandledRejection", error => { console.log("listener", error.message); next(); });
for (let i = 0; i < 3; i++) {
  const done = new Promise(resolve => (next = resolve));
  Promise.reject(new Error("r" + i));
  await done;
  console.log("step", i);
}
`,
        },
        ["a.mjs"],
      ),
    ).toEqual({
      stdout: "listener r0\nstep 0\nlistener r1\nstep 1\nlistener r2\nstep 2\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test("a listener that settles the promise after 'beforeExit' lets the module finish", async () => {
    expect(
      await run(
        {
          "a.mjs": `let resolve;
process.on("unhandledRejection", () => { console.log("listener"); resolve(); });
process.once("beforeExit", () => { console.log("beforeExit"); Promise.reject(new Error("in beforeExit")); });
await new Promise(r => { resolve = r; });
console.log("after");
`,
        },
        ["a.mjs"],
      ),
    ).toEqual({ stdout: "beforeExit\nlistener\nafter\n", stderr: "", exitCode: 0, signalCode: null });
  });

  test("'beforeExit' does not fire again for a rejection that a listener takes", async () => {
    expect(
      await run(
        {
          "a.mjs": `let fired = 0;
process.on("unhandledRejection", error => console.log("listener", error.message));
process.on("beforeExit", () => { Promise.reject(new Error("in beforeExit " + ++fired)); });
process.on("exit", code => console.log("exit", code, fired));
${dead}
`,
        },
        ["a.mjs"],
      ),
    ).toEqual({
      stdout: "listener in beforeExit 1\nexit 13 1\n",
      stderr: warning("a.mjs", 5, dead),
      exitCode: 13,
      signalCode: null,
    });
  });

  test("a rejection in a 'beforeExit' listener gives the error and code 1, without a warning", async () => {
    const result = await run(
      { "a.mjs": `process.on("beforeExit", () => { Promise.reject(new Error("in beforeExit")); });\n${dead}\n` },
      ["a.mjs"],
    );
    expect(result.stderr).toContain("error: in beforeExit");
    expect(result.stderr).not.toContain("unsettled top-level await");
    expect({ ...result, stderr: "" }).toEqual({ stdout: "", stderr: "", exitCode: 1, signalCode: null });
  });

  test("work that is unref'd does not keep the wait alive", async () => {
    const source = `await new Promise(resolve => setTimeout(() => { console.log("timer"); resolve(); }, 20).unref());`;
    expect(await run({ "a.mjs": `${source}\nconsole.log("after");\n` }, ["a.mjs"])).toEqual({
      stdout: "",
      stderr: warning("a.mjs", 1, source),
      exitCode: 13,
      signalCode: null,
    });
  });

  test("--no-warnings silences the warning and keeps code 13", async () => {
    expect(await run({ "a.mjs": `${dead}\n` }, ["--no-warnings", "a.mjs"])).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 13,
      signalCode: null,
    });
  });

  test("NODE_NO_WARNINGS=1 does not silence the warning", async () => {
    expect(await run({ "a.mjs": `${dead}\n` }, ["a.mjs"], { NODE_NO_WARNINGS: "1" })).toEqual({
      stdout: "",
      stderr: warning("a.mjs", 1, dead),
      exitCode: 13,
      signalCode: null,
    });
  });
});

describe.concurrent("the warning names each stalled await", () => {
  test("in the module that is suspended, not in the modules that wait for it", async () => {
    expect(
      await run(
        {
          "entry.mjs": `import "./mid.mjs";\nconsole.log("entry ran");\n`,
          "mid.mjs": `import "./leaf.mjs";\nconsole.log("mid ran");\n`,
          "leaf.mjs": `console.log("leaf ran");\n\n${dead}\n`,
        },
        ["entry.mjs"],
      ),
    ).toEqual({ stdout: "leaf ran\n", stderr: warning("leaf.mjs", 3, dead), exitCode: 13, signalCode: null });
  });

  test("once for each module, in the order of the imports", async () => {
    expect(
      await run(
        {
          "entry.mjs": `import "./first.mjs";\nimport "./second.mjs";\n`,
          "first.mjs": `${dead}\n`,
          "second.mjs": `await 0;\n${dead}\n`,
        },
        ["entry.mjs"],
      ),
    ).toEqual({
      stdout: "",
      stderr: warning("first.mjs", 1, dead) + warning("second.mjs", 2, dead),
      exitCode: 13,
      signalCode: null,
    });
  });

  test("at the import() of a module that never finishes", async () => {
    const source = `await import("./never.mjs");`;
    expect(
      await run({ "entry.mjs": `${source}\nconsole.log("after");\n`, "never.mjs": `${dead}\n` }, ["entry.mjs"]),
    ).toEqual({ stdout: "", stderr: warning("entry.mjs", 1, source), exitCode: 13, signalCode: null });
  });

  // https://github.com/oven-sh/bun/issues/45262
  test("at the import() that closes a cycle", async () => {
    const source = `await import("./config.mjs");`;
    expect(
      await run(
        {
          "entry.mjs": `${source}\nconsole.log("loaded");\n`,
          "config.mjs": `import "./again.mjs";\nexport default 1;\n`,
          "again.mjs": `await import("./config.mjs");\n`,
        },
        ["entry.mjs"],
      ),
    ).toEqual({ stdout: "", stderr: warning("entry.mjs", 1, source), exitCode: 13, signalCode: null });
  });

  test("on its line of a TypeScript file, under the `await` of a longer statement", async () => {
    const source = `\tconst value: number = await new Promise<number>(() => {});`;
    expect(
      await run(
        {
          "entry.ts": `interface Unused {\n  field: string;\n}\ntype Alias = Unused | null;\n\n${source}\nconsole.log(value);\n`,
        },
        ["entry.ts"],
      ),
    ).toEqual({
      stdout: "",
      stderr: warning("entry.ts", 6, source, "\t                      "),
      exitCode: 13,
      signalCode: null,
    });
  });

  // No position is recorded for an \`await\`. It is found from the last expression that ran before it.
  test.each([
    [
      "at the start of an expression that ends on a later line",
      "const settings = {};\nconst value = await load(\n  settings,\n).result();\n",
      { line: 2, source: "const value = await load(", indent: "              " },
    ],
    [
      "at an operand that is only a name",
      'try {\n  const closed = load().result();\n  console.log("waits");\n  await closed;\n} catch {}\n',
      { line: 4, source: "  await closed;", indent: "  " },
    ],
    [
      "behind an await that settled",
      "const pending = load().result();\nconst first = await Promise.resolve(1);\nawait pending;\n",
      { line: 3, source: "await pending;", indent: "" },
    ],
    [
      "behind text that is not ASCII",
      'const text = "h\u00e9llo w\u00f6rld \u65e5\u672c\u8a9e"; const value = await load().result();\n',
      {
        line: 1,
        source: 'const text = "h\u00e9llo w\u00f6rld \u65e5\u672c\u8a9e"; const value = await load().result();',
        indent: Buffer.alloc(46, " ").toString(),
      },
    ],
    [
      "at the `await` of a `for await`",
      "async function* each() {\n  yield 1;\n  await load().result();\n}\nfor await (const item of each()) console.log(item);\n",
      { line: 5, source: "for await (const item of each()) console.log(item);", indent: "    " },
    ],
  ])("%s", async (_, body, { line, source, indent }) => {
    const load = `const load = () => ({ result: () => new Promise(() => {}) });\n`;
    const result = await run({ "entry.mjs": load + body }, ["entry.mjs"]);
    expect({ ...result, stdout: "" }).toEqual({
      stdout: "",
      stderr: warning("entry.mjs", line + 1, source, indent),
      exitCode: 13,
      signalCode: null,
    });
  });

  test("without a line where none can be told: the disposal of an `await using`", async () => {
    expect(
      await run(
        {
          "entry.mjs": `await using resource = { [Symbol.asyncDispose]: () => new Promise(() => {}) };\nconsole.log("body");\n`,
        },
        ["entry.mjs"],
      ),
    ).toEqual({
      stdout: "body\n",
      stderr: "Warning: Detected unsettled top-level await at file://<dir>/entry.mjs\n\n",
      exitCode: 13,
      signalCode: null,
    });
  });

  // A line of minified code is cut like the line that an error shows, and the caret goes with its part of the line.
  test.each([
    ["at the start of a long line", (pad: string) => `${dead} /* ${pad} */`, "\n^"],
    ["far into a long line", (pad: string) => `/* ${pad} */ ${dead}`, ""],
  ])("%s", async (_, line, caret) => {
    const source = line(Buffer.alloc(2000, "x").toString());
    expect(await run({ "entry.mjs": source + "\n" }, ["entry.mjs"])).toEqual({
      stdout: "",
      stderr: `Warning: Detected unsettled top-level await at file://<dir>/entry.mjs:1\n${source.slice(0, 1024)}${caret}\n\n`,
      exitCode: 13,
      signalCode: null,
    });
  });

  // Nothing is suspended on an await here: a plugin never answers for the module that the entry imports.
  test("a module graph that never finishes loading is not called an unsettled await", async () => {
    expect(
      await run(
        {
          "plugin.mjs": `Bun.plugin({ name: "never", setup(build) { build.onLoad({ filter: /\\.never$/ }, () => new Promise(() => {})); } });\n`,
          "entry.mjs": `import "./module.never";\nconsole.log("after");\n`,
          "module.never": "",
        },
        ["--preload", "./plugin.mjs", "entry.mjs"],
      ),
    ).toEqual({
      stdout: "",
      stderr: "Warning: The load of file://<dir>/entry.mjs never finished, and nothing is left to wait for\n\n",
      exitCode: 13,
      signalCode: null,
    });
  });
});

describe.concurrent("an unsettled top-level await in other kinds of entry", () => {
  /** The warning for a script that has a name instead of a path. */
  const named = (name: string, line: number) =>
    `Warning: Detected unsettled top-level await at ${name}:${line}\n${dead}\n^\n\n`;

  test("--eval", async () => {
    using dir = tempDir("unsettled-tla-eval", {});
    expect(await spawned([bunExe(), "-e", `console.log("before");\n${dead}`], String(dir))).toEqual({
      stdout: "before\n",
      stderr: named("[eval]", 2),
      exitCode: 13,
      signalCode: null,
    });
  });

  test("--print prints nothing for the module that did not finish", async () => {
    using dir = tempDir("unsettled-tla-print", {});
    expect(await spawned([bunExe(), "-p", dead], String(dir))).toEqual({
      stdout: "",
      stderr: named("[eval]", 1),
      exitCode: 13,
      signalCode: null,
    });
  });

  test("--print prints the result of a module that a 'beforeExit' listener lets finish", async () => {
    using dir = tempDir("unsettled-tla-print-late", {});
    const script = `let resolve; process.on("beforeExit", () => resolve()); await new Promise(r => (resolve = r)); 5`;
    expect(await spawned([bunExe(), "-p", script], String(dir))).toEqual({
      stdout: "5\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test("--print still prints a pending promise that the script evaluates to", async () => {
    using dir = tempDir("unsettled-tla-print-pending", {});
    expect(await spawned([bunExe(), "-p", "new Promise(() => {})"], String(dir))).toEqual({
      stdout: "Promise { <pending> }\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  test("a script on stdin", async () => {
    using dir = tempDir("unsettled-tla-stdin", {});
    expect(await spawned([bunExe(), "-"], String(dir), {}, `console.log("before");\n${dead}\n`)).toEqual({
      stdout: "before\n",
      stderr: named("[stdin]", 2),
      exitCode: 13,
      signalCode: null,
    });
  });

  // A preload that cannot finish fails like a preload that throws: its error is the error of the run.
  test("a --preload fails the run, and the entry does not run", async () => {
    const result = await run(
      { "preload.mjs": `console.log("preload");\n${dead}\n`, "entry.mjs": `console.log("entry");\n` },
      ["--preload", "./preload.mjs", "entry.mjs"],
    );
    expect(result.stderr).toStartWith(
      `error: Detected unsettled top-level await at file://<dir>/preload.mjs:2\n${dead}\n^\n`,
    );
    expect({ ...result, stderr: "" }).toEqual({ stdout: "preload\n", stderr: "", exitCode: 1, signalCode: null });
  });
});

// The wait ends on what ends the run loop: nothing queued and nothing ref'd. So a top-level await gives up exactly where
// a then() on the same promise is never called, and waits wherever that then() is called.
describe.concurrent("a top-level await gives up where then() on the same promise is never called", () => {
  const child = `Bun.spawn({ cmd: [process.execPath, "-e", ""], stdio: ["ignore", "ignore", "ignore"] })`;
  test.each([
    ["a timer", "", `new Promise(resolve => setTimeout(resolve, 20))`, true],
    ["a timer that is unref'd", "", `new Promise(resolve => setTimeout(resolve, 20).unref())`, false],
    ["an immediate", "", `new Promise(resolve => setImmediate(resolve))`, true],
    ["an immediate that is unref'd", "", `new Promise(resolve => setImmediate(resolve).unref())`, false],
    [
      "an immediate that an immediate sets",
      "",
      `new Promise(resolve => setImmediate(() => setImmediate(resolve)))`,
      true,
    ],
    ["a tick", "", `new Promise(resolve => process.nextTick(resolve))`, true],
    ["a file that is read", "", `Bun.file(import.meta.path).text()`, true],
    [
      "a request to a server of the process",
      `const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });`,
      `fetch(server.url).then(response => response.text()).then(() => server.stop(true))`,
      true,
    ],
    ["a child process", `const child = ${child};`, `child.exited`, true],
    ["a child process that is unref'd", `const child = ${child};\nchild.unref();`, `child.exited`, false],
    [
      "AbortSignal.timeout()",
      "",
      `new Promise(resolve => AbortSignal.timeout(20).addEventListener("abort", resolve))`,
      false,
    ],
    [
      "Atomics.waitAsync() with a timeout",
      "",
      `Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20).value`,
      false,
    ],
    ["a listener for a signal", "", `new Promise(resolve => process.on("SIGINT", resolve))`, false],
  ])("%s", async (_, setup, promise, settles) => {
    using dir = tempDir("unsettled-tla-then", {
      "then.mjs": `${setup}\n(${promise}).then(() => console.log("settled"));\n`,
      "await.mjs": `${setup}\nawait (${promise});\nconsole.log("settled");\n`,
    });
    const [then, awaited] = await Promise.all([
      spawned([bunExe(), "then.mjs"], String(dir)),
      spawned([bunExe(), "await.mjs"], String(dir)),
    ]);
    expect({
      then: { stdout: then.stdout, exitCode: then.exitCode },
      await: { stdout: awaited.stdout, exitCode: awaited.exitCode, warns: awaited.stderr.startsWith("Warning: ") },
    }).toEqual({
      then: { stdout: settles ? "settled\n" : "", exitCode: 0 },
      await: { stdout: settles ? "settled\n" : "", exitCode: settles ? 0 : 13, warns: !settles },
    });
  });
});

// The fixtures and the expectations of Node's test/es-module/test-esm-tla-unfinished.mjs. That file itself needs
// node:test outside of a test runner, and it expects Node's name for --eval input and Node's text for an error.
describe.concurrent("the fixtures of Node's test-esm-tla-unfinished", () => {
  const fixtures = join(import.meta.dir, "..", "test", "fixtures", "es-modules", "tla");
  const received = (code: number) => `the exit listener received code: ${code}\n`;
  const inside = (code: number) => `process.exitCode inside the exist listener: ${code}\n`;
  const warns = (fixture: string) =>
    new RegExp(
      `^Warning: Detected unsettled top-level await at \\S+${RegExp.escape(fixture)}:5\n\\s*await new Promise`,
    );

  test.each([
    [["unresolved.mjs"], { stdout: received(13), exitCode: 13 }, warns("unresolved.mjs")],
    [["--no-warnings", "unresolved.mjs"], { stdout: received(13), exitCode: 13 }, /^$/],
    [["--no-warnings", "unresolved-withexitcode.mjs"], { stdout: received(42), exitCode: 42 }, /^$/],
    [["--no-warnings", "process-exit.mjs"], { stdout: "", exitCode: 0 }, /^$/],
    [
      ["unresolved-with-worker-process-exit.mjs"],
      { stdout: "", exitCode: 13 },
      warns("unresolved-with-worker-process-exit.mjs"),
    ],
    [["--no-warnings", "unresolved-with-worker-process-exit.mjs"], { stdout: "", exitCode: 13 }, /^$/],
    [["unresolved-with-listener.mjs"], { stdout: received(13) + inside(13), exitCode: 13 }, /^Warning: /],
    [
      ["--no-warnings", "unresolved-withexitcode-and-listener.mjs"],
      { stdout: received(42) + inside(42), exitCode: 42 },
      /^$/,
    ],
    [["--no-warnings", "rejected.mjs"], { stdout: "", exitCode: 1 }, /^error: Xyz$/m],
    [["--no-warnings", "rejected-withexitcode.mjs"], { stdout: "", exitCode: 1 }, /^error: Xyz$/m],
  ])("%j", async (args, expected, stderr) => {
    const result = await spawned([bunExe(), ...args], fixtures);
    expect(result.stderr).toMatch(stderr);
    expect({ stdout: result.stdout, exitCode: result.exitCode }).toEqual(expected);
  });
});

import { spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

it("process.exit(1) works", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-1.js"]);
  expect(exitCode).toBe(1);
});

it("await on a thrown value reports exit code 1", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-await-throw-1.js"]);
  expect(exitCode).toBe(1);
});

it("unhandled promise rejection reports exit code 1", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-unhandled-throw.js"]);
  expect(exitCode).toBe(1);
});

it("handled promise rejection reports exit code 0", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-handled-throw.js"]);
  expect(exitCode).toBe(1);
});

it("process.exit(0) works", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-0.js"]);
  expect(exitCode).toBe(0);
});

// Each program queues `process.exit(0)` and then fails while its entry point, a preload or a
// dependency is evaluated. The failure is reported before what was queued runs, so the error is
// printed and the exit code is 1. node v26.12.0 gives the same result, unless a case says otherwise.
describe.concurrent("a program that fails after it queued process.exit(0)", () => {
  const queue = {
    "a tick": "process.nextTick(() => process.exit(0));",
    "a promise job": "Promise.resolve().then(() => process.exit(0));",
  };
  const fails = (by: keyof typeof queue, before = "") => `${before}\n${queue[by]}\nthrow new Error("fatal");\n`;
  // Marks a source as CommonJS or as an ES module where the file extension does not.
  const commonjs = `require("node:fs");`;
  const esm = `import "node:fs";`;
  const runMainWrapper = `
    const Module = require("module");
    const runMain = Module.runMain;
    Module.runMain = function (...args) {
      return runMain.apply(this, args);
    };
  `;

  async function run(files: Record<string, string>, args: string[], stdin?: string) {
    using dir = tempDir("fails-after-queued-exit", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      cwd: String(dir),
      env: bunEnv,
      stdin: stdin === undefined ? "ignore" : Buffer.from(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, errors: stderr.split("\n").filter(line => /^(error|written): /.test(line)), exitCode };
  }
  const reported = { stdout: "", errors: ["error: fatal"], exitCode: 1 };

  const cases: [name: string, files: Record<string, string>, args: string[]][] = [];
  for (const by of ["a promise job", "a tick"] as const) {
    cases.push(
      [`a CommonJS entry point, by ${by}`, { "entry.cjs": fails(by) }, ["entry.cjs"]],
      [`an ES module entry point, by ${by}`, { "entry.mjs": fails(by) }, ["entry.mjs"]],
      [`a TypeScript entry point, by ${by}`, { "entry.ts": fails(by, esm) }, ["entry.ts"]],
      [`-e with CommonJS source, by ${by}`, {}, ["-e", fails(by, commonjs)]],
      // node --input-type=module -e runs the promise job first.
      [`-e with ES module source, by ${by}`, {}, ["-e", fails(by, esm)]],
      [
        `a CommonJS preload, by ${by}`,
        { "preload.cjs": fails(by, commonjs), "entry.cjs": "" },
        ["--preload", "./preload.cjs", "entry.cjs"],
      ],
      // node --import runs the promise job first.
      [
        `an ES module preload, by ${by}`,
        { "preload.mjs": fails(by), "entry.cjs": "" },
        ["--preload", "./preload.mjs", "entry.cjs"],
      ],
      [
        `a CommonJS entry point whose require() throws, by ${by}`,
        { "entry.cjs": `${queue[by]}\nrequire("./dependency.cjs");`, "dependency.cjs": `throw new Error("fatal");` },
        ["entry.cjs"],
      ],
      [
        `an ES module entry point whose ES module import throws, by ${by}`,
        { "entry.mjs": `import "./dependency.mjs";`, "dependency.mjs": fails(by) },
        ["entry.mjs"],
      ],
      [
        `a CommonJS entry point that a Module.runMain wrapper runs, by ${by}`,
        { "preload.cjs": runMainWrapper, "entry.cjs": fails(by) },
        ["--preload", "./preload.cjs", "entry.cjs"],
      ],
      [
        `an ES module entry point that a Module.runMain wrapper runs, by ${by}`,
        { "preload.cjs": runMainWrapper, "entry.mjs": fails(by) },
        ["--preload", "./preload.cjs", "entry.mjs"],
      ],
    );
  }
  cases.push(
    // An imported CommonJS module runs when it is fetched, inside a promise job: only its ticks wait for the report.
    [
      "an ES module entry point whose CommonJS import queues a tick and throws",
      { "entry.mjs": `import "./dependency.cjs";`, "dependency.cjs": fails("a tick", commonjs) },
      ["entry.mjs"],
    ],
    // After a top-level await the failure is a rejection: promise jobs queued before it run first, ticks do not.
    [
      "an entry point that throws after a top-level await, by a tick",
      { "entry.mjs": fails("a tick", "await 0;") },
      ["entry.mjs"],
    ],
    [
      "an entry point whose top-level await rejects, by a tick",
      { "entry.mjs": `${queue["a tick"]}\nawait Promise.reject(new Error("fatal"));` },
      ["entry.mjs"],
    ],
    [
      "an entry point that throws after a top-level await that waits for the event loop, by a tick",
      { "entry.mjs": fails("a tick", "await new Promise(resolve => setImmediate(resolve));") },
      ["entry.mjs"],
    ],
  );

  it.each(cases)("%s", async (_name, files, args) => {
    expect(await run(files, args)).toEqual(reported);
  });

  it.each([
    ["CommonJS source, by a promise job", fails("a promise job", commonjs)],
    ["ES module source, by a tick", fails("a tick", esm)],
  ])("stdin with %s", async (_name, source) => {
    expect(await run({}, ["-"], source)).toEqual(reported);
  });

  it.each(["entry.cjs", "entry.mjs"])("a listener that a queued tick adds comes too late for %s", async entry => {
    const source = `
      process.nextTick(() => process.on("uncaughtException", () => console.log("too late")));
      throw new Error("fatal");
    `;
    expect(await run({ [entry]: source }, [entry])).toEqual(reported);
  });

  it("what the entry point wrote through a sink comes before the report", async () => {
    const entry = `Bun.stderr.writer().write("written: first\\n");\nthrow new Error("fatal");`;
    expect(await run({ "entry.cjs": entry }, ["entry.cjs"])).toEqual({
      ...reported,
      errors: ["written: first", "error: fatal"],
    });
  });

  // The two steps of the load are in one turn of the event loop: no unhandled-rejection pass runs between them.
  it("an ES module entry point handles a rejection that its CommonJS import left", async () => {
    const files = {
      "entry.mjs": `import dependency from "./dependency.cjs";\nawait dependency.ready.catch(error => console.log("handled " + error.message));`,
      "dependency.cjs": `exports.ready = Promise.reject(new Error("fatal"));`,
    };
    expect(await run(files, ["entry.mjs"])).toEqual({ stdout: "handled fatal\n", errors: [], exitCode: 0 });
  });

  // node throws ERR_REQUIRE_CYCLE_MODULE for this require().
  it("what a CommonJS entry point throws after it required an ES module that imports it is reported", async () => {
    const files = {
      "entry.cjs": `exports.named = 5;\nconsole.log(require("./dependency.mjs").named);\nthrow new Error("fatal");`,
      "dependency.mjs": `export { named } from "./entry.cjs";`,
    };
    expect(await run(files, ["entry.cjs"])).toEqual({ ...reported, stdout: "5\n" });
  });

  // bun test prints what a test file throws. The exit code is still the one that the file asked for.
  it("a test file of bun test", async () => {
    const { errors, exitCode } = await run({ "a.test.js": fails("a tick") }, ["test", "./a.test.js"]);
    expect({ errors, exitCode }).toEqual({ errors: ["error: fatal"], exitCode: 0 });
  });

  // The failure of a worker's entry point is the "error" event of the Worker. One process starts
  // all of the workers. With node:worker_threads, node v26.12.0 gives the same results.
  it("in a worker", async () => {
    const workers: [name: string, file: string, source: string, expected: string][] = [
      ["a CommonJS entry point, by a promise job", "1.cjs", fails("a promise job"), "error, exit 1"],
      ["an ES module entry point, by a promise job", "2.mjs", fails("a promise job"), "error, exit 1"],
      // Node rethrows what a worker's entry point throws from a tick: a tick that it queued before runs first.
      ["a CommonJS entry point, by a tick, exits before the report", "3.cjs", fails("a tick"), "exit 0"],
      ["an ES module entry point, by a tick, exits before the report", "4.mjs", fails("a tick"), "exit 0"],
      // The worker's "exit" listeners run for the report, and the exit code they set is the worker's.
      [
        "an exit listener of a CommonJS entry point sets the exit code",
        "5.cjs",
        `process.on("exit", () => (process.exitCode = 7));\nthrow new Error("fatal");`,
        "error, exit 7",
      ],
      // What the entry point leaves behind that is not its own failure still fails the worker.
      [
        "an entry point that leaves an unhandled rejection",
        "6.cjs",
        `Promise.reject(new Error("fatal"));`,
        "error, exit 1",
      ],
    ];
    const parent = `
      for (const [name, file] of require("./workers.json")) {
        const events = [];
        const worker = new Worker("./" + file);
        worker.addEventListener("error", event => {
          event.preventDefault();
          events.push(event.message.includes("fatal") ? "error" : event.message);
        });
        worker.addEventListener("close", event => console.log(name + ": " + [...events, "exit " + event.code].join(", ")));
      }
    `;
    const files: Record<string, string> = { "parent.cjs": parent, "workers.json": JSON.stringify(workers) };
    for (const [, file, source] of workers) files[file] = source;
    const { stdout, errors, exitCode } = await run(files, ["parent.cjs"]);
    expect({ stdout: stdout.split("\n").sort(), errors, exitCode }).toEqual({
      stdout: ["", ...workers.map(([name, , , expected]) => `${name}: ${expected}`)].sort(),
      errors: [],
      exitCode: 0,
    });
  });

  // An imported CommonJS module runs inside a promise job of the loader, so a promise job that it queued runs first.
  it.todo("an ES module entry point whose CommonJS import queues a promise job and throws", async () => {
    const files = { "entry.mjs": `import "./dependency.cjs";`, "dependency.cjs": fails("a promise job", commonjs) };
    expect(await run(files, ["entry.mjs"])).toEqual(reported);
  });
});

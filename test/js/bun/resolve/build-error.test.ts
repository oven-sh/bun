import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

test("BuildError is modifiable", async () => {
  try {
    await import("../util/inspect-error-fixture-bad.js");
    expect.unreachable();
  } catch (e) {
    var error: BuildMessage = e as BuildMessage;
    if (error.name !== "BuildMessage") {
      throw new Error("Expected BuildMessage, got " + error.name);
    }
  }

  const message = error!.message;
  // @ts-ignore
  expect(() => (error!.message = "new message")).not.toThrow();
  expect(error!.message).toBe("new message");
  expect(error!.message).not.toBe(message);
});

test("import with many build errors keeps AggregateError entries alive across GC", async () => {
  // process_fetch_log accumulated the BuildMessage wrappers in a heap Vec
  // while creating the next ones; the conservative GC stack scan never saw
  // them, so a collection triggered mid-loop swept the earlier cells and
  // freed their native BuildMessage (use-after-free found by fuzzing).
  // 257 duplicate declarations produce 256 log messages, maximizing the
  // number of allocations between the first wrapper and the AggregateError.
  const dupes = Array.from({ length: 257 }, (_, i) => `const dup = ${i};`).join("\n");
  using dir = tempDir("build-error-gc", {
    "bad.js": dupes,
    "main.js": `
      const jobs = [];
      for (let i = 0; i < 16; i++) {
        jobs.push(
          import("./bad.js?v=" + i).then(
            () => {
              throw new Error("expected rejection");
            },
            e => {
              let n = 0;
              for (const err of e.errors ?? []) {
                if (typeof err.message === "string") n++;
              }
              return n;
            },
          ),
        );
      }
      const counts = await Promise.all(jobs);
      console.log(JSON.stringify(counts));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: { ...bunEnv, BUN_JSC_slowPathAllocsBetweenGCs: "100" },
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // stderr carries the crash report when the child dies; surface it in the
  // failure diff but don't assert on it (debug builds emit benign noise).
  if (exitCode !== 0) console.error(stderr);
  expect(stdout.trim()).toBe(JSON.stringify(Array.from({ length: 16 }, () => 256)));
  expect(exitCode).toBe(0);
});

test("BuildMessage finalize frees with the same allocator it was created with", async () => {
  // BuildMessage.create() clones the message with the passed allocator
  // but finalize() was freeing it with bun.default_allocator and never
  // destroying the struct itself.
  using dir = tempDir("build-message-finalize", { "bad.js": "function bad( {" });
  const entry = join(String(dir), "bad.js");
  for (let i = 0; i < 20; i++) {
    const r = await Bun.build({ entrypoints: [entry], throw: false });
    expect(r.success).toBe(false);
    expect(r.logs.length).toBeGreaterThan(0);
    for (const e of r.logs) {
      void e.message;
      void e.level;
      void e.position;
      void e.notes;
      void String(e);
    }
    Bun.gc(true);
  }
});

// The module loader keeps the registry entry of a module whose build failed and
// settles every later load of it from that entry. It used to hand out a copy of
// the stored error that had only the error's type and message, so the second
// import() (or a require(), or another module importing it) got an
// AggregateError without `errors`; with two test files importing the same
// broken module, `bun test` crashed printing that copy on the second file
// (#36963). Later loads now reject with the error the build produced.
describe.concurrent("a module that failed to build reports its errors to every later load", () => {
  // Three declarations of the same const produce exactly two build errors.
  const twoBuildErrors = `const dup = 1; const dup = 2; const dup = 3;\n`;
  // The stripped copy has the same name and message; `errors` tells them apart.
  const shape = /* js */ `
    const shape = e => ({
      name: e.constructor.name,
      message: e.message,
      errors: e.errors ? e.errors.map(error => error.name) : null,
    });
  `;
  const aggregateOfTwo = {
    name: "AggregateError",
    message: expect.stringMatching(/^2 errors building "/),
    errors: ["BuildMessage", "BuildMessage"],
  };

  async function runEntry(files: Record<string, string>) {
    using dir = tempDir("failed-build-reload", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  test("a second import() and a require()", async () => {
    const result = await runEntry({
      "bad.js": twoBuildErrors,
      "entry.js": /* js */ `
        ${shape}
        const out = {};
        out.firstImport = await import("./bad.js").then(() => "loaded", shape);
        out.secondImport = await import("./bad.js").then(() => "loaded", shape);
        try {
          require("./bad.js");
          out.require = "loaded";
        } catch (e) {
          out.require = shape(e);
        }
        console.log(JSON.stringify(out));
      `,
    });
    expect(result).toEqual({ firstImport: aggregateOfTwo, secondImport: aggregateOfTwo, require: aggregateOfTwo });
  });

  test("every module that imports it", async () => {
    const result = await runEntry({
      "bad.js": twoBuildErrors,
      "a.js": `import "./bad.js";`,
      "b.js": `import "./bad.js";`,
      "entry.js": /* js */ `
        ${shape}
        const out = {};
        out.a = await import("./a.js").then(() => "loaded", shape);
        out.b = await import("./b.js").then(() => "loaded", shape);
        console.log(JSON.stringify(out));
      `,
    });
    expect(result).toEqual({ a: aggregateOfTwo, b: aggregateOfTwo });
  });

  // The second file used to crash the run. Its report is empty because a
  // BuildMessage is only ever printed once per process (the same as for a
  // module with a single build error); it still fails the file and the run.
  test("every test file that imports it under bun test", async () => {
    using dir = tempDir("failed-build-bun-test", {
      "bad.js": twoBuildErrors,
      "a.test.js": `import "./bad.js";`,
      "b.test.js": `import "./bad.js";`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./a.test.js", "./b.test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const output = stdout + stderr;
    expect(output).toContain('error: "dup" has already been declared');
    expect(output).toContain("\nb.test.js:\n");
    expect(output).toContain("Ran 2 tests across 2 files.");
    expect(exitCode).toBe(1);
  });

  test("a second import() while the same file is also loaded with another import type", async () => {
    const result = await runEntry({
      "bad.js": twoBuildErrors,
      "entry.js": /* js */ `
        ${shape}
        const out = {};
        out.firstImport = await import("./bad.js").then(() => "loaded", shape);
        const firstText = await import("./bad.js", { with: { type: "text" } });
        out.secondImport = await import("./bad.js").then(() => "loaded", shape);
        const secondText = await import("./bad.js", { with: { type: "text" } });
        out.textIsSameModule = firstText === secondText;
        out.text = firstText.default;
        console.log(JSON.stringify(out));
      `,
    });
    expect(result).toEqual({
      firstImport: aggregateOfTwo,
      secondImport: aggregateOfTwo,
      textIsSameModule: true,
      text: twoBuildErrors,
    });
  });

  // The same replay applies to whatever a plugin rejected the load with.
  test("a second import() of a plugin module keeps the properties of the error the plugin threw", async () => {
    const result = await runEntry({
      "entry.js": /* js */ `
        Bun.plugin({
          name: "failing module",
          setup(build) {
            build.module("virtual:failing", async () => {
              const error = new Error("plugin failed");
              error.code = "E_PLUGIN";
              throw error;
            });
          },
        });
        const shape = e => ({ message: e.message, code: e.code ?? null });
        const out = {};
        out.first = await import("virtual:failing").then(() => "loaded", shape);
        out.second = await import("virtual:failing").then(() => "loaded", shape);
        console.log(JSON.stringify(out));
      `,
    });
    const pluginError = { message: "plugin failed", code: "E_PLUGIN" };
    expect(result).toEqual({ first: pluginError, second: pluginError });
  });

  // A module that threw while evaluating is replayed the same way, and always was.
  test("a module that threw while evaluating rejects every later import() with that error", async () => {
    const result = await runEntry({
      "throws.js": `globalThis.evaluations = (globalThis.evaluations ?? 0) + 1;\nthrow new Error("evaluation failed");`,
      "entry.js": /* js */ `
        const errors = [];
        for (let i = 0; i < 2; i++) errors.push(await import("./throws.js").then(() => "loaded", e => e));
        console.log(JSON.stringify({
          messages: errors.map(e => e.message),
          sameError: errors[0] === errors[1],
          evaluations: globalThis.evaluations,
        }));
      `,
    });
    expect(result).toEqual({ messages: ["evaluation failed", "evaluation failed"], sameError: true, evaluations: 1 });
  });
});

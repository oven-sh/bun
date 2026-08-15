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

// A module whose build failed has no module record, but the module loader kept
// its registry entry and settled every later load of it with a copy of the
// stored error that only had the error's type and message: the second import()
// (or require(), or another module importing it) got an AggregateError without
// `errors`, which is also what made `bun test` crash on the second test file
// importing a broken module (#36963). The entry is now dropped before the next
// load, so the module is built again and, as in Node, every importer gets the
// complete error of its own attempt, or the module once the file is fixed.
describe.concurrent("loading a module again after it failed to build", () => {
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
    using dir = tempDir("reload-failed-build", files);
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

  test("import() and require() report the build errors on every load", async () => {
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

  test("every module importing it reports the build errors", async () => {
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

  test("bun test prints the build errors for every test file importing it", async () => {
    using dir = tempDir("reload-failed-build-test", {
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
    expect(output.split('error: "dup" has already been declared')).toHaveLength(1 + 2 * 2);
    expect(output).toContain("Ran 2 tests across 2 files.");
    expect(exitCode).toBe(1);
  });

  test("the module is loaded once the file is fixed", async () => {
    const result = await runEntry({
      "via-import.js": twoBuildErrors,
      "via-require.js": twoBuildErrors,
      "via-extension.js": twoBuildErrors,
      "entry.js": /* js */ `
        ${shape}
        import { writeFileSync } from "node:fs";
        import Module from "node:module";
        const fix = name => writeFileSync(import.meta.dir + "/" + name, "export const loadedBy = " + JSON.stringify(name) + ";");
        const attempt = async load => {
          try {
            return (await load()).loadedBy;
          } catch (e) {
            return shape(e);
          }
        };
        const out = {};

        out.importBefore = await attempt(() => import("./via-import.js"));
        fix("via-import.js");
        out.importAfter = await attempt(() => import("./via-import.js"));

        out.requireBefore = await attempt(() => import("./via-require.js"));
        fix("via-require.js");
        out.requireAfter = await attempt(() => require("./via-require.js"));

        out.extensionBefore = await attempt(() => import("./via-extension.js"));
        fix("via-extension.js");
        out.extensionAfter = await attempt(() => {
          const filename = require.resolve("./via-extension.js");
          const mod = new Module(filename);
          mod.filename = filename;
          require.extensions[".js"](mod, filename);
          return mod.exports;
        });

        console.log(JSON.stringify(out));
      `,
    });
    expect(result).toEqual({
      importBefore: aggregateOfTwo,
      importAfter: "via-import.js",
      requireBefore: aggregateOfTwo,
      requireAfter: "via-require.js",
      extensionBefore: aggregateOfTwo,
      extensionAfter: "via-extension.js",
    });
  });

  test("a failed build does not unload the same file imported with another type", async () => {
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

  test("a plugin module that failed to load is loaded again with its own error", async () => {
    const result = await runEntry({
      "entry.js": /* js */ `
        let attempts = 0;
        let thrown;
        Bun.plugin({
          name: "failing module",
          setup(build) {
            build.module("virtual:failing", async () => {
              attempts++;
              thrown = new Error("attempt " + attempts);
              thrown.code = "E_ATTEMPT_" + attempts;
              throw thrown;
            });
          },
        });
        const shape = e => ({ message: e.message, code: e.code ?? null, isThrownObject: e === thrown });
        const out = {};
        out.first = await import("virtual:failing").then(() => "loaded", shape);
        out.second = await import("virtual:failing").then(() => "loaded", shape);
        out.attempts = attempts;
        console.log(JSON.stringify(out));
      `,
    });
    expect(result).toEqual({
      first: { message: "attempt 1", code: "E_ATTEMPT_1", isThrownObject: true },
      second: { message: "attempt 2", code: "E_ATTEMPT_2", isThrownObject: true },
      attempts: 2,
    });
  });

  // Only a failed build is retried. A module that threw while evaluating is
  // cached along with its error, as the spec requires.
  test("a module that threw while evaluating is not evaluated again", async () => {
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

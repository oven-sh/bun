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

// "Cannot use import statement with CommonJS-only features" is logged after
// the parser has already produced an AST. The async transpile path behind
// `import` and `import()` used to skip the log check that `require()` does, so
// JSC got the `import` inside the CommonJS wrapper and threw its own
// SyntaxError instead.
const mixedModuleFiles = {
  "dep.js": `export const x = 42;`,
  "mixed.js": `import { x } from "./dep.js";\nmodule.exports = { x };`,
};

test.concurrent(
  "import() of a file that mixes import with module.exports rejects with the parser's error",
  async () => {
    using dir = tempDir("build-error-mixed-import", {
      ...mixedModuleFiles,
      "main.js": `
      const out = {};
      try {
        await import("./mixed.js");
      } catch (e) {
        out.import = [e.name, e.message];
      }
      try {
        require("./mixed.js");
      } catch (e) {
        out.require = [e.name, e.message];
      }
      console.log(JSON.stringify(out));
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    if (exitCode !== 0) console.error(stderr);
    const expected = ["BuildMessage", "Cannot use import statement with CommonJS-only features"];
    expect(JSON.parse(stdout)).toEqual({ import: expected, require: expected });
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "unhandled import() of a file that mixes import with module.exports prints the parser's notes",
  async () => {
    using dir = tempDir("build-error-mixed-uncaught", {
      ...mixedModuleFiles,
      "main.js": `import("./mixed.js");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toContain("error: Cannot use import statement with CommonJS-only features");
    expect(stderr).toContain(`note: Try require("./dep.js") instead`);
    expect(stderr).toContain("note: This file is CommonJS because 'module' was used");
    expect(exitCode).toBe(1);
  },
);

test("import whose transpile log holds a resolve error rejects with a ResolveMessage next to the BuildMessage", async () => {
  // A macro import that cannot be resolved is logged by the resolver while the
  // file is being transpiled, so process_fetch_log sees one Resolve-metadata
  // message and one Build-metadata message and has to wrap each in the
  // matching JS class.
  using dir = tempDir("build-error-resolve-message", {
    "needs-macro.ts": `
      import { nope } from "./does-not-exist" with { type: "macro" };
      export const value = nope();
    `,
  });

  let error: any;
  try {
    await import(join(String(dir), "needs-macro.ts"));
    expect.unreachable();
  } catch (e) {
    error = e;
  }

  expect(error).toBeInstanceOf(AggregateError);
  expect(error.message).toMatch(/^2 errors building ".*needs-macro\.ts"$/);
  expect(
    error.errors.map((e: any) => ({
      name: e.name,
      message: e.message,
      ...(e.name === "ResolveMessage" ? { specifier: e.specifier, importKind: e.importKind } : {}),
    })),
  ).toEqual([
    {
      name: "ResolveMessage",
      message: 'Macro "./does-not-exist" not found',
      specifier: "./does-not-exist",
      importKind: "import-statement",
    },
    {
      name: "BuildMessage",
      message: '"MacroNotFound" error in macro',
    },
  ]);
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

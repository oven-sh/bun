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

// TypeScript drops an import whose bindings are only used as types. Such a file
// is plain CommonJS after transpilation, so the `import` must not be reported
// as a conflict with `module.exports`.
test.concurrent("a type-only import next to module.exports loads on every path", async () => {
  using dir = tempDir("build-error-type-only-import", {
    "types.ts": `export interface Foo { x: number }`,
    "mixed.ts": `import { Foo } from "./types";\nconst f: Foo = { x: 1 };\nmodule.exports = { f };`,
    "main.ts": `
      const viaImport = (await import("./mixed.ts")).default;
      const viaRequire = require("./mixed.ts");
      console.log(JSON.stringify({ import: viaImport, require: viaRequire }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  await using direct = Bun.spawn({
    cmd: [bunExe(), "mixed.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode, directStdout, directStderr, directExitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
    direct.stdout.text(),
    direct.stderr.text(),
    direct.exited,
  ]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({ import: { f: { x: 1 } }, require: { f: { x: 1 } } });
  expect(directStdout).toBe("");
  expect(directStderr).toBe("");
  expect(exitCode).toBe(0);
  expect(directExitCode).toBe(0);
});

// The parser adds the JSX runtime import itself. It must not be reported as
// an import statement the user should replace with require().
test.concurrent("JSX next to module.exports is not blamed on a runtime import", async () => {
  using dir = tempDir("build-error-jsx-cjs", {
    "mixed.tsx": `const el = <div />;\nmodule.exports = { el };`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "mixed.tsx"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The file still fails to load: the generated import is printed inside the
  // CommonJS wrapper, and JSC rejects that. The error must not name it.
  expect(stdout).toBe("");
  expect(stderr).not.toContain("Cannot use import statement with CommonJS-only features");
  expect(stderr).not.toContain("Try require(");
  expect(exitCode).toBe(1);
});

// The lexer reads the first token while the parser is constructed. An error it
// logs there still has to fail the parse, on both load paths, also when the
// `// @bun` pragma makes the parser hand the file over without parsing it.
test.concurrent("a lexer error on the first token rejects import() and require()", async () => {
  using dir = tempDir("build-error-first-token", {
    // `\u0030foo` spells the identifier `0foo`.
    "bad.js": `\\u0030foo = 1;\nconsole.log("loaded");`,
    "prebundled.js": `// @bun\n\\u0030foo = 1;\nconsole.log("loaded");`,
    "main.js": `
      const out = {};
      for (const file of ["./bad.js", "./prebundled.js"]) {
        try {
          await import(file);
        } catch (e) {
          out["import " + file] = [e.name, e.message];
        }
        try {
          require(file);
        } catch (e) {
          out["require " + file] = [e.name, e.message];
        }
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

  expect(stderr).toBe("");
  const expected = ["BuildMessage", 'Invalid identifier: "0foo"'];
  expect(JSON.parse(stdout)).toEqual({
    "import ./bad.js": expected,
    "require ./bad.js": expected,
    "import ./prebundled.js": expected,
    "require ./prebundled.js": expected,
  });
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

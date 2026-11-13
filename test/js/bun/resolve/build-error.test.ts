import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { join } from "node:path";

test("BuildError is modifiable", async () => {
  try {
    await import("../util/inspect-error-fixture-bad.js" as string);
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
      void (e as any).notes;
      void String(e);
    }
    Bun.gc(true);
  }
});

// A virtual source's path is a view of the UTF-8 copy of the specifier that the
// native fetch makes when the specifier is not 8-bit ASCII, and frees when it
// returns. The location of a YAML or JSON5 error used to point into that copy.
test.concurrent("a BuildMessage's position.file outlives the fetch that made it", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      Bun.plugin({
        name: "virtual-yaml",
        setup(build) {
          build.onResolve({ filter: /^virtual:/ }, ({ path }) => ({ path, namespace: "virtual" }));
          build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: "[", loader: "yaml" }));
        },
      });

      // The same characters in a flat 16-bit string.
      function wide(string) {
        const prefixed = "\\u0100" + string;
        void prefixed.charCodeAt(0);
        return prefixed.slice(1);
      }

      async function check(label, specifier, load) {
        let error;
        try {
          await load(specifier);
        } catch (e) {
          error = e;
        }
        const files = [error?.position.file, error?.toJSON().position.file];
        console.log(label, error?.name, JSON.stringify(files.map(file => (file === specifier ? "the specifier" : file))));
      }

      const url = URL.createObjectURL(new File(["["], "bad.yaml"));
      await check("blob", wide(url), s => import(s));
      // Joined at run time: as one literal it would be an 8-bit atom, which then is the module's key.
      await check("node fallback", wide(["/bun-vfs$$/node_", "modules/events/.json5"].join("")), s => import(s));
      await check("node fallback import", "/bun-vfs$$/node_modules/events/\\u00e9.json5", s => import(s));
      await check("node fallback require", "/bun-vfs$$/node_modules/events/\\u00e8.json5", s => require(s));
      await check("plugin", "virtual:\\u00e9.yaml", s => import(s));
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) console.error(stderr);
  expect(stdout.trim().split("\n")).toEqual(
    ["blob", "node fallback", "node fallback import", "node fallback require", "plugin"].map(
      label => `${label} BuildMessage ["the specifier","the specifier"]`,
    ),
  );
  expect(exitCode).toBe(0);
});

// The module loader settles every later importer of a module that failed to
// load with the error object the first load produced, so the same BuildMessage or
// ResolveMessage is reported once per failure it causes. The error printer
// used to print such an object only the first time it saw it, so every report
// after the first (another test file importing the module, another test in
// the same file, the error being reported again by the program) was empty.
describe.concurrent("an error from a module that failed to load is printed every time it is reported", () => {
  async function run(files: Record<string, string>, ...args: string[]) {
    using dir = tempDir("replayed-load-error", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      stdout: normalizeBunSnapshot(stdout, String(dir)),
      stderr: normalizeBunSnapshot(stderr, String(dir)),
      exitCode,
    };
  }

  test("a build error, by each test file that imports the module", async () => {
    const { stderr, exitCode } = await run(
      {
        "bad.js": "function bad( {",
        "a.test.js": `import "./bad.js";`,
        "b.test.js": `import "./bad.js";`,
      },
      "test",
      "./a.test.js",
      "./b.test.js",
    );
    expect(stderr).toMatchInlineSnapshot(`
      "a.test.js:

      # Unhandled error between tests
      -------------------------------
      1 | function bad( {
                        ^
      error: Expected identifier but found end of file
          at <dir>/bad.js:1:15
      -------------------------------


      b.test.js:

      # Unhandled error between tests
      -------------------------------
      1 | function bad( {
                        ^
      error: Expected identifier but found end of file
          at <dir>/bad.js:1:15
      -------------------------------


       0 pass
       2 fail
       2 errors
      Ran 2 tests across 2 files."
    `);
    expect(exitCode).toBe(1);
  });

  test("a resolve error, by each test file that imports the module", async () => {
    const { stderr, exitCode } = await run(
      {
        "lib.js": `import "./missing.js";`,
        "a.test.js": `import "./lib.js";`,
        "b.test.js": `import "./lib.js";`,
      },
      "test",
      "./a.test.js",
      "./b.test.js",
    );
    expect(stderr).toMatchInlineSnapshot(`
      "a.test.js:

      # Unhandled error between tests
      -------------------------------
      error: Cannot find module './missing.js' from '<dir>/lib.js'
      -------------------------------


      b.test.js:

      # Unhandled error between tests
      -------------------------------
      error: Cannot find module './missing.js' from '<dir>/lib.js'
      -------------------------------


       0 pass
       2 fail
       2 errors
      Ran 2 tests across 2 files."
    `);
    expect(exitCode).toBe(1);
  });

  test("a build error, by each test that imports the module", async () => {
    const { stderr, exitCode } = await run(
      {
        "bad.js": "function bad( {",
        "c.test.js": /* js */ `
          import { test } from "bun:test";
          test("first", () => import("./bad.js"));
          test("second", () => import("./bad.js"));
        `,
      },
      "test",
      "./c.test.js",
    );
    expect(stderr).toMatchInlineSnapshot(`
      "c.test.js:
      1 | function bad( {
                        ^
      error: Expected identifier but found end of file
          at <dir>/bad.js:1:15
      (fail) first
      1 | function bad( {
                        ^
      error: Expected identifier but found end of file
          at <dir>/bad.js:1:15
      (fail) second

       0 pass
       2 fail
      Ran 2 tests across 1 file."
    `);
    expect(exitCode).toBe(1);
  });

  test("a build error reported twice by the program", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "bad.js": "function bad( {",
        "entry.js": /* js */ `
          for (let i = 1; i <= 2; i++) {
            const error = await import("./bad.js").then(() => null, e => e);
            console.log("report " + i + ": " + error.constructor.name);
            reportError(error);
          }
        `,
      },
      "entry.js",
    );
    expect(stdout).toMatchInlineSnapshot(`
      "report 1: BuildMessage
      report 2: BuildMessage"
    `);
    expect(stderr).toMatchInlineSnapshot(`
      "1 | function bad( {
                        ^
      error: Expected identifier but found end of file
          at <dir>/bad.js:1:15
      1 | function bad( {
                        ^
      error: Expected identifier but found end of file
          at <dir>/bad.js:1:15

      Bun v<bun-version>"
    `);
    expect(exitCode).toBe(1);
  });

  // Two or more build errors reject the load with one AggregateError holding a
  // BuildMessage per error, and printing it prints those members.
  test("the build errors of an AggregateError printed twice", async () => {
    const { stdout, exitCode } = await run(
      {
        "bad.js": "const dup = 1; const dup = 2; const dup = 3;",
        "entry.js": /* js */ `
          const error = await import("./bad.js").then(() => null, e => e);
          console.log(error.constructor.name);
          console.log(error);
          console.log(error.constructor.name);
          console.log(error);
        `,
      },
      "entry.js",
    );
    const errorLocations = (report: string) =>
      Array.from(report.matchAll(/^error: "dup" has already been declared\n\s+at (\S+)$/gm), match => match[1]);
    const [, firstReport, secondReport] = stdout.split(/^AggregateError$/m);
    expect([firstReport, secondReport].map(errorLocations)).toEqual([
      ["<dir>/bad.js:1:22", "<dir>/bad.js:1:37"],
      ["<dir>/bad.js:1:22", "<dir>/bad.js:1:37"],
    ]);
    expect(exitCode).toBe(0);
  });
});

import { bunEnv, bunExe, tempDir } from "harness";
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

// Under `bun test`, `assert` and `should` of "vitest" come from the project's
// chai. An `import` that names them is an import like any other: TypeScript
// drops it when the file uses none of its names at run time, and one that stays
// next to `module.exports` is reported at the line the user wrote, with the
// module that a require() gets the names from.
test.concurrent(
  "chai names of vitest next to module.exports: an unused import loads, a used one says what to require()",
  async () => {
    const checked = `{ check() { return "checked"; } }`;
    const asserts = `{ check(value) { assert.ok(value); } }`;
    // Each file loads, and its `check()` returns "checked".
    const loads: Record<string, string> = {
      "unused.ts": `import { assert } from "vitest";\nmodule.exports = ${checked};`,
      "unused.tsx": `import { assert } from "vitest";\nmodule.exports = ${checked};`,
      "unused.cts": `import { assert } from "vitest";\nmodule.exports = ${checked};`,
      "should.ts": `import { should } from "vitest";\nmodule.exports = ${checked};`,
      "renamed.ts": `import { assert as a, should as s } from "vitest";\nmodule.exports = ${checked};`,
      "type-only.ts": `import { assert } from "vitest";\ntype Assert = typeof assert;\nmodule.exports = { check(_?: Assert) { return "checked"; } };`,
      "type-sibling.ts": `import { assert, type TestContext } from "vitest";\nmodule.exports = { check(_?: TestContext) { return "checked"; } };`,
      "other-name.ts": `import { assert, vi } from "vitest";\nmodule.exports = ${checked};`,
      "default-name.ts": `import vitest, { assert } from "vitest";\nmodule.exports = ${checked};`,
      "two-statements.ts": `import { assert } from "vitest";\nimport { vi } from "vitest";\nmodule.exports = ${checked};`,
      "exports.ts": `import { assert } from "vitest";\nexports.check = () => "checked";`,
      "export-equals.ts": `import { assert } from "vitest";\nexport = ${checked};`,
      // What the note of the rejected files advises.
      "requires-chai.ts": `const { assert } = require("chai");\nmodule.exports = { check() { assert.ok(true); return "checked"; } };`,
    };
    const chai = `Try require("chai") instead`;
    const vitest = `Try require("vitest") instead`;
    const both = `Try require("vitest") instead, and require("chai") for "assert" and "should"`;
    // The import on `line` is reported, with `note`.
    const rejects: Record<string, [source: string, note: string, line?: number]> = {
      "used.ts": [`import { assert } from "vitest";\nmodule.exports = ${asserts};`, chai],
      // JavaScript keeps an import that the file doesn't use.
      "unused.js": [`import { assert } from "vitest";\nmodule.exports = ${checked};`, chai],
      "both-used.ts": [
        `import { assert, vi } from "vitest";\nmodule.exports = { check(value) { assert.ok(value); return vi; } };`,
        both,
      ],
      "both-used.js": [
        `import { assert, vi } from "vitest";\nmodule.exports = { check(value) { assert.ok(value); return vi; } };`,
        both,
      ],
      "default-name-used.ts": [
        `import vitest, { assert } from "vitest";\nmodule.exports = { check(value) { assert.ok(value); return vitest; } };`,
        both,
      ],
      "default-name-used.js": [
        `import vitest, { assert } from "vitest";\nmodule.exports = { check(value) { assert.ok(value); return vitest; } };`,
        both,
      ],
      // TypeScript drops the names that the file doesn't use, and the import of the others stays.
      "other-name-unused.ts": [`import { assert, vi } from "vitest";\nmodule.exports = ${asserts};`, chai],
      "default-name-unused.ts": [`import vitest, { assert } from "vitest";\nmodule.exports = ${asserts};`, chai],
      "default-name-only.ts": [
        `import vitest, { assert } from "vitest";\nmodule.exports = { check() { return vitest; } };`,
        vitest,
      ],
      // Of the imports that stay, the first one in the source is reported.
      "before-another.ts": [
        `import { assert } from "vitest";\nimport { sep } from "node:path";\nmodule.exports = { check(value) { assert.ok(value); return sep; } };`,
        chai,
      ],
      "after-unused.ts": [
        `import { assert } from "vitest";\nimport { sep } from "node:path";\nimport { should } from "vitest";\nmodule.exports = { check() { return should(); } };`,
        chai,
        3,
      ],
      // An import of "vitest" without a chai name is reported as before.
      "no-names.ts": [`import "vitest";\nmodule.exports = ${checked};`, vitest],
      "empty-clause.ts": [`import {} from "vitest";\nmodule.exports = ${checked};`, vitest],
      "vi-used.ts": [`import { vi } from "vitest";\nmodule.exports = { check() { return vi; } };`, vitest],
    };
    const expected = {
      ...Object.fromEntries(Object.keys(loads).map(file => [file, "checked"])),
      ...Object.fromEntries(
        Object.entries(rejects).map(([file, [source, note, line = 1]]) => [
          file,
          [
            "BuildMessage",
            "Cannot use import statement with CommonJS-only features",
            [note, "This file is CommonJS because 'module' was used"],
            line,
            source.split("\n")[line - 1],
          ],
        ]),
      ),
    };

    using dir = tempDir("build-error-chai-names", {
      "node_modules/chai/package.json": `{ "name": "chai", "version": "0.0.0", "main": "index.js" }`,
      "node_modules/chai/index.js": `exports.assert = { ok(value) { if (!value) throw new Error("not ok"); } };\nexports.should = () => {};`,
      ...loads,
      ...Object.fromEntries(Object.entries(rejects).map(([file, [source]]) => [file, source])),
      "rows.test.js": `
        const files = ${JSON.stringify(Object.keys(expected))};
        test("rows", async () => {
          const results = {};
          for (const file of files) {
            try {
              const loaded = process.env.LOAD_WITH === "import" ? (await import("./" + file)).default : require("./" + file);
              results[file] = loaded.check();
            } catch (error) {
              results[file] = [error.name, error.message, error.notes?.map(note => note.message), error.position?.line, error.position?.lineText];
            }
          }
          console.log(JSON.stringify(results));
        });
      `,
      "mocked.js": `exports.value = "real";`,
      // A hoisted mock moves the import of "vitest" ahead of the other statements of the file.
      "entry-mock.test.ts": `import { assert } from "vitest";\nvi.mock("./mocked.js", () => ({ value: "mocked" }));\ntest("the entry file with a mock runs", () => console.log(require("./mocked.js").value));\nmodule.exports = {};`,
      "entry-unused.test.ts": `import { assert } from "vitest";\ntest("the entry file runs", () => console.log("ran"));\nmodule.exports = {};`,
      "entry-used.test.ts": `import { assert } from "vitest";\ntest("is never registered", () => assert.ok(true));\nmodule.exports = {};`,
    });

    const run = async (files: string[], env: Record<string, string> = {}) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", ...files],
        env: { ...bunEnv, ...env },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const [byRequire, byImport, asEntry] = await Promise.all([
      run(["./rows.test.js"], { LOAD_WITH: "require" }),
      run(["./rows.test.js"], { LOAD_WITH: "import" }),
      run(["./entry-mock.test.ts", "./entry-unused.test.ts", "./entry-used.test.ts"]),
    ]);

    const rowsOf = ({ stdout }: { stdout: string }) => JSON.parse(stdout.slice(stdout.indexOf("{")));
    expect({ require: rowsOf(byRequire), import: rowsOf(byImport) }).toEqual({ require: expected, import: expected });
    expect([byRequire.exitCode, byImport.exitCode]).toEqual([0, 0]);

    expect({
      stdout: asEntry.stdout.split("\n").filter(line => line && !line.startsWith("bun test ")),
      stderr: asEntry.stderr.split("\n").filter(line => /^(error|note): |^ \d+ (pass|fail)$/.test(line)),
      exitCode: asEntry.exitCode,
    }).toEqual({
      stdout: ["mocked", "ran"],
      stderr: [
        "error: Cannot use import statement with CommonJS-only features",
        `note: Try require("chai") instead`,
        "note: This file is CommonJS because 'module' was used",
        " 2 pass",
        " 1 fail",
      ],
      exitCode: 1,
    });
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

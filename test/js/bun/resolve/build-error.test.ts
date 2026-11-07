import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

test("the error of a file that does not parse is modifiable", async () => {
  let error: any;
  try {
    await import("../util/inspect-error-fixture-bad.js" as string);
    expect.unreachable();
  } catch (e) {
    error = e;
  }
  expect(error.name).toBe("SyntaxError");

  const message = error.message;
  expect(() => (error.message = "new message")).not.toThrow();
  expect(error.message).toBe("new message");
  expect(error.message).not.toBe(message);

  // Each reads as a writable data property that holds the value of the first error's BuildMessage.
  for (const key of ["position", "notes", "level"]) {
    const descriptor = Object.getOwnPropertyDescriptor(error, key)!;
    expect(descriptor).toEqual({ value: error[key], writable: true, enumerable: false, configurable: true });
    error[key] = "replaced";
    expect(error[key]).toBe("replaced");
  }
});

// `toBe` prints the received value as the console does, `toEqual` as a snapshot does.
test("a failed matcher prints the error of a file that does not parse with its code frame", async () => {
  const error = await import("../util/inspect-error-fixture-bad.js" as string).then(
    () => "loaded",
    e => e,
  );
  expect(error.name).toBe("SyntaxError");
  for (const check of [() => expect(error).toBe(1), () => expect(error).toEqual(1)]) {
    let failure = "the matcher passed";
    try {
      check();
    } catch (e) {
      failure = Bun.stripANSI((e as Error).message).replaceAll("\\", "/");
    }
    expect(failure).toContain("2 | const duplicateConstDecl = 456;");
    expect(failure).toContain('error: "duplicateConstDecl" has already been declared');
    expect(failure).toContain("/inspect-error-fixture-bad.js:2:7");
  }
});

test("a BuildMessage is modifiable and has a JSON form", () => {
  let error: any;
  try {
    new Bun.Transpiler().transformSync("const x;");
    expect.unreachable();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(BuildMessage);
  expect(error.toJSON()).toEqual({
    name: "BuildMessage",
    position: {
      lineText: "const x;",
      file: "input.jsx",
      namespace: "file",
      line: 1,
      column: 7,
      length: 1,
      offset: 6,
    },
    message: 'The constant "x" must be initialized',
    level: "error",
  });

  expect(() => (error.message = "new message")).not.toThrow();
  expect(error.message).toBe("new message");
});

// process_fetch_log accumulated the BuildMessage wrappers in a heap Vec while
// creating the next ones; the conservative GC stack scan never saw them, so a
// collection triggered mid-loop swept the earlier cells and freed their native
// BuildMessage (use-after-free found by fuzzing). Each input gives more log
// messages than the 256 that reach JS, maximizing the number of allocations
// between the first wrapper and the error that keeps them.
test.each([
  {
    keeper: "the SyntaxError of a file that does not parse",
    // 301 duplicate declarations produce 300 log messages.
    bad: Array.from({ length: 301 }, (_, i) => `const dup = ${i};`).join("\n"),
    // The printer reads every wrapper.
    count: `e => Bun.inspect(e).split('error: "dup" has already been declared').length - 1`,
  },
  {
    keeper: "the AggregateError of a file whose first error is a resolve error",
    // Each call of the macro that is not found produces two log messages.
    bad:
      `import { nope } from "./does-not-exist" with { type: "macro" };\n` +
      Array.from({ length: 200 }, (_, i) => `nope(${i});`).join("\n"),
    count: `e => e.errors.filter(error => typeof error.message === "string").length`,
  },
])("import with many build errors keeps every diagnostic alive across GC: $keeper", async ({ bad, count }) => {
  using dir = tempDir("build-error-gc", {
    "bad.js": bad,
    "main.js": `
      const jobs = [];
      for (let i = 0; i < 16; i++) {
        jobs.push(
          import("./bad.js?v=" + i).then(() => {
            throw new Error("expected rejection");
          }, ${count}),
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
    const expected = ["SyntaxError", "Cannot use import statement with CommonJS-only features"];
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
  const expected = ["SyntaxError", 'Invalid identifier: "0foo"'];
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
test.concurrent("the position.file of a parse error outlives the fetch that made it", async () => {
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
        const files = [error?.position.file, error?.notes.length, error?.sourceURL];
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
      label => `${label} SyntaxError ["the specifier",0,"the specifier"]`,
    ),
  );
  expect(exitCode).toBe(0);
});

// When Bun's own parser refuses a file, import() rejects with a SyntaxError and require() throws
// one, as in Node and as when JavaScriptCore's parser is the one that refuses the file. It used to
// be a BuildMessage, or an AggregateError of them for a file with several diagnostics.
describe.concurrent("a file that Bun's parser refuses fails to load with one SyntaxError", () => {
  // Paths read "<dir>/file" on every platform.
  const shape = /* js */ `
    const path = text => text.replaceAll(import.meta.dir, "<dir>").replaceAll("\\\\", "/");
    const shape = e => ({
      constructor: e.constructor.name,
      name: e.name,
      prototype: Object.getPrototypeOf(e) === SyntaxError.prototype,
      isError: Error.isError(e),
      isNativeError: require("node:util").types.isNativeError(e),
      tag: Object.prototype.toString.call(e),
      message: e.message,
      stack: path(e.stack),
      line: e.line,
      column: e.column,
      sourceURL: path(e.sourceURL),
      position: e.position && { ...e.position, file: path(e.position.file) },
      level: e.level,
      notes: e.notes?.map(note => note.constructor.name + ": " + note.message),
      ownKeys: Reflect.ownKeys(e).sort(),
      enumerable: Object.keys(e),
      hasErrors: "errors" in e,
    });
  `;
  const syntaxError = {
    constructor: "SyntaxError",
    name: "SyntaxError",
    prototype: true,
    isError: true,
    isNativeError: true,
    tag: "[object Error]",
    level: "error",
    ownKeys: ["column", "level", "line", "message", "notes", "position", "sourceURL", "stack"],
    enumerable: [],
    hasErrors: false,
  };
  const constX = {
    ...syntaxError,
    message: 'The constant "x" must be initialized',
    line: 1,
    column: 7,
    notes: [],
  };
  const frame = (file: string, text: string, line: number, name: string) =>
    `${line} | ${text}\n          ^\nerror: The constant "${name}" must be initialized\n    at <dir>/${file}:${line}:7`;

  async function run(files: Record<string, string | Buffer>, cmd = ["main.js"]) {
    using dir = tempDir("build-error-syntax-error", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      stdout,
      stderr: stderr.replaceAll(String(dir), "<dir>").replaceAll("\\", "/").split("\n\nBun v")[0],
      exitCode,
    };
  }

  test("import() and require() of a file with one diagnostic", async () => {
    const { stdout, stderr, exitCode } = await run({
      "bad.js": `const x;\n`,
      "main.js": /* js */ `
        ${shape}
        const out = {};
        out.import = await import("./bad.js").then(() => "loaded", shape);
        try {
          require("./bad.js");
          out.require = "loaded";
        } catch (e) {
          out.require = shape(e);
        }
        console.log(JSON.stringify(out));
      `,
    });
    expect(stderr).toBe("");
    const expected = {
      ...constX,
      stack: 'SyntaxError: The constant "x" must be initialized\n    at <parse> (<dir>/bad.js:1:7)',
      sourceURL: "<dir>/bad.js",
      position: {
        lineText: "const x;",
        file: "<dir>/bad.js",
        namespace: "file",
        line: 1,
        column: 7,
        length: 1,
        offset: 6,
      },
    };
    expect(JSON.parse(stdout)).toEqual({ import: expected, require: expected });
    expect(exitCode).toBe(0);
  });

  test("a file with several diagnostics gives the first error, and every diagnostic is printed", async () => {
    const files = {
      "two.js": `const x;\nconst y;\n`,
      "static.js": `import "./two.js";\n`,
      "main.js": /* js */ `
        ${shape}
        const out = {};
        out.import = await import("./two.js").then(() => "loaded", e => ({ ...shape(e), inspected: path(Bun.inspect(e)) }));
        try {
          require("./two.js");
          out.require = "loaded";
        } catch (e) {
          out.require = { ...shape(e), inspected: path(Bun.inspect(e)) };
        }
        console.log(JSON.stringify(out));
      `,
    };
    const blocks = frame("two.js", "const x;", 1, "x") + "\n\n" + frame("two.js", "const y;", 2, "y");
    const expected = {
      ...constX,
      stack: 'SyntaxError: The constant "x" must be initialized\n    at <parse> (<dir>/two.js:1:7)',
      sourceURL: "<dir>/two.js",
      position: {
        lineText: "const x;",
        file: "<dir>/two.js",
        namespace: "file",
        line: 1,
        column: 7,
        length: 1,
        offset: 6,
      },
      inspected: blocks,
    };
    const [caught, entryPoint, staticImport] = await Promise.all([
      run(files),
      run(files, ["two.js"]),
      run(files, ["static.js"]),
    ]);
    expect(caught.stderr).toBe("");
    expect(JSON.parse(caught.stdout)).toEqual({ import: expected, require: expected });
    expect(caught.exitCode).toBe(0);
    expect(entryPoint).toEqual({ stdout: "", stderr: blocks, exitCode: 1 });
    expect(staticImport).toEqual({ stdout: "", stderr: blocks, exitCode: 1 });
  });

  test("the notes of the first error, and a file that a data loader refuses", async () => {
    const { stdout, stderr, exitCode } = await run({
      "redeclared.js": `const a = 1;\nconst a = 2;\n`,
      "bad.toml": `a = [1, 2\n`,
      "main.js": /* js */ `
        ${shape}
        const out = {};
        for (const file of ["./redeclared.js", "./bad.toml"]) {
          const { message, stack, line, column, notes, position } = await import(file).then(() => "loaded", shape);
          out[file] = { message, stack, line, column, notes, lineText: position.lineText };
        }
        console.log(JSON.stringify(out));
      `,
    });
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      "./redeclared.js": {
        message: '"a" has already been declared',
        stack: 'SyntaxError: "a" has already been declared\n    at <parse> (<dir>/redeclared.js:2:7)',
        line: 2,
        column: 7,
        notes: ['BuildMessage: "a" was originally declared here'],
        lineText: "const a = 2;",
      },
      "./bad.toml": {
        message: "Expected ',' or ']' in an array but found end of file",
        stack:
          "SyntaxError: Expected ',' or ']' in an array but found end of file\n    at <parse> (<dir>/bad.toml:1:10)",
        line: 1,
        column: 10,
        notes: [],
        lineText: "a = [1, 2",
      },
    });
    expect(exitCode).toBe(0);
  });

  test("a warning before the first error", async () => {
    const { stdout, stderr, exitCode } = await run({
      // The parser warns about the legacy HTML comment on line 2.
      "warned.js": `x = 1;\n--> comment\nconst y;\n`,
      "main.js": /* js */ `
        ${shape}
        const error = await import("./warned.js").then(() => "loaded", e => e);
        const { constructor, message, stack, line, column, level, position } = shape(error);
        const printed = Bun.inspect(error).split("\\n").filter(line => /^(warn|error): /.test(line));
        console.log(JSON.stringify({ constructor, message, stack, line, column, level, lineText: position.lineText, printed }));
      `,
    });
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      constructor: "SyntaxError",
      message: 'The constant "y" must be initialized',
      stack: 'SyntaxError: The constant "y" must be initialized\n    at <parse> (<dir>/warned.js:3:7)',
      line: 3,
      column: 7,
      level: "error",
      lineText: "const y;",
      printed: [
        'warn: Treating "-->" as the start of a legacy HTML single-line comment',
        'error: The constant "y" must be initialized',
      ],
    });
    expect(exitCode).toBe(0);
  });

  // A diagnostic without a line does not say where the parser refused the text. A file that is
  // nested too deeply is not refused for its syntax: JavaScriptCore and Node report a RangeError.
  test("a diagnostic without a line, and a file that is nested too deeply, stay a BuildMessage", async () => {
    // Deep enough to overflow the parser's stack on every platform, whatever the size of a frame.
    const depth = 2_000_000;
    const { stdout, stderr, exitCode } = await run({
      // The position of an error in a transcoded document is not a position in the file.
      "no-line.xml": Buffer.from(`<?xml version="1.0" encoding="ISO-8859-1"?>\n<a>\xE9<b></a>\n`, "latin1"),
      "deep.js": `export const count = ${Buffer.alloc(depth, "(").toString()}1${Buffer.alloc(depth, ")").toString()};\n`,
      "main.js": /* js */ `
        const out = {};
        for (const file of ["./no-line.xml", "./deep.js"]) {
          const error = await import(file).then(() => "loaded", e => e);
          out[file] = [error.constructor.name, Error.isError(error), error.message, error.position.line > 0];
        }
        console.log(JSON.stringify(out));
      `,
    });
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      "./no-line.xml": ["BuildMessage", false, "Expected closing tag </b> but found </a>", false],
      "./deep.js": ["BuildMessage", false, "Maximum call stack size exceeded", true],
    });
    expect(exitCode).toBe(0);
  });

  test("structuredClone() copies it as any SyntaxError", async () => {
    const { stdout, stderr, exitCode } = await run({
      "two.js": `const x;\nconst y;\n`,
      "main.js": /* js */ `
        ${shape}
        const error = await import("./two.js").then(() => "loaded", e => e);
        const { constructor, message, stack, line, column, sourceURL, ownKeys } = shape(structuredClone(error));
        console.log(JSON.stringify({ constructor, message, stack, line, column, sourceURL, ownKeys }));
      `,
    });
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      constructor: "SyntaxError",
      message: 'The constant "x" must be initialized',
      stack: 'SyntaxError: The constant "x" must be initialized\n    at <parse> (<dir>/two.js:1:7)',
      line: 1,
      column: 7,
      sourceURL: "<dir>/two.js",
      ownKeys: ["column", "line", "message", "sourceURL", "stack"],
    });
    expect(exitCode).toBe(0);
  });

  test("every way to load the file", async () => {
    const { stdout, stderr, exitCode } = await run({
      "bad.js": `const x;\n`,
      "bad.cjs": `const x;\n`,
      "bad.mjs": `export const a = 1;\nconst x;\n`,
      "bad.ts": `const x: number;\nexport {};\n`,
      "imports-bad.mjs": `import "./bad.mjs";\n`,
      "from-plugin.virtual": ``,
      "main.js": /* js */ `
        import Module from "node:module";
        import { join } from "node:path";
        Bun.plugin({
          name: "bad contents",
          setup(build) {
            build.onLoad({ filter: /\\.virtual$/ }, () => ({ contents: "const x;", loader: "js" }));
            build.module("virtual:bad", () => ({ contents: "const x;", loader: "js" }));
          },
        });
        const ways = {
          "import()": () => import("./bad.js"),
          "import() of a TypeScript file": () => import("./bad.ts"),
          "require()": () => require("./bad.cjs"),
          "require() of an ES module": () => require("./bad.mjs"),
          "require() of a module that imports it": () => require("./imports-bad.mjs"),
          "import.meta.require()": () => import.meta.require("./bad.js"),
          "Module._extensions": () => Module._extensions[".js"](new Module("bad"), join(import.meta.dir, "bad.cjs")),
          "a data: URL": () => import("data:text/javascript,const x;"),
          "a blob: URL": () => import(URL.createObjectURL(new Blob(["const x;"], { type: "text/javascript" }))),
          "contents from an onLoad plugin": () => import("./from-plugin.virtual"),
          "contents from build.module()": () => import("virtual:bad"),
        };
        const out = {};
        for (const [way, load] of Object.entries(ways)) {
          try {
            await load();
            out[way] = "loaded";
          } catch (e) {
            out[way] = [e.constructor.name, Error.isError(e), e.message, e.position.line, typeof e.stack];
          }
        }
        console.log(JSON.stringify(out));
      `,
    });
    expect(stderr).toBe("");
    const syntaxError = ["SyntaxError", true, 'The constant "x" must be initialized', 1, "string"];
    expect(JSON.parse(stdout)).toEqual({
      "import()": syntaxError,
      "import() of a TypeScript file": syntaxError,
      "require()": syntaxError,
      "require() of an ES module": [...syntaxError.slice(0, 3), 2, "string"],
      "require() of a module that imports it": [...syntaxError.slice(0, 3), 2, "string"],
      "import.meta.require()": syntaxError,
      "Module._extensions": syntaxError,
      "a data: URL": syntaxError,
      "a blob: URL": syntaxError,
      "contents from an onLoad plugin": syntaxError,
      "contents from build.module()": syntaxError,
    });
    expect(exitCode).toBe(0);
  });

  // The module registry keeps the error of a module whose fetch failed, and settles with it every
  // module that imports that module afterwards. Each of them gets the error itself, not a copy
  // that has the message alone.
  test("modules that import the file get the error that the registry keeps", async () => {
    const { stdout, stderr, exitCode } = await run({
      "one.js": `const x;\n`,
      "two.js": `const x;\nconst y;\n`,
      ...Object.fromEntries(
        ["one", "two"].flatMap(file =>
          Array.from({ length: 8 }, (_, i) => [`${file}-importer-${i}.js`, `import "./${file}.js";\n`]),
        ),
      ),
      "main.js": /* js */ `
        ${shape}
        const out = {};
        for (const file of ["one", "two"]) {
          const importer = i => import("./" + file + "-importer-" + i + ".js").then(() => "loaded", e => e);
          // One after the other, then at once.
          const errors = [await importer(0), await importer(1), ...(await Promise.all([2, 3, 4, 5, 6, 7].map(importer)))];
          out[file] = {
            same: errors.map(error => error === errors[0]),
            stack: [...new Set(errors.map(error => path(String(error.stack))))],
            inspected: new Set(errors.map(error => Bun.inspect(error))).size,
          };
        }
        console.log(JSON.stringify(out));
      `,
    });
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      one: {
        same: Array.from({ length: 8 }, () => true),
        stack: ['SyntaxError: The constant "x" must be initialized\n    at <parse> (<dir>/one.js:1:7)'],
        inspected: 1,
      },
      two: {
        same: Array.from({ length: 8 }, () => true),
        stack: ['SyntaxError: The constant "x" must be initialized\n    at <parse> (<dir>/two.js:1:7)'],
        inspected: 1,
      },
    });
    expect(exitCode).toBe(0);
  });

  // import() and require() of the file itself read it again, and drop the error that the registry
  // kept: each gets an error of its own.
  test("each import() and require() of the file gets a new error", async () => {
    const { stdout, stderr, exitCode } = await run({
      "bad.js": `const x;\n`,
      "importer-0.js": `import "./bad.js";\n`,
      "importer-1.js": `import "./bad.js";\n`,
      "main.js": /* js */ `
        const imported = specifier => import(specifier).then(() => "loaded", e => e);
        const required = () => {
          try {
            require("./bad.js");
            return "loaded";
          } catch (e) {
            return e;
          }
        };
        const importer = await imported("./importer-0.js");
        const direct = [await imported("./bad.js"), await imported("./bad.js"), required(), required()];
        const laterImporter = await imported("./importer-1.js");
        const errors = [importer, ...direct, laterImporter];
        console.log(JSON.stringify({
          names: [...new Set(errors.map(error => error.constructor.name))],
          distinct: new Set(errors).size,
          theFirstImporterKeepsItsError: (await imported("./importer-0.js")) === importer,
        }));
      `,
    });
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ names: ["SyntaxError"], distinct: 6, theFirstImporterKeepsItsError: true });
    expect(exitCode).toBe(0);
  });

  // The printers of "bun test" and of the console read the diagnostics that the error keeps.
  test("a resolve error after the first error is printed with it", async () => {
    const { stdout, stderr, exitCode } = await run({
      "mixed.js": `import { nope } from "./does-not-exist" with { type: "macro" };\nconst a = 1;\na = 2;\nnope();\n`,
      "main.js": /* js */ `
        const error = await import("./mixed.js").then(() => "loaded", e => e);
        const printed = Bun.inspect(error).split("\\n").filter(line => /^(note|error): /.test(line));
        console.log(JSON.stringify({ name: error.constructor.name, message: error.message, line: error.line, printed }));
      `,
    });
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      name: "SyntaxError",
      message: 'Cannot assign to "a" because it is a constant',
      line: 3,
      printed: [
        'error: Cannot assign to "a" because it is a constant',
        'note: The symbol "a" was declared a constant here:',
        'error: Macro "./does-not-exist" not found',
        'error: "MacroNotFound" error in macro',
      ],
    });
    expect(exitCode).toBe(0);
  });

  // mocha replaces the error of a module that a test file imports with a copy like this one.
  test("an error that takes the stack is printed with the file's code frame", async () => {
    const { stdout, stderr, exitCode } = await run({
      "bad.js": `const x;\n`,
      "main.js": /* js */ `
        ${shape}
        const error = await import("./bad.js").then(() => "loaded", e => e);
        const copy = new SyntaxError(error.message);
        copy.stack = error.stack;
        console.log(path(Bun.inspect(copy)));
      `,
    });
    expect(stderr).toBe("");
    expect(stdout).toBe(
      '1 | const x;\n          ^\nSyntaxError: The constant "x" must be initialized\n      at <parse> (<dir>/bad.js:1:7)\n\n',
    );
    expect(exitCode).toBe(0);
  });
});

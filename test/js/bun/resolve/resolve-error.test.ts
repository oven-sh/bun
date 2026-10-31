import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, MAX_PATH_BYTES, normalizeBunSnapshot, tempDir } from "harness";
import path from "node:path";

describe("ResolveMessage", () => {
  it("carries what the resolver logged while failing as notes", async () => {
    // The resolver records the reason it gave up (here: the dependency's
    // package.json does not parse) in the log of the failing resolve. That
    // used to be discarded, leaving a bare "Cannot find package".
    using dir = tempDir("resolve-error-notes", {
      "index.js": `import "badjson";\n`,
      "node_modules/badjson/package.json": `{ "name": "badjson", "main":\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(normalizeBunSnapshot(stderr, String(dir))).toMatchInlineSnapshot(`
      "error: Cannot find package 'badjson' from '<dir>/index.js'

      1 | { "name": "badjson", "main":
                                      ^
      note: Unexpected end of file
         at <dir>/node_modules/badjson/package.json:1:29

      Bun v<bun-version>"
    `);
    expect(exitCode).toBe(1);
  });

  it("position object does not segfault", async () => {
    try {
      await import("./file-importing-nonexistent-file.js");
    } catch (e: any) {
      expect(Bun.inspect(e.position).length > 0).toBe(true);
      expect(e.column).toBeGreaterThanOrEqual(0);
      expect(e.line).toBeGreaterThanOrEqual(0);
    }
  });

  it(".message is modifiable", async () => {
    try {
      await import("./file-importing-nonexistent-file.js");
    } catch (e: any) {
      const orig = e.message;
      expect(() => (e.message = "new message")).not.toThrow();
      expect(e.message).toBe("new message");
      expect(e.message).not.toBe(orig);
    }
  });

  it("has code for esm", async () => {
    try {
      await import("./file-importing-nonexistent-file.js");
    } catch (e: any) {
      expect(e.code).toBe("ERR_MODULE_NOT_FOUND");
    }
  });

  it("has code for require.resolve", () => {
    try {
      require.resolve("./file-importing-nonexistent-file.js");
    } catch (e: any) {
      expect(e.code).toBe("MODULE_NOT_FOUND");
    }
  });

  it("has code for require", () => {
    try {
      require("./file-importing-nonexistent-file.cjs");
    } catch (e: any) {
      expect(e.code).toBe("MODULE_NOT_FOUND");
    }
  });

  it("preserves non-ASCII specifier in .message and .specifier (import)", async () => {
    const spec = "./caf\u00e9-missing-\u{1F389}";
    let err: any;
    try {
      await import(spec);
      expect.unreachable();
    } catch (e) {
      err = e;
    }
    expect(err.name).toBe("ResolveMessage");
    expect(err.specifier).toBe(spec);
    expect(err.message).toContain(spec);
    expect(String(err)).toContain(spec);
    expect(JSON.parse(JSON.stringify(err))).toMatchObject({ specifier: spec });
  });

  it("preserves non-ASCII specifier in .message and .specifier (require node:)", () => {
    const spec = "node:sql\u0131te"; // dotless i U+0131
    let err: any;
    try {
      require(spec);
      expect.unreachable();
    } catch (e) {
      err = e;
    }
    expect(err.code).toBe("ERR_UNKNOWN_BUILTIN_MODULE");
    expect(err.specifier).toBe(spec);
    expect(err.message).toBe(`No such built-in module: ${spec}`);
  });

  it("preserves non-ASCII referrer in .referrer and .message", () => {
    const referrer = "/tmp/caf\u00e9-tr\u00e8s-\u{1F389}/file.js";
    let err: any;
    try {
      Bun.resolveSync("./does-not-exist", referrer);
      expect.unreachable();
    } catch (e) {
      err = e;
    }
    expect(err.referrer).toBe(referrer);
    expect(err.message).toContain(referrer);
  });

  it("preserves non-ASCII in position.lineText and position.file", async () => {
    const lineText = `const caf\u00e9 = 1; import "./na\u00efve-missing.js"; // \u{1F389}`;
    const fileName = "entry-caf\u00e9-\u{1F389}.js";
    using dir = tempDir("resolve-position-utf8", {
      [fileName]: lineText + "\n",
    });
    const result = await Bun.build({ entrypoints: [path.join(String(dir), fileName)], throw: false });
    expect(result.success).toBe(false);
    const log: any = result.logs.find(l => l.name === "ResolveMessage");
    expect(log).toBeDefined();
    expect(log.position.lineText).toBe(lineText);
    expect(path.basename(log.position.file)).toBe(fileName);
    expect(log.specifier).toBe("./na\u00efve-missing.js");
  });

  it("invalid data URL import", async () => {
    expect(async () => {
      // @ts-ignore
      await import("data:Hello%2C%20World!");
    }).toThrow("Cannot resolve invalid data URL");
  });

  it("doesn't crash", async () => {
    expect(async () => {
      // @ts-ignore
      await import(":://filesystem");
    }).toThrow("Cannot find package '::'");
  });

  it("referrer is not freed before it is read", () => {
    // Non-ASCII in the source path forces resolveMaybeNeedsTrailingSlash to
    // allocate a new UTF-8 buffer which is freed on return. ResolveMessage
    // used to borrow that buffer for .referrer, causing a use-after-free
    // when the property was read later.
    let err: any;
    try {
      Bun.resolveSync("./does-not-exist", "/tmp/caf\u00e9-tr\u00e8s-long-\u{1F389}/file.js");
    } catch (e) {
      err = e;
    }
    Bun.gc(true);
    expect(err.referrer).toStartWith("/tmp/caf");
    expect(err.referrer).toEndWith("/file.js");
  });

  it("finalize frees with the same allocator it was created with", () => {
    // ResolveMessage.create() clones the message with the VM's arena
    // allocator but finalize() was freeing it with bun.default_allocator
    // and never destroying the struct itself. Under ASAN with mimalloc's
    // per-heap tracking this surfaced as a flaky use-after-poison in the
    // resolver after many failed require()s + GCs in a long-running
    // process (Fuzzilli REPRL). Use relative specifiers so auto-install
    // does not kick in.
    for (let i = 0; i < 50; i++) {
      let errs: any[] = [];
      for (let j = 0; j < 10; j++) {
        try {
          Bun.resolveSync("./does-not-exist-" + j, import.meta.dir);
        } catch (e) {
          errs.push(e);
        }
      }
      for (const e of errs) {
        void e.message;
        void e.code;
        void e.specifier;
        void e.referrer;
        void e.level;
        void e.importKind;
        void e.position;
        void String(e);
      }
      errs = [];
      Bun.gc(true);
    }
    expect().pass();
  });
});

// These tests reproduce panics where the module resolver wrote past fixed-size
// PathBuffers when given very long import specifiers. The bug triggers when
// `import_path < PATH_MAX` but `baseUrl + import_path > PATH_MAX` (otherwise a
// syscall returns ENAMETOOLONG first). PATH_MAX is 1024 on macOS, 4096 on
// Linux/Windows, so pick a length just under it per platform.
// Any length > 512 also exercises the `esm_subpath` buffer.
describe.concurrent("long import path overflow", () => {
  const len = process.platform === "darwin" ? 1020 : 4090;
  // "a".repeat is slow in debug builds; use Buffer.alloc instead.
  const long = Buffer.alloc(len, "a").toString();

  function makeDir() {
    // package.json + node_modules/ prevent the resolver from attempting
    // auto-install (which has an unrelated pre-existing bug).
    return tempDir("resolve-long-path", {
      "package.json": `{"name": "test", "version": "0.0.0"}`,
      "node_modules/.keep": "",
      "tsconfig.json": `{"compilerOptions": {"baseUrl": ".", "paths": {"@x/*": ["./src/*"]}}}`,
    });
  }

  async function run(dir: string, importExpr: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `try { await import(${importExpr}); } catch {} console.log("ok");`],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  }

  it("bare package specifier (tsconfig baseUrl + import_path join)", async () => {
    using dir = makeDir();
    // normalizeStringGenericTZ: `@memcpy(buf[buf_i..][0..count], ...)` past PathBuffer
    await run(String(dir), `\`@nonexistent/pkg/build/${long}.js\``);
  });

  it("tsconfig paths wildcard (matched text captured from import path)", async () => {
    using dir = makeDir();
    // matchTSConfigPaths: bun.concat into fixed tsconfig_match_full_buf3
    await run(String(dir), `\`@x/${long}\``);
  });

  it("relative path (source_dir + import_path join)", async () => {
    using dir = makeDir();
    // checkRelativePath / resolveWithoutRemapping absBuf
    await run(String(dir), `\`./${long}.js\``);
  });

  it("relative path full of `..` segments (exercises normalization fallback)", async () => {
    using dir = makeDir();
    // Concat length >> PATH_MAX but normalizes down; JoinScratch heap fallback
    await run(String(dir), `\`./\${"x/../".repeat(${len})}${long}.js\``);
  });

  it("absolute path longer than PATH_MAX (dirInfoCached buffer)", async () => {
    using dir = makeDir();
    // dirInfoCachedMaybeLog: bun.copy into dir_info_uncached_path
    await run(String(dir), `\`/${long}/mixed\``);
  });

  it("absolute path with >256 short components (dir_entry_paths_to_resolve queue)", async () => {
    using dir = makeDir();
    // Walk-up loop indexed into a fixed [256]DirEntryResolveQueueItem
    await run(String(dir), `\`/\${"a/".repeat(300)}x\``);
  });
});

// The resolver builds every candidate path in a MAX_PATH_BYTES buffer and treats one that's too long as missing.
describe.concurrent("candidate paths longer than a path buffer", () => {
  const longName = Buffer.alloc(MAX_PATH_BYTES, "a").toString();

  // package.json and node_modules/ keep the resolver from auto-installing the bare specifiers.
  async function run(files: Record<string, string>) {
    using dir = tempDir("resolve-too-long", {
      "package.json": `{"name": "test", "version": "0.0.0"}`,
      "node_modules/.keep": "",
      ...files,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { result: stdout && JSON.parse(stdout), stderr, exitCode };
  }

  const helpers = `
    const outcome = fn => { try { return "resolved: " + fn(); } catch (e) { return e.code; } };
  `;

  it("throws MODULE_NOT_FOUND for a missing file whose path length is near the limit", async () => {
    const lengths = [-5, -4, -1, 0, 1, 300].map(delta => MAX_PATH_BYTES + delta);
    expect(
      await run({
        "main.cjs": `${helpers}
          const cwd = process.cwd();
          const out = {};
          for (const length of ${JSON.stringify(lengths)}) {
            const file = cwd + "/" + Buffer.alloc(length - Buffer.byteLength(cwd) - 1, "f").toString();
            out[length] = [outcome(() => require(file)), outcome(() => require.resolve(file))];
          }
          console.log(JSON.stringify(out));`,
      }),
    ).toEqual({
      result: Object.fromEntries(lengths.map(length => [length, ["MODULE_NOT_FOUND", "MODULE_NOT_FOUND"]])),
      stderr: "",
      exitCode: 0,
    });
  });

  it("throws when package.json main or module is too long", async () => {
    expect(
      await run({
        "node_modules/relative/package.json": JSON.stringify({ name: "relative", main: `./${longName}` }),
        "node_modules/absolute/package.json": JSON.stringify({ name: "absolute", module: `/${longName}` }),
        "main.cjs": `${helpers}
          import("absolute").then(() => "resolved", e => e.code).then(absolute => {
            console.log(JSON.stringify({ relative: outcome(() => require("relative")), absolute }));
          });`,
      }),
    ).toEqual({
      result: { relative: "MODULE_NOT_FOUND", absolute: "ERR_MODULE_NOT_FOUND" },
      stderr: "",
      exitCode: 0,
    });
  });

  it("throws MODULE_NOT_FOUND when a require.extensions key is too long", async () => {
    expect(
      await run({
        "dir/.keep": "",
        "main.cjs": `${helpers}
          require.extensions[${JSON.stringify("." + longName)}] = () => {};
          console.log(JSON.stringify({
            file: outcome(() => require("./missing")),
            directory: outcome(() => require("./dir")),
          }));`,
      }),
    ).toEqual({
      result: { file: "MODULE_NOT_FOUND", directory: "MODULE_NOT_FOUND" },
      stderr: "",
      exitCode: 0,
    });
  });

  it("fails the build when the package.json browser field remaps main to a path that's too long", async () => {
    expect(
      await run({
        "node_modules/m/package.json": JSON.stringify({
          name: "m",
          main: "./x.js",
          browser: { "./x.js": `./${longName}` },
        }),
        "node_modules/m/x.js": "module.exports = 1;",
        "entry.js": `import "m";`,
        "main.cjs": `
          Bun.build({ entrypoints: ["./entry.js"], target: "browser", throw: false }).then(build => {
            console.log(JSON.stringify({ success: build.success, messages: build.logs.map(log => log.message) }));
          });`,
      }),
    ).toEqual({
      result: { success: false, messages: ['Could not resolve: "m". Maybe you need to "bun install"?'] },
      stderr: "",
      exitCode: 0,
    });
  });

  it("skips tsconfig.json extends, baseUrl and paths values that are too long", async () => {
    // Each use.cjs uses the tsconfig.json next to it.
    expect(
      await run({
        "extends/tsconfig.json": JSON.stringify({ extends: `./${longName}` }),
        "extends/use.cjs": `module.exports = "loaded";`,
        "baseUrl/tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: longName } }),
        "baseUrl/use.cjs": `module.exports = require("x");`,
        "paths/tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { x: [longName] } } }),
        "paths/use.cjs": `module.exports = require("x");`,
        "main.cjs": `${helpers}
          console.log(JSON.stringify({
            extends: outcome(() => require("./extends/use.cjs")),
            baseUrl: outcome(() => require("./baseUrl/use.cjs")),
            paths: outcome(() => require("./paths/use.cjs")),
          }));`,
      }),
    ).toEqual({
      result: { extends: "resolved: loaded", baseUrl: "MODULE_NOT_FOUND", paths: "MODULE_NOT_FOUND" },
      stderr: "",
      exitCode: 0,
    });
  });
});

// matchTSConfigPaths sliced `path[prefix.len()..path.len() - suffix.len()]`
// after only checking starts_with/ends_with. When the prefix and suffix bytes
// overlap inside the import path (e.g. key "ab*ba" vs import "aba"), the slice
// start exceeds the end and Rust panics.
describe.concurrent("tsconfig paths wildcard with overlapping prefix/suffix", () => {
  async function run(key: string, specifier: string) {
    using dir = tempDir("tsconfig-paths-overlap", {
      "package.json": `{"name": "test", "version": "0.0.0"}`,
      "node_modules/.keep": "",
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { [key]: ["./impl/*"] } },
      }),
      "main.ts": `try { require(${JSON.stringify(specifier)}); } catch (e) { console.log("ERR:" + e.code); }`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: "ERR:MODULE_NOT_FOUND",
      stderr: "",
      exitCode: 0,
    });
  }

  it("ab*ba vs aba", async () => {
    await run("ab*ba", "aba");
  });

  it("test*test vs testest", async () => {
    await run("test*test", "testest");
  });

  it("xy*xy vs xy", async () => {
    await run("xy*xy", "xy");
  });
});

// Bun.resolve() resolves synchronously and returns an already-settled promise.
// A rejected one has to be reported like any other unhandled rejection.
describe.concurrent("Bun.resolve() rejections are tracked", () => {
  async function run(body: string) {
    using dir = tempDir("bun-resolve-unhandled", {});
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `const dir = ${JSON.stringify(String(dir))};\n${body}`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it("an unhandled rejection is reported", async () => {
    const { stdout, stderr, exitCode } = await run(`Bun.resolve("./does-not-exist", dir);`);
    expect(stdout).toBe("");
    expect(stderr).toContain("Cannot find module './does-not-exist'");
    expect(exitCode).toBe(1);
  });

  it("the returned promise is the one passed to 'unhandledRejection'", async () => {
    const { stdout, stderr, exitCode } = await run(`
      process.on("unhandledRejection", (reason, promise) => {
        console.log(reason.code, promise === p);
      });
      const p = Bun.resolve("./does-not-exist", dir);
    `);
    expect(stdout).toBe("ERR_MODULE_NOT_FOUND true\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  it("a handled rejection is not reported", async () => {
    const { stdout, stderr, exitCode } = await run(`
      Bun.resolve("./does-not-exist", dir).catch(e => console.log("caught", e.code));
    `);
    expect(stdout).toBe("caught ERR_MODULE_NOT_FOUND\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});

// An import or a re-export of a name that the other module does not export fails when the importing module is linked.
// None of that module's code is running then, so an error that no JavaScript is waiting for has no frame to say where
// the statement is. It is given one: the file of the statement, at the line and column that the specifier has in the
// file as it was written.
// https://github.com/oven-sh/bun/issues/5582
describe.concurrent("module link error", () => {
  // The transpiler emits none of these lines, so an import under them is on another line in the text that is linked.
  const erased = [
    ``,
    `// A comment.`,
    `import type { Shape } from "./shapes.ts";`,
    `import { type Gone } from "./dep.ts";`,
    `interface Local { shape: Shape }`,
    `type Erased = Gone | Local;`,
  ];
  const importer = (...statements: string[]) => [...erased, ...statements, ""].join("\n");
  // What the source preview shows above line 7.
  const above = [
    `2 | // A comment.`,
    `3 | import type { Shape } from "./shapes.ts";`,
    `4 | import { type Gone } from "./dep.ts";`,
    `5 | interface Local { shape: Shape }`,
    `6 | type Erased = Gone | Local;`,
  ];
  const dep = { "dep.ts": `export const b = 1;\n` };
  const both = {
    "one.ts": `export const x = 1;\n`,
    "two.ts": `export const x = 2;\n`,
    "both.ts": `export * from "./one.ts";\nexport * from "./two.ts";\n`,
  };
  const react = (...runtime: string[]) => ({
    "node_modules/react/package.json": JSON.stringify({
      name: "react",
      version: "0.0.0",
      type: "module",
      exports: { "./jsx-dev-runtime": "./jsx-dev-runtime.js" },
    }),
    "node_modules/react/jsx-dev-runtime.js": [
      `export const Fragment = Symbol.for("react.fragment");`,
      ...runtime,
      "",
    ].join("\n"),
  });
  const jsxEnv = { ...bunEnv, NODE_ENV: "development" };
  const message = `Export named 'a' not found in module '<dir>/dep.ts'.`;
  const notFound = `SyntaxError: ${message}`;
  const basic = { ...dep, "index.ts": importer(`import { a } from "./dep.ts";`, `console.log(a);`) };
  // A barrel with an `export { name } from` that went stale, and a module of the cycle that takes the barrel as a
  // namespace. The namespace leaves the name out, and the link of the barrel says which statement it is.
  const barrel = {
    "bar.ts": `export const present = 1;\n`,
    "index.ts": [
      `// a barrel`,
      `export { present } from "./bar.ts";`,
      `export { renamedAway } from "./bar.ts";`,
      `export { useApi } from "./feature.ts";`,
      ``,
    ].join("\n"),
    "feature.ts": [
      `// a feature that reads the barrel as a namespace`,
      `import * as api from "./index.ts";`,
      `export const useApi = () => Object.keys(api);`,
      ``,
    ].join("\n"),
    "main.ts": `import { useApi } from "./index.ts";\nconsole.log(useApi());\n`,
  };
  // The same through an `export *`, from either end of the cycle.
  const throughStar = {
    "leaf.mjs": `export const present = 1;\n`,
    "mid.mjs": `import "./x.mjs";\nexport { gone } from "./leaf.mjs";\n`,
    "barrel.mjs": `export * from "./mid.mjs";\n`,
    "x.mjs": `import * as ns from "./barrel.mjs";\nimport "./mid.mjs";\nexport const keys = () => Object.keys(ns);\n`,
  };
  const staleExport = [
    `1 | import "./x.mjs";`,
    `2 | export { gone } from "./leaf.mjs";`,
    `             ^`,
    `SyntaxError: export 'gone' not found in './leaf.mjs'`,
    `      at <dir>/mid.mjs:2:10`,
  ];

  type Files = Record<string, string>;

  async function spawn(cwd: string, args: string[], env: typeof bunEnv) {
    await using proc = Bun.spawn({ cmd: [bunExe(), ...args], env, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  // What Bun prints when it runs in a directory that has `files`, with `<dir>` for the directory.
  async function run(files: Files, args: string[], env = bunEnv) {
    using dir = tempDir("module-link-error", files);
    const { stdout, stderr, exitCode } = await spawn(String(dir), args, env);
    return {
      stdout: normalizeBunSnapshot(stdout, String(dir)),
      stderr: normalizeBunSnapshot(stderr, String(dir)),
      exitCode,
    };
  }

  // The same for a fixture that prints JSON: `<dir>` is for the directory in each string of it.
  async function runJSON(files: Files, args: string[]) {
    using dir = tempDir("module-link-error", files);
    const { stdout, stderr, exitCode } = await spawn(String(dir), args, bunEnv);
    const printed = JSON.parse(stdout || "null", (_, value) =>
      typeof value === "string" ? value.replaceAll(String(dir), "<dir>").replaceAll("\\", "/") : value,
    );
    return { printed, stderr, exitCode };
  }

  // What `bun test` prints of an error that is not the error of a test.
  const unhandled = (stderr: string) => /# Unhandled error between tests\n-+\n([^]*?)\n-+\n/.exec(stderr)?.[1];

  describe("names the statement in the uncaught error of the entry point", () => {
    type Statement = {
      statement: string;
      files: Files;
      error: string[];
      args?: string[];
      env?: typeof bunEnv;
      // What differs when a test file imports the module under `bun test --isolate`. "links": the record of the module
      // says that it is TypeScript, where the name can be a type that the other module has. "bare": the text of a file
      // that has no extension is read for an error only when the file is the entry point.
      underIsolate?: "links" | "bare";
    };
    const statements: Statement[] = [
      {
        statement: "a named import",
        files: basic,
        error: [
          ...above,
          `7 | import { a } from "./dep.ts";`,
          `             ^`,
          notFound,
          `      at <dir>/index.ts:7:10`,
        ],
      },
      {
        statement: "a name on a line of its own, under one that is renamed",
        files: {
          ...dep,
          "index.ts": importer(
            `import {`,
            `  b as renamed,`,
            `  a,`,
            `} from "./dep.ts";`,
            `console.log(renamed, await a);`,
          ),
        },
        error: [
          `4 | import { type Gone } from "./dep.ts";`,
          `5 | interface Local { shape: Shape }`,
          `6 | type Erased = Gone | Local;`,
          `7 | import {`,
          `8 |   b as renamed,`,
          `9 |   a,`,
          `      ^`,
          notFound,
          `      at <dir>/index.ts:9:3`,
        ],
      },
      {
        statement: "a renamed import, at the name it imports",
        files: { ...dep, "index.ts": importer(`import { a as b } from "./dep.ts";`, `console.log(b);`) },
        error: [
          ...above,
          `7 | import { a as b } from "./dep.ts";`,
          `             ^`,
          notFound,
          `      at <dir>/index.ts:7:10`,
        ],
      },
      {
        statement: "a name after a type-only one",
        files: { ...dep, "index.ts": importer(`import { type Gone as Never, a } from "./dep.ts";`, `console.log(a);`) },
        error: [
          ...above,
          `7 | import { type Gone as Never, a } from "./dep.ts";`,
          `                                 ^`,
          notFound,
          `      at <dir>/index.ts:7:30`,
        ],
      },
      {
        // The column counts UTF-16 code units, as that of a stack frame does: one for the é, two for the emoji.
        statement: "a name after characters that are not ASCII",
        files: { ...dep, "index.ts": importer(`/* é\u{1F600} */ import { a } from "./dep.ts";`, `console.log(a);`) },
        error: [
          ...above,
          `7 | /* é\u{1F600} */ import { a } from "./dep.ts";`,
          `                       ^`,
          notFound,
          `      at <dir>/index.ts:7:20`,
        ],
      },
      {
        statement: "a default import of a module that has no default export",
        files: { ...dep, "index.ts": importer(`import missing from "./dep.ts";`, `console.log(missing);`) },
        error: [
          ...above,
          `7 | import missing from "./dep.ts";`,
          `           ^`,
          `SyntaxError: Missing 'default' export in module '<dir>/dep.ts'.`,
          `      at <dir>/index.ts:7:8`,
        ],
      },
      {
        statement: "a default import under a name that the module exports",
        files: { ...dep, "index.ts": importer(`import b from "./dep.ts";`, `console.log(b);`) },
        error: [
          ...above,
          `7 | import b from "./dep.ts";`,
          `           ^`,
          `SyntaxError: module '<dir>/dep.ts' does not have an export named 'default'. Did you mean 'b'?`,
          `      at <dir>/index.ts:7:8`,
        ],
      },
      {
        statement: "a named import of what the module exports as its default",
        files: {
          "default.ts": `export default function a() {}\n`,
          "index.ts": importer(`import { a } from "./default.ts";`, `console.log(a);`),
        },
        error: [
          ...above,
          `7 | import { a } from "./default.ts";`,
          `             ^`,
          `SyntaxError: Export named 'a' not found in module '<dir>/default.ts'. Did you mean to import default?`,
          `      at <dir>/index.ts:7:10`,
        ],
      },
      {
        statement: "an import of a name that two `export *` both provide",
        files: { ...both, "index.ts": importer(`import { x } from "./both.ts";`, `console.log(x);`) },
        error: [
          ...above,
          `7 | import { x } from "./both.ts";`,
          `             ^`,
          `SyntaxError: Export named 'x' cannot be resolved due to ambiguous multiple bindings in module '<dir>/both.ts'.`,
          `      at <dir>/index.ts:7:10`,
        ],
      },
      {
        statement: "`export { x } from`",
        files: { ...dep, "index.ts": importer(`export { b, x } from "./dep.ts";`) },
        error: [
          ...above,
          `7 | export { b, x } from "./dep.ts";`,
          `                ^`,
          `SyntaxError: export 'x' not found in './dep.ts'`,
          `      at <dir>/index.ts:7:13`,
        ],
        underIsolate: "links",
      },
      {
        statement: "`export { a as x } from`, at the name it imports",
        files: { ...dep, "index.ts": importer(`export { b, a as x } from "./dep.ts";`) },
        error: [
          ...above,
          `7 | export { b, a as x } from "./dep.ts";`,
          `                ^`,
          `SyntaxError: export 'x' not found in './dep.ts'`,
          `      at <dir>/index.ts:7:13`,
        ],
        underIsolate: "links",
      },
      {
        statement: "`export { x } from` of a name that two `export *` both provide",
        files: { ...both, "index.ts": importer(`export { x } from "./both.ts";`) },
        error: [
          ...above,
          `7 | export { x } from "./both.ts";`,
          `             ^`,
          `SyntaxError: Cannot export 'x' multiple times in './both.ts'`,
          `      at <dir>/index.ts:7:10`,
        ],
      },
      {
        statement: "`export { default } from` a module that has no default export",
        files: { ...dep, "index.ts": importer(`export { default } from "./dep.ts";`) },
        error: [
          ...above,
          `7 | export { default } from "./dep.ts";`,
          `             ^`,
          `SyntaxError: export default cannot be used with export *`,
          `      at <dir>/index.ts:7:10`,
        ],
      },
      {
        statement: "an import that is exported, at the import",
        files: { ...dep, "index.ts": importer(`import { b, x } from "./dep.ts";`, `export { b, x };`) },
        error: [
          ...above,
          `7 | import { b, x } from "./dep.ts";`,
          `                ^`,
          `SyntaxError: export 'x' not found in './dep.ts'`,
          `      at <dir>/index.ts:7:13`,
        ],
        underIsolate: "links",
      },
      {
        statement: "an import that an export clause above it exports, at the import",
        files: {
          ...dep,
          "index.js": [
            `export { b, x as y };`,
            `import { b } from "./dep.ts";`,
            `import { x } from "./dep.ts";`,
            ``,
          ].join("\n"),
        },
        args: ["./index.js"],
        error: [
          `1 | export { b, x as y };`,
          `2 | import { b } from "./dep.ts";`,
          `3 | import { x } from "./dep.ts";`,
          `             ^`,
          `SyntaxError: export 'y' not found in './dep.ts'`,
          `      at <dir>/index.js:3:10`,
        ],
      },
      {
        statement: "an import from a specifier that the transpiler rewrites",
        files: { "index.ts": importer(`import { readFileSync, nope } from "fs";`, `console.log(readFileSync, nope);`) },
        error: [
          ...above,
          `7 | import { readFileSync, nope } from "fs";`,
          `                           ^`,
          `SyntaxError: Export named 'nope' not found in module 'node:fs'.`,
          `      at <dir>/index.ts:7:24`,
        ],
      },
      {
        statement: "an import in a dependency of the entry point",
        files: {
          ...dep,
          "dependency.ts": importer(`import { a } from "./dep.ts";`, `export const value = a;`),
          "index.ts": `import { value } from "./dependency.ts";\nconsole.log(value);\n`,
        },
        error: [
          ...above,
          `7 | import { a } from "./dep.ts";`,
          `             ^`,
          notFound,
          `      at <dir>/dependency.ts:7:10`,
        ],
      },
      {
        statement: "an import in a file that has JSX",
        args: ["./index.tsx"],
        env: jsxEnv,
        files: {
          ...dep,
          ...react(`export const jsxDEV = (type, props) => ({ type, props });`),
          "index.tsx": importer(`import { b, a } from "./dep.ts";`, `console.log(<div>{b}{a}</div>);`),
        },
        error: [
          ...above,
          `7 | import { b, a } from "./dep.ts";`,
          `                ^`,
          notFound,
          `      at <dir>/index.tsx:7:13`,
        ],
      },
      {
        // The transpiler moves the import above the class that it rewrites.
        statement: "an import in a JavaScript file that has a decorator",
        args: ["./index.js"],
        files: {
          ...dep,
          "index.js": [
            `const same = value => value;`,
            `@same`,
            `class Decorated {}`,
            `import { a } from "./dep.ts";`,
            `console.log(a, Decorated);`,
            ``,
          ].join("\n"),
        },
        error: [
          `1 | const same = value => value;`,
          `2 | @same`,
          `3 | class Decorated {}`,
          `4 | import { a } from "./dep.ts";`,
          `             ^`,
          notFound,
          `      at <dir>/index.js:4:10`,
        ],
      },
      {
        statement: "an import in a file that has a decorator which only experimentalDecorators allows",
        files: {
          ...dep,
          "tsconfig.json": JSON.stringify({ compilerOptions: { experimentalDecorators: true } }),
          "index.ts": importer(
            `import { a } from "./dep.ts";`,
            `const make = () => () => (target: unknown) => {};`,
            `@make()()`,
            `class Decorated {}`,
            `console.log(a, Decorated);`,
          ),
        },
        error: [
          ...above,
          `7 | import { a } from "./dep.ts";`,
          `             ^`,
          notFound,
          `      at <dir>/index.ts:7:10`,
        ],
      },
      {
        statement: "an import in a script that has no extension",
        args: ["./script"],
        files: { ...dep, "script": importer(`import { a } from "./dep.ts";`, `console.log(a);`) },
        error: [
          ...above,
          `7 | import { a } from "./dep.ts";`,
          `             ^`,
          notFound,
          `      at <dir>/script:7:10`,
        ],
        underIsolate: "bare",
      },
      {
        statement: "an import in the text that `bun -e` is given",
        args: ["-e", importer(`import { a } from "./dep.ts";`, `console.log(a);`)],
        files: dep,
        error: [
          ...above,
          `7 | import { a } from "./dep.ts";`,
          `             ^`,
          notFound,
          `      at <dir>/[eval]:7:10`,
        ],
      },
      {
        statement: "a stale `export { x } from` of a barrel that a module of the cycle takes as a namespace",
        args: ["./main.ts"],
        files: barrel,
        error: [
          `1 | // a barrel`,
          `2 | export { present } from "./bar.ts";`,
          `3 | export { renamedAway } from "./bar.ts";`,
          `             ^`,
          `SyntaxError: export 'renamedAway' not found in './bar.ts'`,
          `      at <dir>/index.ts:3:10`,
        ],
        underIsolate: "links",
      },
      {
        statement: "a stale `export { x } from` that the namespace reaches through `export *`",
        args: ["./x.mjs"],
        files: throughStar,
        error: staleExport,
      },
      {
        statement: "the same when the module that has the statement is the entry point",
        args: ["./mid.mjs"],
        files: throughStar,
        error: staleExport,
      },
    ];
    it.each(statements)("$statement", async ({ files, error, args = ["./index.ts"], env = bunEnv }) => {
      expect(await run(files, args, env)).toEqual({
        stdout: "",
        stderr: [...error, ``, `Bun v<bun-version>`].join("\n"),
        exitCode: 1,
      });
    });

    // `bun test --isolate` makes the record of a module from what the transpiler knows of it. JavaScriptCore parses
    // nothing. The text of `bun -e` is no module that a test file can import.
    it.each(statements.filter(({ args }) => args?.[0] !== "-e"))(
      "under bun test --isolate: $statement",
      async ({ files, error, args = ["./index.ts"], env = bunEnv, underIsolate }) => {
        const test = { "isolate.test.ts": `import ${JSON.stringify(args[0])};\ntest("is never run", () => {});\n` };
        const { stderr, exitCode } = await run({ ...files, ...test }, ["test", "--isolate", "./isolate.test.ts"], env);
        expect({ unhandled: unhandled(stderr), exitCode }).toEqual(
          {
            links: { unhandled: undefined, exitCode: 0 },
            bare: { unhandled: error.at(-2), exitCode: 1 },
            located: { unhandled: error.join("\n"), exitCode: 1 },
          }[underIsolate ?? "located"],
        );
      },
    );
  });

  const located = {
    stack: `${notFound}\n    at <dir>/index.ts:7:10`,
    line: 7,
    column: 10,
    sourceURL: "<dir>/index.ts",
  };
  const location = `error => ({ stack: error.stack, line: error.line, column: error.column, sourceURL: error.sourceURL })`;

  it.each([
    { first: "stack", order: ["stack", "line", "column", "sourceURL"] },
    { first: "line", order: ["line", "column", "sourceURL", "stack"] },
  ])("a caught import() has the location when .$first is read first", async ({ order }) => {
    const files = {
      ...basic,
      "caught.mjs": `
        const error = await import("./index.ts").catch(error => error);
        const read = {};
        for (const property of process.argv.slice(2)) read[property] = error[property];
        console.log(JSON.stringify({ stack: read.stack, line: read.line, column: read.column, sourceURL: read.sourceURL }));
      `,
    };
    expect(await runJSON(files, ["caught.mjs", ...order])).toEqual({ printed: located, stderr: "", exitCode: 0 });
  });

  it("Error.captureStackTrace() before the first read leaves the location as it is", async () => {
    const files = {
      ...basic,
      // The frames that it captures are those of any SyntaxError.
      "capture.mjs": `
        const error = await import("./index.ts").catch(error => error);
        const [frames, framesOfAnySyntaxError] = [error, new SyntaxError("any")].map(error => {
          Error.captureStackTrace(error);
          return error.stack.split("\\n").slice(1);
        });
        console.log(JSON.stringify({
          header: error.stack.split("\\n")[0],
          framesAreThoseOfAnySyntaxError: frames.length > 0 && frames.join() === framesOfAnySyntaxError.join(),
          line: error.line,
          column: error.column,
          sourceURL: error.sourceURL,
        }));
      `,
    };
    expect(await runJSON(files, ["capture.mjs"])).toEqual({
      printed: {
        header: notFound,
        framesAreThoseOfAnySyntaxError: true,
        line: 7,
        column: 10,
        sourceURL: "<dir>/index.ts",
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // With no frame left to read in the stack, the error is printed from its line and column. Line 7 of what the
  // transpiler emits for this file is another statement, and these are not a position in that text.
  it("an error whose stack was replaced is printed at the statement", async () => {
    const files = {
      ...dep,
      "index.ts": importer(
        `import { a } from "./dep.ts";`,
        `const one = 1;`,
        `const two = 2;`,
        `const three = 3;`,
        `const four = 4;`,
        `const five = 5;`,
        `const six = 6;`,
        `console.log(a, one, two, three, four, five, six);`,
      ),
      "replaced.mjs": `
        const error = await import("./index.ts").catch(error => error);
        error.stack = "replaced";
        console.error(error);
      `,
    };
    expect(await run(files, ["replaced.mjs"])).toEqual({
      stdout: "",
      stderr: [
        ...above,
        `7 | import { a } from "./dep.ts";`,
        `             ^`,
        notFound,
        `      at <dir>/index.ts:7:10`,
      ].join("\n"),
      exitCode: 0,
    });
  });

  it("a second import() of the module rejects with the same location", async () => {
    const files = {
      ...basic,
      "again.ts": `import "./index.ts";\n`,
      "twice.mjs": `
        const first = await import("./index.ts").catch(error => error);
        const second = await import("./index.ts").catch(error => error);
        const throughAnother = await import("./again.ts").catch(error => error);
        const location = ${location};
        console.log(JSON.stringify({
          secondIsFirst: second === first,
          second: location(second),
          throughAnotherIsFirst: throughAnother === first,
          throughAnother: location(throughAnother),
        }));
      `,
    };
    expect(await runJSON(files, ["twice.mjs"])).toEqual({
      printed: { secondIsFirst: true, second: located, throughAnotherIsFirst: false, throughAnother: located },
      stderr: "",
      exitCode: 0,
    });
  });

  // A module that does not link is linked again, as the text that was read the first time, when a module that was not
  // loaded before imports it. The statement is looked for in the file as it is then, as far as the statement.
  it("a link that fails again after the file changed has the place of the statement in the file as it is, or none", async () => {
    const at = (line: number, column: number) => ({
      stack: `${notFound}\n    at <dir>/index.ts:${line}:${column}`,
      line,
      column,
      sourceURL: "<dir>/index.ts",
    });
    const changes: { change: string; text: string | null; location?: ReturnType<typeof at> }[] = [
      {
        change: "the statement moved down",
        text: importer(`// One more line.`, `// And another.`, `import { a } from "./dep.ts";`, `console.log(a);`),
        location: at(9, 10),
      },
      {
        // The statement is the one that binds the name. What it imports under the name is not compared.
        change: "the name is now what another import is renamed to",
        text: importer(`import { z, b as a } from "./dep.ts";`, `console.log(a, z);`),
        location: at(7, 13),
      },
      {
        change: "a syntax error under the statement",
        text: importer(`import { a } from "./dep.ts";`, `console.log(a;`),
        location: at(7, 10),
      },
      {
        change: "a syntax error above the statement",
        text: importer(`const = ;`, `import { a } from "./dep.ts";`, `console.log(a);`),
      },
      { change: "the name is bound by no import", text: importer(`import { a as c } from "./dep.ts";`) },
      { change: "the file is empty", text: `` },
      { change: "the file is deleted", text: null },
    ];
    const files = {
      ...basic,
      ...Object.fromEntries(changes.map((_, i) => [`root-${i}.ts`, `import "./index.ts";\n`])),
      "changes.json": JSON.stringify(changes.map(({ change, text }) => ({ change, text }))),
      "changed.mjs": `
        import { rmSync, writeFileSync } from "node:fs";
        import changes from "./changes.json";
        const first = await import("./index.ts").catch(error => error);
        const location = ${location};
        const printed = [];
        for (const [i, { change, text }] of changes.entries()) {
          if (text === null) rmSync("index.ts");
          else writeFileSync("index.ts", text);
          const error = await import("./root-" + i + ".ts").catch(error => error);
          printed.push({ change, isAnotherError: error !== first, message: error.message, ...location(error) });
        }
        console.log(JSON.stringify({ first: location(first), changed: printed }));
      `,
    };
    expect(await runJSON(files, ["changed.mjs"])).toEqual({
      printed: {
        first: located,
        changed: changes.map(({ change, location }) => ({ change, isAnotherError: true, message, ...location })),
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // No more than the first mebibyte of a module is parsed for the statement: a link that fails does not build the
  // syntax tree of a bundle.
  it("looks for the statement in the first mebibyte of the module", async () => {
    const limit = 1024 * 1024;
    const comment = (bytes: number) => `/*${Buffer.alloc(bytes - 4, "*").toString()}*/`;
    const statement = `import { a } from "./dep.ts";`;
    // What the mebibyte cuts short is no statement of the module. Without the rest, `export { x }` would export the
    // import in front of it.
    const imports = `import { x } from "./has-x.ts";\nconsole.log(x);\n`;
    const rest = `\nfrom "./lacks-x.ts";\n`;
    const files = {
      ...dep,
      "has-x.ts": `export const x = 1;\n`,
      "lacks-x.ts": `export const y = 2;\n`,
      "a-mebibyte.js": comment(limit - statement.length) + statement,
      "a-byte-more.js": comment(limit + 1 - statement.length) + statement,
      "ends-after-the-clause.js": `${imports}${comment(limit - imports.length - 12)}export { x }${rest}`,
      // The é is two bytes, and the mebibyte ends between them.
      "ends-in-a-character.js": `${imports}${comment(limit - imports.length - 17)}export { x } // é${rest}`,
      "limit.mjs": `
        const location = ${location};
        const printed = {};
        for (const module of process.argv.slice(2)) {
          const error = await import("./" + module).catch(error => error);
          printed[module] = { message: error.message, ...location(error) };
        }
        console.log(JSON.stringify(printed));
      `,
    };
    const modules = ["a-mebibyte.js", "a-byte-more.js", "ends-after-the-clause.js", "ends-in-a-character.js"];
    const column = limit - statement.length + `import { a`.length;
    expect(await runJSON(files, ["limit.mjs", ...modules])).toEqual({
      printed: {
        "a-mebibyte.js": {
          message,
          stack: `${notFound}\n    at <dir>/a-mebibyte.js:1:${column}`,
          line: 1,
          column,
          sourceURL: "<dir>/a-mebibyte.js",
        },
        "a-byte-more.js": { message },
        "ends-after-the-clause.js": { message: `export 'x' not found in './lacks-x.ts'` },
        "ends-in-a-character.js": { message: `export 'x' not found in './lacks-x.ts'` },
      },
      stderr: "",
      exitCode: 0,
    });
  });

  it.each([[[]], [["--isolate"]]])(
    "bun test %j shows the location of an import that a test file fails on",
    async flags => {
      const files = {
        ...dep,
        "bad.test.ts": importer(`import { a } from "./dep.ts";`, `test("a", () => expect(a).toBe(1));`),
      };
      const { stderr, exitCode } = await run(files, ["test", ...flags, "./bad.test.ts"]);
      expect({ unhandled: unhandled(stderr), exitCode }).toEqual({
        unhandled: [
          ...above,
          `7 | import { a } from "./dep.ts";`,
          `             ^`,
          notFound,
          `      at <dir>/bad.test.ts:7:10`,
        ].join("\n"),
        exitCode: 1,
      });
    },
  );

  // The statement is not looked for in these cases, and the error is what it was before any was: by design, the tests
  // of this block also pass without the change that the tests above are for.
  describe("is left as it is", () => {
    const modules: { module: string; args: string[]; files: Files; error: string; env?: typeof bunEnv }[] = [
      {
        // The statement is not in the source.
        module: "when the transpiler adds the import, as it does for the JSX runtime",
        args: ["./index.tsx"],
        env: jsxEnv,
        files: { ...react(), "index.tsx": importer(`console.log(<div />);`) },
        error: `SyntaxError: Export named 'jsxDEV' not found in module '<dir>/node_modules/react/jsx-dev-runtime.js'.`,
      },
      {
        module: "when the file is of another type and is imported as JavaScript",
        args: ["-e", `await import("./index.txt", { with: { type: "js" } });`],
        files: { ...dep, "index.txt": `import { a } from "./dep.ts";\nconsole.log(a);\n` },
        error: notFound,
      },
      {
        // The text is not the text of the file, which has this import on line 7.
        module: "when a plugin gives the text of the file",
        args: ["plugin.mjs"],
        files: {
          ...basic,
          "plugin.mjs": [
            `Bun.plugin({`,
            `  name: "another text",`,
            `  setup(build) {`,
            `    const contents = 'import { a } from "./dep.ts"; console.log(a);';`,
            `    build.onLoad({ filter: /index\\.ts$/ }, () => ({ contents, loader: "ts" }));`,
            `  },`,
            `});`,
            `await import("./index.ts");`,
          ].join("\n"),
        },
        error: notFound,
      },
      {
        // A position in a bundle is not a position in a source that somebody wrote.
        module: "when the file is already bundled",
        args: ["./bundled.js"],
        files: { ...dep, "bundled.js": `// @bun\nimport { a } from "./dep.ts";\nconsole.log(a);\n` },
        error: notFound,
      },
    ];
    it.each(modules)("$module", async ({ files, args, error, env = bunEnv }) => {
      expect(await run(files, args, env)).toEqual({
        stdout: "",
        stderr: [error, ``, `Bun v<bun-version>`].join("\n"),
        exitCode: 1,
      });
    });

    // The text of a node:vm module is not the text of the file that its identifier names, which has this import on
    // line 7. The error has the frames of the link() that JavaScript called.
    it("when the module is a node:vm module", async () => {
      const files = {
        ...basic,
        "vm.mjs": `
          import vm from "node:vm";
          const dep = new vm.SourceTextModule("export const b = 1;", { identifier: "vm:dep" });
          const importer = new vm.SourceTextModule("import { a } from 'dep'; a;", { identifier: import.meta.dirname + "/index.ts" });
          const error = await importer.link(() => dep).catch(error => error);
          console.log(JSON.stringify({ message: error.message, sourceURL: error.sourceURL }));
        `,
      };
      expect(await runJSON(files, ["vm.mjs"])).toEqual({
        printed: { message: `Export named 'a' not found in module 'vm:dep'.`, sourceURL: "node:vm" },
        stderr: "",
        exitCode: 0,
      });
    });

    // The link runs under the require(): the error has the frames of that code, and Error.prepareStackTrace gets them.
    it("when CommonJS requires the module", async () => {
      const files = {
        ...basic,
        "require.cjs": `
          const calls = [];
          Error.prepareStackTrace = (error, callSites) => {
            calls.push(callSites.map(callSite => callSite.getFileName()).at(-1));
            return "prepared";
          };
          let error;
          try {
            require("./index.ts");
          } catch (thrown) {
            error = thrown;
          }
          console.log(JSON.stringify({ name: error.name, message: error.message, stack: [error.stack, error.stack], calls }));
        `,
      };
      expect(await runJSON(files, ["require.cjs"])).toEqual({
        printed: {
          name: "SyntaxError",
          message,
          stack: ["prepared", "prepared"],
          calls: ["<dir>/require.cjs"],
        },
        stderr: "",
        exitCode: 0,
      });
    });

    // expect() waits for the import() under the frame of the test, so the error has that frame.
    it("when a test waits for the import() in expect().rejects", async () => {
      const files = {
        ...basic,
        "rejects.test.ts": [
          `import { expect, test } from "bun:test";`,
          `test("rejects", async () => {`,
          `  await expect(import("./index.ts")).rejects.toThrow("Export named 'a' not found in module");`,
          `  const error = await import("./index.ts").catch(error => error);`,
          `  console.log(JSON.stringify({ message: error.message, line: error.line, column: error.column, sourceURL: error.sourceURL }));`,
          `});`,
          ``,
        ].join("\n"),
      };
      // The first line that `bun test` prints is its own.
      const { stdout, exitCode } = await run(files, ["test", "./rejects.test.ts"]);
      const printed = JSON.parse(stdout.split("\n").find(line => line.startsWith("{")) ?? "null");
      expect({ printed, exitCode }).toEqual({
        printed: {
          message,
          line: 3,
          column: 46,
          sourceURL: "<dir>/rejects.test.ts",
        },
        exitCode: 0,
      });
    });
  });
});

// Bun.resolve() allocates its rejected promise while the exception the resolve
// threw is still pending on the VM. That allocation is a GC safepoint, and the
// concurrent collector's end phase materializes the stack of every live Error
// whose frames died, through the onComputeErrorInfo hook. The hook used to
// clear whatever exception was pending, so the rejection then found nothing:
// `panic: A JavaScript exception was thrown, but it was cleared before it could be read.`
//
// Each call comes from a fresh closure and the reasons are kept in a ring, so
// every collection has live Errors with a dead top frame to materialize. The
// calls have to be awaited one at a time (64 per tick never fires), and
// collectContinuously keeps an end phase always imminent. The unfixed debug
// build panics after 2500 to 8500 iterations. Not concurrent with the tests
// above: a busy machine starves the collector and hides the race.
//
// Skipped on Windows: collectContinuously is several times slower under
// Windows + ASAN in CI, and the fixed C++ path is not platform-specific.
it.skipIf(isWindows)(
  "Bun.resolve() rejection survives a GC stack-trace finalizer",
  async () => {
    using dir = tempDir("bun-resolve-rejection-gc", {
      "fixture.mjs": `
        const keep = [];
        let rejections = 0;
        for (let i = 0; i < 20000; i++) {
          const call = () => Bun.resolve();
          await call().catch(e => {
            rejections++;
            keep.push(e);
            if (keep.length > 1024) keep.shift();
          });
        }
        console.log("ok rejections=" + rejections);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.mjs"],
      env: { ...bunEnv, BUN_JSC_collectContinuously: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "ok rejections=20000", exitCode: 0 });
    void stderr;
  },
  // 20000 awaited rejections under collectContinuously on a debug+ASAN build
  // take well over the default 5s.
  120_000,
);

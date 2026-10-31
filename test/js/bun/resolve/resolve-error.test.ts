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
// None of that module's code is running then, so the error has no frame of its own to say where the statement is. It
// is given one: the file of the statement, at the line and column that the specifier has in the file as it was written.
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
  const notFound = `SyntaxError: Export named 'a' not found in module '<dir>/dep.ts'.`;
  const basic = { ...dep, "index.ts": importer(`import { a } from "./dep.ts";`, `console.log(a);`) };

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

  describe("names the statement in the uncaught error of the entry point", () => {
    const statements: { statement: string; files: Files; error: string[]; args?: string[]; env?: typeof bunEnv }[] = [
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
        statement: "an import in a directory that has parentheses in its name",
        args: ["with (parentheses)/index.ts"],
        files: {
          ...dep,
          "with (parentheses)/dep.ts": `export const b = 1;\n`,
          "with (parentheses)/index.ts": importer(`import { a } from "./dep.ts";`, `console.log(a);`),
        },
        error: [
          ...above,
          `7 | import { a } from "./dep.ts";`,
          `             ^`,
          `SyntaxError: Export named 'a' not found in module '<dir>/with (parentheses)/dep.ts'.`,
          `      at <dir>/with (parentheses)/index.ts:7:10`,
        ],
      },
      {
        statement: "an import in a file that has JSX",
        args: ["index.tsx"],
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
        args: ["index.js"],
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
    ];
    it.each(statements)("$statement", async ({ files, error, args = ["index.ts"], env = bunEnv }) => {
      expect(await run(files, args, env)).toEqual({
        stdout: "",
        stderr: [...error, ``, `Bun v<bun-version>`].join("\n"),
        exitCode: 1,
      });
    });
  });

  describe("names the module alone when the statement is not in the source", () => {
    const importers: { importer: string; args: string[]; files: Files; error: string[]; env?: typeof bunEnv }[] = [
      {
        importer: "the import of the JSX runtime, which the transpiler adds",
        args: ["index.tsx"],
        env: jsxEnv,
        files: { ...react(), "index.tsx": importer(`console.log(<div />);`) },
        error: [
          `SyntaxError: Export named 'jsxDEV' not found in module '<dir>/node_modules/react/jsx-dev-runtime.js'.`,
          `      at <dir>/index.tsx`,
        ],
      },
      {
        importer: "the same in a directory that has parentheses in its name",
        args: ["with (parentheses)/index.tsx"],
        env: jsxEnv,
        files: { ...react(), "with (parentheses)/index.tsx": importer(`console.log(<div />);`) },
        error: [
          `SyntaxError: Export named 'jsxDEV' not found in module '<dir>/node_modules/react/jsx-dev-runtime.js'.`,
          `      at <dir>/with (parentheses)/index.tsx`,
        ],
      },
      {
        importer: "a file of another type that is imported as JavaScript",
        args: ["-e", `await import("./index.txt", { with: { type: "js" } });`],
        files: { ...dep, "index.txt": `import { a } from "./dep.ts";\nconsole.log(a);\n` },
        error: [notFound, `      at <dir>/index.txt`],
      },
      {
        // The text is not the text of the file, which has this import on line 7.
        importer: "a file whose text a plugin gives",
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
        error: [notFound, `      at <dir>/index.ts`],
      },
      {
        // Its text is not the text of the file that its identifier names, which has this import on line 7.
        importer: "a node:vm module",
        args: ["vm.mjs"],
        files: {
          ...basic,
          "vm.mjs": [
            `import vm from "node:vm";`,
            `const dep = new vm.SourceTextModule("export const b = 1;", { identifier: "vm:dep" });`,
            `const importer = new vm.SourceTextModule("import { a } from 'dep'; a;", { identifier: import.meta.dirname + "/index.ts" });`,
            `await importer.link(() => dep);`,
          ].join("\n"),
        },
        error: [`SyntaxError: Export named 'a' not found in module 'vm:dep'.`, `      at <dir>/index.ts`],
      },
      {
        importer: "a node:vm module whose identifier has parentheses",
        args: ["vm.mjs"],
        files: {
          "vm.mjs": [
            `import vm from "node:vm";`,
            `const dep = new vm.SourceTextModule("export const b = 1;", { identifier: "vm:dep" });`,
            `const importer = new vm.SourceTextModule("import { a } from 'dep'; a;");`,
            `await importer.link(() => dep);`,
          ].join("\n"),
        },
        error: [`SyntaxError: Export named 'a' not found in module 'vm:dep'.`, `      at vm:module(0)`],
      },
      {
        // A frame with no line is not looked up in a source map, where it would be taken for the first line.
        importer: "a file of no type that Bun knows, whose source map has a mapping for its first line",
        args: ["./bundle.out"],
        files: {
          "dep.mjs": `export const b = 1;\n`,
          "bundle.out": [
            `// @bun`,
            `import { a } from "./dep.mjs";`,
            `console.log(a);`,
            `//# sourceMappingURL=data:application/json;base64,${Buffer.from(
              JSON.stringify({
                version: 3,
                sources: ["original.ts"],
                sourcesContent: ["the first line of the original\n"],
                mappings: "AAAA",
                names: [],
              }),
            ).toString("base64")}`,
            ``,
          ].join("\n"),
        },
        error: [`SyntaxError: Export named 'a' not found in module '<dir>/dep.mjs'.`, `      at <dir>/bundle.out`],
      },
    ];
    it.each(importers)("$importer", async ({ files, args, error, env = bunEnv }) => {
      expect(await run(files, args, env)).toEqual({
        stdout: "",
        stderr: [...error, ``, `Bun v<bun-version>`].join("\n"),
        exitCode: 1,
      });
    });
  });

  const located = {
    stack: `${notFound}\n    at <dir>/index.ts:7:10`,
    line: 7,
    column: 10,
    sourceURL: "<dir>/index.ts",
  };

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
      // A SyntaxError's frames start with one for the parser, which has no position here, as for any SyntaxError.
      "capture.mjs": `
        const error = await import("./index.ts").catch(error => error);
        const [frames, framesOfAnySyntaxError] = [error, new SyntaxError("any")].map(error => {
          Error.captureStackTrace(error);
          return error.stack.split("\\n").slice(1);
        });
        console.log(JSON.stringify({
          header: error.stack.split("\\n")[0],
          parserFrame: frames[0],
          framesAreThoseOfAnySyntaxError: frames.join() === framesOfAnySyntaxError.join(),
          line: error.line,
          column: error.column,
          sourceURL: error.sourceURL,
        }));
      `,
    };
    expect(await runJSON(files, ["capture.mjs"])).toEqual({
      printed: {
        header: notFound,
        parserFrame: "    at <parse> (:0)",
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
        const location = error => ({ stack: error.stack, line: error.line, column: error.column, sourceURL: error.sourceURL });
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

  it("a caught require() of the module has the import first and then the frames of the require()", async () => {
    const files = {
      ...basic,
      "throws.ts": `export const value = 1;\nthrow new Error("thrown while it runs");\n`,
      // A debug build of Bun has more frames of its own require() than a release build. An error that a module
      // throws as it runs has the same ones under the frame of the module.
      "require.cjs": `
        const [error, thrown] = ["./index.ts", "./throws.ts"].map(specifier => {
          try {
            require(specifier);
          } catch (error) {
            return error;
          }
        });
        const [frames, framesOfThrown] = [error, thrown].map(error => error.stack.split("\\n").slice(2));
        console.log(JSON.stringify({
          stack: error.stack.split("\\n").slice(0, 2).join("\\n"),
          framesOfRequireFollow: frames.length > 0 && frames.join() === framesOfThrown.join(),
          line: error.line,
          column: error.column,
          sourceURL: error.sourceURL,
        }));
      `,
    };
    expect(await runJSON(files, ["require.cjs"])).toEqual({
      printed: { ...located, framesOfRequireFollow: true },
      stderr: "",
      exitCode: 0,
    });
  });

  it("an uncaught require() of the module prints the import and then where the require() is", async () => {
    const { stdout, stderr, exitCode } = await run({ ...basic, "require.cjs": `require("./index.ts");\n` }, [
      "require.cjs",
    ]);
    // Between the two are the frames of Bun's own require(), which a debug build of Bun has more of.
    const own = /^ +at (require \(|native:|unknown:)/;
    expect({ stdout, stderr: stderr.split("\n").filter(line => !own.test(line)), exitCode }).toEqual({
      stdout: "",
      stderr: [
        ...above,
        `7 | import { a } from "./dep.ts";`,
        `             ^`,
        notFound,
        `      at <dir>/index.ts:7:10`,
        `      at <dir>/require.cjs:1:1`,
        ``,
        `Bun v<bun-version>`,
      ],
      exitCode: 1,
    });
  });

  // The frames of a link error are only in its stack string, as are those of an error that structuredClone() made.
  // To print one they are read back from the string, whether or not a frame has a function name.
  it("the frames of a stack that is only a string are printed when they have no function name, or parentheses in their location", async () => {
    const files = {
      "cloned.mjs": `
        import { join } from "node:path";
        const error = new Error("cloned");
        error.stack = [
          "Error: cloned",
          "    at async " + join(import.meta.dirname, "a.js") + ":2:3",
          "    at " + join(import.meta.dirname, "with (parentheses)", "b.js") + ":4:5",
          "    at named (" + join(import.meta.dirname, "module(0).js") + ":6:7)",
          "    at other (vm:module(0):8:9)",
        ].join("\\n");
        console.log(JSON.stringify(Bun.inspect(structuredClone(error)).split("\\n")));
      `,
    };
    expect(await runJSON(files, ["cloned.mjs"])).toEqual({
      printed: [
        `error: cloned`,
        `      at <dir>/a.js:2:3`,
        `      at <dir>/with (parentheses)/b.js:4:5`,
        `      at named (<dir>/module(0).js:6:7)`,
        `      at other (vm:module(0):8:9)`,
        ``,
      ],
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
      expect({ unhandled: /# Unhandled error between tests\n-+\n([^]*?)\n-+\n/.exec(stderr)?.[1], exitCode }).toEqual({
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

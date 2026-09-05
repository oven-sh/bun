import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

describe("ResolveMessage", () => {
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

// A resolve error logged while a module is being transpiled belongs to the
// module being transpiled, so that module is the ResolveMessage's referrer. It
// used to be whatever the module loader passed as the fetch's referrer: the
// literal string "undefined" for import(), and the requiring file for require().
//
// Two things log resolve errors at transpile time: a macro import that does not
// resolve (always accompanied by a second, build-level message, so the load
// rejects with an AggregateError), and a static import of an unknown node:
// builtin in a module transpiled on the JS thread, such as a require()d one
// (a single message, so the load rejects with the ResolveMessage itself).
describe.concurrent("ResolveMessage.referrer for resolve errors raised during transpile", () => {
  const macroSource = `import { nope } from "./does-not-exist" with { type: "macro" };\nexport const x = nope();\n`;
  const nodeBuiltinSource = `import "node:this_builtin_does_not_exist";\nexport const x = 1;\n`;

  function makeDir() {
    return tempDir("resolve-error-transpile-referrer", {
      "import-me.ts": macroSource,
      "require-me.ts": macroSource,
      "require-me-node-builtin.ts": nodeBuiltinSource,
      "fixture.ts": `
        Bun.plugin({
          name: "virtual modules with an unresolvable macro import",
          setup(build) {
            for (const name of ["virt:import-me", "virt:require-me"]) {
              build.module(name, () => ({ contents: ${JSON.stringify(macroSource)}, loader: "ts" }));
            }
          },
        });

        function resolveMessages(error) {
          return (error.errors ?? [error])
            .filter(e => e.name === "ResolveMessage")
            .map(e => ({ specifier: e.specifier, referrer: e.referrer, file: e.position?.file }));
        }

        const out = {
          importMe: Bun.resolveSync("./import-me.ts", import.meta.dir),
          requireMe: Bun.resolveSync("./require-me.ts", import.meta.dir),
          requireMeNodeBuiltin: Bun.resolveSync("./require-me-node-builtin.ts", import.meta.dir),
        };
        const loads = {
          import: () => import("./import-me.ts"),
          require: () => require("./require-me.ts"),
          importVirtual: () => import("virt:import-me"),
          requireVirtual: () => require("virt:require-me"),
          requireNodeBuiltin: () => require("./require-me-node-builtin.ts"),
        };
        for (const [name, load] of Object.entries(loads)) {
          try {
            await load();
            out[name] = "loaded";
          } catch (error) {
            out[name] = resolveMessages(error);
          }
        }
        console.log(JSON.stringify(out));
      `,
    });
  }

  async function run(dir: string, env: Record<string, string | undefined>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts"],
      env,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { importMe, requireMe, requireMeNodeBuiltin, ...results } = JSON.parse(stdout);
    expect(results).toEqual({
      import: [{ specifier: "./does-not-exist", referrer: importMe, file: importMe }],
      require: [{ specifier: "./does-not-exist", referrer: requireMe, file: requireMe }],
      importVirtual: [{ specifier: "./does-not-exist", referrer: "virt:import-me", file: "virt:import-me" }],
      requireVirtual: [{ specifier: "./does-not-exist", referrer: "virt:require-me", file: "virt:require-me" }],
      requireNodeBuiltin: [
        {
          specifier: "node:this_builtin_does_not_exist",
          referrer: requireMeNodeBuiltin,
          file: requireMeNodeBuiltin,
        },
      ],
    });
    expect(exitCode).toBe(0);
  }

  it("import(), require() and plugin virtual modules", async () => {
    using dir = makeDir();
    await run(String(dir), bunEnv);
  });

  // import() normally transpiles on the concurrent transpiler; this covers the
  // same-thread transpile path import() takes when that is disabled.
  it("with the concurrent transpiler disabled", async () => {
    using dir = makeDir();
    await run(String(dir), { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" });
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

import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync } from "node:fs";
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

// load_as_file copies the full path into a fixed PathBuffer and then probes
// extensions by appending to that buffer. When the specifier's dirname names
// a real directory (so read_directory succeeds), a basename long enough to
// push the total path to MAX_PATH_BYTES used to abort the process instead of
// returning MODULE_NOT_FOUND. The directory cases at the end cover the index
// probe that runs after load_as_file gives up.
describe.concurrent("absolute specifier at the PathBuffer boundary", () => {
  // Mirrors MAX_PATH_BYTES in src/bun_core/util.rs: 4096 on linux/android,
  // PATH_MAX_WIDE * 3 + 1 on windows, 1024 everywhere else (darwin, the BSDs).
  const max =
    process.platform === "linux" || process.platform === "android"
      ? 4096
      : process.platform === "win32"
        ? 32767 * 3 + 1
        : 1024;
  const root = process.platform === "win32" ? "C:/" : "/";

  async function expectNotFound(specExpr: string, how: "require.resolve" | "import" | "Bun.resolveSync") {
    const body =
      how === "require.resolve"
        ? `require.resolve(p)`
        : how === "import"
          ? `await import(p)`
          : `Bun.resolveSync(p, process.cwd())`;
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const p = ${specExpr}; try { ${body} } catch (e) { console.log("ERR", e.code ?? e.name) }`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: expect.stringMatching(/^ERR (MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|ResolveMessage)$/),
      stderr: "",
      exitCode: 0,
    });
  }

  // Well past MAX_PATH_BYTES: the raw copy into bufs!(load_as_file) panicked.
  for (const how of ["require.resolve", "import", "Bun.resolveSync"] as const) {
    it(`${how}: path > MAX_PATH_BYTES`, async () => {
      await expectNotFound(`${JSON.stringify(root)} + Buffer.alloc(${max + 1000}, "a").toString() + ".ts"`, how);
    });
  }

  // Just under MAX_PATH_BYTES so the copy fits, but appending the longest
  // probed extension (".json", 5 bytes) pushes past it: load_extension
  // panicked slicing `[0..path.len() + ext.len()]`.
  it("require.resolve: path + probed extension > MAX_PATH_BYTES", async () => {
    const pathLen = max - 4;
    await expectNotFound(
      `${JSON.stringify(root)} + Buffer.alloc(${pathLen - root.length - 3}, "a").toString() + ".ts"`,
      "require.resolve",
    );
  });

  // Exactly MAX_PATH_BYTES with a .js specifier: the bare copy fits and every
  // load_extension probe is rejected, but the .js -> .tsx rewrite grows the
  // path by one byte. Only the `>=` (not `>`) in load_as_file stops it.
  it("require.resolve: .js path == MAX_PATH_BYTES", async () => {
    await expectNotFound(
      `${JSON.stringify(root)} + Buffer.alloc(${max - root.length - 3}, "a").toString() + ".js"`,
      "require.resolve",
    );
  });

  // Byte length governs, not char length.
  it("require.resolve: multibyte basename past MAX_PATH_BYTES", async () => {
    const chars = Math.ceil((max + 100) / 3);
    await expectNotFound(
      `${JSON.stringify(root)} + Buffer.alloc(${chars * 3}, "\\u20ac", "utf8").toString() + ".ts"`,
      "require.resolve",
    );
  });

  // Creates a real directory under `root` whose absolute path is exactly
  // `byteLength` bytes and returns its path.
  function mkLongDir(root: string, byteLength: number): string {
    let p = root;
    for (;;) {
      const remaining = byteLength - Buffer.byteLength(p);
      if (remaining === 0) break;
      // Each step appends "/" + segment. NAME_MAX is 255 on linux and darwin.
      // Never leave exactly one byte, which would force an empty final
      // segment and a trailing slash.
      let segLen = Math.min(200, remaining - 1);
      if (remaining - 1 - segLen === 1) segLen -= 1;
      p += "/" + Buffer.alloc(segLen, "x").toString();
    }
    expect(Buffer.byteLength(p)).toBe(byteLength);
    expect(p.endsWith("/")).toBe(false);
    mkdirSync(p, { recursive: true });
    return p;
  }

  // The directory cases below need a directory that really exists at the
  // boundary. On Windows MAX_PATH_BYTES is far past what the filesystem
  // allows, so such a directory cannot be created there.

  // A directory at MAX_PATH_BYTES - 1 (the longest path the OS allows) gets
  // past load_as_file and dir_info_cached, then
  // load_as_index_with_browser_remapping appended SEP and a NUL to it in a
  // PathBuffer, writing one byte past the end.
  it.skipIf(isWindows)("import: real directory at MAX_PATH_BYTES - 1", async () => {
    using dir = tempDir("resolve-long-dir", {});
    const p = mkLongDir(String(dir), max - 1);
    await expectNotFound(JSON.stringify(p), "import");
  });

  // With target browser and an enclosing package.json "browser" map, the same
  // function joins the directory with "index" into another PathBuffer. A
  // directory a few bytes under MAX_PATH_BYTES overflowed that join.
  it.skipIf(isWindows)("Bun.build target browser: real directory at MAX_PATH_BYTES - 2", async () => {
    using dir = tempDir("resolve-long-dir-browser", {
      "package.json": JSON.stringify({ name: "p", browser: { "./unrelated.js": "./other.js" } }),
    });
    const p = mkLongDir(String(dir), max - 2);
    await Bun.write(path.join(String(dir), "entry.js"), `import ${JSON.stringify(p)};`);
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const r = await Bun.build({ entrypoints: ["./entry.js"], target: "browser", throw: false });
         console.log(r.success, r.logs.map(l => l.name).join(","));`,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
      stdout: "false ResolveMessage",
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

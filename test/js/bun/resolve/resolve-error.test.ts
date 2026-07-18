import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import { createRequire } from "node:module";

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

  // resolve_maybe_needs_trailing_slash's ENAMETOOLONG guard (at MAX_PATH_BYTES * 1.5)
  // used to build a ResolveMessage without .resolve metadata, so one byte over
  // the threshold dropped .code/.specifier/.importKind entirely.
  const threshold = isWindows ? 147453 : isMacOS ? 1536 : 6144;
  // 200000 > u16::MAX exercises the BabyString length clamp. On Windows the
  // at-threshold case would push 147 KB through the full resolver (untested
  // territory), so only run it where the at-threshold length is small.
  const longSpecifierLengths = isWindows ? [threshold + 1, 200000] : [threshold, threshold + 1, 200000];
  it.each(longSpecifierLengths)("has code/specifier/importKind for long specifier (len=%d)", async len => {
    const cjsRequire = createRequire(import.meta.url);
    const builtin = "node:x" + Buffer.alloc(len - 6, "a").toString();
    // .specifier is stored as a BabyString (u16 len) so very long specifiers
    // are clamped; assert it is a non-empty prefix rather than exact equality.
    const expectSpecifier = (got: string, full: string) => {
      expect(got.length).toBeGreaterThan(0);
      expect(full.startsWith(got)).toBe(true);
      if (len <= 0xffff) expect(got).toBe(full);
    };

    let e: any;
    try {
      cjsRequire(builtin);
      expect.unreachable();
    } catch (err) {
      e = err;
    }
    expect({ code: e.code, importKind: e.importKind }).toEqual({
      code: "ERR_UNKNOWN_BUILTIN_MODULE",
      importKind: "require-call",
    });
    expectSpecifier(e.specifier, builtin);

    try {
      await import(builtin);
      expect.unreachable();
    } catch (err) {
      e = err;
    }
    expect({ code: e.code, importKind: e.importKind }).toEqual({
      code: "ERR_UNKNOWN_BUILTIN_MODULE",
      importKind: "import-statement",
    });
    expectSpecifier(e.specifier, builtin);

    // The relative case is only exercised above the threshold; at the threshold
    // it would go through the real resolver with a near-PATH_MAX path.
    if (len > threshold) {
      const relative = "./x" + Buffer.alloc(len - 3, "a").toString();
      try {
        cjsRequire(relative);
        expect.unreachable();
      } catch (err) {
        e = err;
      }
      expect({ code: e.code, importKind: e.importKind }).toEqual({
        code: "MODULE_NOT_FOUND",
        importKind: "require-call",
      });
      expectSpecifier(e.specifier, relative);
    }

    // Bun.resolveSync uses IS_A_FILE_PATH=false, so the length guard never
    // fires and the specifier reaches the post-_resolve fallback at any length.
    try {
      Bun.resolveSync(builtin, import.meta.dir);
      expect.unreachable();
    } catch (err) {
      e = err;
    }
    expect({ code: e.code, importKind: e.importKind }).toEqual({
      code: "ERR_UNKNOWN_BUILTIN_MODULE",
      importKind: "import-statement",
    });
    expectSpecifier(e.specifier, builtin);
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
    }).toThrow("Cannot find module");
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

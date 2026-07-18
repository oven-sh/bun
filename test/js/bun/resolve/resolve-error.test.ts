import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

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

// Node.js refuses to load any module whose format must be determined by an
// invalid package.json (malformed JSON, non-object root, or non-string "type"),
// throwing ERR_INVALID_PACKAGE_CONFIG. Bun previously swallowed the parse
// error and silently fell through to content-sniffing or the parent scope.
describe.concurrent("ERR_INVALID_PACKAGE_CONFIG", () => {
  // A 0-byte package.json is NOT in this matrix: Bun intentionally treats
  // empty JSONC input as `{}` (see test/js/bun/resolve/jsonc.test.ts), so an
  // empty package.json is a valid empty scope rather than an error.
  const invalidCases = [
    ["malformed JSON", "{\n"],
    ["non-object root", "42"],
    ["non-string type", `{"name":"p","type":42}`],
  ] as const;

  function makeDir(pkgJson: string, extra: Record<string, string> = {}) {
    return tempDir("invalid-pkg-config", {
      "package.json": `{"name":"root"}`,
      "pkg/package.json": pkgJson,
      "pkg/t.js": `export const x = 7;\nconsole.log("loaded");\n`,
      "p.mjs": `import * as N from "./pkg/t.js"; console.log("ns", Object.keys(N));`,
      "p.cjs": `const N = require("./pkg/t.js"); console.log("ns", Object.keys(N));`,
      "dyn.mjs": `const N = await import("./pkg/t.js"); console.log("ns", Object.keys(N));`,
      ...extra,
    });
  }

  async function run(dir: string, args: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  describe.each(invalidCases)("%s", (_name, pkgJson) => {
    it("static import throws ERR_INVALID_PACKAGE_CONFIG", async () => {
      using dir = makeDir(pkgJson);
      const { stdout, stderr, exitCode } = await run(String(dir), ["p.mjs"]);
      expect(stdout).not.toContain("loaded");
      expect(stderr).toContain("ERR_INVALID_PACKAGE_CONFIG");
      expect(stderr).toContain("Invalid package config");
      expect(stderr).toContain("package.json");
      expect(exitCode).toBe(1);
    });

    it("entrypoint throws ERR_INVALID_PACKAGE_CONFIG", async () => {
      using dir = makeDir(pkgJson);
      const { stdout, stderr, exitCode } = await run(String(dir), ["pkg/t.js"]);
      expect(stdout).not.toContain("loaded");
      expect(stderr).toContain("ERR_INVALID_PACKAGE_CONFIG");
      expect(exitCode).toBe(1);
    });

    it("require() throws ERR_INVALID_PACKAGE_CONFIG", async () => {
      using dir = makeDir(pkgJson);
      const { stdout, stderr, exitCode } = await run(String(dir), ["p.cjs"]);
      expect(stdout).not.toContain("loaded");
      expect(stderr).toContain("ERR_INVALID_PACKAGE_CONFIG");
      expect(exitCode).toBe(1);
    });

    it("dynamic import() rejects with ERR_INVALID_PACKAGE_CONFIG", async () => {
      using dir = makeDir(pkgJson);
      const { stdout, stderr, exitCode } = await run(String(dir), ["dyn.mjs"]);
      expect(stdout).not.toContain("loaded");
      expect(stderr).toContain("ERR_INVALID_PACKAGE_CONFIG");
      expect(exitCode).toBe(1);
    });

    it(".mjs under the invalid scope loads without error (format from extension)", async () => {
      using dir = makeDir(pkgJson, {
        "pkg/t.mjs": `export const x = 7;\nconsole.log("loaded");\n`,
        "p.mjs": `import * as N from "./pkg/t.mjs"; console.log("ns", Object.keys(N));`,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["p.mjs"]);
      expect(normalizeBunSnapshot(stdout, dir)).toBe('loaded\nns [ "x" ]');
      expect(stderr).not.toContain("ERR_INVALID_PACKAGE_CONFIG");
      expect(exitCode).toBe(0);
    });

    it(".cjs under the invalid scope loads without error (format from extension)", async () => {
      using dir = makeDir(pkgJson, {
        "pkg/t.cjs": `module.exports.x = 7;\nconsole.log("loaded");\n`,
        "p.cjs": `const N = require("./pkg/t.cjs"); console.log("ns", Object.keys(N));`,
      });
      const { stdout, stderr, exitCode } = await run(String(dir), ["p.cjs"]);
      expect(normalizeBunSnapshot(stdout, dir)).toBe('loaded\nns [ "x" ]');
      expect(stderr).not.toContain("ERR_INVALID_PACKAGE_CONFIG");
      expect(exitCode).toBe(0);
    });
  });

  it("error is catchable and has .code", async () => {
    using dir = makeDir("{\n", {
      "catch.mjs": `
        try {
          await import("./pkg/t.js");
          console.log("FAIL: did not throw");
        } catch (e) {
          console.log(JSON.stringify({ code: e.code, hasMessage: e.message.includes("package.json") }));
        }
      `,
    });
    const { stdout, exitCode } = await run(String(dir), ["catch.mjs"]);
    expect(JSON.parse(stdout.trim())).toEqual({ code: "ERR_INVALID_PACKAGE_CONFIG", hasMessage: true });
    expect(exitCode).toBe(0);
  });

  it("unknown string type value does NOT error (matches Node)", async () => {
    using dir = makeDir(`{"name":"p","type":"nonsense"}`);
    const { stdout, exitCode } = await run(String(dir), ["p.mjs"]);
    expect(stdout).toContain("loaded");
    expect(exitCode).toBe(0);
  });

  it("invalid package.json in a child dir poisons that scope, not the parent", async () => {
    using dir = tempDir("invalid-pkg-config-nested", {
      "package.json": `{"name":"root","type":"module"}`,
      "ok.js": `console.log("parent-ok");`,
      "sub/package.json": "{\n",
      "sub/t.js": `console.log("child");`,
    });
    // Parent scope still works.
    {
      const { stdout, exitCode } = await run(String(dir), ["ok.js"]);
      expect(stdout.trim()).toBe("parent-ok");
      expect(exitCode).toBe(0);
    }
    // Child scope fails.
    {
      const { stderr, exitCode } = await run(String(dir), ["sub/t.js"]);
      expect(stderr).toContain("ERR_INVALID_PACKAGE_CONFIG");
      expect(exitCode).toBe(1);
    }
  });

  it("valid nameless package.json between an invalid ancestor and the file is the scope boundary", async () => {
    // A nameless `{}` or `{"type":...}` package.json is still Node's package
    // scope boundary; an invalid grandparent above it must not poison files
    // below it.
    using dir = tempDir("invalid-pkg-config-mid", {
      "package.json": `{"name":"root"}`,
      "gp/package.json": "{\n",
      "gp/mid/package.json": "{}",
      "gp/mid/sub/foo.js": `console.log("ok");`,
      "gp/mid2/package.json": `{"type":"commonjs"}`,
      "gp/mid2/sub/foo.js": `console.log("ok2");`,
    });
    {
      const { stdout, stderr, exitCode } = await run(String(dir), ["gp/mid/sub/foo.js"]);
      expect(stderr).not.toContain("ERR_INVALID_PACKAGE_CONFIG");
      expect(stdout.trim()).toBe("ok");
      expect(exitCode).toBe(0);
    }
    {
      const { stdout, stderr, exitCode } = await run(String(dir), ["gp/mid2/sub/foo.js"]);
      expect(stderr).not.toContain("ERR_INVALID_PACKAGE_CONFIG");
      expect(stdout.trim()).toBe("ok2");
      expect(exitCode).toBe(0);
    }
  });
});

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

  // https://github.com/oven-sh/bun/issues/12890
  describe.concurrent("blocked lifecycle script hint", () => {
    async function run(files: Record<string, string>) {
      using dir = tempDir("resolve-blocked-lifecycle", {
        "package.json": JSON.stringify({ name: "app", version: "0.0.0" }),
        "main.js": `require("has-postinstall");`,
        ...files,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    it("points at `bun pm trust` when the enclosing package has a postinstall", async () => {
      const { stderr, exitCode } = await run({
        "node_modules/has-postinstall/package.json": JSON.stringify({
          name: "has-postinstall",
          version: "1.0.0",
          main: "index.js",
          scripts: {
            // `}` inside an earlier script value must not truncate the scan
            // before the postinstall key is seen.
            clean: "rimraf {dist,build} && echo ${CI:+done}",
            postinstall: "node scripts/recover-modules.js temp_modules node_modules",
          },
        }),
        "node_modules/has-postinstall/index.js": `module.exports = require("missing-inner-dep");`,
      });
      expect(stderr).toContain(`Cannot find package 'missing-inner-dep'`);
      expect(stderr).toContain(
        `The "postinstall" script for "has-postinstall" may have been blocked. If you trust this package, run \`bun pm trust has-postinstall\``,
      );
      expect(exitCode).toBe(1);
    });

    it("handles scoped package names", async () => {
      using dir = tempDir("resolve-blocked-lifecycle-scoped", {
        "package.json": JSON.stringify({ name: "app", version: "0.0.0" }),
        "main.js": `require("@scope/has-postinstall");`,
        "node_modules/@scope/has-postinstall/package.json": JSON.stringify({
          name: "@scope/has-postinstall",
          version: "1.0.0",
          main: "index.js",
          scripts: { postinstall: "true" },
        }),
        "node_modules/@scope/has-postinstall/index.js": `module.exports = require("missing-inner-dep");`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(`\`bun pm trust @scope/has-postinstall\``);
      expect(exitCode).toBe(1);
    });

    it("points at `bun pm trust` when the enclosing package has a binding.gyp", async () => {
      const { stderr, exitCode } = await run({
        "node_modules/has-postinstall/package.json": JSON.stringify({
          name: "has-postinstall",
          version: "1.0.0",
          main: "index.js",
        }),
        "node_modules/has-postinstall/binding.gyp": "{}",
        "node_modules/has-postinstall/index.js": `module.exports = require("./build/Release/addon.node");`,
      });
      expect(stderr).toContain(`Cannot find module './build/Release/addon.node'`);
      expect(stderr).toContain(`run \`bun pm trust has-postinstall\``);
      expect(exitCode).toBe(1);
    });

    it("does not fire for a prepare-only package (prepare is never blocked for registry deps)", async () => {
      const { stderr, exitCode } = await run({
        "node_modules/has-postinstall/package.json": JSON.stringify({
          name: "has-postinstall",
          version: "1.0.0",
          main: "index.js",
          scripts: { prepare: "husky install" },
        }),
        "node_modules/has-postinstall/index.js": `module.exports = require("missing-inner-dep");`,
      });
      expect(stderr).toContain(`Cannot find package 'missing-inner-dep'`);
      expect(stderr).not.toContain("bun pm trust");
      expect(exitCode).toBe(1);
    });

    it("does not fire when the enclosing package has no install-class script", async () => {
      const { stderr, exitCode } = await run({
        "node_modules/has-postinstall/package.json": JSON.stringify({
          name: "has-postinstall",
          version: "1.0.0",
          main: "index.js",
          scripts: { test: "jest", build: "tsc" },
          // The scan is bounded to the scripts object, so a sibling key that
          // happens to be named like a lifecycle hook must not trigger it.
          dependencies: { install: "^0.13.0" },
        }),
        "node_modules/has-postinstall/index.js": `module.exports = require("missing-inner-dep");`,
      });
      expect(stderr).toContain(`Cannot find package 'missing-inner-dep'`);
      expect(stderr).not.toContain("bun pm trust");
      expect(exitCode).toBe(1);
    });

    it('is not confused by `"scripts"` appearing as a string value', async () => {
      const { stderr, exitCode } = await run({
        "node_modules/has-postinstall/package.json": JSON.stringify({
          name: "has-postinstall",
          version: "1.0.0",
          main: "index.js",
          // `"scripts"` appears as an array element before any key of that
          // name; the scan must not treat the following `dependencies` object
          // as the scripts body.
          files: ["scripts"],
          dependencies: { install: "^0.13.0" },
        }),
        "node_modules/has-postinstall/index.js": `module.exports = require("missing-inner-dep");`,
      });
      expect(stderr).toContain(`Cannot find package 'missing-inner-dep'`);
      expect(stderr).not.toContain("bun pm trust");
      expect(exitCode).toBe(1);
    });

    it('finds the real `"scripts"` key after a `"scripts"` string value', async () => {
      const { stderr, exitCode } = await run({
        "node_modules/has-postinstall/package.json": JSON.stringify({
          name: "has-postinstall",
          version: "1.0.0",
          main: "index.js",
          files: ["scripts"],
          repository: { type: "git" },
          scripts: { postinstall: "true" },
        }),
        "node_modules/has-postinstall/index.js": `module.exports = require("missing-inner-dep");`,
      });
      expect(stderr).toContain(`The "postinstall" script for "has-postinstall" may have been blocked`);
      expect(exitCode).toBe(1);
    });

    it("does not fire when the referrer is outside node_modules", async () => {
      using dir = tempDir("resolve-blocked-lifecycle-root", {
        "package.json": JSON.stringify({
          name: "app",
          version: "0.0.0",
          scripts: { postinstall: "true" },
        }),
        "node_modules/.keep": "",
        "main.js": `require("missing-top-level-dep");`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(`Cannot find package 'missing-top-level-dep'`);
      expect(stderr).not.toContain("bun pm trust");
      expect(exitCode).toBe(1);
    });
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

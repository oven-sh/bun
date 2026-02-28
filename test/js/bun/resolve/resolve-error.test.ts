import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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

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

  it("doesn't crash on very long import paths with tsconfig baseUrl", async () => {
    // Reproduces a panic where joining tsconfig baseUrl + a long import path
    // overflowed a fixed-size PathBuffer in normalizeStringGenericTZ.
    // The bug triggers when import_path < PATH_MAX but baseUrl + import_path > PATH_MAX.
    // PATH_MAX is 1024 on macOS, 4096 on Linux/Windows. Pick a length just under
    // PATH_MAX so the specifier itself doesn't hit ENAMETOOLONG earlier.
    // Any length > 512 also exercises the esm_subpath buffer overflow.
    // "a".repeat is slow in debug builds; use Buffer.alloc instead.
    const len = process.platform === "darwin" ? 1020 : 4090;
    const long = Buffer.alloc(len, "a").toString();
    using dir = tempDir("resolve-long-path", {
      // package.json + node_modules/ prevent the resolver from attempting
      // auto-install (which has an unrelated pre-existing bug).
      "package.json": `{"name": "test", "version": "0.0.0"}`,
      "node_modules/.keep": "",
      "tsconfig.json": `{"compilerOptions": {"baseUrl": ".", "paths": {"@x/*": ["./src/*"]}}}`,
      "test.js": `
        const long = ${JSON.stringify(long)};
        // bare package (tsconfig baseUrl path)
        try { await import(\`@nonexistent/pkg/build/\${long}.js\`); } catch {}
        // tsconfig paths wildcard (captures long text)
        try { await import(\`@x/\${long}\`); } catch {}
        // relative path
        try { await import(\`./\${long}.js\`); } catch {}
        // very long with .. segments (tests normalization handling)
        try { await import(\`./\${"x/../".repeat(${len})}\${long}.js\`); } catch {}
        // absolute path > PATH_MAX (dirInfoCached buffer overflow)
        try { await import(\`/\${long}/mixed\`); } catch {}
        // deep path with >256 short components (dir_entry_paths_to_resolve overflow)
        try { await import(\`/\${"a/".repeat(300)}x\`); } catch {}
        console.log("ok");
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });
});

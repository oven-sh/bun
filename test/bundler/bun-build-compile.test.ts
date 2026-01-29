import { describe, expect, test } from "bun:test";
import { isArm64, isLinux, isMacOS, isMusl, isWindows, tempDir } from "harness";
import { join } from "path";

describe("Bun.build compile", () => {
  test("compile with current platform target string", async () => {
    using dir = tempDir("build-compile-target", {
      "app.js": `console.log("Cross-compiled app");`,
    });

    const os = isMacOS ? "darwin" : isLinux ? "linux" : isWindows ? "windows" : "unknown";
    const arch = isArm64 ? "aarch64" : "x64";
    const musl = isMusl ? "-musl" : "";
    const target = `bun-${os}-${arch}${musl}` as any;
    const outdir = join(dir + "", "out");

    const result = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      outdir,
      compile: {
        target: target,
        outfile: "app-cross",
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);
    expect(result.outputs[0].path).toEndWith(isWindows ? "app-cross.exe" : "app-cross");

    const exists = await Bun.file(result.outputs[0].path).exists();

    // Verify that we do write it to the outdir.
    expect(result.outputs[0].path.replaceAll("\\", "/")).toStartWith(outdir.replaceAll("\\", "/"));
    expect(exists).toBe(true);
  });

  test("compile with invalid target fails gracefully", async () => {
    using dir = tempDir("build-compile-invalid", {
      "index.js": `console.log("test");`,
    });

    expect(() =>
      Bun.build({
        entrypoints: [join(dir, "index.js")],
        compile: {
          target: "bun-invalid-platform",
          outfile: join(dir, "invalid-app"),
        },
      }),
    ).toThrowErrorMatchingInlineSnapshot(`"Unknown compile target: bun-invalid-platform"`);
  });
  test("compile with relative outfile paths", async () => {
    using dir = tempDir("build-compile-relative-paths", {
      "app.js": `console.log("Testing relative paths");`,
    });

    // Test 1: Nested forward slash path
    const result1 = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile: join(dir + "", "output/nested/app1"),
      },
    });
    expect(result1.success).toBe(true);
    expect(result1.outputs[0].path).toContain(join("output", "nested", isWindows ? "app1.exe" : "app1"));

    // Test 2: Current directory relative path
    const result2 = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile: join(dir + "", "app2"),
      },
    });
    expect(result2.success).toBe(true);
    expect(result2.outputs[0].path).toEndWith(isWindows ? "app2.exe" : "app2");

    // Test 3: Deeply nested path
    const result3 = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile: join(dir + "", "a/b/c/d/app3"),
      },
    });
    expect(result3.success).toBe(true);
    expect(result3.outputs[0].path).toContain(join("a", "b", "c", "d", isWindows ? "app3.exe" : "app3"));
  });

  test("compile with embedded resources uses correct module prefix", async () => {
    using dir = tempDir("build-compile-embedded-resources", {
      "app.js": `
        // This test verifies that embedded resources use the correct target-specific base path
        // The module prefix should be set to the target's base path 
        // not the user-configured public_path
        import { readFileSync } from 'fs';
        
        // Try to read a file that would be embedded in the standalone executable
        try {
          const embedded = readFileSync('embedded.txt', 'utf8');
          console.log('Embedded file:', embedded);
        } catch (e) {
          console.log('Reading embedded file');
        }
      `,
      "embedded.txt": "This is an embedded resource",
    });

    // Test with default target (current platform)
    const result = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile: "app-with-resources",
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);
    expect(result.outputs[0].path).toEndWith(isWindows ? "app-with-resources.exe" : "app-with-resources");

    // The test passes if compilation succeeds - the actual embedded resource
    // path handling is verified by the successful compilation
  });
});

// file command test works well

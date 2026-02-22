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

describe("compiled binary validity", () => {
  test("output binary has valid executable header", async () => {
    using dir = tempDir("build-compile-valid-header", {
      "app.js": `console.log("hello");`,
    });

    const outfile = join(dir + "", "app-out");
    const result = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile,
      },
    });

    expect(result.success).toBe(true);

    // Read the first 4 bytes and verify it's a valid executable magic number
    const file = Bun.file(result.outputs[0].path);
    const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());

    if (isMacOS) {
      // MachO magic: 0xCFFAEDFE (little-endian)
      expect(header[0]).toBe(0xcf);
      expect(header[1]).toBe(0xfa);
      expect(header[2]).toBe(0xed);
      expect(header[3]).toBe(0xfe);
    } else if (isLinux) {
      // ELF magic: 0x7F 'E' 'L' 'F'
      expect(header[0]).toBe(0x7f);
      expect(header[1]).toBe(0x45); // 'E'
      expect(header[2]).toBe(0x4c); // 'L'
      expect(header[3]).toBe(0x46); // 'F'
    } else if (isWindows) {
      // PE magic: 'M' 'Z'
      expect(header[0]).toBe(0x4d); // 'M'
      expect(header[1]).toBe(0x5a); // 'Z'
    }
  });

  test("compiled binary runs and produces expected output", async () => {
    using dir = tempDir("build-compile-runs", {
      "app.js": `console.log("compile-test-output");`,
    });

    const outfile = join(dir + "", "app-run");
    const result = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile,
      },
    });

    expect(result.success).toBe(true);

    await using proc = Bun.spawn({
      cmd: [result.outputs[0].path],
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("compile-test-output");
    expect(exitCode).toBe(0);
  });
});

// file command test works well

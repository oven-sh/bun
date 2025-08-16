import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isLinux, isMacOS, isMusl, isWindows, tempDirWithFiles } from "harness";
import { join } from "path";

describe("Bun.build compile", () => {
  test("compile: true creates standalone executable", async () => {
    const dir = tempDirWithFiles("build-compile", {
      "index.js": `console.log("Hello from compiled executable!");`,
    });

    const result = await Bun.build({
      entrypoints: [join(dir, "index.js")],
      compile: true,
      outfile: join(dir, "app"),
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    const output = result.outputs[0];
    expect(output.path).toEndWith("app");
    expect(output.kind).toBe("entry-point");

    const file = Bun.file(output.path);
    expect(await file.exists()).toBe(true);

    // Verify file size indicates a real executable
    const stat = await file.stat();
    expect(stat.size).toBeGreaterThan(1_000_000); // Executables are typically > 1MB
  });

  test("compile with current platform target string", async () => {
    const dir = tempDirWithFiles("build-compile-target", {
      "app.js": `console.log("Cross-compiled app");`,
    });

    const os = isMacOS ? "darwin" : isLinux ? "linux" : isWindows ? "windows" : "unknown";
    const arch = isArm64 ? "aarch64" : "x64";
    const musl = isMusl ? "-musl" : "";
    const target = `${os}-${arch}${musl}` as any;

    const result = await Bun.build({
      entrypoints: [join(dir, "app.js")],
      compile: target,
      outfile: join(dir, "app-cross"),
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);
    expect(result.outputs[0].path).toEndWith("app-cross");

    const exists = await Bun.file(result.outputs[0].path).exists();
    expect(exists).toBe(true);
  });

  test("compile option sets target to bun", async () => {
    const dir = tempDirWithFiles("build-compile-target-bun", {
      "index.js": `
        // This should work with Bun APIs
        import { $ } from "bun";
        const result = await $\`echo "Hello from Bun"\`.text();
        console.log(result.trim());
      `,
    });

    const result = await Bun.build({
      entrypoints: [join(dir, "index.js")],
      compile: true,
      outfile: join(dir, "bun-app"),
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);
  });

  test("compile with invalid target fails gracefully", async () => {
    const dir = tempDirWithFiles("build-compile-invalid", {
      "index.js": `console.log("test");`,
    });

    try {
      await Bun.build({
        entrypoints: [join(dir, "index.js")],
        compile: "invalid-platform" as any,
        outfile: join(dir, "invalid-app"),
      });
      throw new Error("Expected build to throw but it succeeded");
    } catch (error: any) {
      expect(error.message).toMatch(/Unsupported compile target/);
    }
  });

  test("compile with outfile option", async () => {
    const dir = tempDirWithFiles("build-compile-outfile", {
      "main.js": `console.log("Custom output name");`,
    });

    const result = await Bun.build({
      entrypoints: [join(dir, "main.js")],
      outfile: join(dir, "my-app"),
      compile: true,
    });

    expect(result.success).toBe(true);
    expect(result.outputs[0].path).toEndWith("my-app");
  });

  test("compile with code splitting fails with error", async () => {
    const dir = tempDirWithFiles("build-compile-splitting", {
      "index.js": `import("./lazy.js");`,
      "lazy.js": `console.log("lazy loaded");`,
    });

    try {
      await Bun.build({
        entrypoints: [join(dir, "index.js")],
        outfile: join(dir, "splitting-app"),
        compile: true,
        splitting: true as any,
      });
      throw new Error("Expected build to fail but it succeeded");
    } catch (error: any) {
      expect(error.message).toMatch(/cannot use.*compile.*with.*code splitting/i);
    }
  });

  test("compile with outdir fails with error", async () => {
    const dir = tempDirWithFiles("build-compile-outdir", {
      "index.js": `console.log("test");`,
    });

    try {
      await Bun.build({
        entrypoints: [join(dir, "index.js")],
        outdir: dir,
        compile: true as any,
      });
      throw new Error("Expected build to fail but it succeeded");
    } catch (error: any) {
      expect(error.message).toMatch(/cannot use.*outdir.*with.*compile/i);
    }
  });

  test("compile with modules and dependencies", async () => {
    const dir = tempDirWithFiles("build-compile-deps", {
      "index.js": `
        import { add } from "./math.js";
        console.log("2 + 3 =", add(2, 3));
      `,
      "math.js": `
        export function add(a, b) {
          return a + b;
        }
      `,
    });

    const result = await Bun.build({
      entrypoints: [join(dir, "index.js")],
      compile: true as any,
      outfile: join(dir, "math-app"),
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    // Just verify the executable was created
    const file = Bun.file(result.outputs[0].path);
    expect(await file.exists()).toBe(true);
  });

  test.if(isMacOS || isLinux)("compiled executable properties for current platform", async () => {
    const dir = tempDirWithFiles("build-compile-props", {
      "index.js": `console.log("test");`,
    });

    const result = await Bun.build({
      entrypoints: [join(dir, "index.js")],
      compile: true,
      outfile: join(dir, `test-app`),
    });

    expect(result.success).toBe(true);
    expect(result.outputs).toHaveLength(1);

    const executablePath = result.outputs[0].path;
    const stat = await Bun.file(executablePath).stat();

    expect(executablePath).not.toEndWith(".exe");

    const fileResult = Bun.spawnSync(["file", executablePath]);
    if (fileResult.exitCode === 0) {
      const fileOutput = fileResult.stdout.toString();
      if (isMacOS) {
        if (isArm64) {
          expect(fileOutput).toMatch(/Mach-O.*arm64/i);
        } else {
          expect(fileOutput).toMatch(/Mach-O.*64-bit/i);
        }
      } else if (isLinux) {
        if (isArm64) {
          expect(fileOutput).toMatch(/ELF.*64-bit.*aarch64/i);
        } else {
          expect(fileOutput).toMatch(/ELF.*64-bit.*x86-64/i);
        }
      } else {
        expect.unreachable("Unsupported platform");
      }
    }

    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  test.each([
    ["darwin-x64", /Mach-O.*64-bit/i],
    ["darwin-aarch64", /Mach-O.*(arm64|aarch64)/i],
    ["linux-x64", /ELF.*64-bit.*x86-64/i],
    ["linux-aarch64", /ELF.*64-bit.*aarch64/i],
    ["windows-x64", /PE32\+.*executable/i],
  ] as const)("compiled executable properties for %s", async (platform, expectedFilePattern) => {
    const dir = tempDirWithFiles("build-compile-props", {
      "index.js": `
        console.log("Hello from compiled executable!");
        process.exit(42);
      `,
    });

    const result = await Bun.build({
      entrypoints: [join(dir, "index.js")],
      compile: platform as Bun.CompileTarget,
      outfile: join(dir, `test-app-${platform}`),
    });

    expect(result.success).toBe(true);
    expect(result.outputs).toHaveLength(1);

    const executablePath = result.outputs[0].path;
    const stat = await Bun.file(executablePath).stat();

    if (platform.includes("windows")) {
      expect(executablePath).toEndWith(".exe");
    } else {
      expect(executablePath).not.toEndWith(".exe");
    }

    const fileResult = Bun.spawnSync(["file", executablePath]);
    if (fileResult.exitCode === 0) {
      const fileOutput = fileResult.stdout.toString();
      expect(fileOutput).toMatch(expectedFilePattern);
    }

    if (!platform.includes("windows")) {
      expect(stat.mode & 0o111).toBeGreaterThan(0);
    }
  });

  test("invalid compile target should error gracefully", async () => {
    const dir = tempDirWithFiles("build-compile-invalid", {
      "index.js": `console.log("test");`,
    });

    const invalidTargets = ["darwin-arm64", "invalid-platform", "linux-invalid", "windows-arm64", "", "darwin"];

    for (const target of invalidTargets) {
      try {
        const result = await Bun.build({
          entrypoints: [join(dir, "index.js")],
          compile: target as any,
          outfile: join(dir, `app-${target || "empty"}`),
        });

        expect(result.success).toBe(false);
      } catch (error) {
        expect(error).toBeDefined();
      }
    }
  });

  test("CLI bun build --compile basic functionality", async () => {
    const dir = tempDirWithFiles("cli-compile-test", {
      "index.js": `console.log("test");`,
    });

    // Test default compile
    const proc1 = Bun.spawnSync({
      cmd: [bunExe(), "build", "--compile", join(dir, "index.js"), "--outfile", join(dir, "test-default")],
      env: bunEnv,
      cwd: dir,
    });

    expect(proc1.exitCode).toBe(0);
    expect(await Bun.file(join(dir, "test-default")).exists()).toBe(true);

    // Test Windows target creates .exe
    const proc2 = Bun.spawnSync({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--target",
        "bun-windows-x64",
        join(dir, "index.js"),
        "--outfile",
        join(dir, "test-win"),
      ],
      env: bunEnv,
      cwd: dir,
    });

    expect(proc2.exitCode).toBe(0);
    expect(await Bun.file(join(dir, "test-win.exe")).exists()).toBe(true);

    // Test cross-platform compilation
    const proc3 = Bun.spawnSync({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--target",
        "bun-linux-x64",
        join(dir, "index.js"),
        "--outfile",
        join(dir, "test-linux"),
      ],
      env: bunEnv,
      cwd: dir,
    });

    expect(proc3.exitCode).toBe(0);
    expect(await Bun.file(join(dir, "test-linux")).exists()).toBe(true);
  });
});

// file command test works well

import { describe, expect, test } from "bun:test";
import { execSync } from "child_process";
import { existsSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

describe.if(isWindows)("compile --outfile with subdirectories", () => {
  test("places executable in subdirectory with forward slash", async () => {
    using dir = tempDir("compile-subdir-forward", {
      "app.js": `console.log("Hello from subdirectory!");`,
    });

    // Use forward slash in outfile
    const outfile = "subdir/nested/app.exe";

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", join(String(dir), "app.js"), "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    // Check that the file exists in the subdirectory
    const expectedPath = join(String(dir), "subdir", "nested", "app.exe");
    expect(existsSync(expectedPath)).toBe(true);

    // Run the executable to verify it works
    await using exe = Bun.spawn({
      cmd: [expectedPath],
      env: bunEnv,
      stdout: "pipe",
    });

    const exeOutput = await exe.stdout.text();
    expect(exeOutput.trim()).toBe("Hello from subdirectory!");
  });

  test("places executable in subdirectory with backslash", async () => {
    using dir = tempDir("compile-subdir-backslash", {
      "app.js": `console.log("Hello with backslash!");`,
    });

    // Use backslash in outfile
    const outfile = "subdir\\nested\\app.exe";

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", join(String(dir), "app.js"), "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    // Check that the file exists in the subdirectory
    const expectedPath = join(String(dir), "subdir", "nested", "app.exe");
    expect(existsSync(expectedPath)).toBe(true);
  });

  test("creates parent directories if they don't exist", async () => {
    using dir = tempDir("compile-create-dirs", {
      "app.js": `console.log("Created directories!");`,
    });

    // Use a deep nested path that doesn't exist yet
    const outfile = "a/b/c/d/e/app.exe";

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", join(String(dir), "app.js"), "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    // Check that the file and all directories were created
    const expectedPath = join(String(dir), "a", "b", "c", "d", "e", "app.exe");
    expect(existsSync(expectedPath)).toBe(true);
  });

  test.if(isWindows)("Windows metadata works with subdirectories", async () => {
    using dir = tempDir("compile-metadata-subdir", {
      "app.js": `console.log("App with metadata!");`,
    });

    const outfile = "output/bin/app.exe";

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        join(String(dir), "app.js"),
        "--outfile",
        outfile,
        "--windows-title",
        "Subdirectory App",
        "--windows-version",
        "1.2.3.4",
        "--windows-description",
        "App in a subdirectory",
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");

    const expectedPath = join(String(dir), "output", "bin", "app.exe");
    expect(existsSync(expectedPath)).toBe(true);

    // Verify metadata was set correctly
    const getMetadata = (field: string) => {
      try {
        return execSync(`powershell -Command "(Get-ItemProperty '${expectedPath}').VersionInfo.${field}"`, {
          encoding: "utf8",
        }).trim();
      } catch {
        return "";
      }
    };

    expect(getMetadata("ProductName")).toBe("Subdirectory App");
    expect(getMetadata("FileDescription")).toBe("App in a subdirectory");
    expect(getMetadata("ProductVersion")).toBe("1.2.3.4");
  });

  test("fails gracefully when parent is a file", async () => {
    using dir = tempDir("compile-parent-is-file", {
      "app.js": `console.log("Won't compile!");`,
      "blocked": "This is a file, not a directory",
    });

    // Try to use blocked/app.exe where blocked is a file
    const outfile = "blocked/app.exe";

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", join(String(dir), "app.js"), "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).not.toBe(0);
    // Should get an error about the path
    expect(stderr.toLowerCase()).toContain("notdir");
  });

  test("works with . and .. in paths", async () => {
    using dir = tempDir("compile-relative-paths", {
      "src/app.js": `console.log("Relative paths work!");`,
    });

    // Use relative path with . and ..
    const outfile = "./output/../output/./app.exe";

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", join(String(dir), "src", "app.js"), "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    // Should normalize to output/app.exe
    const expectedPath = join(String(dir), "output", "app.exe");
    expect(existsSync(expectedPath)).toBe(true);
  });
});

describe("Bun.build() compile with subdirectories", () => {
  test.if(isWindows)("places executable in subdirectory via API", async () => {
    using dir = tempDir("api-compile-subdir", {
      "app.js": `console.log("API subdirectory test!");`,
    });

    const result = await Bun.build({
      entrypoints: [join(String(dir), "app.js")],
      compile: {
        outfile: "dist/bin/app.exe",
      },
      outdir: String(dir),
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);

    // The output path should include the subdirectories
    expect(result.outputs[0].path).toContain("dist");
    expect(result.outputs[0].path).toContain("bin");

    // File should exist at the expected location
    const expectedPath = join(String(dir), "dist", "bin", "app.exe");
    expect(existsSync(expectedPath)).toBe(true);
  });

  test.if(isWindows)("API with Windows metadata and subdirectories", async () => {
    using dir = tempDir("api-metadata-subdir", {
      "app.js": `console.log("API with metadata!");`,
    });

    const result = await Bun.build({
      entrypoints: [join(String(dir), "app.js")],
      compile: {
        outfile: "build/release/app.exe",
        windows: {
          title: "API Subdirectory App",
          version: "2.0.0.0",
          publisher: "Test Publisher",
        },
      },
      outdir: String(dir),
    });

    expect(result.success).toBe(true);

    const expectedPath = join(String(dir), "build", "release", "app.exe");
    expect(existsSync(expectedPath)).toBe(true);

    // Verify metadata
    const getMetadata = (field: string) => {
      try {
        return execSync(`powershell -Command "(Get-ItemProperty '${expectedPath}').VersionInfo.${field}"`, {
          encoding: "utf8",
        }).trim();
      } catch {
        return "";
      }
    };

    expect(getMetadata("ProductName")).toBe("API Subdirectory App");
    expect(getMetadata("CompanyName")).toBe("Test Publisher");
    expect(getMetadata("ProductVersion")).toBe("2.0.0.0");
  });
});

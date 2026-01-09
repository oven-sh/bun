import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("FFI permissions", () => {
  test("dlopen denied in secure mode without --allow-ffi", async () => {
    using dir = tempDir("perm-ffi-test", {
      "test.ts": `
        import { dlopen } from "bun:ffi";
        try {
          dlopen("libtest.so", {});
        } catch (e) {
          console.log("ERROR:", e.message);
          process.exit(1);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--no-prompt", "test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout + stderr).toContain("PermissionDenied");
    expect(stdout + stderr).toContain("ffi");
    expect(exitCode).not.toBe(0);
  });

  test("dlopen allowed with --allow-ffi", async () => {
    using dir = tempDir("perm-ffi-allow", {
      "test.ts": `
        import { dlopen } from "bun:ffi";
        try {
          // This will fail with "library not found" (not permission denied)
          dlopen("libnonexistent12345.so", {});
          console.log("LOADED");
        } catch (e) {
          // We expect a library-not-found error, NOT a permission error
          if (e.message.includes("PermissionDenied")) {
            console.log("PERMISSION_ERROR");
            process.exit(2);
          }
          console.log("LIBRARY_ERROR:", e.message);
          process.exit(0); // This is expected
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-ffi", "test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should get library error, not permission error
    expect(stdout + stderr).not.toContain("PermissionDenied");
    expect(stdout).toContain("LIBRARY_ERROR");
    expect(exitCode).toBe(0);
  });

  test("granular --allow-ffi=<path> works for allowed path", async () => {
    using dir = tempDir("perm-ffi-granular", {});
    const libPath = `${String(dir)}/allowed.so`;

    // Write the test file with the actual path interpolated
    await Bun.write(
      `${String(dir)}/test.ts`,
      `
        import { dlopen } from "bun:ffi";
        try {
          // This will fail with "library not found" (not permission denied)
          dlopen("${libPath}", {});
          console.log("LOADED");
        } catch (e) {
          if (e.message.includes("PermissionDenied")) {
            console.log("PERMISSION_ERROR");
            process.exit(2);
          }
          console.log("LIBRARY_ERROR");
          process.exit(0);
        }
      `,
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", `--allow-ffi=${libPath}`, "test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should get library error, not permission error
    expect(stdout + stderr).not.toContain("PermissionDenied");
    expect(exitCode).toBe(0);
  });

  test("granular --allow-ffi=<path> denies other paths", async () => {
    using dir = tempDir("perm-ffi-deny-other", {});
    const allowedPath = `${String(dir)}/allowed.so`;
    const forbiddenPath = `${String(dir)}/forbidden.so`;

    await Bun.write(
      `${String(dir)}/test.ts`,
      `
        import { dlopen } from "bun:ffi";
        try {
          dlopen("${forbiddenPath}", {});
          console.log("LOADED");
        } catch (e) {
          console.log("ERROR:", e.message);
          process.exit(1);
        }
      `,
    );

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", `--allow-ffi=${allowedPath}`, "test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout + stderr).toContain("PermissionDenied");
    expect(exitCode).not.toBe(0);
  });

  test("-A allows FFI access", async () => {
    using dir = tempDir("perm-ffi-all", {
      "test.ts": `
        import { dlopen } from "bun:ffi";
        try {
          dlopen("libnonexistent.so", {});
          console.log("LOADED");
        } catch (e) {
          if (e.message.includes("PermissionDenied")) {
            console.log("PERMISSION_ERROR");
            process.exit(2);
          }
          console.log("LIBRARY_ERROR");
          process.exit(0);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "-A", "test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout + stderr).not.toContain("PermissionDenied");
    expect(exitCode).toBe(0);
  });
});

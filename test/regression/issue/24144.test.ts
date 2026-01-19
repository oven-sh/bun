import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMusl, tempDir } from "harness";

// Issue #24144: Using --bytecode with --target bun-linux-x64-musl causes a segfault
// because bytecode is not portable across different platforms/architectures/libcs.
// The fix is to error out at build time when --bytecode is combined with cross-compilation.
describe("issue #24144: bytecode with cross-compilation", () => {
  test("--bytecode with cross-compilation target should error", async () => {
    using dir = tempDir("issue-24144", {
      "index.ts": `console.log("Hello, world!");`,
    });

    // Use a cross-compilation target that differs from current platform
    // We pick a musl target if we're on glibc, or glibc target if we're on musl
    const crossTarget = isLinux
      ? isMusl
        ? "bun-linux-x64" // glibc target if we're on musl
        : "bun-linux-x64-musl" // musl target if we're on glibc
      : "bun-linux-x64-musl"; // any linux target if we're not on linux

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--bytecode", `--target=${crossTarget}`, "index.ts", "--outfile=server"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("--bytecode is not supported with cross-compilation");
    expect(exitCode).toBe(1);
  });

  test("--bytecode without cross-compilation should work", async () => {
    using dir = tempDir("issue-24144-same-platform", {
      "index.ts": `console.log("Hello, world!");`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--bytecode", "index.ts", "--outfile=server"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should succeed without the cross-compilation error
    expect(stderr).not.toContain("--bytecode is not supported with cross-compilation");
    expect(exitCode).toBe(0);
  });
});

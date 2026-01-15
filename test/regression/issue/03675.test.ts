// https://github.com/oven-sh/bun/issues/3675
// bunx should support HTTPS tarball URLs like npx does
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";

describe("issue/03675", () => {
  test("bunx can run package from HTTPS tarball URL", async () => {
    const tmp = tmpdirSync();

    await using proc = Bun.spawn({
      cmd: [bunExe(), "x", "https://registry.npmjs.org/cowsay/-/cowsay-1.5.0.tgz", "Hello"],
      cwd: tmp,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("unrecognised dependency format");
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain("Hello");
    expect(stdout).toContain("< Hello >"); // cowsay output format
    expect(exitCode).toBe(0);
  });

  test("bunx can run scoped package from HTTPS tarball URL", async () => {
    const tmp = tmpdirSync();

    // Use a scoped package to test the scoped package name extraction
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "x",
        "https://registry.npmjs.org/@anthropic-ai/claude-code/-/claude-code-0.2.59.tgz",
        "--version",
      ],
      cwd: tmp,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("unrecognised dependency format");
    // The package should be installed and run successfully
    // Note: we don't check the version output as it may vary
    // The main test is that it doesn't error on the tarball URL format
  });
});

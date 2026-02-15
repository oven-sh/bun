import { spawn } from "bun";
import { expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/2686
// `bun link .` should work the same as `bun link` (register the current package globally)
it("bun link . should register the current package", async () => {
  using dir = tempDir("bun-link-dot", {
    "package.json": JSON.stringify({
      name: "test-link-dot-pkg",
      version: "1.0.0",
    }),
  });

  await using proc = spawn({
    cmd: [bunExe(), "link", "."],
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
    env: bunEnv,
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain('Success! Registered "test-link-dot-pkg"');
  expect(stderr).not.toContain("unrecognised dependency format");
  expect(exitCode).toBe(0);
});

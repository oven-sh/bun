import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("lifecycle script should handle directory deletion gracefully", async () => {
  const dir = tempDirWithFiles("lifecycle-crash-test", {
    "package.json": JSON.stringify({
      name: "test-package",
      version: "1.0.0",
      scripts: {
        preinstall: process.platform === "win32" ? "rmdir /s /q ." : "rm -rf .",
        postinstall: "echo hello world",
      },
    }),
  });

  // Run bun install and expect it to handle the directory deletion gracefully
  // without crashing with assertions
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // The process should not crash with assertion failures
  // It may fail (non-zero exit code) but should fail gracefully
  // and not with internal assertion errors
  expect(stderr).not.toContain("assertion");
  expect(stderr).not.toContain("atIndex");
  expect(stderr).not.toContain("panic");

  // Should contain an error message about the script failure
  expect(stderr.includes("script") && (stderr.includes("exited with") || stderr.includes("Failed to run script"))).toBe(
    true,
  );

  // The process should exit with a non-zero code due to the script failure
  expect(exitCode).not.toBe(0);
});

test("lifecycle script with optional dependency should handle directory deletion", async () => {
  const depDir = tempDirWithFiles("optional-dep", {
    "package.json": JSON.stringify({
      name: "optional-dep",
      version: "1.0.0",
      scripts: {
        preinstall: process.platform === "win32" ? "rmdir /s /q ." : "rm -rf .",
        postinstall: "echo hello from optional dep",
      },
    }),
  });

  const mainDir = tempDirWithFiles("main-package", {
    "package.json": JSON.stringify({
      name: "main-package",
      version: "1.0.0",
      optionalDependencies: {
        "optional-dep": `file:${depDir}`,
      },
    }),
  });

  // Run bun install and expect it to handle the optional dependency
  // directory deletion gracefully
  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: mainDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // The process should not crash with assertion failures
  expect(stderr).not.toContain("assertion");
  expect(stderr).not.toContain("atIndex");
  expect(stderr).not.toContain("panic");

  // For optional dependencies, the install should succeed even if scripts fail
  // The process may warn about deleting the optional dependency
  expect(exitCode).toBe(0);
});

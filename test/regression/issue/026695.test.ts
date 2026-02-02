import { expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// Test for https://github.com/oven-sh/bun/issues/26695
// --preserve-symlinks-main should apply to test file path resolution for snapshot tests
// Skip on Windows: symlinkSync requires elevated privileges or developer mode
test.skipIf(isWindows)("--preserve-symlinks-main applies to snapshot test file path resolution", async () => {
  using dir = tempDir("symlink-snapshot-test", {});

  // Create real directory structure
  const realDir = join(String(dir), "real-dir");
  mkdirSync(realDir);
  mkdirSync(join(realDir, "__snapshots__"));

  // Create test file in real directory
  writeFileSync(
    join(realDir, "test.test.ts"),
    `import { test, expect } from "bun:test";
test("snapshot", () => {
  expect({ hello: "world" }).toMatchSnapshot();
});
`,
  );

  // Create snapshot in real directory - this should NOT be used when running via symlink
  writeFileSync(
    join(realDir, "__snapshots__", "test.test.ts.snap"),
    `exports[\`snapshot 1\`] = \`
{
  "hello": "real-dir-snapshot",
}
\`;
`,
  );

  // Create symlink directory structure
  const symlinkDir = join(String(dir), "symlink-dir");
  mkdirSync(symlinkDir);
  mkdirSync(join(symlinkDir, "__snapshots__"));

  // Create symlink to the test file
  symlinkSync(join(realDir, "test.test.ts"), join(symlinkDir, "test.test.ts"));

  // Create snapshot in symlink directory - this SHOULD be used when running via symlink with --preserve-symlinks-main
  writeFileSync(
    join(symlinkDir, "__snapshots__", "test.test.ts.snap"),
    `exports[\`snapshot 1\`] = \`
{
  "hello": "world",
}
\`;
`,
  );

  // Run test via symlink WITH --preserve-symlinks-main
  // The snapshot should be looked up in symlink-dir, not real-dir
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--preserve-symlinks-main", "test.test.ts"],
    cwd: symlinkDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // With --preserve-symlinks-main, the test should pass because it uses
  // symlink-dir/__snapshots__/test.test.ts.snap (which has "world")
  // Without the fix, it would look in real-dir/__snapshots__/test.test.ts.snap (which has "real-dir-snapshot")
  expect(stderr).toContain("1 pass");
  expect(stderr).not.toContain("real-dir-snapshot");
  expect(exitCode).toBe(0);
});

// Skip on Windows: symlinkSync requires elevated privileges or developer mode
test.skipIf(isWindows)("snapshot uses resolved path without --preserve-symlinks-main", async () => {
  using dir = tempDir("symlink-snapshot-test-no-flag", {});

  // Create real directory structure
  const realDir = join(String(dir), "real-dir");
  mkdirSync(realDir);
  mkdirSync(join(realDir, "__snapshots__"));

  // Create test file in real directory
  writeFileSync(
    join(realDir, "test.test.ts"),
    `import { test, expect } from "bun:test";
test("snapshot", () => {
  expect({ hello: "world" }).toMatchSnapshot();
});
`,
  );

  // Create snapshot in real directory - this SHOULD be used without --preserve-symlinks-main
  writeFileSync(
    join(realDir, "__snapshots__", "test.test.ts.snap"),
    `exports[\`snapshot 1\`] = \`
{
  "hello": "world",
}
\`;
`,
  );

  // Create symlink directory structure
  const symlinkDir = join(String(dir), "symlink-dir");
  mkdirSync(symlinkDir);
  mkdirSync(join(symlinkDir, "__snapshots__"));

  // Create symlink to the test file
  symlinkSync(join(realDir, "test.test.ts"), join(symlinkDir, "test.test.ts"));

  // Create a DIFFERENT snapshot in symlink directory
  writeFileSync(
    join(symlinkDir, "__snapshots__", "test.test.ts.snap"),
    `exports[\`snapshot 1\`] = \`
{
  "hello": "wrong-snapshot",
}
\`;
`,
  );

  // Run test via symlink WITHOUT --preserve-symlinks-main
  // The snapshot should be looked up in real-dir (symlink resolved)
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "test.test.ts"],
    cwd: symlinkDir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Without --preserve-symlinks-main, the test should pass because it uses
  // real-dir/__snapshots__/test.test.ts.snap (which has "world")
  expect(stderr).toContain("1 pass");
  expect(stderr).not.toContain("wrong-snapshot");
  expect(exitCode).toBe(0);
});

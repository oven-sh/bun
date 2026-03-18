import { expect, setDefaultTimeout, test } from "bun:test";
import { existsSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

setDefaultTimeout(30_000);

test("bun add with relative tarball path and --global should work", async () => {
  using dir = tempDir("tarball-global", {
    "test-pkg/package.json": JSON.stringify({ name: "test-global-tarball-28208", version: "1.0.0", main: "index.js" }),
    "test-pkg/index.js": "module.exports = 'hello';",
  });

  // Create the tarball
  const tarResult = Bun.spawnSync({
    cmd: ["tar", "czf", "test.tgz", "-C", "test-pkg", "."],
    cwd: String(dir),
  });
  expect(tarResult.exitCode).toBe(0);
  expect(existsSync(join(String(dir), "test.tgz"))).toBe(true);

  // Test: bun add ./test.tgz --global with a relative path
  await using proc = Bun.spawn({
    cmd: [bunExe(), "add", "./test.tgz", "--global"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Clean up: remove the globally installed package
  const removeResult = Bun.spawnSync({
    cmd: [bunExe(), "remove", "test-global-tarball-28208", "--global"],
    env: bunEnv,
  });
  expect(removeResult.exitCode).toBe(0);

  expect(stderr).not.toContain("ENOENT extracting tarball");
  expect(stderr).not.toContain("failed to resolve");
  expect(exitCode).toBe(0);
});

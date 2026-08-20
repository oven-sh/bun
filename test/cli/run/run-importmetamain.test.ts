import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const probe = `console.log(JSON.stringify([typeof require, import.meta.main, !import.meta.main, require.main === module, require.main !== module]));`;

test.concurrent("import.meta.main", async () => {
  using dir = tempDir("importmetamain-esm", {
    "index1.js": `import "fs"; ${probe}`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index1.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(JSON.stringify(["function", true, false, true, false]));
  expect(exitCode).toBe(0);
});

test.concurrent("import.meta.main in a common.js file", async () => {
  using dir = tempDir("importmetamain-cjs", {
    "index1.js": `module.exports = {}; ${probe}`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index1.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(JSON.stringify(["function", true, false, true, false]));
  expect(exitCode).toBe(0);
});

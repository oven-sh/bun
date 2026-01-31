import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/26629
// bun:sqlite fails to locate the system SQLite library on Linux because
// it searched for "sqlite3" instead of "libsqlite3.so".
test("bun:sqlite should load the system SQLite library", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", "import Database from 'bun:sqlite'; new Database(':memory:'); console.log('ok')"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

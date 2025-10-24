// https://github.com/oven-sh/bun/issues/23705
// Snapshots should use the same key on each rerun when --rerun-each is used
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

test("snapshots should use consistent keys with --rerun-each", async () => {
  using dir = tempDir("issue-23705", {
    "snapshot.test.ts": `
      import { test, expect } from "bun:test";

      test("simple snapshot test", () => {
        expect("hello world").toMatchInlineSnapshot();
      });
    `,
  });

  // First run: create the snapshot (disable CI to allow snapshot creation)
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "test", "snapshot.test.ts", "--update-snapshots"],
    env: { ...bunEnv, CI: "false" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

  expect(exitCode1).toBe(0);

  // Second run: verify with --rerun-each=2 in CI mode
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "test", "snapshot.test.ts", "--rerun-each=2"],
    env: { ...bunEnv, CI: "true", GITHUB_ACTIONS: "true" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  // Should pass both runs
  expect(exitCode2).toBe(0);

  // Should not try to create new snapshots
  const combined = stdout2 + stderr2;
  expect(combined).not.toContain("Snapshot creation is not allowed in CI");
  expect(combined).not.toContain("error");
  expect(combined).toMatch(/2 pass/);
});

test("file snapshots should use consistent keys with --rerun-each", async () => {
  using dir = tempDir("issue-23705-file", {
    "file-snapshot.test.ts": `
      import { test, expect } from "bun:test";

      test("snapshot to file", () => {
        expect({ foo: "bar", baz: 42 }).toMatchSnapshot();
      });
    `,
  });

  // First run: create the snapshot file (disable CI to allow snapshot creation)
  await using proc1 = Bun.spawn({
    cmd: [bunExe(), "test", "file-snapshot.test.ts", "--update-snapshots"],
    env: { ...bunEnv, CI: "false" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout1, stderr1, exitCode1] = await Promise.all([proc1.stdout.text(), proc1.stderr.text(), proc1.exited]);

  expect(exitCode1).toBe(0);

  // Verify snapshot file was created
  const snapshotFile = join(String(dir), "__snapshots__", "file-snapshot.test.ts.snap");
  const snapshotExists = await Bun.file(snapshotFile).exists();
  expect(snapshotExists).toBe(true);

  // Second run: verify with --rerun-each=2 in CI mode
  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "test", "file-snapshot.test.ts", "--rerun-each=2"],
    env: { ...bunEnv, CI: "true", GITHUB_ACTIONS: "true" },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout2, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);

  // Should pass both runs
  expect(exitCode2).toBe(0);

  // Should not try to create new snapshots
  const combined = stdout2 + stderr2;
  expect(combined).not.toContain("Snapshot creation is not allowed in CI");
  expect(combined).not.toContain("error");
  expect(combined).toMatch(/2 pass/);
});

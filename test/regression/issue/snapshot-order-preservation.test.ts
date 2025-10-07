// Test for snapshot order preservation issue
// https://github.com/oven-sh/bun/issues/XXXXX
// When updating snapshots, the order should be preserved in the file.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

test("snapshot order should be preserved when updating", async () => {
  const dir = tempDirWithFiles("snapshot-order", {
    "test.ts": 'test("second", () => { expect("two").toMatchSnapshot(); });',
  });

  const testPath = join(String(dir), "test.ts");
  const snapshotPath = join(String(dir), "__snapshots__", "test.ts.snap");

  // Step 1: Create initial snapshot for "second" test
  await Bun.spawn([bunExe(), "test", testPath], {
    cwd: String(dir),
    env: bunEnv,
    stderr: "inherit",
    stdout: "inherit",
  }).exited;

  let snapshot = await Bun.file(snapshotPath).text();
  expect(snapshot).toContain("exports[`second 1`]");

  // Step 2: Add "first" test before "second"
  await Bun.write(
    testPath,
    'test("first", () => { expect("one").toMatchSnapshot(); });\ntest("second", () => { expect("two").toMatchSnapshot(); });',
  );

  await Bun.spawn([bunExe(), "test", testPath], {
    cwd: String(dir),
    env: bunEnv,
    stderr: "inherit",
    stdout: "inherit",
  }).exited;

  snapshot = await Bun.file(snapshotPath).text();
  const lines = snapshot.split("\n");
  const secondIndex = lines.findIndex(l => l.includes("exports[`second 1`]"));
  const firstIndex = lines.findIndex(l => l.includes("exports[`first 1`]"));

  // "second" should come before "first" in the file since it was added first
  expect(secondIndex).toBeLessThan(firstIndex);

  // Step 3: Update "first" snapshot
  await Bun.write(
    testPath,
    'test("first", () => { expect("one - updated").toMatchSnapshot(); });\ntest("second", () => { expect("two").toMatchSnapshot(); });',
  );

  await Bun.spawn([bunExe(), "test", "-u", testPath], {
    cwd: String(dir),
    env: bunEnv,
    stderr: "inherit",
    stdout: "inherit",
  }).exited;

  snapshot = await Bun.file(snapshotPath).text();
  const updatedLines = snapshot.split("\n");
  const secondIndexAfter = updatedLines.findIndex(l => l.includes("exports[`second 1`]"));
  const firstIndexAfter = updatedLines.findIndex(l => l.includes("exports[`first 1`]"));

  // Order should be preserved! "second" should still come before "first"
  expect(secondIndexAfter).toBeLessThan(firstIndexAfter);
  expect(snapshot).toContain('exports[`first 1`] = `"one - updated"`');
});

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

test("snapshots will recognize existing entries", async () => {
  const testDir = tmpdirSync();
  await Bun.write(
    join(testDir, "test.test.js"),
    `
  test("snapshot test", () => {
    expect("foo").toMatchSnapshot();
  });
  `,
  );

  let proc = Bun.spawnSync({
    cmd: [bunExe(), "test", "./test.test.js"],
    cwd: testDir,
    env: { ...bunEnv, CI: "false" },
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(proc.stderr.toString()).toContain("1 added");
  expect(proc.exitCode).toBe(0);

  const newSnapshot = await Bun.file(join(testDir, "__snapshots__", "test.test.js.snap")).text();

  // Run the same test, make sure another entry isn't added
  proc = Bun.spawnSync({
    cmd: [bunExe(), "test", "./test.test.js"],
    cwd: testDir,
    env: { ...bunEnv, CI: "false" },
    stdout: "pipe",
    stderr: "pipe",
  });

  expect(proc.stderr.toString()).not.toContain("1 added");
  expect(proc.exitCode).toBe(0);

  expect(newSnapshot).toBe(await Bun.file(join(testDir, "__snapshots__", "test.test.js.snap")).text());
});

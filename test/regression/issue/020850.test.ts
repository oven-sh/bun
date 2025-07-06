import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

// Regression test for hanging installs when creating a new lockfile
// Ensure tasks are scheduled on first install

test("install completes with new lockfile", async () => {
  const tarball = join(import.meta.dir, "../..", "cli", "install", "bar-0.0.2.tgz");
  const dir = tempDirWithFiles("install-new-lockfile", {
    "package.json": JSON.stringify({
      name: "foo",
      version: "1.0.0",
      dependencies: { bar: "file:" + tarball },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "install"],
    cwd: dir,
    env: bunEnv,
  });

  const exitCode = await proc.exited;
  expect(exitCode).toBe(0);
});

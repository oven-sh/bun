import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("short flags should be properly parsed", () => {
  const dir = tempDirWithFiles("07114", {
    "package.json": JSON.stringify({
      name: "short-flags-test",
      version: "0.0.0",
    }),
  });

  // Test single short flag
  const singleFlag = Bun.spawnSync({
    cmd: [bunExe(), "-t"],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
  });
  expect(singleFlag.stderr.toString().toLowerCase()).not.toContain("invalid argument '-t'");

  // Test multiple combined short flags
  const multipleFlags = Bun.spawnSync({
    cmd: [bunExe(), "-abc"],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
  });
  expect(multipleFlags.stderr.toString().toLowerCase()).not.toContain("invalid argument");

  // Test short flag with value
  const flagWithValue = Bun.spawnSync({
    cmd: [bunExe(), "-p", "3000"],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
  });
  expect(flagWithValue.stderr.toString().toLowerCase()).not.toContain("invalid argument '-p'");
});

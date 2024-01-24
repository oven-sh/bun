import { file } from "bun";
import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

test("custom matcher runs", async () => {
  const dir = tempDirWithFiles("custom-matcher-preload-test-fixture", {
    "preload.ts": await file(join(import.meta.dir, "custom-matcher-preload-test-fixture-1.ts")).text(),
    "expect-extend.test.ts": await file(join(import.meta.dir, "custom-matcher-preload-test-fixture-2.ts")).text(),
    "bunfig.toml": `
[test]
preload = "./preload.ts"
        `,
    "package.json": JSON.stringify(
      {
        name: "custom-matcher-preload-test-fixture",
        version: "1.0.0",
      },
      null,
      2,
    ),
  });
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "test", "expect-extend.test.ts"],
    cwd: dir,
    env: bunEnv,
    stderr: "inherit",
    stdout: "pipe",
    stdin: "inherit",
  });
  expect(stdout.toString().trim()).toContain("custom matcher test passed");
  expect(exitCode).toBe(0);
});

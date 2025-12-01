import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("bun build --production does not crash (issue #19652)", async () => {
  using dir = tempDir("19652", {
    "tsconfig.json": "{}",
    "index.js": `console.log("hello");`,
  });

  const result = Bun.spawnSync({
    cmd: [bunExe(), "build", "index.js", "--production"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "inherit",
    stderr: "inherit",
  });

  expect(result.exitCode).toBe(0);
});

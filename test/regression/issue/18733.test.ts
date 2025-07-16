// Regression test for https://github.com/oven-sh/bun/issues/18733
// bun pm cache and bun pm cache rm should work without package.json

import { expect, it } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

it("pm cache commands work without package.json (#18733)", async () => {
  const test_dir = tmpdirSync();
  const cache_dir = join(test_dir, ".cache");

  // Test pm cache without package.json
  const {
    stdout: cacheOut,
    stderr: cacheErr,
    exitCode: cacheCode,
  } = Bun.spawnSync({
    cmd: [bunExe(), "pm", "cache"],
    cwd: test_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: cache_dir,
    },
  });
  expect(cacheCode).toBe(0);
  expect(cacheErr.toString("utf-8")).toBe("");
  expect(cacheOut.toString("utf-8")).toBe(cache_dir);

  // Test pm cache rm without package.json
  const {
    stdout: cacheRmOut,
    stderr: cacheRmErr,
    exitCode: cacheRmCode,
  } = Bun.spawnSync({
    cmd: [bunExe(), "pm", "cache", "rm"],
    cwd: test_dir,
    stdout: "pipe",
    stdin: "pipe",
    stderr: "pipe",
    env: {
      ...bunEnv,
      BUN_INSTALL_CACHE_DIR: cache_dir,
    },
  });
  expect(cacheRmCode).toBe(0);
  expect(cacheRmErr.toString("utf-8")).toBe("");
  // The important thing is that it doesn't error with "No package.json"
  expect(cacheRmErr.toString("utf-8")).not.toContain("No package.json");
});

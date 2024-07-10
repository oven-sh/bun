import { bunEnv, bunExe, tmpdirSync } from "harness";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { it, expect } from "bun:test";

it("imports tsconfig.json with abritary keys", async () => {
  const testDir = tmpdirSync();

  // Clean up from prior runs if necessary
  rmSync(testDir, { recursive: true, force: true });

  // Create a directory with our test tsconfig.json
  mkdirSync(testDir, { recursive: true });
  writeFileSync(join(testDir, "tsconfig.json"), '{ "key-with-hyphen": true }');

  const { exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "-e", `require('${join(testDir, "tsconfig.json").replace(/\\/g, "\\\\")}').compilerOptions`],
    env: bunEnv,
    stderr: "inherit",
  });

  expect(exitCode).toBe(0);
});

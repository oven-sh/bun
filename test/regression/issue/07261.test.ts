import { expect, it } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

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

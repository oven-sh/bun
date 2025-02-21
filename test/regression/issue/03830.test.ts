import { expect, it } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

it("macros should not lead to seg faults under any given input", async () => {
  // this test code follows the same structure as and
  // is based on the code for testing issue 4893

  let testDir = tmpdirSync();

  // Clean up from prior runs if necessary
  rmSync(testDir, { recursive: true, force: true });

  // Create a directory with our test file
  mkdirSync(testDir, { recursive: true });
  writeFileSync(join(testDir, "macro.ts"), "export function fn(str) { return str; }");
  writeFileSync(
    join(testDir, "index.ts"),
    "import { fn } from './macro' assert { type: 'macro' };\nfn(`©${Number(0)}`);",
  );
  testDir = realpathSync(testDir);

  const { stderr, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "build", "--minify", join(testDir, "index.ts")],
    env: bunEnv,
    stderr: "pipe",
  });

  expect(stderr.toString().trim().replaceAll(testDir, "[dir]").replaceAll("\\", "/")).toMatchSnapshot();
  expect(exitCode).toBe(1);
});

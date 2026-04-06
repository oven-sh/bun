import { describe, expect, it } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import { join } from "path";

describe.concurrent("issue/03830", () => {
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

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--minify", join(testDir, "index.ts")],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(stderr.trim().replaceAll(testDir, "[dir]").replaceAll("\\", "/")).toMatchSnapshot();
    expect(exitCode).toBe(1);
  });
});

import { test, expect } from "bun:test";
import { tempDirWithFiles, bunExe, bunEnv } from "harness";
import path from "path";

test("coverage crash", () => {
  const dir = tempDirWithFiles("cov", {
    "demo.test.ts": `class Y {
  #hello
}`,
  });
  const result = Bun.spawnSync([bunExe(), "test", "--coverage"], {
    cwd: dir,
    env: {
      ...bunEnv,
    },
  });
  try {
    expect(result.exitCode).toBe(0);
    expect(result.signalCode).toBeUndefined();
  } catch (e) {
    console.log("Err: ", result.stderr.toString("utf8"));
    throw e;
  }
});

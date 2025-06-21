import { spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("console.assert", () => {
  test("prints Assertion failed prefix", () => {
    const { stderr } = spawnSync({
      cmd: [bunExe(), import.meta.dir + "/console-assert-run.ts", "message"],
      env: bunEnv,
    });
    expect(stderr.toString().trim()).toBe("Assertion failed: message");
  });
});

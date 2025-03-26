import { test, expect } from "bun:test";
import { join } from "path";
import { bunExe } from "harness";

test("should not crash on abort", async () => {
  for (let i = 0; i < 2; i++) {
    const { exitCode, signalCode } = await Bun.spawnSync({
      cmd: [bunExe(), join(import.meta.dir, "node-http-uaf-fixture.ts")],
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    expect(exitCode).not.toBeNull();
    expect(signalCode).toBeUndefined();
  }
});

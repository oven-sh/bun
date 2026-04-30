import { spawnSync } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";

test.each(["stdin", "stdout", "stderr", "openStdin"])(
  "process.%s lazy init near stack limit does not assert",
  which => {
    const { stdout, stderr, signalCode } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "process-stdio-stack-overflow-fixture.js"), which],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "pipe",
    });
    expect(stdout.toString()).not.toContain("ASSERTION FAILED");
    expect(stderr.toString()).not.toContain("ASSERTION FAILED");
    expect(signalCode).toBeUndefined();
  },
);

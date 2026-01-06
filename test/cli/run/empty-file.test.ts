import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

describe.concurrent("empty-file", () => {
  it("should execute empty scripts", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--bun", join(import.meta.dir, "empty-file.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBeEmpty();
    expect(stderr).toBeEmpty();
    expect(exitCode).toBe(0);
  });
});

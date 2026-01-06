import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

describe.concurrent("jsx-symbol-collision", () => {
  it("should not have a symbol collision with jsx imports", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--bun", join(import.meta.dir, "jsx-collision.tsx")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("[Function: Fragment]\n");
    expect(stderr).toBeEmpty();
    expect(exitCode).toBe(0);
  });
});

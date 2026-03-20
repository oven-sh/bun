import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";

test("Bun.inspect does not crash when lazy property callback throws", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `delete globalThis.Array; try { Bun.inspect(Bun); } catch(e) {} console.log("ok");`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});

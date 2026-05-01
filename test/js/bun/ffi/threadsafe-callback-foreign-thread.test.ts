import { test, expect } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import path from "node:path";

// bun:ffi JSCallback uses TinyCC-generated trampolines and pthreads; neither
// is available on Windows in the form this fixture needs.
test.skipIf(isWindows)(
  "threadsafe JSCallback invoked from a foreign thread does not corrupt the VM HandleSet",
  async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "threadsafe-callback-foreign-thread-fixture.ts")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toBe("ok 2048\n");
    expect(exitCode).toBe(0);
  },
  30_000,
);

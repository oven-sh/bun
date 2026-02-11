import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Issue #26847: Segfault in shell interpreter GC finalization
// When setupIOBeforeRun() fails in the JS path, the interpreter was freed
// immediately via deinitFromExec(). When GC later ran deinitFromFinalizer(),
// it accessed already-freed memory, causing a segfault.
//
// The exact error path (dup() failure) is hard to trigger from JS, but this
// test exercises the shell interpreter + GC interaction to verify there are
// no lifetime issues when many shell interpreters are created and collected.
test("shell interpreter GC finalization does not crash", async () => {
  const code = `
    // Create many shell interpreters and let them be collected by GC.
    // This stresses the GC finalization path of ShellInterpreter objects.
    for (let i = 0; i < 100; i++) {
      // Create shell promises but don't await them, so they get GC'd
      Bun.$\`echo \${i}\`.quiet();
    }
    // Force garbage collection to finalize the shell interpreter objects.
    Bun.gc(true);
    await Bun.sleep(10);
    Bun.gc(true);

    // Also test the normal path: run and await shell commands, then GC
    for (let i = 0; i < 10; i++) {
      await Bun.$\`echo \${i}\`.quiet();
    }
    Bun.gc(true);
    Bun.gc(true);

    console.log("OK");
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("OK");
  expect(exitCode).toBe(0);
});

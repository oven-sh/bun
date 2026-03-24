import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// BlockList.estimatedSize previously divided by ref_count, which
// can be zero during GC finalization, causing SIGFPE on x86-64.
test("BlockList does not crash during GC", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const { BlockList } = require("net");
      for (let i = 0; i < 1000; i++) {
        const bl = new BlockList();
        bl.addAddress("1.2.3.4", "ipv4");
      }
      Bun.gc(true);
      Bun.gc(true);
      console.log("OK");
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("OK");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

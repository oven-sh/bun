import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("BlockList.estimatedSize does not crash during GC", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const net = require("net");
      for (let i = 0; i < 100; i++) {
        const bl = new net.BlockList();
        bl.addAddress("127.0.0.1");
      }
      Bun.gc(true);
      Bun.gc(true);
      console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

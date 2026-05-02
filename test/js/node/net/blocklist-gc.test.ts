import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";

// BlockList.estimatedSize divided by ref_count which can be observed as 0
// from the concurrent GC thread while another JS wrapper for the same
// BlockList is being finalized, raising SIGFPE.
test("BlockList survives GC with multiple wrappers sharing one backing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { BlockList } = require("node:net");
        for (let j = 0; j < 100; j++) {
          let bl = new BlockList();
          bl.addAddress("127.0.0.1");
          let clones = [];
          for (let i = 0; i < 8; i++) clones.push(structuredClone(bl));
          bl = null;
          clones = null;
          Bun.gc(true);
        }
        console.log("ok");
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exited] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("ok");
  expect(exited).toBe(0);
});

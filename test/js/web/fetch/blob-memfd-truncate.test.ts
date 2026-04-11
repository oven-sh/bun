import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Large Blobs on Linux are backed by a memfd + mmap. If the memfd is
// truncated from under the mapping (e.g. via a user-supplied fd that was
// reused), finalizing the Blob must not SIGBUS when freeing the mapping.
describe.skipIf(process.platform !== "linux")("Blob memfd store", () => {
  test("freeing a Blob whose memfd was truncated does not crash", async () => {
    const script = `
      const fs = require("node:fs");
      // >8MB so LinuxMemFdAllocator.shouldUse() picks the memfd path.
      let blob = new Blob(new SharedArrayBuffer(16 * 1024 * 1024));
      if (blob.size !== 16 * 1024 * 1024) process.exit(2);

      let truncated = false;
      for (const entry of fs.readdirSync("/proc/self/fd")) {
        let link;
        try {
          link = fs.readlinkSync("/proc/self/fd/" + entry);
        } catch {
          continue;
        }
        if (link.includes("memfd:memfd-num-")) {
          fs.ftruncateSync(Number(entry), 4096);
          truncated = true;
        }
      }
      if (!truncated) process.exit(3);

      blob = null;
      Bun.gc(true);
      console.log("ok");
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("ok\n");
    expect(stderr).not.toContain("AddressSanitizer");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(0);
  });
});

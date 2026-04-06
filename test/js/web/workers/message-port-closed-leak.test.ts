import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://bugs.webkit.org/show_bug.cgi?id=281662
// Transferring buffers to a closed MessageChannel causes memory leaks
describe("MessagePortChannel closed port", () => {
  test("postMessage to closed port does not accumulate in pending queue", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { port1, port2 } = new MessageChannel();
          port2.close();

          // Warm up: first batch establishes allocator high-water mark
          for (let i = 0; i < 5000; i++) {
            port1.postMessage(Buffer.alloc(64 * 1024).toString());
          }
          Bun.gc(true);
          Bun.gc(true);

          // Measure: second batch should reuse freed memory if messages
          // are dropped (not queued) for closed ports.
          const rssBefore = process.memoryUsage().rss;
          for (let i = 0; i < 5000; i++) {
            port1.postMessage(Buffer.alloc(64 * 1024).toString());
          }
          Bun.gc(true);
          Bun.gc(true);
          const rssAfter = process.memoryUsage().rss;
          const deltaMB = (rssAfter - rssBefore) / 1024 / 1024;

          // Without fix: ~300+ MB growth (5000 * 64KB queued)
          // With fix: ~0-5 MB (allocator reuses freed memory)
          if (deltaMB > 50) {
            console.error("FAIL: RSS grew by", deltaMB.toFixed(2), "MB on second batch");
            process.exit(1);
          }
          console.log("PASS: delta", deltaMB.toFixed(2), "MB");
          port1.close();
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout).toContain("PASS");
    expect(exitCode).toBe(0);
  });
});

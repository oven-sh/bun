import { $ } from "bun";
import { expect, test } from "bun:test";

test("shell parsing error does not leak emmory", async () => {
  const buffer = Buffer.alloc(1024 * 1024, "A").toString();
  for (let i = 0; i < 5; i++) {
    try {
      $`${{ raw: buffer }} <!INVALID ==== SYNTAX!>`;
    } catch (e) {}
  }
  const rss = process.memoryUsage.rss();
  for (let i = 0; i < 200; i++) {
    try {
      $`${{ raw: buffer }} <!INVALID ==== SYNTAX!>`;
    } catch (e) {}
  }
  const after = process.memoryUsage.rss() / 1024 / 1024;
  const before = rss / 1024 / 1024;
  // In Bun v1.3.0 on macOS arm64:
  //   Expected: < 100
  //   Received: 524.65625
  // In Bun v1.3.1 on macOS arm64:
  //   Expected: < 100
  //   Received: 0.25
  expect(after - before).toBeLessThan(100);
});

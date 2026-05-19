import { $ } from "bun";
import { expect, test } from "bun:test";
import { isASAN } from "harness";

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
  //
  // Under ASAN the freed parser buffers land in the allocator quarantine
  // (default `quarantine_size_mb=256`) instead of being returned, so the RSS
  // delta over-reports by up to the quarantine size (~180 MiB observed) even
  // when nothing leaks. Widen to 400 MiB under ASAN (still catches the 1.3.0
  // regression at 524 MiB with headroom for quarantine churn); keep the
  // original 100 MiB threshold elsewhere.
  expect(after - before).toBeLessThan(isASAN ? 400 : 100);
});

test("shell execution doesn't leak argv", async () => {
  const buffer = Buffer.alloc(1024 * 1024, "bun!").toString();
  const cmd = `echo ${buffer}`;
  for (let i = 0; i < 5; i++) {
    await $`${{ raw: cmd }}`.quiet();
  }
  const rss = process.memoryUsage.rss();
  for (let i = 0; i < 200; i++) {
    await $`${{ raw: cmd }}`.quiet();
  }
  const after = process.memoryUsage.rss() / 1024 / 1024;
  const before = rss / 1024 / 1024;
  // In Bun v1.3.0 on macOS arm64:
  //   Expected: < 250
  //   Received: 588.515625
  // In Bun v1.3.1 on macOS arm64:
  //   Expected: < 250
  //   Received: 93.875
  //
  // Same ASAN quarantine over-reporting as the test above: widen to 450 MiB
  // under ASAN (still below the 1.3.0 regression at 588 MiB); keep the
  // original 250 MiB threshold elsewhere.
  expect(after - before).toBeLessThan(isASAN ? 450 : 250);
});

test("non-awaited shell command does not leak argv", async () => {
  const buffer = Buffer.alloc(1024 * 1024, "bun!").toString();
  const cmd = `echo ${buffer}`;
  for (let i = 0; i < 5; i++) {
    $`${{ raw: cmd }}`.quiet();
  }
  const rss = process.memoryUsage.rss();
  for (let i = 0; i < 200; i++) {
    $`${{ raw: cmd }}`.quiet();
  }
  const after = process.memoryUsage.rss() / 1024 / 1024;
  const before = rss / 1024 / 1024;
  // In Bun v1.3.0 on macOS arm64:
  //   Expected: < 250
  //   Received: 588.515625
  // In Bun v1.3.1 on macOS arm64:
  //   Expected: < 250
  //   Received: 93.875
  //
  // Same ASAN quarantine over-reporting as the test above: widen to 450 MiB
  // under ASAN (still below the 1.3.0 regression at 588 MiB); keep the
  // original 250 MiB threshold elsewhere.
  expect(after - before).toBeLessThan(isASAN ? 450 : 250);
});

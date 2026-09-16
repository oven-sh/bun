import { $ } from "bun";
import { heapStats } from "bun:jsc";
import { expect, test } from "bun:test";
import { isASAN, rss } from "harness";

// The arena a script is parsed into is a whole mimalloc heap, so this counts
// the scripts that had to create one.
const mimallocHeapsCreated = (): number => heapStats().mimalloc.heaps.total;

test("shell parsing error does not leak emmory", async () => {
  const buffer = Buffer.alloc(1024 * 1024, "A").toString();
  for (let i = 0; i < 5; i++) {
    try {
      $`${{ raw: buffer }} <!INVALID ==== SYNTAX!>`;
    } catch (e) {}
  }
  const rssBefore = rss();
  for (let i = 0; i < 200; i++) {
    try {
      $`${{ raw: buffer }} <!INVALID ==== SYNTAX!>`;
    } catch (e) {}
  }
  const after = rss() / 1024 / 1024;
  const before = rssBefore / 1024 / 1024;
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
  const rssBefore = rss();
  for (let i = 0; i < 200; i++) {
    await $`${{ raw: cmd }}`.quiet();
  }
  const after = rss() / 1024 / 1024;
  const before = rssBefore / 1024 / 1024;
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
  const rssBefore = rss();
  for (let i = 0; i < 200; i++) {
    $`${{ raw: cmd }}`.quiet();
  }
  const after = rss() / 1024 / 1024;
  const before = rssBefore / 1024 / 1024;
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

test("a finished script gives its parse arena to the next script", async () => {
  await $`echo warmup`.quiet();
  const before = mimallocHeapsCreated();
  for (let i = 0; i < 100; i++) {
    expect(await $`echo ${i} && true`.text()).toBe(`${i}\n`);
  }
  // Two heaps per script when every script creates and destroys its own.
  expect(mimallocHeapsCreated() - before).toBeLessThan(10);
});

test("a script larger than the parked arena's cap does not stay in it", async () => {
  const big = `echo ${Buffer.alloc(1024 * 1024, "bun!").toString()}`;
  await $`${{ raw: big }}`.quiet();
  const before = mimallocHeapsCreated();
  for (let i = 0; i < 10; i++) {
    await $`${{ raw: big }}`.quiet();
  }
  const created = mimallocHeapsCreated() - before;
  // Each one leaves more than the cap behind, so its arena is destroyed and
  // the next script starts a new one.
  expect(created).toBeGreaterThanOrEqual(10);
  expect(created).toBeLessThan(20);
});

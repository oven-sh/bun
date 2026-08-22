import { expect, test } from "bun:test";
import { isASAN, isDebug, rss } from "harness";

// Release builds are the detector. The leaks this file has caught (#12831's six
// source-line StringImpls, the per-print path buffer noted in jsc_hooks.rs) are
// one to two hundred bytes per printed error, so it takes ~100k prints to push
// them past the 10 MB bound below; a clean run drifts a few MB regardless of the
// count. ASAN and debug builds print an error 4-50x slower, and the 400 MB ASAN
// bound is quarantine headroom rather than a leak detector, so they only need
// enough prints to exercise the path.
const perBatch = isASAN || isDebug ? 250 : 2000;
const repeat = isASAN || isDebug ? 4 : 50;

test("Printing errors does not leak", () => {
  function batch() {
    for (let i = 0; i < perBatch; i++) {
      Bun.inspect(new Error("leak"));
    }
    Bun.gc(true);
  }

  batch();
  const baseline = Math.floor(rss() / 1024);
  for (let i = 0; i < repeat; i++) {
    batch();
  }

  const after = Math.floor(rss() / 1024);
  const diff = ((after - baseline) / 1024) | 0;
  console.log(`RSS increased by ${diff} MB`);
  // ASAN's free quarantine (default 256 MB) plus redzones and glibc page
  // retention inflate RSS even when nothing is leaking.
  expect(diff, `RSS grew by ${diff} MB after ${perBatch * repeat} iterations`).toBeLessThan(isASAN ? 400 : 10);
});

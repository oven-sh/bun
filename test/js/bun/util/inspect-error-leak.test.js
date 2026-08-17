import { expect, test } from "bun:test";
import { isASAN, isDebug, rss } from "harness";

// The leak this guards against (the error printer not releasing its
// ZigException holder) is ~1 KB per printed error, so 30k prints grow a release
// build by ~30 MB against the 10 MB bound below. ASAN and debug builds print an
// error 4-50x slower and the bound has no teeth under ASAN's quarantine anyway
// (the ASAN lane runs LeakSanitizer), so they only get enough iterations to
// exercise the path.
const perBatch = isASAN || isDebug ? 250 : 1000;
const repeat = isASAN || isDebug ? 4 : 30;

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

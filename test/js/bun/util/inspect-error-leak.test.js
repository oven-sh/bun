import { expect, test } from "bun:test";
import { isASAN, isDebug, rss } from "../../../harness";

const perBatch = 2000;
const repeat = 50;
test(
  "Printing errors does not leak",
  () => {
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
  },
  // 100k inspect() calls plus 51 full GCs take ~13s on the release ASAN lane
  // and over a minute on a debug ASAN build; the RSS bound above is what
  // catches a leak, not the clock.
  isDebug || isASAN ? 120_000 : 10_000,
);

import { test as bunTest, expect } from "bun:test";
import { isASAN, isDebug } from "harness";

const ASAN_MULTIPLIER = isASAN ? 1 / 10 : 1;

// Each case builds ~100k Requests, which a debug JSC takes ~30s to do — past
// the default test timeout, so these have never run under `bun bd`. Shrinking
// the workload enough to fit would leave the RSS bounds below measuring
// nothing, so skip instead: the release and release-ASAN lanes are where this
// guard earns its keep.
const test = isDebug ? bunTest.skip : bunTest;

const constructorArgs = [
  [
    new Request("http://foo/", {
      body: "ahoyhoy",
      method: "POST",
    }),
  ],
  [
    "http://foo/",
    {
      body: "ahoyhoy",
      method: "POST",
    },
  ],
  [
    new URL("http://foo/"),
    {
      body: "ahoyhoy",
      method: "POST",
    },
  ],
  [
    new Request("http://foo/", {
      body: "ahoyhoy",
      method: "POST",
      headers: {
        "test-header": "value",
      },
    }),
  ],
  [
    "http://foo/",
    {
      body: "ahoyhoy",
      method: "POST",
      headers: {
        "test-header": "value",
      },
    },
  ],
  [
    new URL("http://foo/"),
    {
      body: "ahoyhoy",
      method: "POST",
      headers: {
        "test-header": "value",
      },
    },
  ],
];
for (let i = 0; i < constructorArgs.length; i++) {
  const args = constructorArgs[i];
  test("new Request(test #" + i + ")", () => {
    Bun.gc(true);

    for (let i = 0; i < 1000 * ASAN_MULTIPLIER; i++) {
      new Request(...args);
    }

    Bun.gc(true);
    const baseline = (process.memoryUsage.rss() / 1024 / 1024) | 0;
    for (let i = 0; i < 2000 * ASAN_MULTIPLIER; i++) {
      for (let j = 0; j < 500; j++) {
        new Request(...args);
      }
      Bun.gc();
    }
    Bun.gc(true);

    const memory = (process.memoryUsage.rss() / 1024 / 1024) | 0;
    const delta = Math.max(memory, baseline) - Math.min(baseline, memory);
    console.log("RSS delta: ", delta, "MB");
    // ASAN's quarantine and redzones retain freed pages so RSS over-reports
    // even when nothing leaks; CI samples show 30-50 MB delta with ASAN's 1/10
    // iteration multiplier vs <10 MB native. The unfixed leak presents as
    // 100+ MB, so the bound stays well under that.
    //
    // 64 had no headroom: this case measures 65 MB under ASAN with no leak
    // present, and run-to-run variance is a few MB either way.
    expect(delta).toBeLessThan(isASAN ? 80 : 30);
  });

  test("request.clone(test #" + i + ")", () => {
    Bun.gc(true);

    for (let i = 0; i < 1000 * ASAN_MULTIPLIER; i++) {
      const request = new Request(...args);
      request.clone();
    }

    Bun.gc(true);
    const baseline = (process.memoryUsage.rss() / 1024 / 1024) | 0;
    for (let i = 0; i < 2000 * ASAN_MULTIPLIER; i++) {
      for (let j = 0; j < 500 * ASAN_MULTIPLIER; j++) {
        const request = new Request(...args);
        request.clone();
      }
      Bun.gc();
    }
    Bun.gc(true);

    const memory = (process.memoryUsage.rss() / 1024 / 1024) | 0;
    const delta = Math.max(memory, baseline) - Math.min(baseline, memory);
    console.log("RSS delta: ", delta, "MB");
    // ASAN's quarantine and redzones retain freed pages so RSS over-reports
    // even when nothing leaks; CI samples show 30-50 MB delta with ASAN's 1/10
    // iteration multiplier vs <10 MB native. The unfixed leak presents as
    // 100+ MB so 64 MB still catches it.
    expect(delta).toBeLessThan(isASAN ? 64 : 30);
  });
}

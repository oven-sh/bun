import { expect, test } from "bun:test";
import { isASAN } from "harness";

// Under ASAN the RSS delta below is dominated by the quarantine and redzones
// ASAN keeps around *freed* allocations, so it tracks sizeof(Request) and the
// iteration count rather than whether anything leaked. Running enough
// iterations for a leak to outweigh that noise takes tens of seconds in a
// debug+ASAN build, past the default timeout. So ASAN runs the loops at 1/20
// scale to exercise the allocation paths, which is what ASAN's own
// instrumentation inspects, and leaves the leak bound to the other lanes, where
// a million iterations put the unfixed leak at 100+ MB over a <10 MB baseline.
const ASAN_MULTIPLIER = isASAN ? 1 / 20 : 1;

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
      for (let j = 0; j < 500 * ASAN_MULTIPLIER; j++) {
        new Request(...args);
      }
      Bun.gc();
    }
    Bun.gc(true);

    const memory = (process.memoryUsage.rss() / 1024 / 1024) | 0;
    const delta = Math.max(memory, baseline) - Math.min(baseline, memory);
    console.log("RSS delta: ", delta, "MB");
    // See the note on ASAN_MULTIPLIER: under ASAN this number is quarantine
    // noise, so the bound only runs where it can actually see a leak.
    if (!isASAN) expect(delta).toBeLessThan(30);
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
    // See the note on ASAN_MULTIPLIER: under ASAN this number is quarantine
    // noise, so the bound only runs where it can actually see a leak.
    if (!isASAN) expect(delta).toBeLessThan(30);
  });
}

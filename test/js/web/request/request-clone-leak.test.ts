import { expect, test } from "bun:test";
import { isASAN, rss } from "harness";

const ASAN_MULTIPLIER = isASAN ? 1 / 20 : 1;

const init = { body: "ahoyhoy", method: "POST" };
const initWithHeaders = { body: "ahoyhoy", method: "POST", headers: { "test-header": "value" } };
// new Request(request) consumes the input request's body, so the Request-input
// variants chain: each iteration's result feeds back as the next iteration's
// input. The seed is rebuilt per test so the two tests per variant don't share
// a consumed input.
const constructorArgs = [
  { chain: true, seed: () => [new Request("http://foo/", init)] },
  { chain: false, seed: () => ["http://foo/", init] },
  { chain: false, seed: () => [new URL("http://foo/"), init] },
  { chain: true, seed: () => [new Request("http://foo/", initWithHeaders)] },
  { chain: false, seed: () => ["http://foo/", initWithHeaders] },
  { chain: false, seed: () => [new URL("http://foo/"), initWithHeaders] },
];
for (let i = 0; i < constructorArgs.length; i++) {
  const { chain, seed } = constructorArgs[i];
  test("new Request(test #" + i + ")", () => {
    let args = seed();
    Bun.gc(true);

    for (let i = 0; i < 1000 * ASAN_MULTIPLIER; i++) {
      const r = new Request(...args);
      if (chain) args[0] = r;
    }

    Bun.gc(true);
    const baseline = (rss() / 1024 / 1024) | 0;
    for (let i = 0; i < 2000 * ASAN_MULTIPLIER; i++) {
      for (let j = 0; j < 500 * ASAN_MULTIPLIER; j++) {
        const r = new Request(...args);
        if (chain) args[0] = r;
      }
      Bun.gc();
    }
    Bun.gc(true);

    const memory = (rss() / 1024 / 1024) | 0;
    const delta = Math.max(memory, baseline) - Math.min(baseline, memory);
    console.log("RSS delta: ", delta, "MB");
    // The ASAN iteration count is too small for the RSS delta to distinguish
    // the unfixed leak from quarantine noise; the loop runs for sanitizer
    // coverage and the leak regression is guarded by the release lane.
    if (!isASAN) expect(delta).toBeLessThan(30);
  });

  test("request.clone(test #" + i + ")", () => {
    let args = seed();
    Bun.gc(true);

    for (let i = 0; i < 1000 * ASAN_MULTIPLIER; i++) {
      const request = new Request(...args);
      request.clone();
      if (chain) args[0] = request;
    }

    Bun.gc(true);
    const baseline = (rss() / 1024 / 1024) | 0;
    for (let i = 0; i < 2000 * ASAN_MULTIPLIER; i++) {
      for (let j = 0; j < 500 * ASAN_MULTIPLIER; j++) {
        const request = new Request(...args);
        request.clone();
        if (chain) args[0] = request;
      }
      Bun.gc();
    }
    Bun.gc(true);

    const memory = (rss() / 1024 / 1024) | 0;
    const delta = Math.max(memory, baseline) - Math.min(baseline, memory);
    console.log("RSS delta: ", delta, "MB");
    // The ASAN iteration count is too small for the RSS delta to distinguish
    // the unfixed leak from quarantine noise; the loop runs for sanitizer
    // coverage and the leak regression is guarded by the release lane.
    if (!isASAN) expect(delta).toBeLessThan(30);
  });
}

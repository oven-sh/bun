import { expect, test } from "bun:test";
import { isASAN } from "harness";

const ASAN_MULTIPLIER = isASAN ? 1 / 10 : 1;

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
  // `new Request(req)` transfers (consumes) the input body; chain the result
  // back as the next iteration's input so the single-arg Request-input path
  // (construct_into's clone_into arm) stays covered at one allocation per
  // iteration. The url/URL-input cases ignore `r` and reuse the shared args.
  const chain = args.length === 1 && args[0] instanceof Request;
  const seed = () => (chain ? (args[0] as Request).clone() : (args[0] as string | URL));
  test("new Request(test #" + i + ")", () => {
    Bun.gc(true);

    let r = seed();
    for (let i = 0; i < 1000 * ASAN_MULTIPLIER; i++) {
      r = chain ? new Request(r) : new Request(...args);
    }

    Bun.gc(true);
    const baseline = (process.memoryUsage.rss() / 1024 / 1024) | 0;
    r = seed();
    for (let i = 0; i < 2000 * ASAN_MULTIPLIER; i++) {
      for (let j = 0; j < 500 * ASAN_MULTIPLIER; j++) {
        r = chain ? new Request(r) : new Request(...args);
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

  test("request.clone(test #" + i + ")", () => {
    Bun.gc(true);

    let r = seed();
    for (let i = 0; i < 1000 * ASAN_MULTIPLIER; i++) {
      r = chain ? new Request(r) : new Request(...args);
      r.clone();
    }

    Bun.gc(true);
    const baseline = (process.memoryUsage.rss() / 1024 / 1024) | 0;
    r = seed();
    for (let i = 0; i < 2000 * ASAN_MULTIPLIER; i++) {
      for (let j = 0; j < 500 * ASAN_MULTIPLIER; j++) {
        r = chain ? new Request(r) : new Request(...args);
        r.clone();
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

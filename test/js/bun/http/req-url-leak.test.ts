import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import path from "path";
test(
  "req.url doesn't leak memory",
  async () => {
    const { promise, resolve } = Promise.withResolvers();
    await using process = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "req-url-leak-fixture.js")],
      env: bunEnv,
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      ipc(message, child) {
        if (message.url) {
          resolve(message.url);
        }
      },
    });

    const baseURL = await promise;

    const url = new URL(Buffer.alloc(1024 * 15, "Z").toString(), baseURL);

    let maxRSS = 0;

    for (let i = 0; i < 256; i++) {
      const batchSize = 64;
      const promises = [];
      for (let j = 0; j < batchSize; j++) {
        promises.push(
          fetch(url)
            .then(r => r.text())
            .then(rssText => {
              const rss = parseFloat(rssText);
              if (Number.isSafeInteger(rss)) {
                maxRSS = Math.max(maxRSS, rss);
              }
            }),
        );
      }
      await Promise.all(promises);
    }

    console.log("Max RSS", (maxRSS / 1024 / 1024) | 0, "MB");

    // 297 MB on Bun 1.2
    //  44 MB on Bun 1.3
    // ASAN's quarantine + shadow memory raise the absolute RSS floor; widen there.
    expect(maxRSS).toBeLessThan(1024 * 1024 * (isASAN ? 450 : 150));
    // Same calibration for the deadline: the 16K fetches that finish in ~3s on a
    // release build run ~10x slower under ASAN's instrumentation (observed
    // ~12-13s), and the run used to die on this timeout with the RSS assertion
    // itself passing.
  },
  isASAN ? 90_000 : 10_000,
);

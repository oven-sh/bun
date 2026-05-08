import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
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
    let firstRSS = 0;

    // Debug builds are several times slower per request and start with a much
    // higher baseline RSS, so scale the workload down while still pushing
    // ~60MB of URL bytes through the server (enough to surface a per-request
    // leak of the 15KB URL string).
    const batches = isDebug ? 64 : 256;
    for (let i = 0; i < batches; i++) {
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
                if (firstRSS === 0) firstRSS = rss;
              }
            }),
        );
      }
      await Promise.all(promises);
    }

    console.log("Max RSS", (maxRSS / 1024 / 1024) | 0, "MB");

    if (isDebug) {
      // Debug builds have a baseline RSS far above any fixed threshold, so
      // assert on growth instead: a real leak grows by ~batches*batch*15KB
      // (~60MB here), the fixed code stays roughly flat.
      const growth = maxRSS - firstRSS;
      console.log("RSS growth", (growth / 1024 / 1024) | 0, "MB");
      expect(growth).toBeLessThan(1024 * 1024 * 40);
    } else {
      // 297 MB on Bun 1.2
      //  44 MB on Bun 1.3
      expect(maxRSS).toBeLessThan(1024 * 1024 * 150);
    }
  },
  isDebug ? 60_000 : 10_000,
);

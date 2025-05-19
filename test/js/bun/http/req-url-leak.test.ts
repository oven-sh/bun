import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";
test("req.url doesn't leak memory", async () => {
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

  for (let i = 0; i < 512; i++) {
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

  console.log("RSS", maxRSS);

  // 557 MB on Bun 1.2
  expect(maxRSS).toBeLessThan(1024 * 1024 * 256);
}, 10_000);

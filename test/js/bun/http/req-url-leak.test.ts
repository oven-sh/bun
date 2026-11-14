import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, withoutAsanQuarantine } from "harness";
import path from "path";

test(
  "req.url doesn't leak memory",
  async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "req-url-leak-fixture.js")],
      env: withoutAsanQuarantine(bunEnv),
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
      ipc(message) {
        if (message.url) resolve(message.url);
      },
    });
    proc.exited.then(code => reject(new Error(`fixture exited (${code}) before sending its URL`)));

    const baseURL = await promise;
    const url = new URL(Buffer.alloc(1024 * 15, "Z").toString(), baseURL);
    const sampleRSS = async () => Number(await (await fetch(baseURL, { method: "POST" })).text());

    // 6 samples, 512 requests apart. Growth is measured from the second sample, once the allocator has
    // warmed up. A leaked 15 KB url per request grows RSS by 30 MB over those 2048 requests.
    const samples: number[] = [];
    for (let i = 0; i < 6; i++) {
      for (let batch = 0; batch < 8; batch++) {
        await Promise.all(Array.from({ length: 64 }, () => fetch(url).then(res => res.text())));
      }
      samples.push(await sampleRSS());
    }

    const growthMB = (samples.at(-1)! - samples[1]) / 1024 / 1024;
    console.log("RSS samples (MB)", samples.map(sample => (sample / 1024 / 1024) | 0).join(" "));
    expect(growthMB).toBeLessThan(10);
  },
  isASAN || isDebug ? 90_000 : 10_000,
);

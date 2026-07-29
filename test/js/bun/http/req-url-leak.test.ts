import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import path from "path";

test(
  "req.url doesn't leak memory",
  async () => {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "req-url-leak-fixture.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
      ipc(message) {
        if (message.url) resolve(message.url);
      },
    });
    const stderr = proc.stderr.text();
    proc.exited.then(async code =>
      reject(new Error(`req-url-leak fixture exited (${code}) before sending its URL: ${await stderr}`)),
    );

    const baseURL = await promise;
    const url = new URL(Buffer.alloc(1024 * 15, "Z").toString(), baseURL);
    // POST = GC-then-report RSS (routed by method so the long-URL GET path keeps
    // the exact #16787 scenario: no req.url access in the handler).
    const report = async () => parseInt(await (await fetch(baseURL, { method: "POST" })).text());

    // 6 windows of 8×64 = 3072 GETs total. A leaked 15 KB url per request grows
    // RSS linearly; between samples[1] (after 1024 requests, allocator warmed up)
    // and samples[5] that is 2048×15 KB ≈ 30 MB. With the fix the post-GC samples
    // are flat within ±3 MB on ASAN, so the old 16 K sweep's absolute-RSS check
    // becomes a growth bound at a fifth of the requests.
    const batchSize = 64;
    const samples: number[] = [];
    for (let window = 0; window < 6; window++) {
      for (let i = 0; i < 8; i++) {
        const batch = new Array(batchSize);
        for (let j = 0; j < batchSize; j++) batch[j] = fetch(url).then(r => r.text());
        await Promise.all(batch);
      }
      samples.push(await report());
    }

    proc.kill();
    await Promise.all([proc.stdout.text(), proc.exited]);

    const growthMB = (samples.at(-1)! - samples[1]) / 1024 / 1024;
    console.log(
      "RSS samples (MB):",
      samples.map(s => (s / 1024 / 1024) | 0).join(" "),
      "growth:",
      growthMB.toFixed(1) + "MB",
    );

    expect(await stderr).toBe("");
    // 297 MB on Bun 1.2 vs 44 MB on Bun 1.3 for the old 16 K absolute-RSS check;
    // as a post-GC delta the leak shows as ~30 MB here versus ~0 on a fixed build.
    expect(growthMB).toBeLessThan(15);
  },
  isASAN || isDebug ? 90_000 : 10_000,
);

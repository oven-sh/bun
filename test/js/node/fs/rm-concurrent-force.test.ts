// Concurrent fs.rm({ recursive: true, force: true }) on the same path must
// resolve for every caller. force: true is documented to ignore a missing path,
// which is exactly what every loser of the race observes.
//
// On macOS/BSD, unlinkat(2) of a directory returns EPERM (not EISDIR). Bun
// disambiguates with lstatat; if another concurrent rm removes the path
// between those calls, the lstat fails with ENOENT. Propagating the original
// EPERM (historically mapped through a narrow table to EFAULT) made force:true
// fail. See https://github.com/oven-sh/bun/issues/36984.

import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

test("concurrent recursive force rm on the same empty directory never rejects", async () => {
  await using base = tempDir("rm-concurrent-force", {});
  const ROUNDS = 200;
  const CONCURRENCY = 8;
  const errors = new Map<string, number>();

  for (let round = 0; round < ROUNDS; round++) {
    const target = join(String(base), `victim-${round}`);
    await mkdir(target);

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () => rm(target, { recursive: true, force: true })),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        const code = (result.reason as { code?: string })?.code ?? String(result.reason);
        errors.set(code, (errors.get(code) ?? 0) + 1);
      }
    }
  }

  const failed = [...errors.values()].reduce((a, b) => a + b, 0);
  expect(failed, `unexpected rejections: ${[...errors.entries()].map(([c, n]) => `${c}=${n}`).join(", ")}`).toBe(0);
});

test("concurrent recursive force rm on a non-empty directory never rejects", async () => {
  await using base = tempDir("rm-concurrent-force-nested", {});
  const ROUNDS = 100;
  const CONCURRENCY = 8;
  const errors = new Map<string, number>();

  for (let round = 0; round < ROUNDS; round++) {
    const target = join(String(base), `victim-${round}`);
    await mkdir(join(target, "sub"), { recursive: true });
    await Bun.write(join(target, "sub", "f.txt"), "x");

    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, () => rm(target, { recursive: true, force: true })),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        const code = (result.reason as { code?: string })?.code ?? String(result.reason);
        errors.set(code, (errors.get(code) ?? 0) + 1);
      }
    }
  }

  const failed = [...errors.values()].reduce((a, b) => a + b, 0);
  expect(failed, `unexpected rejections: ${[...errors.entries()].map(([c, n]) => `${c}=${n}`).join(", ")}`).toBe(0);
});

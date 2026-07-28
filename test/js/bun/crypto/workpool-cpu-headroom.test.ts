// CPU-bound work-pool jobs (pbkdf2, scrypt, argon2, zlib, WebCrypto, transpile,
// image) are capped at `pool size - 1` concurrent executions so a flood leaves
// one core free for the JS event loop. I/O-bound jobs (fs, dns, glob) are not
// capped.
//
// The assertion is mechanistic and independent of host core count: pin the
// child's pool at 2 (UV_THREADPOOL_SIZE=2 -> cap 1), queue 2 long pbkdf2 jobs,
// and check that one is forced into a second wave (completes at ~2x the
// first). Without the cap, both run in parallel and finish together.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("CPU-bound work-pool jobs are capped at pool-1 so the event loop keeps a core", async () => {
  const N = 2;
  const body = /* js */ `
      import crypto from "node:crypto";
      const N = ${N};
      const ITERS = 1_500_000;
      const t0 = performance.now();
      const done = [];
      let maxLate = 0, last = performance.now();
      const iv = setInterval(() => {
        const n = performance.now();
        maxLate = Math.max(maxLate, n - last - 10);
        last = n;
      }, 10);
      await Promise.all(
        Array.from({ length: N }, () =>
          new Promise(r =>
            crypto.pbkdf2("p", "s", ITERS, 32, "sha256", () => {
              done.push(performance.now() - t0);
              r();
            })
          )
        )
      );
      clearInterval(iv);
      done.sort((a, b) => a - b);
      process.stdout.write(JSON.stringify({ done, maxLate }));
    `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", body],
    env: {
      ...bunEnv,
      // Pin pool=2, cap=1. Keeps the wave structure independent of host
      // topology (cgroup-limited runners, oversubscribed parallel batches).
      UV_THREADPOOL_SIZE: String(N),
      GOMAXPROCS: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const { done, maxLate } = JSON.parse(stdout) as { done: number[]; maxLate: number };
  expect(done.length).toBe(N);

  // With the cap at N-1=1, the second job waits for the first to release its
  // permit, so the gap between them is a full job-length. Without the cap,
  // both run in parallel and the gap is scheduler noise.
  const first = done[0];
  const gap = done[N - 1] - done[N - 2];
  expect(gap).toBeGreaterThan(first * 0.5);

  // Informational: the 10 ms interval's worst lateness during the flood.
  console.log(
    `first=${first.toFixed(0)}ms last=${done[N - 1].toFixed(0)}ms gap=${gap.toFixed(0)}ms maxLate=${maxLate.toFixed(0)}ms`,
  );

  expect(exitCode).toBe(0);
});

// CPU-bound work-pool jobs (pbkdf2, scrypt, argon2, zlib, WebCrypto) are capped
// at `cores - 1` concurrent executions so a flood leaves one core free for the
// JS event loop. I/O-bound jobs (fs, dns) are not capped.
//
// The assertion is mechanistic: queue exactly `cores` long pbkdf2 jobs and
// check that one of them is forced into a second wave (completes at ~2x the
// first). Without the cap, all `cores` run in parallel and finish together.

import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

const cores = navigator.hardwareConcurrency;

// On a 1-core host get_thread_count() clamps the pool to 2 and the cap to 1,
// but hardwareConcurrency would report 1 and the wave probe can't distinguish.
test.skipIf(cores < 2)(
  "CPU-bound work-pool jobs are capped at cores-1 so the event loop keeps a core",
  async () => {
    const body = /* js */ `
      import crypto from "node:crypto";
      const cores = navigator.hardwareConcurrency;
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
        Array.from({ length: cores }, () =>
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
      process.stdout.write(JSON.stringify({ cores, done, maxLate }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", body],
      env: {
        ...bunEnv,
        // Ensure the child's pool is sized to the default (= hardwareConcurrency),
        // not an inherited override.
        UV_THREADPOOL_SIZE: undefined,
        GOMAXPROCS: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    expect(stderr).toBe("");
    const { cores: childCores, done, maxLate } = JSON.parse(stdout) as {
      cores: number;
      done: number[];
      maxLate: number;
    };
    expect(childCores).toBe(cores);
    expect(done.length).toBe(cores);

    // With the cap at cores-1, exactly one job waits for a permit and lands in
    // a second wave roughly one job-length after the first. Without the cap,
    // all `cores` jobs run together and the last-to-second-last gap is noise.
    const first = done[0];
    const gap = done[cores - 1] - done[cores - 2];
    // The second-wave job starts only after a first-wave job releases its
    // permit, so the gap is at least ~first. Assert half that to absorb
    // scheduler jitter; uncapped runs stay well under this (the spread across
    // `cores` parallel jobs is a fraction of one job-length, not a whole one).
    expect(gap).toBeGreaterThan(first * 0.5);

    // Informational: with a core free the 10ms interval should not be tens of
    // ms late. Logged so CI output carries the event-loop-latency number even
    // though the hard assertion above is the one the cap guarantees.
    console.log(
      `cores=${cores} first=${first.toFixed(0)}ms last=${done[cores - 1].toFixed(0)}ms gap=${gap.toFixed(0)}ms maxLate=${maxLate.toFixed(0)}ms`,
    );

    expect(exitCode).toBe(0);
  },
);

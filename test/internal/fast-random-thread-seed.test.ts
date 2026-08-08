/**
 * `bun_core::fast_random()` (src/bun_core/util.rs) keeps a thread-local
 * xoshiro256++ PRNG. Each thread must seed its PRNG from fresh OS entropy so
 * concurrent callers (install thread pool `.old-{HEX}` rename targets,
 * isolated-install tmp suffixes, bundler unique keys) don't emit identical
 * sequences.
 *
 * A prior port cached one process-global seed and handed it to every thread's
 * `DefaultPrng::init`, so thread A's Nth draw equalled thread B's Nth draw.
 * `fastRandomThreadProbe(n)` spawns `n` fresh threads, returns each thread's
 * first `fast_random()` as 16-char hex, and lets this test assert they are
 * distinct (deterministic fail on the shared-seed bug; the only false-positive
 * is an OS-entropy collision at ~2^-52 for 64 threads).
 */
import { fastRandomThreadProbe } from "bun:internal-for-testing";
import { expect, test } from "bun:test";

test("fast_random() seeds each thread's PRNG independently", () => {
  const N = 64;
  const draws = fastRandomThreadProbe(N);
  expect(draws).toHaveLength(N);
  for (const v of draws) expect(v).toMatch(/^[0-9a-f]{16}$/);

  const unique = new Set(draws);
  // With a shared seed every entry is identical (size === 1); with per-thread
  // OS entropy all 64 are distinct.
  expect(unique.size).toBe(N);
});

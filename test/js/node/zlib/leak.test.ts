import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import { join } from "node:path";

// Each method runs in its own leak-fixture.ts process, so that the memory it
// samples tracks live memory. In this process it does not:
// - ASAN parks every freed block in a 256 MB quarantine, so resident memory
//   follows the allocation volume. ASAN reads ASAN_OPTIONS only at startup.
// - The JIT compiles on its own threads while the loop runs. With no leak that
//   adds 5 to 9 MB over 10,000 calls, in steps of up to 4.7 MB. Without the JIT
//   it is under 1 MB. A leak here is native, so the fixture runs without it.
//
// The async methods are the slowest, so they come first: an ASAN build runs
// only five tests at a time.
const cases = [
  ["deflate", "inflateSync"],
  ["gzip", "gunzipSync"],
  ["brotliCompress", "brotliDecompressSync"],
  ["zstdCompress", "zstdDecompressSync"],
  ["deflateSync", "inflateSync"],
  ["gzipSync", "gunzipSync"],
  ["brotliCompressSync", "brotliDecompressSync"],
  ["zstdCompressSync", "zstdDecompressSync"],
] as const;

// Resident memory sees every leak, but a run with no leak already measures up
// to 3,100 bytes for each call. The native leaks here are far above that: one
// codec state is 320 KB or more, and one input or output is 50,000 bytes. The
// bound is a fifth of that buffer.
const maxResidentBytesPerCall = 10_000;
// A smaller leak is a leak of JS objects, and the JS heap is exact. A run with
// no leak measures 2 bytes for each call at most. One retained closure
// measures 25, and one retained stream 17,000.
const maxHeapBytesPerCall = 256;
// ASAN builds are slower, so they make fewer calls. They can: mimalloc needs
// about 400 zstd calls to settle, and an ASAN build does not use mimalloc.
const callsPerRound = isASAN ? (isDebug ? 15 : 25) : 50;
const rounds = 20;
const warmupRounds = 2;

// `samples` has one value for each round, taken after the full GC that ends
// it. The growth for each round is the median slope over every pair of samples
// (Theil-Sen). A few stray samples cannot move it, and they do happen: with no
// leak, a sample of the resident memory can sit 0.5 MB above the ones around it.
function growthPerCall(samples: number[]): number {
  expect(samples).toHaveLength(rounds);
  const measured = samples.slice(warmupRounds);
  const slopes: number[] = [];
  for (let i = 0; i < measured.length; i++) {
    for (let j = i + 1; j < measured.length; j++) slopes.push((measured[j] - measured[i]) / (j - i));
  }
  return slopes.sort((a, b) => a - b)[slopes.length >> 1] / callsPerRound;
}

describe("zlib compression does not leak memory", () => {
  test.concurrent.each(cases)(
    "%s",
    async (method, inverse) => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          join(import.meta.dir, "leak-fixture.ts"),
          method,
          inverse,
          String(rounds),
          String(callsPerRound),
        ],
        env: {
          ...bunEnv,
          BUN_JSC_useJIT: "0",
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
            .filter(Boolean)
            .join(":"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const { resident, heap, ...report } = JSON.parse(stdout) as { resident: number[]; heap: number[] };
      expect(report).toEqual({
        method,
        calls: rounds * callsPerRound,
        // Every call returned the bytes of the first call, and those bytes
        // decompress to the input.
        mismatches: 0,
        roundTrip: true,
      });
      expect(growthPerCall(heap)).toBeLessThan(maxHeapBytesPerCall);
      expect(growthPerCall(resident)).toBeLessThan(maxResidentBytesPerCall);
      expect(exitCode).toBe(0);
    },
    // Only a debug build needs more than the default: its slowest method takes
    // up to 12 s, and up to 38 s with the exception check validation that the
    // test runner turns on. No CI lane runs one, so each keeps its own timeout.
    isDebug ? 60_000 : undefined,
  );
});

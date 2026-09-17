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
// A smaller leak is a leak of JS objects, and the JS heap counts them to the
// byte. A run with no leak measures 0 bytes for each call at most. One retained
// closure measures 32, and one retained stream 117,000 with its buffers.
const maxHeapBytesPerCall = 256;
// ASAN builds are slower, so they make fewer calls. They can: mimalloc needs
// about 400 zstd calls to settle, and an ASAN build does not use mimalloc.
const callsPerRound = isASAN ? (isDebug ? 15 : 25) : 50;
const rounds = 20;
const warmupRounds = 2;

// `samples` has one value for each round, taken after the full GC that ends
// it. Each estimate below is a median, in bytes for each call.
function median(values: number[]): number {
  return values.sort((a, b) => a - b)[values.length >> 1];
}

function measuredSamples(samples: number[]): number[] {
  expect(samples).toHaveLength(rounds);
  return samples.slice(warmupRounds);
}

// Resident memory is noisy around a level that does not move: with no leak, a
// sample can sit 0.5 MB above the ones around it. The median slope over every
// pair of samples (Theil-Sen) ignores a few such samples.
function residentGrowthPerCall(samples: number[]): number {
  const measured = measuredSamples(samples);
  const slopes: number[] = [];
  for (let i = 0; i < measured.length; i++) {
    for (let j = i + 1; j < measured.length; j++) slopes.push((measured[j] - measured[i]) / (j - i));
  }
  return median(slopes) / callsPerRound;
}

// The JS heap has no such noise, but its level moves. The GC scans the stack
// conservatively. So the 117 KB that one call leaves behind (the stream, its
// input, its output chunks) stay alive for as long as a stale stack word
// points at them, and such a word can appear or go away in the middle of a
// run. To the median slope, one such step in 17 rounds of 25 calls is 275
// bytes for each call. So the heap takes the median of what each round adds: a
// call that leaks adds to every round, and a step adds to one.
function heapGrowthPerCall(samples: number[]): number {
  const measured = measuredSamples(samples);
  return median(measured.slice(1).map((sample, i) => sample - measured[i])) / callsPerRound;
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
      expect(heapGrowthPerCall(heap), `heap samples: ${heap}`).toBeLessThan(maxHeapBytesPerCall);
      expect(residentGrowthPerCall(resident), `resident samples: ${resident}`).toBeLessThan(maxResidentBytesPerCall);
      expect(exitCode).toBe(0);
    },
    // Only a debug build needs more than the default: its slowest method takes
    // up to 12 s, and up to 38 s with the exception check validation that the
    // test runner turns on. No CI lane runs one, so each keeps its own timeout.
    isDebug ? 60_000 : undefined,
  );
});

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

// The smallest leak to catch is one 50,000-byte input or output for each call.
// The bound is a fifth of that. A run with no leak measures 2,400 at most.
const maxBytesPerCall = 10_000;
// ASAN builds are slower, so they make fewer calls. They can: mimalloc needs
// about 400 zstd calls to settle, and an ASAN build does not use mimalloc.
const callsPerRound = isASAN ? (isDebug ? 15 : 25) : 50;
const rounds = 20;
const warmupRounds = 2;

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
      const { samples, leakedHandles, ...report } = JSON.parse(stdout) as { samples: number[]; leakedHandles: number };
      expect(report).toEqual({
        method,
        calls: rounds * callsPerRound,
        // Every call returned the bytes of the first call, and those bytes
        // decompress to the input.
        mismatches: 0,
        roundTrip: true,
        // The count of native handles sees the three streams that the fixture
        // holds open.
        openHandles: 3,
      });
      // A leak is one native handle for each call, so one for each hundred
      // calls is not a leak. The count is not always 0: on Windows, about 1 run
      // in 15 of `gzip` or `deflate` still counts the handle of its last call.
      // One function scope points at it, nothing in a heap snapshot points at
      // that scope, and one event loop turn later both are gone.
      expect(leakedHandles).toBeLessThan((rounds * callsPerRound) / 100);
      expect(samples).toHaveLength(rounds);

      // `samples` is the resident memory after the full GC that ends each round.
      // The growth per round is the median slope over every pair of samples
      // (Theil-Sen). A few stray samples cannot move it, and they do happen:
      // with no leak, a sample can sit 0.5 MB above the ones around it.
      const measured = samples.slice(warmupRounds);
      const slopes: number[] = [];
      for (let i = 0; i < measured.length; i++) {
        for (let j = i + 1; j < measured.length; j++) slopes.push((measured[j] - measured[i]) / (j - i));
      }
      const bytesPerRound = slopes.sort((a, b) => a - b)[slopes.length >> 1];
      expect(bytesPerRound / callsPerRound).toBeLessThan(maxBytesPerCall);
      expect(exitCode).toBe(0);
    },
    // On a debug build the slowest method takes up to 12 s, and up to 38 s when
    // the test runner turns on the exception check validation.
    60_000,
  );
});

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir, withoutAsanQuarantine } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Guards fs.promises.readFile() and writeFile() against a leak of the
// AbortSignal they are given. #16788 fixed two: a call that was rejected
// because its signal was already aborted never freed its arguments, and a call
// that ran never released the signal.
//
// A signal that native code never releases shows in one of two ways:
// - "memory": an aborted signal loses its wrapper at the next GC and the native
//   AbortSignal stays. The wrapper count does not move. Only the resident
//   memory grows, by about 400 bytes for each call (800 on a debug build).
// - "wrappers": a signal that is not aborted and has an "abort" listener keeps
//   its wrapper while native code holds a pending activity count on it. The
//   wrapper count grows by one for each call.
//
// The loop runs in abort-signal-leak-read-write-file-fixture.ts so that the
// memory it samples tracks live memory:
// - ASAN parks every freed block in a 256 MB quarantine, and reads
//   ASAN_OPTIONS only when the process starts.
// - A JIT compile is a step of 2 MB or more. The leak is native, so the
//   fixture runs without the JIT.
// - Each worker thread brings its own stack and heap. A pool of 4 is the same
//   on every machine.
// - The garbage of a round stays in the JS heap until the GC that ends the
//   round, and the part of it that the heap keeps mapped moves the resident
//   memory as much as the leak does. A short round keeps that small.
const fixture = join(import.meta.dir, "abort-signal-leak-read-write-file-fixture.ts");
const callsPerRound = 256;
const callsInFlight = 16;
// A round ends with a GC and a sample: 6 ms on a release build, 25 ms on a
// release ASAN build, 50 ms on a debug build. A debug build also spends 0.6 ms
// on each call. A leak in the wrapper count shows after a few calls.
const rounds = { memory: isDebug ? 20 : isASAN ? 40 : 80, wrappers: 4 };
// A run with no leak measures 27 at most (36 on a debug build).
const maxBytesPerCall = isDebug ? 256 : 128;

const written = (content: string) =>
  Object.fromEntries(Array.from({ length: callsInFlight }, (_, slot) => [`out-${slot}`, content]));

// The median slope over every pair of samples (Theil-Sen). A few stray samples
// cannot move it.
function growthPerRound(samples: number[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) slopes.push((samples[j] - samples[i]) / (j - i));
  }
  return slopes.sort((a, b) => a - b)[slopes.length >> 1];
}

test.concurrent.each([
  // The call is rejected before anything is scheduled. It must not touch the disk.
  ["readFile", "is already aborted", "memory", "AbortError ABORT_ERR", {}],
  ["writeFile", "is already aborted", "memory", "AbortError ABORT_ERR", {}],
  // The call is scheduled, and the signal aborts before the result is back.
  // How much of the data is on disk by then is not specified.
  ["writeFile", "aborts on the next tick", "memory", "AbortError ABORT_ERR", undefined],
  // The call runs to its end.
  ["readFile", "never aborts", "wrappers", 'resolved with "blah"', {}],
  ["writeFile", "never aborts", "wrappers", "resolved", written("blah")],
] as const)(
  "fs.promises.%s does not leak a signal that %s",
  async (method, signal, leakShowsIn, outcome, files) => {
    const roundCount = rounds[leakShowsIn];
    using dir = tempDir("abort-signal-leak", { blah: "blah" });
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, method, signal, ...[roundCount, callsPerRound, callsInFlight].map(String)],
      cwd: String(dir),
      env: { ...withoutAsanQuarantine(bunEnv), BUN_JSC_useJIT: "0", UV_THREADPOOL_SIZE: "4" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { samples, abortSignals, rss, ...report } = JSON.parse(stdout) as {
      outcomes: Record<string, number>;
      samples: number[];
      abortSignals: number;
      rss: number;
    };
    expect(report).toEqual({ outcomes: { [outcome]: roundCount * callsPerRound } });
    if (files) {
      const found = readdirSync(String(dir)).map(name => [name, readFileSync(join(String(dir), name), "utf8")]);
      expect(Object.fromEntries(found)).toEqual({ blah: "blah", ...files });
    }

    // The AbortSignal wrappers on the heap after the last GC.
    expect(abortSignals).toBeLessThanOrEqual(10);

    expect(samples).toHaveLength(roundCount);
    if (leakShowsIn === "memory") {
      // `samples` is the resident memory after the full GC that ends each
      // round. The first tenth is warmup. A leak grows in every part of the
      // run. A step does not: where transparent huge pages are on, the kernel
      // backs a new stretch of a thread stack with 2 MB at once. On an ASAN
      // build that happens in up to one run in 4. So the rest is split in
      // three, and the part that grew the least counts.
      const measured = samples.slice(samples.length / 10);
      const third = measured.length / 3;
      const parts = [0, 1, 2].map(part => measured.slice(part * third, (part + 1) * third));
      const bytesPerCall = Math.min(...parts.map(growthPerRound)) / callsPerRound;
      console.log(`fs.promises.${method}, signal ${signal}: ${Math.round(bytesPerCall)} bytes per call`);
      // The fixture has an exact number to read on Linux only.
      if (isLinux) expect(bytesPerCall).toBeLessThan(maxBytesPerCall);
    }
    // Every platform keeps the ceiling that this test had before it measured
    // the growth.
    expect(rss / 1024 / 1024).toBeLessThan(isASAN ? 700 : 200);
    expect(exitCode).toBe(0);
  },
  // Only a debug build needs more than the default: a long loop takes about
  // 8 s there. No CI lane runs one, so each keeps its own timeout.
  isDebug ? 60_000 : undefined,
);

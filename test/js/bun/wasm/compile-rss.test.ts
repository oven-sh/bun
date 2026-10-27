import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isMacOS } from "harness";
import path from "node:path";

// A burst is 6 compiles of one module, each result dropped. Idle wasm compiler threads that do not
// release what they freed keep 38 to 54 MiB of it after a burst (8 threads), until they exit after
// 10 s. With one release they keep 7 to 44 MiB: one release leaves the large blocks that a thread
// used a moment ago. When they release again for those, RSS returns to about 4 MiB over where it
// started, about 200 ms after the burst.
const idleTargetMiB = 10;

// On Darwin a later burst grows the footprint by 17 to 37 MiB, where the first one grows it by 62
// to 64, so what it leaves says little about what the threads keep. Only the first burst runs
// there.
const laterBursts = !isMacOS;

// Debug and ASAN builds link a JavaScriptCore that does not allocate through mimalloc, so the
// per-thread retention this test checks for does not exist there.
test.skipIf(isDebug || isASAN)(
  "WebAssembly.compile does not retain memory in idle compiler threads (#41438)",
  async () => {
    type Burst = { peakDeltaMiB: number; idleDeltaMiB: number; stalled: boolean };
    let result: { first: Burst; bursts: Burst[] };
    for (let attempt = 0; ; attempt++) {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          path.join(import.meta.dir, "compile-rss-fixture.mjs"),
          String(idleTargetMiB),
          laterBursts ? "later" : "first",
        ],
        env: {
          ...bunEnv,
          // The retained amount scales with the compiler thread count. Pin it so the test does not
          // depend on the core count of the machine.
          BUN_JSC_numberOfWasmCompilerThreads: "8",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      result = JSON.parse(stdout.trim().split("\n").at(-1)!);
      // A first burst that stalled and stayed over the target says nothing about the release (the
      // fixture says why), and only a new process has threads that never released. Measure again.
      if (attempt === 2 || !result.first.stalled || result.first.idleDeltaMiB < idleTargetMiB) break;
    }
    const released = result.bursts.filter(burst => burst.idleDeltaMiB < idleTargetMiB);
    // The whole measurement is in the object so a failure prints it. The compiles have to grow RSS
    // well past the target first, or the idle check means nothing. The fixture says why the first
    // burst is not enough, and how often it repeats a later one.
    expect({
      ...result,
      firstGrew: result.first.peakDeltaMiB > idleTargetMiB * 2,
      firstReleased: result.first.idleDeltaMiB < idleTargetMiB,
      laterGrew: released.every(burst => burst.peakDeltaMiB > idleTargetMiB * 2),
      laterReleased: !laterBursts || released.length >= 2,
    }).toMatchObject({ firstGrew: true, firstReleased: true, laterGrew: true, laterReleased: true });
  },
  // A run that fails polls every burst for its whole second, 5 bursts in all, and can do so 3
  // times. That is to be reported by the assertion with its numbers, and not as a timeout.
  30_000,
);

// A build of Bun configured with webAssembly off (scripts/build/config.ts) has no WebAssembly global.
test.skipIf(typeof WebAssembly !== "undefined")(
  "BUN_JSC_useWasm is accepted and does not bring WebAssembly back",
  async () => {
    for (const useWasm of ["1", "0"]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-p", "typeof WebAssembly"],
        env: { ...bunEnv, BUN_JSC_useWasm: useWasm },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.trim()).toBe("undefined");
      expect(exitCode).toBe(0);
    }
  },
);

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// https://bugs.webkit.org/show_bug.cgi?id=293319
// AbortController.signal.reason is lost after garbage collection
describe("AbortController GC", () => {
  // https://bugs.webkit.org/show_bug.cgi?id=236353
  // verifyGC + collectContinuously is prohibitively slow under Windows CI and
  // the code path under test is platform-independent.
  test.skipIf(isWindows)(
    "reason is marked across concurrent GC (write barrier / output constraint)",
    async () => {
      // verifyGC asserts on reachable cells the concurrent collector missed.
      // Before the fix, abort() after the controller was scanned stored the
      // reason with no write barrier / output constraint, leaving it unmarked.
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const controllers = [];
            for (let iter = 0; iter < 500; iter++) {
              const c = new AbortController();
              controllers.push(c);
              const garbage = [];
              for (let j = 0; j < 50; j++) garbage.push({ a: j, b: new Array(10).fill(j) });
              c.abort(new Error("reason-" + iter));
            }
            let lost = 0;
            for (const c of controllers) {
              if (!(c.signal.reason instanceof Error)) lost++;
            }
            console.log("PASS lost=" + lost);
          `,
        ],
        env: {
          ...bunEnv,
          BUN_JSC_verifyGC: "1",
          BUN_JSC_collectContinuously: "1",
          // `bun -e` sets numberOfGCMarkers=1 for one-shot startup, which
          // serializes marking and hides the race. Restore parallel marking.
          BUN_JSC_numberOfGCMarkers: "8",
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // On failure verifyGC prints "GC Verifier: ERROR cell ... was not marked"
      // to stderr and aborts before stdout is reached. stderr is included for
      // diagnostics only; debug/ASAN builds may emit benign warnings there.
      expect({ stdout: stdout.trim(), exitCode, stderr }).toEqual({
        stdout: "PASS lost=0",
        exitCode: 0,
        stderr: expect.not.stringContaining("was not marked"),
      });
    },
    120_000,
  );

  test("signal.reason survives GC when only controller is retained", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          function createAbortedController(message) {
            const controller = new AbortController();
            controller.abort(new Error(message));
            return controller;
          }

          const errorMessage = "my potato";
          const controller = createAbortedController(errorMessage);

          // Force GC multiple times to trigger collection of signal.reason
          // if it's not properly marked by JSAbortController::visitChildren
          for (let i = 0; i < 10; i++) {
            Bun.gc(true);
          }

          if (controller.signal.reason?.message !== errorMessage) {
            console.error("FAIL: reason was", controller.signal.reason);
            process.exit(1);
          }
          console.log("PASS");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("PASS");
    expect(exitCode).toBe(0);
  });

  // AbortSignal.any(): JSAbortSignalOwner::isReachableFromOpaqueRoots probed the dependent
  // signal's source set with WeakListHashSet::isEmptyIgnoringNullReferences(), which prunes
  // dead entries. It runs on JSC's parallel marker threads, so once every source controller
  // had been collected, a HeapHelper thread destroyed WeakPtrImpls owned by the JS thread
  // ("ASSERTION FAILED: m_creationThread == currentThreadID()"; a data race in release).
  test("AbortSignal.any() dependent signals survive parallel GC after their sources are collected", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const noop = () => {};
          function makeBatch(n) {
            const out = [];
            for (let i = 0; i < n; i++) {
              // The controllers (and their signals) are dropped, so every source of the
              // dependent signal is collected, leaving only dead weak references behind.
              const a = new AbortController();
              const b = new AbortController();
              const c = new AbortController();
              const dep = AbortSignal.any([a.signal, b.signal, c.signal]);
              dep.addEventListener("abort", noop);
              out.push(dep);
            }
            return out;
          }
          const keep = [];
          for (let round = 0; round < 24; round++) {
            keep.push(makeBatch(100));
            if (keep.length > 6) keep.shift();
            Bun.gc(true);
          }
          console.log("PASS");
        `,
      ],
      env: {
        ...bunEnv,
        // `bun -e` defaults to a single GC marker; the weak-handle visit has to happen on
        // the parallel marker threads to reach the cross-thread mutation.
        BUN_JSC_numberOfGCMarkers: "8",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // stderr is only reported for diagnostics; debug/ASAN builds may emit benign warnings.
    expect({ stdout: stdout.trim(), exitCode, stderr }).toEqual({
      stdout: "PASS",
      exitCode: 0,
      stderr: expect.any(String),
    });
  });

  test("signal.reason survives GC with many controllers", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const controllers = [];
          for (let i = 0; i < 100; i++) {
            const c = new AbortController();
            c.abort({ index: i, data: "x".repeat(100) });
            controllers.push(c);
          }

          for (let i = 0; i < 10; i++) {
            Bun.gc(true);
          }

          for (let i = 0; i < 100; i++) {
            const reason = controllers[i].signal.reason;
            if (!reason || reason.index !== i) {
              console.error("FAIL at index", i, "reason:", reason);
              process.exit(1);
            }
          }
          console.log("PASS");
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("PASS");
    expect(exitCode).toBe(0);
  });
});

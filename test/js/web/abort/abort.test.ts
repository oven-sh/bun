import { describe, expect, test } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { tmpdir } from "os";
import { join } from "path";

describe("AbortSignal", () => {
  test("spawn test", async () => {
    const fileName = `/abort.test.ts`;
    const testFileContents = await Bun.file(join(import.meta.dir, "abort.ts")).arrayBuffer();

    writeFileSync(join(tmpdirSync(), fileName), testFileContents, "utf8");
    const { stderr } = Bun.spawnSync({
      cmd: [bunExe(), "test", fileName],
      env: bunEnv,
      cwd: tmpdir(),
    });

    expect(stderr?.toString()).not.toContain("✗");
  });

  test("AbortSignal.timeout(n) should not freeze the process", async () => {
    const fileName = join(import.meta.dir, "abort.signal.ts");

    await using server = Bun.spawn({
      cmd: [bunExe(), fileName],
      env: bunEnv,
      cwd: tmpdir(),
      stdout: "inherit",
      stderr: "inherit",
    });

    expect(await server.exited).toBe(0);
  });

  test("AbortSignal.any() should fire abort event", async () => {
    async function testAny(signalToAbort: number) {
      const { promise, resolve } = Promise.withResolvers();

      const a = new AbortController();
      const b = new AbortController();
      // @ts-ignore
      const signal = AbortSignal.any([a.signal, b.signal]);
      const timeout = setTimeout(() => {
        resolve(false);
      }, 100);

      signal.addEventListener("abort", () => {
        clearTimeout(timeout);
        resolve(true);
      });

      if (signalToAbort) {
        b.abort();
      } else {
        a.abort();
      }

      expect(await promise).toBe(true);
      expect(signal.aborted).toBe(true);
    }

    await testAny(0);
    await testAny(1);
  });

  function fmt(value: any) {
    const res = {};
    for (const key in value) {
      if (key === "column" || key === "line" || key === "sourceURL") continue;
      res[key] = value[key];
    }
    return res;
  }

  test(".signal.reason should be a DOMException", () => {
    const ac = new AbortController();
    ac.abort();
    expect(ac.signal.reason).toBeInstanceOf(DOMException);
    expect(fmt(ac.signal.reason)).toEqual(fmt(new DOMException("The operation was aborted.", "AbortError")));
    expect(ac.signal.reason.code).toBe(20);
  });
  test(".signal.reason should be a DOMException for timeout", async () => {
    const ac = AbortSignal.timeout(0);
    await Bun.sleep(10);
    expect(ac.reason).toBeInstanceOf(DOMException);
    expect(fmt(ac.reason)).toEqual(fmt(new DOMException("The operation timed out.", "TimeoutError")));
    expect(ac.reason.code).toBe(23);
  });

  // #33334: with nothing else ref'd, uv_run() skipped its body on Windows so
  // uv__run_timers never ran and the whole file hung. Subprocess so a
  // regression is an attributable failure, not a file-level timeout.
  test("awaiting AbortSignal.timeout(n) abort event with nothing else ref'd does not hang (#33334)", async () => {
    using dir = tempDir("abort-33334", {
      "timeout.test.ts": `import { expect, test } from "bun:test";
        test("AbortSignal.timeout fires", async () => {
          const signal = AbortSignal.timeout(1);
          const { promise, resolve } = Promise.withResolvers<Event>();
          signal.addEventListener("abort", resolve, { once: true });
          await promise;
          expect(signal.aborted).toBe(true);
        });`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "timeout.test.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr: stderr.includes("1 pass") ? "1 pass" : stderr, exitCode, signalCode: proc.signalCode }).toEqual({
      stderr: "1 pass",
      exitCode: 0,
      signalCode: null,
    });
  });

  // AbortSignal.timeout() takes an extra ref on the C++ signal so it stays
  // alive until the timer fires. If the JS wrapper is collected with no
  // observers before the deadline, that extra ref (and the native timer heap
  // entry) must be released then, not at the deadline; otherwise N dropped
  // AbortSignal.timeout(long) signals hold ~440 B/signal of native state until
  // the timers all fire as no-ops. Node clears the timeout from a
  // FinalizationRegistry on the signal.
  //
  // Observed via the Timeout live-count exposed through bun:internal-for-testing
  // (heapStats() only sees JS wrappers, and RSS does not move under ASAN
  // quarantine). Run in a subprocess so other tests' timeout signals do not
  // perturb the count and so the far-future timers do not outlive the test.
  test("AbortSignal.timeout() cancels its native timer when the unobserved signal is collected", async () => {
    const src = `
      const { heapStats } = require("bun:jsc");
      const { abortSignalTimeoutLiveCount } = require("bun:internal-for-testing");
      const N = 2_000;
      // 1 hour deadline: the test never waits for it, so a timer that survives
      // GC stays in the live count.
      const DEADLINE = 60 * 60 * 1000;

      (function () { for (let i = 0; i < N; i++) AbortSignal.timeout(DEADLINE); })();
      const held = abortSignalTimeoutLiveCount();
      // Give the collector a turn between allocation and the first full GC so
      // incremental sweep can retire the wrappers.
      await new Promise(r => setTimeout(r, 10));
      Bun.gc(true); Bun.gc(true);
      await new Promise(r => setTimeout(r, 10));
      Bun.gc(true);
      const afterGc = abortSignalTimeoutLiveCount();
      const wrappers = heapStats().objectTypeCounts.AbortSignal || 0;
      console.log(JSON.stringify({ held, afterGc, wrappers }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { held, afterGc, wrappers } = JSON.parse(stdout.trim());
    // The JS wrappers are collectable either way (isReachableFromOpaqueRoots
    // returns false for a timeout signal with no listeners); assert that so a
    // live-count regression can be attributed to the native side.
    expect(wrappers).toBeLessThan(100);
    // Before the fix: afterGc === held === N. After: afterGc === 0.
    expect({ held, afterGc }).toEqual({ held: 2_000, afterGc: 0 });
    expect(exitCode).toBe(0);
  });

  // Regression guard for the above: a timeout signal that IS observed (via a
  // listener, or transitively via AbortSignal.any) must not have its timer
  // cancelled by GC of whatever reference the user dropped.
  test("AbortSignal.timeout() still fires after GC when the signal is observed", async () => {
    const src = `
      const { abortSignalTimeoutLiveCount } = require("bun:internal-for-testing");
      const { promise: p1, resolve: r1 } = Promise.withResolvers();
      const { promise: p2, resolve: r2 } = Promise.withResolvers();

      // Direct listener on the timeout signal (the only reference is via the
      // listener closure / the signal's own event listener).
      (function () {
        const s = AbortSignal.timeout(500);
        s.addEventListener("abort", () => r1("direct"), { once: true });
      })();

      // Dependent any() signal: the source timeout signal's JS wrapper is
      // dropped immediately, only the dependent is retained.
      let dep;
      (function () {
        dep = AbortSignal.any([AbortSignal.timeout(500)]);
        dep.addEventListener("abort", () => r2("any"), { once: true });
      })();

      Bun.gc(true);
      Bun.gc(true);
      // Both native timers must have survived GC.
      const liveAfterGc = abortSignalTimeoutLiveCount();

      // AbortSignal.timeout timers are unref'd, so keep a ref'd timer around
      // until both abort events have fired.
      const keepalive = setInterval(() => {}, 1000);
      const results = await Promise.all([p1, p2]);
      clearInterval(keepalive);
      console.log(JSON.stringify({ results, liveAfterGc }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout.trim())).toEqual({ results: ["direct", "any"], liveAfterGc: 2 });
    expect(exitCode).toBe(0);
  });

  // https://wpt.fyi/results/dom/abort/timeout.any.html "AbortSignal timeouts fire in order"
  test("AbortSignal.timeout with equal deadlines fire in creation order", async () => {
    const src = `
      const order = [];
      const done = Promise.withResolvers();
      let remaining = 7;
      const tick = v => { order.push(v); if (--remaining === 0) done.resolve(); };
      for (let i = 0; i < 6; i++) {
        const s = AbortSignal.timeout(5);
        s.onabort = () => tick(i);
      }
      // setTimeout with the same delay is a reference: it already fires in
      // creation order, and these signals should sort alongside it.
      setTimeout(() => tick("t"), 5);
      await done.promise;
      console.log(JSON.stringify(order));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(JSON.parse(stdout.trim())).toEqual([0, 1, 2, 3, 4, 5, "t"]);
    expect(exitCode).toBe(0);
  });
});

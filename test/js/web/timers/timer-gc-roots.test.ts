import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// Rooting armed setTimeout/setInterval wrappers via one HandleSet strong
// handle per timer makes the "Sh" strong-handle marking constraint walk every
// armed timer on every collection, including eden. These tests check that the
// per-timer root has been replaced with a shared root structure.

describe("armed timers do not each hold a JSC strong handle", () => {
  test("heapStats().protectedObjectTypeCounts", async () => {
    const src = `
      const { heapStats } = require("bun:jsc");
      const N = 10000;
      const h = [];
      for (let i = 0; i < N; i++) h.push(setTimeout(() => {}, 600000));
      Bun.gc(true);
      const armed = heapStats();
      for (const t of h) clearTimeout(t);
      Bun.gc(true);
      const cleared = heapStats();
      console.log(JSON.stringify({
        N,
        armedProtected: armed.protectedObjectCount,
        clearedProtected: cleared.protectedObjectCount,
        armedTimeout: armed.protectedObjectTypeCounts?.Timeout ?? 0,
        armedTimeoutLive: armed.objectTypeCounts?.Timeout ?? 0,
      }));
      process.exit(0);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { N, armedProtected, clearedProtected, armedTimeout, armedTimeoutLive } = JSON.parse(stdout);
    // The wrappers themselves are live (held by the `h` array).
    expect(armedTimeoutLive).toBeGreaterThanOrEqual(N);
    // No Timeout wrapper is rooted via the strong HandleSet. The table
    // segments (10000 / 4096 = 3) are fine; a per-timer Strong would show
    // 10000 here.
    expect(armedTimeout).toBe(0);
    expect(armedProtected).toBeLessThan(100);
    // Clearing should not regress the strong-handle count.
    expect(clearedProtected).toBeLessThanOrEqual(armedProtected);
    expect(exitCode).toBe(0);
  });

  for (const kind of ["setTimeout", "setInterval", "setImmediate"] as const) {
    test(`${kind}: callback stays reachable across GC while armed`, async () => {
      const body =
        kind === "setImmediate"
          ? `setImmediate(f);`
          : kind === "setInterval"
            ? `const t = setInterval(() => { f(); clearInterval(t); }, 10);`
            : `setTimeout(f, 10);`;
      const src = `
        (function () {
          let hits = 0;
          const f = () => { hits++; if (hits === 1) console.log("ok"); };
          ${body}
        })();
        Bun.gc(true);
        Bun.gc(true);
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", src],
        env: bunEnv,
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("ok\n");
      expect(exitCode).toBe(0);
    });
  }

  test("refresh() re-roots a fired timer", async () => {
    const src = `
      let calls = 0;
      const t = setTimeout(function f() {
        calls++;
        if (calls === 1) {
          t.refresh();
          Bun.gc(true);
        } else {
          console.log("ok");
        }
      }, 5);
      Bun.gc(true);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ok\n");
    expect(exitCode).toBe(0);
  });
});

describe("AbortSignal.timeout is released when its wrapper is collected", () => {
  test("dropped signals without listeners free their native timer", async () => {
    // The native Timeout box plus the C++ AbortSignal it keeps alive is a few
    // hundred bytes; 30000 leaked signals are well over 10 MB of RSS that
    // should come back once the wrappers are collected.
    const src = `
      const N = 30000;
      async function round() {
        for (let i = 0; i < N; i++) AbortSignal.timeout(600000);
        for (let k = 0; k < 6; k++) {
          Bun.gc(true);
          await new Promise(r => setTimeout(r, 10));
        }
      }
      // First round warms up the TZone allocator pool and JSC heap so the
      // second round measures steady-state growth only.
      await round();
      const before = process.memoryUsage().rss;
      await round();
      const after = process.memoryUsage().rss;
      console.log(JSON.stringify({ deltaMB: (after - before) / (1024 * 1024) }));
      process.exit(0);
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { deltaMB } = JSON.parse(stdout);
    // With the refcount cycle this retains the full batch every round
    // (tens of MB). With the timer freed at wrapper GC, steady-state growth
    // is near zero; allow slack for allocator quarantine under ASAN.
    const limit = isASAN || isDebug ? 8 : 4;
    expect(deltaMB).toBeLessThan(limit);
    expect(exitCode).toBe(0);
  });

  test("signals with an abort listener still fire", async () => {
    const src = `
      (function () {
        const s = AbortSignal.timeout(20);
        s.addEventListener("abort", () => console.log("ok:" + s.aborted));
      })();
      Bun.gc(true);
      await new Promise(r => setTimeout(r, 200));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ok:true\n");
    expect(exitCode).toBe(0);
  });
});

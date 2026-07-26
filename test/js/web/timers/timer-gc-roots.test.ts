import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";

// Rooting armed setTimeout/setInterval wrappers via one HandleSet strong
// handle per timer makes the "Sh" strong-handle marking constraint walk every
// armed timer on every collection, including eden. These tests check that the
// per-timer root has been replaced with a shared root structure.

describe.concurrent("armed timers do not each hold a JSC strong handle", () => {
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
    // No Timeout wrapper is rooted via the strong HandleSet; a per-timer
    // Strong would show 10000 here.
    expect(armedTimeout).toBe(0);
    expect(armedProtected).toBeLessThan(100);
    // Clearing should not regress the strong-handle count.
    expect(clearedProtected).toBeLessThanOrEqual(armedProtected);
    expect(exitCode).toBe(0);
  });

  test("root segments are reclaimed after a burst", async () => {
    const src = `
      const { heapStats } = require("bun:jsc");
      const N = 10000;
      const h = [];
      for (let i = 0; i < N; i++) h.push(setTimeout(() => {}, 600000));
      Bun.gc(true);
      const armedSegments = heapStats().objectTypeCounts.TimerRootSegment || 0;
      for (const t of h) clearTimeout(t);
      Bun.gc(true);
      await new Promise(r => setTimeout(r, 0));
      Bun.gc(true);
      const clearedSegments = heapStats().objectTypeCounts.TimerRootSegment || 0;
      console.log(JSON.stringify({ armedSegments, clearedSegments }));
      process.exit(0);
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { armedSegments, clearedSegments } = JSON.parse(stdout);
    // 10000 / 4096 rounds up to 3 segments while armed; after clearing, all
    // but one spare segment are released for GC.
    expect(armedSegments).toBeGreaterThanOrEqual(3);
    expect(clearedSegments).toBeLessThanOrEqual(1);
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
      (function () {
        let calls = 0;
        setTimeout(function () {
          if (++calls === 1) {
            this.refresh();
            // Runs after this fire has returned and before the refreshed fire
            // (~200 ms); the root-table slot is the only thing keeping the
            // wrapper alive during this GC.
            setTimeout(() => Bun.gc(true), 30);
          } else {
            console.log("ok");
            process.exit(0);
          }
        }, 100);
      })();
      Bun.gc(true);
      setTimeout(() => { console.log("never fired"); process.exit(1); }, 2000);
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

  test("ShadowRealm timers use the per-VM segment list", async () => {
    const src = `
      new ShadowRealm().evaluate("setTimeout(() => {}, 10); 0");
      Bun.gc(true);
      await new Promise(r => setTimeout(r, 50));
      Bun.gc(true);
      setTimeout(() => console.log("ok"), 1);
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ok\n");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("AbortSignal.timeout is released when its wrapper is collected", () => {
  test("dropped signals without listeners free their native timer", async () => {
    // The native Timeout box plus the C++ AbortSignal it keeps alive is a few
    // hundred bytes; 15000 leaked signals are ~7 MB of RSS per round that
    // should come back once the wrappers are collected.
    const src = `
      const N = 15000;
      async function round() {
        for (let i = 0; i < N; i++) AbortSignal.timeout(600000);
        for (let k = 0; k < 4; k++) {
          Bun.gc(true);
          await new Promise(r => setTimeout(r, 10));
        }
      }
      // First round warms up the TZone allocator pool and JSC heap so the
      // measured rounds see steady-state growth only.
      await round();
      const before = process.memoryUsage().rss;
      await round();
      await round();
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
    // With the refcount cycle this retains ~7 MB per round (20+ MB over three
    // rounds). With the timer freed at wrapper GC, steady-state growth is
    // allocator noise; allow slack for ASAN quarantine and musl fragmentation.
    const limit = isASAN || isDebug ? 14 : 10;
    expect(deltaMB).toBeLessThan(limit);
    expect(exitCode).toBe(0);
  }, 10_000);

  for (const { name, body } of [
    {
      name: "with an abort listener",
      body: `
        const s = AbortSignal.timeout(20);
        s.addEventListener("abort", () => { console.log("ok:" + s.aborted); process.exit(0); });
      `,
    },
    {
      name: "used as a source of AbortSignal.any()",
      body: `
        const s = AbortSignal.any([AbortSignal.timeout(20)]);
        s.addEventListener("abort", () => { console.log("ok:" + s.aborted); process.exit(0); });
      `,
    },
    {
      name: "passed as addEventListener { signal }",
      body: `
        const t = new EventTarget();
        const fail = () => { console.log("listener leaked"); process.exit(1); };
        t.addEventListener("ping", fail, { signal: AbortSignal.timeout(20) });
        globalThis.__probe = () => {
          t.dispatchEvent(new Event("ping"));
          console.log("ok:true");
          process.exit(0);
        };
      `,
    },
  ]) {
    test(`signals ${name} still fire`, async () => {
      const src = `
        (function () { ${body} })();
        Bun.gc(true);
        // AbortSignal.timeout does not ref the event loop, so a ref'd timer
        // must keep the process alive past the 20 ms deadline.
        setTimeout(() => {
          if (globalThis.__probe) return globalThis.__probe();
          console.log("never fired");
          process.exit(1);
        }, 500);
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
  }
});

test.concurrent("bun test --isolate rearms timers on the new global", async () => {
  using dir = tempDir("timer-root-isolate", {
    "a.test.ts": `
      import { test, expect } from "bun:test";
      test("a", async () => {
        await new Promise<void>(r => setTimeout(r, 1));
        expect(true).toBe(true);
      });
    `,
    "b.test.ts": `
      import { test, expect } from "bun:test";
      test("b", async () => {
        await new Promise<void>(r => setTimeout(r, 1));
        expect(true).toBe(true);
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--isolate", "a.test.ts", "b.test.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("2 pass");
  expect(exitCode).toBe(0);
});

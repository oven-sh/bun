import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

// An armed timer pins its Timeout object through a bun_jsc::Strong, which is a
// slot in the VM's JSC::StrongSet, the same storage JSC::Strong<> uses. Those
// slots are what heapStats() reports as protected objects and what
// getProtectedObjects() returns, and the pin goes away with the timer.

describe.concurrent("Strong handles are JSC strong-handle slots", () => {
  test("heapStats and getProtectedObjects report armed timers, and only while armed", async () => {
    const src = `
      const { heapStats, getProtectedObjects } = require("bun:jsc");
      const N = 5000;
      const h = [];
      for (let i = 0; i < N; i++) h.push(setTimeout(() => {}, 600000));
      const TimeoutPrototype = Object.getPrototypeOf(h[0]);
      const countTimeouts = () =>
        getProtectedObjects().filter(o => typeof o === "object" && o !== null && Object.getPrototypeOf(o) === TimeoutPrototype).length;
      Bun.gc(true);
      const armed = heapStats();
      const armedProtected = countTimeouts();
      for (const t of h) clearTimeout(t);
      Bun.gc(true);
      await new Promise(r => setTimeout(r, 0));
      Bun.gc(true);
      const cleared = heapStats();
      console.log(JSON.stringify({
        N,
        armedTimeout: armed.protectedObjectTypeCounts.Timeout || 0,
        armedProtected,
        armedProtectedCountCoversTimers: armed.protectedObjectCount >= N,
        clearedTimeout: cleared.protectedObjectTypeCounts.Timeout || 0,
        clearedProtected: countTimeouts(),
        clearedObjectTypes: Object.keys(cleared.objectTypeCounts).filter(k => /Strong/.test(k)),
      }));
      process.exit(0);
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    expect(result).toEqual({
      N: 5000,
      armedTimeout: 5000,
      armedProtected: 5000,
      armedProtectedCountCoversTimers: true,
      clearedTimeout: 0,
      clearedProtected: 0,
      // The slots are not heap cells, so nothing shows up in objectTypeCounts.
      clearedObjectTypes: [],
    });
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
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("ok\n");
      expect(exitCode).toBe(0);
    });
  }
});

describe.concurrent("AbortSignal.timeout is released when its wrapper is collected", () => {
  test("dropped signals without listeners free their native timer", async () => {
    const src = `
      const N = 15000;
      async function round() {
        for (let i = 0; i < N; i++) AbortSignal.timeout(600000);
        for (let k = 0; k < 4; k++) {
          Bun.gc(true);
          await new Promise(r => setTimeout(r, 10));
        }
      }
      await round();
      const before = process.memoryUsage().rss;
      await round();
      await round();
      await round();
      const after = process.memoryUsage().rss;
      console.log(JSON.stringify({ deltaMB: (after - before) / (1024 * 1024) }));
      process.exit(0);
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { deltaMB } = JSON.parse(stdout);
    // With the refcount cycle this retains ~7 MB per round (20+ MB over three
    // rounds). With the timer freed at wrapper GC, steady-state growth is
    // allocator noise.
    const limit = isASAN || isDebug ? 14 : 10;
    expect(deltaMB).toBeLessThan(limit);
    expect(exitCode).toBe(0);
  }, 15_000);

  test("AbortSignal.any([timeout, controller.signal]).abort releases the timeout", async () => {
    const src = `
      const N = 1200;
      async function round() {
        for (let i = 0; i < N; i++) {
          const c = new AbortController();
          const s = AbortSignal.any([AbortSignal.timeout(600000), c.signal]);
          s.addEventListener("abort", () => {});
          c.abort();
        }
        for (let k = 0; k < 4; k++) {
          Bun.gc(true);
          await new Promise(r => setTimeout(r, 10));
        }
      }
      await round();
      const before = process.memoryUsage().rss;
      await round();
      await round();
      const after = process.memoryUsage().rss;
      const live = require("bun:jsc").heapStats().objectTypeCounts.AbortSignal || 0;
      console.log(JSON.stringify({ deltaMB: (after - before) / (1024 * 1024), live }));
      process.exit(0);
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { deltaMB, live } = JSON.parse(stdout);
    expect(live).toBeLessThan(50);
    const limit = isASAN || isDebug ? 8 : 4;
    expect(deltaMB).toBeLessThan(limit);
    expect(exitCode).toBe(0);
  }, 15_000);

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
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("ok:true\n");
      expect(exitCode).toBe(0);
    });
  }
});

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import path from "node:path";

// bun_jsc::Strong handles now live in StrongRootBlock cells (rooted by a
// per-VM marking constraint on JSVMClientData; slots re-visited on eden via the
// write-barrier remembered set) instead of one HandleSet strong handle per
// armed timer, so the "Sh" strong-handle marking constraint no longer walks
// every armed timer on every eden collection. heapStats() walks the block list
// to keep protectedObjectTypeCounts/protectedObjectCount user-visible.

describe.concurrent("Strong handles are backed by StrongRootBlock", () => {
  // SQL statements drop their cached-Structure Strongs from JSCell destructors, i.e. mid-sweep;
  // emptying and unlinking a block from there must not touch sibling cells (debug builds assert).
  test("blocks emptied from sweep-time finalizers are released", async () => {
    const fixture = path.join(import.meta.dir, "../../sql/postgres-statement-structure-gc.fixture.ts");
    await using proc = Bun.spawn({ cmd: [bunExe(), fixture], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { count, protectedWhileHeld, protectedAfter } = JSON.parse(stdout.trim().split("\n").at(-1)!);
    expect(protectedWhileHeld).toBeGreaterThanOrEqual(count);
    expect(protectedAfter).toBeLessThan(10);
    expect(exitCode).toBe(0);
  });

  test("heapStats still reports protected Timeout counts", async () => {
    const src = `
      const { heapStats } = require("bun:jsc");
      const N = 5000;
      const h = [];
      for (let i = 0; i < N; i++) h.push(setTimeout(() => {}, 600000));
      Bun.gc(true);
      const armed = heapStats();
      for (const t of h) clearTimeout(t);
      Bun.gc(true);
      await new Promise(r => setTimeout(r, 0));
      Bun.gc(true);
      const cleared = heapStats();
      console.log(JSON.stringify({
        N,
        armedTimeout: armed.protectedObjectTypeCounts.Timeout || 0,
        armedBlocks: armed.objectTypeCounts.StrongRootBlock || 0,
        clearedTimeout: cleared.protectedObjectTypeCounts.Timeout || 0,
        clearedBlocks: cleared.objectTypeCounts.StrongRootBlock || 0,
      }));
      process.exit(0);
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { N, armedTimeout, armedBlocks, clearedTimeout, clearedBlocks } = JSON.parse(stdout);
    // protectedObjectTypeCounts walks the block list, so the count is preserved.
    expect(armedTimeout).toBe(N);
    // N/capacity blocks while armed; all but one spare released after clearing.
    expect(armedBlocks).toBeGreaterThanOrEqual(3);
    expect(clearedTimeout).toBe(0);
    expect(clearedBlocks).toBeLessThanOrEqual(1);
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

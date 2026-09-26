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

  // The two tests below lay blocks out exactly, which relies on CAP matching
  // StrongRootBlock::capacity and on a fresh process holding no Strongs; both
  // are checked through the block counts they print.
  const CAP = 960;

  test("a Strong released from a GC finalizer can unlink a block from the middle of the list", async () => {
    // Listener.stop() empties its `data` Strong but keeps the slot allocated, so
    // the slot is released when the wrapper is finalized, i.e. while JSC is
    // sweeping. `older` fills three blocks exactly, so `data` opens a block of
    // its own ("M"), which the first CAP-1 `newer` timers then fill; the rest of
    // `newer` goes into two blocks linked ahead of it. Clearing the timers that
    // share M leaves `data` as its only occupant, with live blocks on both sides,
    // so releasing it during the sweep has to relink M's neighbours.
    const src = `
      const { heapStats } = require("bun:jsc");
      const older = [];
      for (let i = 0; i < 3 * ${CAP}; i++) older.push(setTimeout(() => {}, 600000));
      (function () {
        const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, data: {}, socket: { data() {} } });
        listener.stop();
      })();
      const newer = [];
      for (let i = 0; i < 2 * ${CAP}; i++) newer.push(setTimeout(() => {}, 600000));
      for (const t of newer.splice(0, ${CAP} - 1)) clearTimeout(t);
      const blocksArmed = heapStats().objectTypeCounts.StrongRootBlock || 0;
      await new Promise(r => setTimeout(r, 0));
      Bun.gc(true);
      await new Promise(r => setTimeout(r, 0));
      Bun.gc(true);
      const protectedTimeouts = heapStats().protectedObjectTypeCounts.Timeout || 0;
      console.log(JSON.stringify({ blocksArmed, protectedTimeouts }));
      for (const t of older) clearTimeout(t);
      for (const t of newer) clearTimeout(t);
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      // three `older` blocks, M, two `newer` blocks
      blocksArmed: 6,
      // protectedObjectTypeCounts walks the list from the head, so this only
      // adds up if unlinking M left the blocks on both sides of it connected.
      protectedTimeouts: 3 * CAP + (CAP + 1),
    });
    expect(exitCode).toBe(0);
  });

  test("re-linking an old block ahead of new blocks keeps them alive across an eden GC", async () => {
    // A block that survived a collection is skipped by the next eden GC unless a
    // write barrier put it back in the remembered set. When acquire() re-links
    // the parked spare (old) ahead of blocks allocated since the last
    // collection, the m_next store has to be that barrier: the slot store that
    // follows it does not remember the block when the value is not a cell,
    // which is what `listener.data = 1` arms.
    //
    // `a` is exactly blocks A1+A2 (old after the full GC). The unreferenced
    // timers are exactly three new blocks, and their Timeouts are rooted only
    // through those blocks' slots. Clearing `a` parks A1 as the spare and
    // leaves the list exactly full, so `listener.data = 1` re-links A1 ahead of
    // the new blocks.
    const src = `
      const { heapStats, edenGC } = require("bun:jsc");
      const blocks = () => heapStats().objectTypeCounts.StrongRootBlock || 0;
      const protectedTimeouts = () => heapStats().protectedObjectTypeCounts.Timeout || 0;
      const blocksAtStart = blocks();
      const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
      listener.stop();
      const a = [];
      for (let i = 0; i < 2 * ${CAP}; i++) a.push(setTimeout(() => {}, 600000));
      Bun.gc(true);
      const blocksOld = blocks();
      for (let i = 0; i < 3 * ${CAP}; i++) setTimeout(() => {}, 600000);
      const blocksNew = blocks();
      for (const t of a) clearTimeout(t);
      listener.data = 1;
      const beforeEden = protectedTimeouts();
      edenGC();
      // Allocate Timeout cells so that anything the eden GC failed to keep alive
      // is swept, releasing its slot, before counting again.
      for (let i = 0; i < 2 * ${CAP}; i++) setTimeout(() => {}, 0);
      await new Promise(r => setTimeout(r, 0));
      console.log(JSON.stringify({ blocksAtStart, blocksOld, blocksNew, beforeEden, afterEden: protectedTimeouts() }));
      process.exit(0);
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", src], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      blocksAtStart: 0,
      blocksOld: 2,
      blocksNew: 5,
      beforeEden: 3 * CAP,
      // Without the barrier the eden GC frees the three new blocks and every
      // Timeout they rooted, and this reads 0.
      afterEden: 3 * CAP,
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

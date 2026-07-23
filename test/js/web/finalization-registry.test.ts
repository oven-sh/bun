import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// JavaScriptCore's async bytecode generator only preserves locals that are read
// after an `await`, so a FinalizationRegistry held only by a module-level or
// async-function `const` whose last use is `register()` becomes unreachable at
// the next suspend point. Without an extra root the registry is swept before
// its targets are observed as dead, and no cleanup callback ever fires (node
// delivers them because V8 preserves every async-function local across await).

async function run(source: string) {
  // Module files, not `-e`: the eval wrapper's extra frames leave conservative
  // stack roots that keep otherwise-dead cells alive for a few extra cycles.
  using dir = tempDir("finalization-registry", { "entry.mjs": source });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  let json: unknown;
  try {
    json = JSON.parse(stdout.trim());
  } catch {
    json = undefined;
  }
  return { stdout, stderr, exitCode, json };
}

describe("FinalizationRegistry keeps itself alive while it has registrations", () => {
  test.concurrent(
    "cleanup callbacks fire when the registry local dies before its targets",
    async () => {
      const { stdout, stderr, exitCode, json } = await run(/* js */ `
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const K = 500;
        let cleaned = 0;
        const fr = new FinalizationRegistry(() => { cleaned++; });
        const wrs = [];
        for (let i = 0; i < K; i++) {
          const o = { i, pad: Buffer.alloc(30, "p").toString() };
          wrs.push(new WeakRef(o));
          fr.register(o, i);
        }
        await sleep(300);
        for (let r = 0; r < 30; r++) {
          Bun.gc(true);
          await sleep(10);
          if (cleaned >= K) break;
        }
        const collected = wrs.filter(w => w.deref() === undefined).length;
        console.log(JSON.stringify({ K, collected, cleaned }));
      `);
      expect(stderr).toBe("");
      expect(stdout.trim()).not.toBe("");
      const { K, collected, cleaned } = json as { K: number; collected: number; cleaned: number };
      expect(collected).toBeGreaterThanOrEqual(K - 1);
      // Without the rooting fix `cleaned` is 0 here; with it every collected
      // target's callback runs.
      expect(cleaned).toBe(collected);
      expect(cleaned).toBeGreaterThanOrEqual(K - 1);
      expect(exitCode).toBe(0);
    },
  );

  test.concurrent("same inside an async function (not just module top level)", async () => {
    const { stderr, exitCode, json } = await run(/* js */ `
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      async function main() {
        let cleaned = 0;
        const fr = new FinalizationRegistry(() => { cleaned++; });
        for (let i = 0; i < 200; i++) fr.register({ i }, i);
        await 0;
        for (let r = 0; r < 30; r++) {
          Bun.gc(true);
          await sleep(10);
          if (cleaned >= 200) break;
        }
        console.log(JSON.stringify({ cleaned }));
      }
      await main();
    `);
    expect(stderr).toBe("");
    expect((json as { cleaned: number }).cleaned).toBeGreaterThanOrEqual(199);
    expect(exitCode).toBe(0);
  });

  test.concurrent("the registry is released once every registration is drained", async () => {
    const { stderr, exitCode, json } = await run(/* js */ `
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      let cleaned = 0;
      globalThis.frw = undefined;
      (function () {
        const fr = new FinalizationRegistry(() => { cleaned++; });
        globalThis.frw = new WeakRef(fr);
        for (let i = 0; i < 100; i++) fr.register({ i }, i);
      })();
      for (let r = 0; r < 30; r++) {
        Bun.gc(true);
        await sleep(10);
        if (cleaned >= 100) break;
      }
      for (let r = 0; r < 30; r++) {
        Bun.gc(true);
        await sleep(10);
        if (globalThis.frw.deref() === undefined) break;
      }
      console.log(JSON.stringify({ cleaned, drained: globalThis.frw.deref() === undefined }));
    `);
    expect(stderr).toBe("");
    const { cleaned, drained } = json as { cleaned: number; drained: boolean };
    expect(cleaned).toBe(100);
    // Released once drained; otherwise the Strong root would leak it forever.
    expect(drained).toBe(true);
    expect(exitCode).toBe(0);
  });

  // Conservative stack scanning can pin any one cell for a few cycles; use a
  // batch of registries so a stray stack word can only shadow the count, never
  // the invariant that the Strong root is released.
  test.concurrent("unregister() that drains every entry releases the root", async () => {
    const { stderr, exitCode, json } = await run(/* js */ `
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const wrs = [];
      (function () {
        const tok = {};
        for (let n = 0; n < 200; n++) {
          const fr = new FinalizationRegistry(() => {});
          wrs.push(new WeakRef(fr));
          for (let i = 0; i < 4; i++) fr.register(globalThis, i, tok);
          fr.unregister(tok);
        }
      })();
      for (let r = 0; r < 30; r++) {
        Bun.gc(true);
        await sleep(5);
        if (wrs.every(w => w.deref() === undefined)) break;
      }
      const alive = wrs.filter(w => w.deref() !== undefined).length;
      console.log(JSON.stringify({ alive, total: wrs.length }));
    `);
    expect(stderr).toBe("");
    const { alive, total } = json as { alive: number; total: number };
    expect(total).toBe(200);
    expect(alive).toBeLessThanOrEqual(2);
    expect(exitCode).toBe(0);
  });

  test.concurrent("a registry that never registers stays collectable", async () => {
    const { stderr, exitCode, json } = await run(/* js */ `
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const wrs = [];
      (function () {
        for (let n = 0; n < 200; n++) {
          const fr = new FinalizationRegistry(() => {});
          wrs.push(new WeakRef(fr));
        }
      })();
      for (let r = 0; r < 30; r++) {
        Bun.gc(true);
        await sleep(5);
        if (wrs.every(w => w.deref() === undefined)) break;
      }
      const alive = wrs.filter(w => w.deref() !== undefined).length;
      console.log(JSON.stringify({ alive, total: wrs.length }));
    `);
    expect(stderr).toBe("");
    const { alive, total } = json as { alive: number; total: number };
    expect(total).toBe(200);
    expect(alive).toBeLessThanOrEqual(2);
    expect(exitCode).toBe(0);
  });

  test.concurrent("register/unregister argument validation is unchanged", async () => {
    const { stderr, exitCode, json } = await run(/* js */ `
      const fr = new FinalizationRegistry(() => {});
      const errors = [];
      const catchType = fn => { try { fn(); errors.push(null); } catch (e) { errors.push(e?.constructor?.name); } };
      catchType(() => fr.register(42, "x"));
      catchType(() => fr.register({}, "x", 42));
      const obj = {};
      catchType(() => fr.register(obj, obj));
      catchType(() => fr.unregister(42));
      catchType(() => FinalizationRegistry.prototype.register.call({}, {}, "x"));
      const tok = {};
      fr.register({}, "x", tok);
      const ok = fr.unregister(tok);
      const okTwice = fr.unregister(tok);
      console.log(JSON.stringify({ errors, ok, okTwice, len: fr.register.length, ulen: fr.unregister.length }));
    `);
    expect(stderr).toBe("");
    expect(json).toEqual({
      errors: ["TypeError", "TypeError", "TypeError", "TypeError", "TypeError"],
      ok: true,
      okTwice: false,
      len: 2,
      ulen: 1,
    });
    expect(exitCode).toBe(0);
  });
});

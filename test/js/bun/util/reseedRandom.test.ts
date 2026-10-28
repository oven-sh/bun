import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Bun.reseedRandom() exists for a process whose address space was duplicated
// without a fork (a VM snapshot restored into several clones). A test cannot
// snapshot a process, so each case checks the observable effect on one of the
// three generators the call re-derives: the BoringSSL DRBG behind
// crypto.getRandomValues (every thread), the per-VM buffered random bytes
// (randomUUID, the default CSRF secret), and Math.random's seed on every global.

async function run(script: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return JSON.parse(stdout);
}

describe.concurrent("Bun.reseedRandom", () => {
  test("is a function that returns undefined", async () => {
    expect(
      await run(`console.log(JSON.stringify([typeof Bun.reseedRandom, Bun.reseedRandom.length, Bun.reseedRandom()]))`),
    ).toEqual(["function", 0, null]);
  });

  test("reseeds Math.random on the calling global and on every other global of the VM", async () => {
    const result = await run(`
      const { getRandomSeed } = require("bun:jsc");
      const realm = new ShadowRealm();
      const realmSeed = await realm.importValue("bun:jsc", "getRandomSeed");
      const before = { main: getRandomSeed(), realm: realmSeed() };
      Bun.reseedRandom();
      const after = { main: getRandomSeed(), realm: realmSeed() };
      Bun.reseedRandom();
      const again = { main: getRandomSeed(), realm: realmSeed() };
      console.log(JSON.stringify({
        mainChanged: before.main !== after.main && after.main !== again.main,
        realmChanged: before.realm !== after.realm && after.realm !== again.realm,
        distinct: after.main !== after.realm,
        stable: getRandomSeed() === again.main,
      }));
    `);
    expect(result).toEqual({ mainChanged: true, realmChanged: true, distinct: true, stable: true });
  });

  test("reseeds Math.random in a Worker when its event loop next runs", async () => {
    const result = await run(`
      const { getRandomSeed } = require("bun:jsc");
      const source = \`
        const { getRandomSeed } = require("bun:jsc");
        self.onmessage = () => postMessage(getRandomSeed());
        postMessage(getRandomSeed());
      \`;
      const worker = new Worker("data:text/javascript," + encodeURIComponent(source));
      const next = () => new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
      const before = await next();
      Bun.reseedRandom();
      // The reseed is a task on the worker's loop. Ask until the worker has run it.
      let after = before;
      for (let i = 0; i < 1000 && after === before; i++) {
        worker.postMessage(0);
        after = await next();
      }
      worker.terminate();
      console.log(JSON.stringify({ changed: after !== before, mainDiffers: after !== getRandomSeed() }));
    `);
    expect(result).toEqual({ changed: true, mainDiffers: true });
  });

  test("reseeds Math.random in node:vm contexts, live and created later", async () => {
    const result = await run(`
      const { getRandomSeed } = require("bun:jsc");
      const vm = require("vm");
      // A host function reports the seed of its own realm, so read a context's
      // seed through an object that belongs to it.
      const seedOf = context => getRandomSeed(vm.runInContext("Math", context));
      const context = vm.createContext({});
      const before = { main: getRandomSeed(), context: seedOf(context) };
      Bun.reseedRandom();
      const after = { main: getRandomSeed(), context: seedOf(context) };
      Bun.reseedRandom();
      const again = { main: getRandomSeed(), context: seedOf(context) };
      const later = seedOf(vm.createContext({}));
      console.log(JSON.stringify({
        contextChanged: before.context !== after.context && after.context !== again.context,
        distinct: new Set([again.main, again.context, later]).size === 3,
      }));
    `);
    expect(result).toEqual({ contextChanged: true, distinct: true });
  });

  test("a call from a Worker reseeds the main thread", async () => {
    const result = await run(`
      const { getRandomSeed } = require("bun:jsc");
      const source = \`
        const { getRandomSeed } = require("bun:jsc");
        self.onmessage = () => { Bun.reseedRandom(); postMessage(getRandomSeed()); };
      \`;
      const worker = new Worker("data:text/javascript," + encodeURIComponent(source));
      const next = () => new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
      const token = Bun.CSRF.generate();
      const before = getRandomSeed();
      worker.postMessage(0);
      const workerSeed = await next();
      // The reseed is a task on this loop, queued before the reply. Poll in case it is not.
      for (let i = 0; i < 1000 && getRandomSeed() === before; i++) await new Promise(setImmediate);
      worker.terminate();
      console.log(JSON.stringify({
        mainChanged: getRandomSeed() !== before,
        tokenDropped: !Bun.CSRF.verify(token),
        workerDiffers: workerSeed !== getRandomSeed(),
      }));
    `);
    expect(result).toEqual({ mainChanged: true, tokenDropped: true, workerDiffers: true });
  });

  test("keeps a seed pinned by BUN_JSC_forceWeakRandomSeed", async () => {
    const result = await run(
      `
      const { getRandomSeed } = require("bun:jsc");
      const vm = require("vm");
      const context = vm.createContext({});
      const before = [getRandomSeed(), getRandomSeed(vm.runInContext("Math", context))];
      Bun.reseedRandom();
      console.log(JSON.stringify([...before, getRandomSeed(), getRandomSeed(vm.runInContext("Math", context))]));
    `,
      { BUN_JSC_forceWeakRandomSeed: "1", BUN_JSC_forcedWeakRandomSeed: "42" },
    );
    expect(result).toEqual([42, 42, 42, 42]);
  });

  test("drops the default CSRF secret", async () => {
    const result = await run(`
      const token = Bun.CSRF.generate();
      const before = Bun.CSRF.verify(token);
      Bun.reseedRandom();
      const after = Bun.CSRF.verify(token);
      const fresh = Bun.CSRF.verify(Bun.CSRF.generate());
      console.log(JSON.stringify({ before, after, fresh }));
    `);
    expect(result).toEqual({ before: true, after: false, fresh: true });
  });

  test("the generators keep producing distinct values after the call", async () => {
    const result = await run(`
      const hex = () => Buffer.from(crypto.getRandomValues(new Uint8Array(1024))).toString("hex");
      const sample = () => ({ bytes: hex(), uuid: crypto.randomUUID(), v7: Bun.randomUUIDv7(), math: Math.random() });
      const before = sample();
      Bun.reseedRandom();
      const after = sample();
      const later = sample();
      const distinct = Object.keys(before).every(k => before[k] !== after[k] && after[k] !== later[k]);
      console.log(JSON.stringify({ distinct, uuidShape: /^[0-9a-f-]{36}$/.test(after.uuid) }));
    `);
    expect(result).toEqual({ distinct: true, uuidShape: true });
  });
});

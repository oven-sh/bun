import { expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

it("shadow realm works", () => {
  const red = new ShadowRealm();
  globalThis.someValue = 1;
  // Affects only the ShadowRealm's global
  const result = red.evaluate("globalThis.someValue = 2;");
  expect(globalThis.someValue).toBe(1);
  expect(result).toBe(2);
});

// require(esm) drives the module loader through a VM-wide synchronous queue.
// Reactions from a ShadowRealm's own module loader that fire during that drain
// must be replayed against the ShadowRealm's registry, not the caller's; if
// they aren't, the first importValue registers the module in the wrong realm
// and the second importValue loads a fresh copy instead of the cached one.
it("importValue caches modules in the ShadowRealm when kicked off under require(esm)", async () => {
  using dir = tempDir("shadow-realm-sync-queue", {
    "counter.mjs": `let n = 0; export const getCounter = () => n++;`,
    "trigger.mjs": `
      import url from "node:url";
      import path from "node:path";
      const mod = url.pathToFileURL(path.join(import.meta.dirname, "counter.mjs")).href;
      const realm = new ShadowRealm();
      const first = realm.importValue(mod, "getCounter");
      export { realm, first, mod };
    `,
    "entry.cjs": `
      const { realm, first, mod } = require("./trigger.mjs");
      (async () => {
        const a = await first;
        const b = await realm.importValue(mod, "getCounter");
        const { getCounter: outer } = await import(mod);
        console.log(JSON.stringify({ a0: a(), b0: b(), b1: b(), outer: outer() }));
      })().catch(e => { console.error(e); process.exit(1); });
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  // a and b must share module state inside the ShadowRealm; the outer realm's
  // import of the same specifier must be a separate instance.
  expect(JSON.parse(stdout.trim())).toEqual({ a0: 0, b0: 1, b1: 2, outer: 0 });
  expect(exitCode).toBe(0);
});

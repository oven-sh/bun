// $esmLoadSync's Pending fallback used to accept any record at status >=
// Evaluating with !hasTLA(). hasTLA() only reports the *self* flag, so a
// module with no TLA whose dependency has TLA (status EvaluatingAsync) was
// returned with bindings still in TDZ. It must throw "async module" instead.
//
// Separately, when the Pending path *does* throw, it used to removeEntry()
// unconditionally. If an outer import() already created the entry, deleting
// it forces a second evaluation when the outer import settles.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("require(esm) rejects when a transitive dependency has top-level await", async () => {
  using dir = tempDir("require-esm-transitive-tla", {
    "leaf-tla.mjs": `
      export let value = "before";
      // A macro-task await so the synchronous loadModule drain cannot
      // complete it inline.
      await new Promise(r => setTimeout(r, 1));
      value = "after";
    `,
    "middle.mjs": `
      // No TLA here, but the dep has it -> this record becomes EvaluatingAsync.
      export { value } from "./leaf-tla.mjs";
      export const ready = true;
    `,
    "entry.cjs": `
      let threw = false;
      try {
        require("./middle.mjs");
      } catch (e) {
        threw = e instanceof TypeError && String(e.message).includes("async module");
      }
      if (!threw) throw new Error("expected require(transitive-TLA) to throw");
      console.log("ok");
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
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

test("require(esm) failing on TLA does not delete an entry an outer import() owns", async () => {
  using dir = tempDir("require-esm-no-double-eval", {
    "side.mjs": `
      globalThis.__sideEvalCount = (globalThis.__sideEvalCount || 0) + 1;
      await new Promise(r => setTimeout(r, 20));
      export const n = globalThis.__sideEvalCount;
    `,
    "entry.mjs": `
      import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      // Kick off the async load first so the registry entry exists.
      const p = import("./side.mjs");
      // Yield to a macro-task so the loader has fetched + entered evaluation
      // (status EvaluatingAsync) but the TLA setTimeout(20) is still pending.
      await new Promise(r => setTimeout(r, 1));
      // The new loader throws "async module"; the old JS loader returned a
      // partial namespace. Either way the registry entry must survive.
      try { require("./side.mjs"); } catch {}
      const m = await p;
      if (m.n !== 1) throw new Error("side.mjs evaluated " + m.n + " times");
      // A second import() must reuse the same record (no removeEntry happened).
      const m2 = await import("./side.mjs");
      if (m2 !== m) throw new Error("second import() produced a different namespace");
      if (globalThis.__sideEvalCount !== 1) throw new Error("eval count " + globalThis.__sideEvalCount);
      console.log("ok");
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

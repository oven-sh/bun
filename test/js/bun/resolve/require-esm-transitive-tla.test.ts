// $esmLoadSync's Pending fallback used to accept any record at status >=
// Evaluating with !hasTLA(). hasTLA() only reports the *self* flag, so a
// module with no TLA whose dependency has TLA (status EvaluatingAsync) was
// returned with bindings still in TDZ. It must throw "async module" instead.
//
// Separately, when the Pending path *does* throw, it used to removeEntry()
// unconditionally. If an outer import() already created the entry, deleting
// it forces a second evaluation when the outer import settles.
import { describe, expect, test } from "bun:test";
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

// An async module graph whose every `await` can make progress using only
// microtasks (no timers, no I/O) is evaluable inside a synchronous require().
// $esmLoadSync runs a plain microtask checkpoint when the load promise is still
// pending after the module-loader-internal drain; only a graph that genuinely
// needs the host event loop keeps throwing the "async module" TypeError.
describe("require(esm) whose top-level await only needs microtasks", () => {
  async function run(dir: { toString(): string }) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  test("awaits that complete without the event loop resolve synchronously", async () => {
    using dir = tempDir("require-esm-microtask-tla", {
      "literal.mjs": `export const x = await 0;`,
      "nul.mjs": `export const x = await null;`,
      "thenable.mjs": `export const x = await { then(r) { r(5); } };`,
      "chained.mjs": `export const x = await Promise.resolve(1).then(v => v + 1);`,
      "all.mjs": `export const x = await Promise.all([Promise.resolve(1), Promise.resolve(2), 3]);`,
      "nested-fn.mjs": `async function f() { await Promise.resolve(); await 0; return 7; } export const x = await f();`,
      "deep-leaf.mjs": `export const x = await 0;`,
      "dep.mjs": `import { x as leaf } from "./deep-leaf.mjs"; export const x = leaf + 100;`,
      // Awaiting a promise resolved *with* another promise routes through a
      // PromiseResolveThenableJobFast, a different job kind than the others.
      "resolved-with.mjs": `export const x = await new Promise(r => r(Promise.resolve(11)));`,
      "settled.mjs": `export const x = await Promise.resolve(42);`,
      "entry.cjs": `
        const names = ["literal", "nul", "thenable", "chained", "all", "nested-fn", "dep", "resolved-with", "settled"];
        const out = [];
        for (const name of names) {
          try {
            out.push(name + " " + JSON.stringify(require("./" + name + ".mjs").x));
          } catch (e) {
            out.push(name + " THREW " + e.message);
          }
        }
        out.push("cached " + (require("./literal.mjs") === require("./literal.mjs")));
        console.log(out.join("\\n"));
      `,
    });

    expect(await run(dir)).toEqual({
      stdout: [
        "literal 0",
        "nul null",
        "thenable 5",
        "chained 2",
        "all [1,2,3]",
        "nested-fn 7",
        "dep 100",
        "resolved-with 11",
        "settled 42",
        "cached true",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
  });

  test("await import() of a synchronous sibling resolves inside require()", async () => {
    using dir = tempDir("require-esm-tla-dynamic-import", {
      "leaf.mjs": `export const s = 9;`,
      "dyn.mjs": `const m = await import("./leaf.mjs"); export const x = m.s;`,
      "entry.cjs": `console.log("got " + require("./dyn.mjs").x);`,
    });
    expect(await run(dir)).toEqual({ stdout: "got 9", stderr: "", exitCode: 0 });
  });

  // The checkpoint is the real FIFO microtask queue, not a private reordering
  // queue: a user microtask queued before the require runs inside it, in order,
  // ahead of the module's own continuations. This pins that observable semantic.
  test("preserves microtask FIFO order across the checkpoint inside require()", async () => {
    using dir = tempDir("require-esm-tla-ordering", {
      "tla.mjs": `
        globalThis.__log.push("module-start");
        Promise.resolve().then(() => globalThis.__log.push("module-queued"));
        export const x = await 0;
        globalThis.__log.push("module-after-await");
      `,
      "entry.cjs": `
        const log = (globalThis.__log = []);
        Promise.resolve().then(() => log.push("pre-queued"));
        const { x } = require("./tla.mjs");
        log.push("after-require " + x);
        Promise.resolve().then(() => console.log(log.join("|")));
      `,
    });
    expect(await run(dir)).toEqual({
      stdout: "module-start|pre-queued|module-queued|module-after-await|after-require 0",
      stderr: "",
      exitCode: 0,
    });
  });

  test("works when require() itself runs inside a microtask (nested checkpoint)", async () => {
    using dir = tempDir("require-esm-tla-nested", {
      "tla.mjs": `export const x = await 0;`,
      "entry.cjs": `Promise.resolve().then(() => { console.log("got " + require("./tla.mjs").x); });`,
    });
    expect(await run(dir)).toEqual({ stdout: "got 0", stderr: "", exitCode: 0 });
  });

  test("a throwing top-level-await module surfaces its own error, and it stays cached", async () => {
    using dir = tempDir("require-esm-tla-reject", {
      "boom.mjs": `await 0; throw new Error("boom-from-tla");`,
      "entry.cjs": `
        const msgs = [];
        for (let i = 0; i < 2; i++) {
          try { require("./boom.mjs"); msgs.push("no-throw"); } catch (e) { msgs.push(e.message); }
        }
        console.log(msgs.join("|"));
      `,
    });
    expect(await run(dir)).toEqual({ stdout: "boom-from-tla|boom-from-tla", stderr: "", exitCode: 0 });
  });

  test("an await that genuinely needs the event loop still throws", async () => {
    using dir = tempDir("require-esm-tla-event-loop", {
      "timer.mjs": `export const x = await new Promise(r => setTimeout(r, 1));`,
      "entry.cjs": `
        try { require("./timer.mjs"); console.log("unexpected-success"); }
        catch (e) { console.log("threw " + (e instanceof TypeError && e.message.includes("async module"))); }
      `,
    });
    expect(await run(dir)).toEqual({ stdout: "threw true", stderr: "", exitCode: 0 });
  });
});

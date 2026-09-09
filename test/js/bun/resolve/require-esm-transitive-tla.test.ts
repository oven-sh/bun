// require() of an ES module graph that contains top-level await.
//
// Like Node, Bun rejects it with ERR_REQUIRE_ASYNC_MODULE, decided from the
// records' [[HasTLA]] flags once the graph is loaded and before any module
// body in it runs. $esmLoadSync used to load+link+evaluate in one step and
// infer "async" from a still-pending promise afterwards, so side effects ran
// before the throw, graphs whose awaits settled on microtasks alone were
// returned, and a graph that import() had already evaluated was returned too.
//
// Separately, when $esmLoadSync does throw for a load it cannot finish
// synchronously, it must only removeEntry() an entry it created itself. If an
// outer import() already created the entry, deleting it forces a second
// evaluation when the outer import settles.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("require(esm) rejects top-level await before evaluating anything", () => {
  const fixtures = {
    "tla-value.mjs": `globalThis.order.push("tla-value"); await 0; export const x = "value";`,
    "tla-resolved.mjs": `globalThis.order.push("tla-resolved"); await Promise.resolve(); export const x = "resolved";`,
    "tla-task.mjs": `globalThis.order.push("tla-task"); await new Promise(r => setTimeout(r, 1)); export const x = "task";`,
    "dep-tla.mjs": `globalThis.order.push("dep-tla"); await 0; export const y = "dep";`,
    "parent.mjs": `import { y } from "./dep-tla.mjs"; globalThis.order.push("parent"); export const x = "parent:" + y;`,
    "plain.mjs": `globalThis.order.push("plain"); export const x = "plain";`,
    "attempt.cjs": `
      globalThis.order = [];
      exports.attempt = function attempt(file) {
        try {
          return { returned: require(file).x };
        } catch (e) {
          return { name: e.name, code: e.code };
        }
      };
    `,
  };
  const rejected = { name: "Error", code: "ERR_REQUIRE_ASYNC_MODULE" };

  async function run(dir: string, file: string) {
    await using proc = Bun.spawn({ cmd: [bunExe(), file], env: bunEnv, cwd: dir, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout);
  }

  test.concurrent("whatever the await shape, and a later import() still evaluates each module once", async () => {
    using dir = tempDir("require-esm-tla-shapes", {
      ...fixtures,
      "main.cjs": `
        const { attempt } = require("./attempt.cjs");
        const files = ["./tla-value.mjs", "./tla-resolved.mjs", "./tla-task.mjs", "./parent.mjs", "./plain.mjs"];
        const required = {};
        // Twice each: a failed require() must fail the same way when retried.
        for (const f of files) required[f] = [attempt(f), attempt(f)];
        const orderAfterRequire = [...globalThis.order];
        (async () => {
          const imported = {};
          for (const f of files) imported[f] = (await import(f)).x;
          console.log(JSON.stringify({ required, orderAfterRequire, imported, order: globalThis.order }));
        })();
      `,
    });
    expect(await run(String(dir), "main.cjs")).toEqual({
      required: {
        "./tla-value.mjs": [rejected, rejected],
        "./tla-resolved.mjs": [rejected, rejected],
        "./tla-task.mjs": [rejected, rejected],
        "./parent.mjs": [rejected, rejected],
        "./plain.mjs": [{ returned: "plain" }, { returned: "plain" }],
      },
      // No module with top-level await in its graph ran any part of its body.
      orderAfterRequire: ["plain"],
      imported: {
        "./tla-value.mjs": "value",
        "./tla-resolved.mjs": "resolved",
        "./tla-task.mjs": "task",
        "./parent.mjs": "parent:dep",
        "./plain.mjs": "plain",
      },
      order: ["plain", "tla-value", "tla-resolved", "tla-task", "dep-tla", "parent"],
    });
  });

  test.concurrent("also when import() already evaluated the graph", async () => {
    using dir = tempDir("require-esm-tla-cached", {
      ...fixtures,
      "main.cjs": `
        const { attempt } = require("./attempt.cjs");
        (async () => {
          const first = await import("./parent.mjs");
          const required = attempt("./parent.mjs");
          const requiredDep = attempt("./dep-tla.mjs");
          const second = await import("./parent.mjs");
          console.log(JSON.stringify({ required, requiredDep, same: first === second, order: globalThis.order }));
        })();
      `,
    });
    expect(await run(String(dir), "main.cjs")).toEqual({
      required: rejected,
      requiredDep: rejected,
      same: true,
      order: ["dep-tla", "parent"],
    });
  });

  test.concurrent("with a message that names the requiring module and the one with the await", async () => {
    using dir = tempDir("require-esm-tla-message", {
      ...fixtures,
      "main.cjs": `
        globalThis.order = [];
        try {
          require("./parent.mjs");
          console.log(JSON.stringify("returned"));
        } catch (e) {
          const message = e.message
            .replaceAll(__filename, "<main.cjs>")
            .replaceAll(require.resolve("./parent.mjs"), "<parent.mjs>")
            .replaceAll(require.resolve("./dep-tla.mjs"), "<dep-tla.mjs>");
          console.log(JSON.stringify(message.split("\\n")));
        }
      `,
    });
    expect(await run(String(dir), "main.cjs")).toEqual([
      "require() cannot be used on an ESM graph with top-level await. Use import() instead.",
      "  From <main.cjs>",
      "  Requiring <parent.mjs>",
      "  The top-level await is in <dep-tla.mjs>",
    ]);
  });
});

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
        threw = e.code === "ERR_REQUIRE_ASYNC_MODULE";
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

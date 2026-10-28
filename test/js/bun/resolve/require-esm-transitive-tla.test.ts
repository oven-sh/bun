// require() of an ES module graph that contains top-level await.
//
// Like Node, Bun rejects it with ERR_REQUIRE_ASYNC_MODULE, decided from the
// records' [[HasTLA]] flags once the graph is loaded and before any ES module
// in it runs. $esmLoadSync used to load+link+evaluate in one step and infer
// "async" from a still-pending promise afterwards, so side effects ran before
// the throw, and graphs whose awaits settled on microtasks alone were returned.
// Unlike Node, a graph whose top-level awaits have all run to their end (an
// import() evaluated it) is handed over: nothing is left to wait for.
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

  // The gate holds awaits-gate.mjs at its top-level await until the test has seen what require() does meanwhile.
  test.concurrent("also while an import() still awaits in the graph, and hands the graph over once that has ended", async () => {
    using dir = tempDir("require-esm-tla-states", {
      ...fixtures,
      "awaits-gate.mjs": `globalThis.order.push("awaits-gate"); await globalThis.gate; export const x = "gate";`,
      "imports-gate.mjs": `import { x as gate } from "./awaits-gate.mjs"; globalThis.order.push("imports-gate"); export const x = "imports:" + gate;`,
      "main.cjs": `
        const { attempt } = require("./attempt.cjs");
        let open;
        globalThis.gate = new Promise(resolve => (open = resolve));
        (async () => {
          const pending = import("./awaits-gate.mjs");
          while (!globalThis.order.includes("awaits-gate")) await new Promise(resolve => setImmediate(resolve));
          const whileAwaiting = [attempt("./awaits-gate.mjs"), attempt("./imports-gate.mjs")];
          const orderWhileAwaiting = [...globalThis.order];
          open();
          const namespace = await pending;
          const afterwards = [attempt("./awaits-gate.mjs"), attempt("./imports-gate.mjs")];
          const same = require("./awaits-gate.mjs") === namespace;
          console.log(JSON.stringify({ whileAwaiting, orderWhileAwaiting, afterwards, same, order: globalThis.order }));
        })();
      `,
    });
    expect(await run(String(dir), "main.cjs")).toEqual({
      whileAwaiting: [rejected, rejected],
      orderWhileAwaiting: ["awaits-gate"],
      afterwards: [{ returned: "gate" }, { returned: "imports:gate" }],
      same: true,
      order: ["awaits-gate", "imports-gate"],
    });
  });

  // in-graph.cjs runs while entry.mjs's graph is still loading, so the modules it require()s are ones that
  // graph has requested and not evaluated yet.
  test.concurrent("also when the ES module graph that imports it is still loading", async () => {
    using dir = tempDir("require-esm-tla-in-graph", {
      ...fixtures,
      "in-graph.cjs": `
        const { attempt } = require("./attempt.cjs");
        globalThis.required = { direct: attempt("./tla-value.mjs"), transitive: attempt("./parent.mjs") };
        globalThis.orderAfterRequire = [...globalThis.order];
      `,
      "entry.mjs": `
        import "./in-graph.cjs";
        import "./tla-value.mjs";
        import "./parent.mjs";
        const { required, orderAfterRequire, order } = globalThis;
        console.log(JSON.stringify({ required, orderAfterRequire, order }));
      `,
    });
    expect(await run(String(dir), "entry.mjs")).toEqual({
      required: { direct: rejected, transitive: rejected },
      orderAfterRequire: [],
      // The graph then evaluates each module once, in import order.
      order: ["tla-value", "dep-tla", "parent"],
    });
  });

  // m0.mjs enters the cycle m2 → m3 → m4 → m1 → m2 at m3, so m2 runs before m1 reads its export. A require()
  // that starts to evaluate the graph enters the cycle at m2, and m1 then reads the export before it exists.
  test.concurrent("and leaves an import cycle to be entered where the importing graph enters it", async () => {
    using dir = tempDir("require-esm-tla-cycle", {
      "m0.mjs": `
        import "./c.cjs";
        import "./m3.mjs";
        console.log(JSON.stringify(globalThis.log));
      `,
      "c.cjs": `
        globalThis.log = [];
        try {
          require("./m2.mjs");
          globalThis.log.push("c: require() returned");
        } catch (e) {
          globalThis.log.push("c: " + e.code);
        }
      `,
      "m1.mjs": `import { v2 } from "./m2.mjs"; globalThis.log.push("m1 reads " + v2);`,
      "m2.mjs": `import "./m3.mjs"; export const v2 = "v2";`,
      "m3.mjs": `import "./m4.mjs";`,
      "m4.mjs": `import "./m1.mjs"; await null;`,
    });
    expect(await run(String(dir), "m0.mjs")).toEqual(["c: ERR_REQUIRE_ASYNC_MODULE", "m1 reads v2"]);
  });

  test.concurrent("with a message that names the requiring module and the one with the await", async () => {
    using dir = tempDir("require-esm-tla-message", {
      ...fixtures,
      "main.cjs": `
        globalThis.order = [];
        function messageOf(load) {
          try {
            load();
            return "returned";
          } catch (e) {
            let message = e.message;
            for (const name of ["main.cjs", "parent.mjs", "dep-tla.mjs", "tla-value.mjs"]) {
              message = message.replaceAll(require.resolve("./" + name), "<" + name + ">");
            }
            return message.split("\\n");
          }
        }
        const direct = messageOf(() => require("./parent.mjs"));
        // A wrapped handler calls the built-in one with the module that is being loaded, not the one that requires it.
        const builtin = require.extensions[".mjs"];
        require.extensions[".mjs"] = (module, filename) => builtin(module, filename);
        const throughHandler = messageOf(() => require("./tla-value.mjs"));
        // A module object that no module required has no parent to name.
        const orphan = new (require("node:module"))(require.resolve("./tla-value.mjs"));
        orphan.filename = orphan.id;
        const withoutParent = messageOf(() => builtin(orphan, orphan.filename));
        console.log(JSON.stringify({ direct, throughHandler, withoutParent, order: globalThis.order }));
      `,
    });
    const message = "require() cannot be used on an ESM graph with top-level await. Use import() instead.";
    expect(await run(String(dir), "main.cjs")).toEqual({
      direct: [message, "  From <main.cjs>", "  Requiring <parent.mjs>", "  The top-level await is in <dep-tla.mjs>"],
      throughHandler: [message, "  From <main.cjs>", "  Requiring <tla-value.mjs>"],
      withoutParent: [message, "  Requiring <tla-value.mjs>"],
      order: [],
    });
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

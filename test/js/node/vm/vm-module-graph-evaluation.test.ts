/**
 * module.evaluate() of node:vm is one ECMAScript Evaluate() of that module:
 * https://tc39.es/ecma262/#sec-moduleevaluation
 *
 * InnerModuleEvaluation walks the graph depth first. A module body runs after
 * the bodies of the modules it imports, a SyntheticModule's evaluateCallback
 * runs where the walk reaches that module, and a module with a top-level await
 * delays only the modules that import it. Evaluate() does not throw what a
 * module throws: it rejects its promise, and every module that could not
 * finish is "errored" with that one error.
 *
 * This file uses node:test and node:assert, so Node runs the identical file:
 *
 *   node --experimental-vm-modules --test vm-module-graph-evaluation.test.ts
 *
 * Every expectation is what Node v26.3.0 does. For the same reason the file
 * does not import from "harness".
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import vm from "node:vm";

const isBun = typeof process.versions.bun === "string";

type Module = vm.SourceTextModule | vm.SyntheticModule;
type Modules = Record<string, Module>;

// Where the modules of a test live. A context with microtaskMode "afterEvaluate" has its own microtask queue.
const kinds = {
  "the main context": undefined,
  "a context": {},
  "an afterEvaluate context": { microtaskMode: "afterEvaluate" },
} as const;
type Kind = keyof typeof kinds;
const everyKind = Object.keys(kinds) as Kind[];

const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const noop = () => {};

// Module code in the main context sees this file's globals. The names of the previous graph go first.
const installed = new Set<string>();
function install(host: Record<string, unknown>) {
  for (const name of installed) delete (globalThis as any)[name];
  installed.clear();
  for (const [name, value] of Object.entries(host)) {
    (globalThis as any)[name] = value;
    installed.add(name);
  }
}

function graph(kind: Kind, sources: Record<string, string>, host: Record<string, unknown> = {}) {
  const log: unknown[] = [];
  host = { log: (entry: unknown) => void log.push(entry), ...host };
  const options = kinds[kind];
  let context: vm.Context | undefined;
  if (options) context = vm.createContext(host, options);
  else install(host);

  const modules: Modules = {};
  for (const [identifier, source] of Object.entries(sources))
    modules[identifier] = new vm.SourceTextModule(source, { identifier, context });

  const linker = (specifier: string) => modules[specifier];
  return {
    log,
    context,
    modules,
    linker,
    link: (root = Object.keys(sources)[0]) => (modules[root] as vm.SourceTextModule).link(linker),
    statuses: () => Object.fromEntries(Object.entries(modules).map(([name, module]) => [name, module.status])),
    // An afterEvaluate context runs its jobs only in a microtask checkpoint, and evaluate() of a module of the
    // context does one. This calls it until `promise` settles. The other kinds need only the event loop.
    async settle(promise: Promise<unknown>, pump = Object.keys(sources)[0]) {
      let outcome: { fulfilled: unknown } | { rejected: unknown } | undefined;
      promise.then(
        fulfilled => (outcome = { fulfilled }),
        rejected => (outcome = { rejected }),
      );
      while (!outcome) {
        await turn();
        if (!outcome && options && "microtaskMode" in options) modules[pump].evaluate().then(noop, noop);
      }
      return outcome;
    },
  };
}

function synthetic(
  g: ReturnType<typeof graph>,
  identifier: string,
  exportNames: string[],
  evaluateCallback: (this: vm.SyntheticModule, module: vm.SyntheticModule) => void,
) {
  const module: vm.SyntheticModule = new vm.SyntheticModule(
    exportNames,
    function (this: vm.SyntheticModule) {
      return evaluateCallback.call(this, module);
    },
    { identifier, context: g.context },
  );
  g.modules[identifier] = module;
  return module;
}

for (const kind of everyKind) {
  describe(`module.evaluate() in ${kind}`, () => {
    describe("order", () => {
      test("a diamond: each body runs once, after the bodies of the modules it imports", async () => {
        const g = graph(kind, {
          a: `import "b"; import "c"; log("a");`,
          b: `import "d"; log("b");`,
          c: `import "d"; log("c");`,
          d: `log("d");`,
        });
        await g.link();
        assert.strictEqual(await g.modules.a.evaluate(), undefined);
        assert.deepStrictEqual(g.log, ["d", "b", "c", "a"]);
        assert.deepStrictEqual(g.statuses(), { a: "evaluated", b: "evaluated", c: "evaluated", d: "evaluated" });
      });

      test("a cycle: the member that the walk enters last runs first", async () => {
        const g = graph(kind, {
          a: `import "b"; log("a");`,
          b: `import "c"; log("b");`,
          c: `import "a"; log("c");`,
        });
        await g.link();
        await g.modules.b.evaluate();
        assert.deepStrictEqual(g.log, ["a", "c", "b"]);
        // The cycle is done: evaluate() of another member runs nothing.
        assert.strictEqual(await g.modules.a.evaluate(), undefined);
        assert.deepStrictEqual(g.log, ["a", "c", "b"]);
      });

      test("a function crosses a cycle before the body of its module runs", async () => {
        const g = graph(kind, {
          a: `import { g } from "b"; log("a"); export function f() { return "f"; } log(g());`,
          b: `import { f } from "a"; log("b " + f()); export function g() { return "g"; }`,
        });
        await g.link();
        await g.modules.a.evaluate();
        assert.deepStrictEqual(g.log, ["b f", "a", "g"]);
      });

      test("two roots that share a cycle run it once", async () => {
        const g = graph(kind, {
          r1: `import "a"; log("r1");`,
          r2: `import "b"; log("r2");`,
          a: `import "b"; log("a");`,
          b: `import "a"; log("b");`,
        });
        await g.link("r1");
        await g.link("r2");
        await g.modules.r1.evaluate();
        assert.deepStrictEqual(g.log, ["b", "a", "r1"]);
        await g.modules.r2.evaluate();
        assert.deepStrictEqual(g.log, ["b", "a", "r1", "r2"]);
      });

      test("a top-level await delays only the modules that import its module", async () => {
        const g = graph(kind, {
          a: `import "b"; import "c"; log("a");`,
          b: `log("b1"); await 0; log("b2");`,
          c: `log("c");`,
        });
        await g.link();
        const promise = g.modules.a.evaluate();
        assert.deepStrictEqual(g.log.slice(0, 2), ["b1", "c"]);
        assert.deepStrictEqual(await g.settle(promise), { fulfilled: undefined });
        assert.deepStrictEqual(g.log, ["b1", "c", "b2", "a"]);
      });

      test("modules that wait for the same module run in the order of the walk", async () => {
        const g = graph(kind, {
          a: `import "b"; import "c"; import "d"; log("a");`,
          b: `import "t"; log("b");`,
          c: `import "t"; log("c");`,
          d: `import "t"; log("d1"); await 0; log("d2");`,
          t: `log("t1"); await 0; log("t2");`,
        });
        await g.link();
        assert.deepStrictEqual(await g.settle(g.modules.a.evaluate()), { fulfilled: undefined });
        assert.deepStrictEqual(g.log, ["t1", "t2", "b", "c", "d1", "d2", "a"]);
      });

      test("a module that imports two modules with a top-level await runs after both", async () => {
        const g = graph(kind, {
          a: `import "b"; import "c"; log("a");`,
          b: `log("b1"); await 0; await 0; await 0; log("b2");`,
          c: `log("c1"); await 0; log("c2");`,
        });
        await g.link();
        assert.deepStrictEqual(await g.settle(g.modules.a.evaluate()), { fulfilled: undefined });
        assert.deepStrictEqual(g.log, ["b1", "c1", "c2", "b2", "a"]);
      });

      test("a cycle with a top-level await", async () => {
        const g = graph(kind, {
          a: `import "b"; log("a");`,
          b: `import "c"; log("b1"); await 0; log("b2");`,
          c: `import "a"; log("c");`,
        });
        await g.link();
        assert.deepStrictEqual(await g.settle(g.modules.a.evaluate()), { fulfilled: undefined });
        assert.deepStrictEqual(g.log, ["c", "b1", "b2", "a"]);
      });

      test("a second root waits for a module that the first root started", async () => {
        const g = graph(kind, {
          r1: `import "t"; log("r1");`,
          r2: `import "t"; log("r2");`,
          t: `log("t1"); await 0; log("t2");`,
        });
        await g.link("r1");
        await g.link("r2");
        const outcomes = await Promise.all([
          g.settle(g.modules.r1.evaluate(), "r1"),
          g.settle(g.modules.r2.evaluate(), "r2"),
        ]);
        assert.deepStrictEqual(outcomes, [{ fulfilled: undefined }, { fulfilled: undefined }]);
        assert.deepStrictEqual(g.log, ["t1", "t2", "r1", "r2"]);
      });

      test("evaluate() of a member of a cycle settles when the cycle is done", async () => {
        const g = graph(kind, {
          a: `import "b"; log("a1"); await 0; await 0; log("a2");`,
          b: `import "a"; log("b");`,
        });
        await g.link();
        const ofA = g.modules.a.evaluate();
        // b has run. Its cycle waits for a.
        assert.deepStrictEqual(g.log.slice(0, 2), ["b", "a1"]);
        const ofB = g.modules.b.evaluate().then(() => void g.log.push("evaluate() of b is done"));
        assert.deepStrictEqual(await g.settle(ofA), { fulfilled: undefined });
        assert.deepStrictEqual(await g.settle(ofB), { fulfilled: undefined });
        assert.deepStrictEqual(g.log, ["b", "a1", "a2", "evaluate() of b is done"]);
      });

      test("evaluate() of a module that already ran as a dependency runs nothing", async () => {
        const g = graph(kind, {
          a: `import "b"; log("a");`,
          b: `log("b");`,
        });
        await g.link();
        await g.modules.a.evaluate();
        assert.strictEqual(await g.modules.b.evaluate(), undefined);
        assert.strictEqual(await g.modules.a.evaluate(), undefined);
        assert.deepStrictEqual(g.log, ["b", "a"]);
      });
    });

    describe("status", () => {
      test("link() of a module links every module that it reaches", async () => {
        const g = graph(kind, {
          a: `import "b";`,
          b: `import "c"; import "d";`,
          c: `import "b";`,
          d: `await 0;`,
          other: `import "d";`,
        });
        assert.deepStrictEqual(g.statuses(), {
          a: "unlinked",
          b: "unlinked",
          c: "unlinked",
          d: "unlinked",
          other: "unlinked",
        });
        await g.link();
        assert.deepStrictEqual(g.statuses(), { a: "linked", b: "linked", c: "linked", d: "linked", other: "unlinked" });
        await assert.rejects((g.modules.c as vm.SourceTextModule).link(g.linker), {
          code: "ERR_VM_MODULE_ALREADY_LINKED",
        });
        await g.link("other");
        assert.strictEqual(g.modules.other.status, "linked");
      });

      test("linkRequests() links nothing, and instantiate() links every module that the module reaches", async () => {
        const g = graph(kind, {
          a: `import "b"; log("a");`,
          b: `import "c"; log("b");`,
          c: `import "b"; log("c");`,
        });
        const { a, b, c } = g.modules as Record<string, vm.SourceTextModule>;
        a.linkRequests([b]);
        b.linkRequests([c]);
        c.linkRequests([b]);
        assert.deepStrictEqual(g.statuses(), { a: "unlinked", b: "unlinked", c: "unlinked" });
        a.instantiate();
        assert.deepStrictEqual(g.statuses(), { a: "linked", b: "linked", c: "linked" });
        await c.evaluate();
        assert.deepStrictEqual(g.log, ["b", "c"]);
        assert.deepStrictEqual(g.statuses(), { a: "linked", b: "evaluated", c: "evaluated" });
        await a.evaluate();
        assert.deepStrictEqual(g.log, ["b", "c", "a"]);
      });

      test("hasAsyncGraph() is true when a module that the module reaches has a top-level await", async () => {
        const g = graph(kind, {
          a: `import "b"; import "c";`,
          b: `import "a";`,
          c: `import "d";`,
          d: `await 0;`,
          sync: `import "e";`,
          e: `import "sync"; async function f() { await 0; }`,
        });
        await g.link();
        await g.link("sync");
        const { a, b, c, d, sync, e } = g.modules as Record<string, vm.SourceTextModule>;
        assert.deepStrictEqual(
          [a, b, c, d, sync, e].map(module => module.hasAsyncGraph()),
          [true, true, true, true, false, false],
        );
      });

      test("a module is 'evaluating' from the start of the walk until its cycle is done", async () => {
        const snapshots: unknown[] = [];
        const g = graph(
          kind,
          {
            a: `import "b"; import "d"; snap("a");`,
            b: `import "c"; snap("b");`,
            c: `import "b"; snap("c");`,
            d: `snap("d");`,
          },
          { snap: (where: string) => void snapshots.push([where, g.statuses()]) },
        );
        await g.link();
        await g.modules.a.evaluate();
        assert.deepStrictEqual(snapshots, [
          ["c", { a: "evaluating", b: "evaluating", c: "evaluating", d: "linked" }],
          ["b", { a: "evaluating", b: "evaluating", c: "evaluating", d: "linked" }],
          ["d", { a: "evaluating", b: "evaluated", c: "evaluated", d: "evaluating" }],
          ["a", { a: "evaluating", b: "evaluated", c: "evaluated", d: "evaluated" }],
        ]);
        assert.deepStrictEqual(g.statuses(), { a: "evaluated", b: "evaluated", c: "evaluated", d: "evaluated" });
      });

      test("a module that waits for a top-level await is 'evaluated'", async () => {
        const snapshots: unknown[] = [];
        const g = graph(
          kind,
          {
            a: `import "b"; snap("a");`,
            b: `snap("b1"); await 0; snap("b2");`,
          },
          { snap: (where: string) => void snapshots.push([where, g.statuses()]) },
        );
        await g.link();
        assert.deepStrictEqual(await g.settle(g.modules.a.evaluate()), { fulfilled: undefined });
        assert.deepStrictEqual(snapshots, [
          ["b1", { a: "evaluating", b: "evaluating" }],
          ["b2", { a: "evaluated", b: "evaluated" }],
          ["a", { a: "evaluated", b: "evaluated" }],
        ]);
      });

      test("evaluate() of a module that is 'evaluating' rejects", async () => {
        let inner: Promise<unknown> | undefined;
        const g = graph(
          kind,
          {
            a: `import "b"; log("a");`,
            b: `reenter(); log("b");`,
          },
          { reenter: () => void (inner = g.modules.a.evaluate()) },
        );
        await g.link();
        await g.modules.a.evaluate();
        await assert.rejects(inner!, { code: "ERR_VM_MODULE_STATUS" });
        assert.deepStrictEqual(g.log, ["b", "a"]);
      });
    });

    describe("errors", () => {
      test("a body that throws: every module on the way to it has that error, the others stay linked", async () => {
        const g = graph(kind, {
          a: `import "b"; import "c"; log("a");`,
          b: `log("b"); throw new Error("from b");`,
          c: `log("c");`,
        });
        await g.link();
        await assert.rejects(g.modules.a.evaluate(), { message: "from b" });
        assert.deepStrictEqual(g.log, ["b"]);
        assert.deepStrictEqual(g.statuses(), { a: "errored", b: "errored", c: "linked" });
        assert.strictEqual(g.modules.a.error, g.modules.b.error);

        // evaluate() of an errored module runs nothing, and rejects with the same error every time.
        const error = g.modules.a.error;
        await assert.rejects(g.modules.a.evaluate(), reason => reason === error);
        await assert.rejects(g.modules.b.evaluate(), reason => reason === error);
        assert.deepStrictEqual(g.log, ["b"]);

        await g.modules.c.evaluate();
        assert.deepStrictEqual(g.log, ["b", "c"]);
        assert.deepStrictEqual(g.statuses(), { a: "errored", b: "errored", c: "evaluated" });
      });

      test("a body that throws in a cycle: every member has that error", async () => {
        const g = graph(kind, {
          a: `import "b"; log("a");`,
          b: `import "c"; log("b"); throw new Error("from b");`,
          c: `import "a"; log("c");`,
        });
        await g.link();
        await assert.rejects(g.modules.a.evaluate(), { message: "from b" });
        assert.deepStrictEqual(g.log, ["c", "b"]);
        assert.deepStrictEqual(g.statuses(), { a: "errored", b: "errored", c: "errored" });
        assert.strictEqual(g.modules.a.error, g.modules.b.error);
        assert.strictEqual(g.modules.c.error, g.modules.b.error);
        await assert.rejects(g.modules.c.evaluate(), { message: "from b" });
        assert.deepStrictEqual(g.log, ["c", "b"]);
      });

      test("a body that throws after a top-level await: the promise of evaluate() rejects", async () => {
        const g = graph(kind, {
          a: `import "b"; import "c"; log("a");`,
          b: `log("b1"); await 0; log("b2"); throw new Error("from b");`,
          c: `log("c");`,
        });
        await g.link();
        const outcome = await g.settle(g.modules.a.evaluate());
        assert.ok("rejected" in outcome);
        assert.strictEqual((outcome.rejected as Error).message, "from b");
        assert.deepStrictEqual(g.log, ["b1", "c", "b2"]);
        assert.deepStrictEqual(g.statuses(), { a: "errored", b: "errored", c: "evaluated" });
        assert.strictEqual(g.modules.a.error, outcome.rejected);
        assert.strictEqual(g.modules.b.error, outcome.rejected);
        await assert.rejects(g.modules.a.evaluate(), reason => reason === outcome.rejected);
        await assert.rejects(g.modules.b.evaluate(), reason => reason === outcome.rejected);
        assert.deepStrictEqual(g.log, ["b1", "c", "b2"]);
      });

      test("a body that throws after a top-level await in a cycle", async () => {
        const g = graph(kind, {
          a: `import "b"; log("a");`,
          b: `import "a"; log("b1"); await 0; log("b2"); throw new Error("from b");`,
        });
        await g.link();
        const outcome = await g.settle(g.modules.a.evaluate());
        assert.ok("rejected" in outcome);
        assert.strictEqual((outcome.rejected as Error).message, "from b");
        assert.deepStrictEqual(g.log, ["b1", "b2"]);
        assert.deepStrictEqual(g.statuses(), { a: "errored", b: "errored" });
        assert.strictEqual(g.modules.a.error, g.modules.b.error);
      });

      test("a member of a cycle that ran stays 'evaluated' when its cycle fails later, and its evaluate() rejects", async () => {
        const g = graph(kind, {
          a: `import "b"; log("a1"); await 0; throw new Error("from a");`,
          b: `import "a"; log("b");`,
        });
        await g.link();
        const outcome = await g.settle(g.modules.a.evaluate());
        assert.ok("rejected" in outcome);
        assert.deepStrictEqual(g.log, ["b", "a1"]);
        assert.deepStrictEqual(g.statuses(), { a: "errored", b: "evaluated" });
        await assert.rejects(g.modules.b.evaluate(), reason => reason === outcome.rejected);
        assert.deepStrictEqual(g.statuses(), { a: "errored", b: "evaluated" });
      });

      test("a second root that imports a module that failed gets the error and does not run", async () => {
        const g = graph(kind, {
          r1: `import "t"; log("r1");`,
          r2: `import "t"; log("r2");`,
          t: `log("t1"); await 0; throw new Error("from t");`,
        });
        await g.link("r1");
        await g.link("r2");
        const first = await g.settle(g.modules.r1.evaluate(), "r1");
        assert.ok("rejected" in first);
        await assert.rejects(g.modules.r2.evaluate(), reason => reason === first.rejected);
        assert.deepStrictEqual(g.log, ["t1"]);
        assert.deepStrictEqual(g.statuses(), { r1: "errored", r2: "errored", t: "errored" });
      });

      test("a second root that waits for a module that then fails", async () => {
        const g = graph(kind, {
          r1: `import "t"; log("r1");`,
          r2: `import "t"; log("r2");`,
          t: `log("t1"); await 0; throw new Error("from t");`,
        });
        await g.link("r1");
        await g.link("r2");
        const [first, second] = await Promise.all([
          g.settle(g.modules.r1.evaluate(), "r1"),
          g.settle(g.modules.r2.evaluate(), "r2"),
        ]);
        assert.ok("rejected" in first && "rejected" in second);
        assert.strictEqual((first.rejected as Error).message, "from t");
        assert.strictEqual(second.rejected, first.rejected);
        assert.deepStrictEqual(g.log, ["t1"]);
        assert.deepStrictEqual(g.statuses(), { r1: "errored", r2: "errored", t: "errored" });
      });

      for (const [name, expression, check] of [
        ["undefined", "undefined", (value: unknown) => value === undefined],
        ["null", "null", (value: unknown) => value === null],
        ["a number", "7", (value: unknown) => value === 7],
      ] as const) {
        test(`a body that throws ${name}`, async () => {
          const g = graph(kind, {
            a: `import "b"; log("a");`,
            b: `throw ${expression};`,
          });
          await g.link();
          await assert.rejects(g.modules.a.evaluate(), check);
          assert.deepStrictEqual(g.statuses(), { a: "errored", b: "errored" });
          assert.ok(check(g.modules.a.error));
          assert.ok(check(g.modules.b.error));
          await assert.rejects(g.modules.a.evaluate(), check);
          assert.deepStrictEqual(g.log, []);
        });
      }
    });

    describe("SyntheticModule", () => {
      test("the evaluateCallback runs where the walk reaches the module", async () => {
        const g = graph(kind, {
          a: `import "b"; import { x } from "s"; import "c"; log("a " + x);`,
          b: `log("b");`,
          c: `log("c");`,
        });
        synthetic(g, "s", ["x"], module => {
          g.log.push("s");
          module.setExport("x", 7);
        });
        await g.link();
        await g.modules.a.evaluate();
        assert.deepStrictEqual(g.log, ["b", "s", "c", "a 7"]);
        assert.strictEqual(g.modules.s.status, "evaluated");
      });

      test("the evaluateCallback runs once for a module that several modules import", async () => {
        const g = graph(kind, {
          a: `import "b"; import { x } from "s"; log("a " + x);`,
          b: `import { x } from "s"; log("b " + x);`,
        });
        let runs = 0;
        synthetic(g, "s", ["x"], module => module.setExport("x", ++runs));
        await g.link();
        await g.modules.a.evaluate();
        await g.modules.s.evaluate();
        assert.deepStrictEqual(g.log, ["b 1", "a 1"]);
        assert.strictEqual(runs, 1);
      });

      test("the evaluateCallback sees what an earlier body did, and a later body sees its exports", async () => {
        const shared: { fromB?: number } = {};
        const g = graph(
          kind,
          {
            a: `import "b"; import { x } from "s"; log("a " + x);`,
            b: `shared.fromB = 5; log("b");`,
          },
          { shared },
        );
        synthetic(g, "s", ["x"], module => module.setExport("x", shared.fromB));
        await g.link();
        await g.modules.a.evaluate();
        assert.deepStrictEqual(g.log, ["b", "a 5"]);
      });

      test("in a cycle, after the member that was imported before it", async () => {
        const g = graph(kind, {
          a: `import "b"; import { x } from "s"; log("a " + x);`,
          b: `import "a"; log("b");`,
        });
        synthetic(g, "s", ["x"], module => {
          g.log.push("s");
          module.setExport("x", 7);
        });
        await g.link();
        await g.modules.a.evaluate();
        assert.deepStrictEqual(g.log, ["b", "s", "a 7"]);
      });

      test("a module that was evaluated before does not run again as a dependency", async () => {
        const g = graph(kind, {
          a: `import { x } from "s"; log("a " + x);`,
        });
        let runs = 0;
        const s = synthetic(g, "s", ["x"], module => module.setExport("x", ++runs));
        assert.strictEqual(await s.evaluate(), undefined);
        assert.strictEqual(s.status, "evaluated");
        await g.link();
        await g.modules.a.evaluate();
        assert.deepStrictEqual(g.log, ["a 1"]);
      });

      test("its status in its evaluateCallback is 'evaluating', and evaluate() of it rejects there", async () => {
        const g = graph(kind, {
          a: `import "s"; log("a");`,
        });
        const seen: unknown[] = [];
        let inner: Promise<unknown> | undefined;
        const s = synthetic(g, "s", [], module => {
          seen.push(module.status, g.modules.a.status);
          inner = module.evaluate();
        });
        await g.link();
        await g.modules.a.evaluate();
        assert.deepStrictEqual(seen, ["evaluating", "evaluating"]);
        await assert.rejects(inner!, { code: "ERR_VM_MODULE_STATUS" });
        assert.strictEqual(s.status, "evaluated");
        assert.deepStrictEqual(g.log, ["a"]);
      });

      test("an evaluateCallback that throws: every module on the way to it has that error", async () => {
        const g = graph(kind, {
          a: `import "b"; log("a");`,
          b: `import "c"; import "s"; import "d"; log("b");`,
          c: `import "b"; log("c");`,
          d: `log("d");`,
        });
        const error = new Error("from s");
        const s = synthetic(g, "s", [], () => {
          throw error;
        });
        await g.link();
        await assert.rejects(g.modules.a.evaluate(), reason => reason === error);
        // c is in a cycle with b. Its body ran before the walk reached s, and it is errored with its cycle.
        assert.deepStrictEqual(g.log, ["c"]);
        assert.deepStrictEqual(g.statuses(), { a: "errored", b: "errored", c: "errored", d: "linked", s: "errored" });
        for (const name of ["a", "b", "c", "s"]) assert.strictEqual(g.modules[name].error, error);
        await assert.rejects(s.evaluate(), reason => reason === error);
        await assert.rejects(g.modules.c.evaluate(), reason => reason === error);
        assert.deepStrictEqual(g.log, ["c"]);
      });

      test("evaluate() of a SyntheticModule whose evaluateCallback throws", async () => {
        const g = graph(kind, {});
        const error = new Error("from s");
        let runs = 0;
        const s = synthetic(g, "s", [], () => {
          runs++;
          throw error;
        });
        await assert.rejects(s.evaluate(), reason => reason === error);
        assert.strictEqual(s.status, "errored");
        assert.strictEqual(s.error, error);
        await assert.rejects(s.evaluate(), reason => reason === error);
        assert.strictEqual(runs, 1);
      });

      test("a module with a top-level await does not delay an evaluateCallback", async () => {
        const g = graph(kind, {
          a: `import "t"; import { x } from "s"; log("a " + x);`,
          t: `log("t1"); await 0; log("t2");`,
        });
        synthetic(g, "s", ["x"], module => {
          g.log.push("s");
          module.setExport("x", 7);
        });
        await g.link();
        const promise = g.modules.a.evaluate();
        assert.deepStrictEqual(g.log.slice(0, 2), ["t1", "s"]);
        assert.deepStrictEqual(await g.settle(promise), { fulfilled: undefined });
        assert.deepStrictEqual(g.log, ["t1", "s", "t2", "a 7"]);
      });

      test("two modules under one specifier with different attributes both run", async () => {
        const g = graph(kind, {
          a: `import one from "s"; import two from "s" with { type: "json" }; log("a " + one + " " + two);`,
        });
        const one = synthetic(g, "one", ["default"], module => {
          g.log.push("one");
          module.setExport("default", 1);
        });
        const two = synthetic(g, "two", ["default"], module => {
          g.log.push("two");
          module.setExport("default", 2);
        });
        await (g.modules.a as vm.SourceTextModule).link((specifier, referrer, extra) =>
          (extra.attributes as Record<string, string>).type === "json" ? two : one,
        );
        await g.modules.a.evaluate();
        assert.deepStrictEqual(g.log, ["one", "two", "a 1 2"]);
        assert.deepStrictEqual([one.status, two.status], ["evaluated", "evaluated"]);
      });
    });

    describe("initializeImportMeta", () => {
      function metaGraph(sources: Record<string, string>, host: Record<string, unknown> = {}) {
        const g = graph(kind, {}, host);
        const calls: unknown[] = [];
        for (const [identifier, source] of Object.entries(sources)) {
          g.modules[identifier] = new vm.SourceTextModule(source, {
            identifier,
            context: g.context,
            initializeImportMeta(meta, module) {
              calls.push([identifier, module === g.modules[identifier], g.statuses()]);
              g.log.push("meta of " + identifier);
              (meta as any).id = identifier;
            },
          });
        }
        return {
          ...g,
          calls,
          link: (root = Object.keys(sources)[0]) => (g.modules[root] as vm.SourceTextModule).link(g.linker),
        };
      }

      test("it runs when the module evaluates import.meta for the first time, and only then", async () => {
        const g = metaGraph({
          a: `import "b"; import "c"; log("a"); log(import.meta.id); log(import.meta.id);`,
          b: `log("b"); log(import.meta.id);`,
          c: `log("c"); export const unused = () => import.meta;`,
        });
        await g.link();
        assert.deepStrictEqual(g.log, []);
        await g.modules.a.evaluate();
        assert.deepStrictEqual(g.log, ["b", "meta of b", "b", "c", "a", "meta of a", "a", "a"]);
        assert.deepStrictEqual(g.calls, [
          ["b", true, { a: "evaluating", b: "evaluating", c: "linked" }],
          ["a", true, { a: "evaluating", b: "evaluated", c: "evaluated" }],
        ]);
      });

      test("a function that a cycle member calls first gets the module's import.meta", async () => {
        const g = metaGraph({
          a: `import { viaB } from "b"; log("a"); export function meta() { return import.meta; } log(viaB === import.meta);`,
          b: `import { meta } from "a"; log("b"); export const viaB = meta(); log(viaB.id);`,
        });
        await g.link();
        await g.modules.a.evaluate();
        assert.deepStrictEqual(g.log, ["b", "meta of a", "a", "a", true]);
        assert.deepStrictEqual(g.calls, [["a", true, { a: "evaluating", b: "evaluating" }]]);
      });

      test("a function that runs after the module is evaluated gets the module's import.meta", async () => {
        const g = metaGraph({
          a: `log("a"); export const later = () => import.meta;`,
        });
        await g.link();
        await g.modules.a.evaluate();
        assert.deepStrictEqual(g.log, ["a"]);
        const meta = (g.modules.a.namespace as any).later();
        assert.strictEqual(meta.id, "a");
        assert.strictEqual((g.modules.a.namespace as any).later(), meta);
        assert.deepStrictEqual(g.calls, [["a", true, { a: "evaluated" }]]);
      });

      test("what it throws is thrown where import.meta is evaluated, and the next evaluation calls it again", async () => {
        const g = graph(kind, {});
        let calls = 0;
        g.modules.a = new vm.SourceTextModule(
          `let kept = "kept";
           try { kept = import.meta; } catch (error) { log(error.message); }
           log(kept);
           log(import.meta.n);
           log(import.meta.n);`,
          {
            identifier: "a",
            context: g.context,
            initializeImportMeta(meta) {
              if (++calls === 1) throw new Error("not yet");
              (meta as any).n = calls;
            },
          },
        );
        await (g.modules.a as vm.SourceTextModule).link(g.linker);
        await g.modules.a.evaluate();
        // A variable keeps its value when the import.meta that is assigned to it throws.
        assert.deepStrictEqual(g.log, ["not yet", "kept", 2, 2]);
        assert.strictEqual(calls, 2);
      });

      test("what it throws outside a try block fails the module", async () => {
        const g = graph(kind, {
          a: `import "b"; log("a");`,
        });
        const error = new Error("from initializeImportMeta");
        g.modules.b = new vm.SourceTextModule(`log("b1"); import.meta; log("b2");`, {
          identifier: "b",
          context: g.context,
          initializeImportMeta() {
            throw error;
          },
        });
        await g.link();
        await assert.rejects(g.modules.a.evaluate(), reason => reason === error);
        assert.deepStrictEqual(g.log, ["b1"]);
        assert.deepStrictEqual(g.statuses(), { a: "errored", b: "errored" });
      });
    });

    describe("AsyncLocalStorage", () => {
      test("every module of the graph runs in the context that evaluate() was called in", async () => {
        const storage = new AsyncLocalStorage<string>();
        // Not in the context that a module was made in, or linked in.
        const g = storage.run("construct", () => {
          const g = graph(
            kind,
            {
              r: `import "a"; import "s"; log("r " + store());`,
              a: `import "b"; import "c"; log("a " + store());`,
              b: `import "t"; log("b " + store());`,
              c: `log("c1 " + store()); await 0; log("c2 " + store());`,
              t: `log("t1 " + store()); await 0; log("t2 " + store());`,
            },
            { store: () => storage.getStore() },
          );
          synthetic(g, "s", [], () => void g.log.push("s " + storage.getStore()));
          return g;
        });
        await storage.run("link", () => g.link());
        const promise = storage.run("evaluate", () => g.modules.r.evaluate());
        assert.deepStrictEqual(await g.settle(promise), { fulfilled: undefined });
        assert.deepStrictEqual(g.log, [
          "t1 evaluate",
          "c1 evaluate",
          "s evaluate",
          "t2 evaluate",
          "c2 evaluate",
          "b evaluate",
          "a evaluate",
          "r evaluate",
        ]);
      });
    });
  });
}

describe("module.evaluate() in an afterEvaluate context", () => {
  const kind = "an afterEvaluate context";

  test("the jobs that the graph queues run in one checkpoint, after the walk", async () => {
    const g = graph(kind, {
      a: `import "b"; log("a"); Promise.resolve().then(() => log("job of a"));`,
      b: `log("b"); Promise.resolve().then(() => log("job of b"));`,
    });
    await g.link();
    const promise = g.modules.a.evaluate();
    assert.deepStrictEqual(g.log, ["b", "a", "job of b", "job of a"]);
    assert.strictEqual(await promise, undefined);
  });

  test("evaluate() of a module that is evaluated or errored runs the jobs that wait in the context", async () => {
    const g = graph(kind, {
      a: `log("a"); globalThis.later = () => Promise.resolve().then(() => log("job"));`,
      b: `throw new Error("from b");`,
    });
    await g.link("a");
    await g.link("b");
    await g.modules.a.evaluate();
    await assert.rejects(g.modules.b.evaluate(), { message: "from b" });

    vm.runInContext("later()", g.context!);
    // runInContext() did a checkpoint too.
    assert.deepStrictEqual(g.log, ["a", "job"]);

    (g.context as any).later();
    assert.deepStrictEqual(g.log, ["a", "job"]);
    await turn();
    assert.deepStrictEqual(g.log, ["a", "job"]);
    await g.modules.a.evaluate();
    assert.deepStrictEqual(g.log, ["a", "job", "job"]);

    (g.context as any).later();
    await assert.rejects(g.modules.b.evaluate(), { message: "from b" });
    assert.deepStrictEqual(g.log, ["a", "job", "job", "job"]);
  });

  test("a top-level await finishes inside evaluate() when only jobs of the context are in its way", async () => {
    const g = graph(kind, {
      a: `import "b"; log("a");`,
      b: `log("b1"); await 0; log("b2");`,
    });
    await g.link();
    const promise = g.modules.a.evaluate();
    assert.deepStrictEqual(g.log, ["b1", "b2", "a"]);
    assert.strictEqual(await promise, undefined);
  });

  test("a top-level await of a promise of the main context finishes in a later evaluate()", async () => {
    let resolve!: (value: string) => void;
    const gate = new Promise<string>(r => (resolve = r));
    const g = graph(
      kind,
      {
        a: `import "b"; log("a");`,
        b: `log("b1"); log(await gate); log("b2");`,
      },
      { gate },
    );
    await g.link();
    let settled = false;
    const promise = g.modules.a.evaluate().then(() => (settled = true));
    await turn();
    assert.deepStrictEqual(g.log, ["b1"]);
    assert.deepStrictEqual(g.statuses(), { a: "evaluated", b: "evaluated" });

    resolve("open");
    await turn();
    // The job that resumes b waits in the queue of the context.
    assert.deepStrictEqual(g.log, ["b1"]);
    assert.strictEqual(settled, false);

    g.modules.a.evaluate().then(noop, noop);
    assert.deepStrictEqual(g.log, ["b1", "open", "b2", "a"]);
    await promise;
    assert.strictEqual(settled, true);
  });

  test("a body that throws after a top-level await rejects the promise of the first evaluate()", async () => {
    let resolve!: () => void;
    const gate = new Promise<void>(r => (resolve = r));
    const g = graph(
      kind,
      {
        a: `import "b"; log("a");`,
        b: `log("b1"); await gate; throw new Error("from b");`,
      },
      { gate },
    );
    await g.link();
    const first = g.modules.a.evaluate();
    first.then(noop, noop);
    await turn();
    resolve();
    await turn();
    assert.deepStrictEqual(g.statuses(), { a: "evaluated", b: "evaluated" });

    // This call runs the job that fails b. Its own promise rejects, and so does the first one.
    await assert.rejects(g.modules.a.evaluate(), { message: "from b" });
    await assert.rejects(first, { message: "from b" });
    assert.deepStrictEqual(g.log, ["b1"]);
    assert.deepStrictEqual(g.statuses(), { a: "errored", b: "errored" });
  });
});

// The child prints what it saw to stdout, and an unhandled rejection ends it with exit code 1.
function runChild(program: string) {
  const { status, stdout, stderr } = spawnSync(
    process.execPath,
    [...(isBun ? [] : ["--experimental-vm-modules", "--no-warnings"]), "-e", program],
    { encoding: "utf8", env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" } },
  );
  return { status, stdout, stderr };
}

const childPrelude = `
  const vm = require("node:vm");
  const entries = [];
  globalThis.log = entry => void entries.push(entry);
  const modules = {};
  const define = sources => {
    for (const [identifier, source] of Object.entries(sources))
      modules[identifier] = new vm.SourceTextModule(source, { identifier });
  };
  const linker = specifier => modules[specifier];
  const turn = () => new Promise(resolve => setImmediate(resolve));
`;

describe("module.evaluate() and unhandled rejections", () => {
  test("a module that throws after a top-level await, when the program handles every evaluate()", () => {
    const { status, stdout, stderr } = runChild(`${childPrelude}
      define({
        a: 'import "b"; log("a");',
        b: 'log("b1"); await 0; throw new Error("from b");',
      });
      (async () => {
        await modules.a.link(linker);
        const outcomes = [];
        await modules.a.evaluate().catch(error => outcomes.push("a: " + error.message));
        await modules.b.evaluate().catch(error => outcomes.push("b: " + error.message));
        await turn();
        console.log(JSON.stringify({ log: entries, outcomes, statuses: [modules.a.status, modules.b.status] }));
      })();
    `);
    assert.strictEqual(stderr, "");
    assert.deepStrictEqual(JSON.parse(stdout), {
      log: ["b1"],
      outcomes: ["a: from b", "b: from b"],
      statuses: ["errored", "errored"],
    });
    assert.strictEqual(status, 0);
  });

  test("a module that throws, when the program handles every evaluate()", () => {
    const { status, stdout, stderr } = runChild(`${childPrelude}
      define({
        a: 'import "b"; log("a");',
        b: 'log("b"); throw new Error("from b");',
      });
      (async () => {
        await modules.a.link(linker);
        const outcomes = [];
        await modules.a.evaluate().catch(error => outcomes.push("a: " + error.message));
        await modules.b.evaluate().catch(error => outcomes.push("b: " + error.message));
        await turn();
        console.log(JSON.stringify({ log: entries, outcomes }));
      })();
    `);
    assert.strictEqual(stderr, "");
    assert.deepStrictEqual(JSON.parse(stdout), { log: ["b"], outcomes: ["a: from b", "b: from b"] });
    assert.strictEqual(status, 0);
  });

  test("a rejection of evaluate() that the program drops is reported", () => {
    const { status, stderr } = runChild(`${childPrelude}
      define({
        a: 'import "b"; log("a");',
        b: 'log("b1"); await 0; throw new Error("from b, dropped");',
      });
      (async () => {
        await modules.a.link(linker);
        modules.a.evaluate();
      })();
    `);
    assert.match(stderr, /from b, dropped/);
    assert.strictEqual(status, 1);
  });

  test("a rejection of evaluate() in an afterEvaluate context that the program drops is reported", () => {
    const { status, stderr } = runChild(`${childPrelude}
      const context = vm.createContext({}, { microtaskMode: "afterEvaluate" });
      const a = new vm.SourceTextModule('import "b";', { context });
      const b = new vm.SourceTextModule('await 0; throw new Error("from the context, dropped");', { context });
      (async () => {
        await a.link(() => b);
        a.evaluate();
      })();
    `);
    assert.match(stderr, /from the context, dropped/);
    assert.strictEqual(status, 1);
  });

  test("a rejection of evaluate() of a cycle that the program drops is reported", () => {
    const { status, stderr } = runChild(`${childPrelude}
      define({
        a: 'import "b"; log("a");',
        b: 'import "a"; log("b1"); await 0; throw new Error("from the cycle, dropped");',
      });
      (async () => {
        await modules.a.link(linker);
        modules.a.evaluate();
      })();
    `);
    assert.match(stderr, /from the cycle, dropped/);
    assert.strictEqual(status, 1);
  });
});

// In Bun, this checks the expectations above against Node.js on the same machine. It runs when the installed
// `node` is the version that Bun reports as process.versions.node, which is the version they were taken from.
const node = isBun ? (globalThis as any).Bun.which("node") : null;
const nodeIsTheReportedVersion =
  !!node && spawnSync(node, ["--version"], { encoding: "utf8" }).stdout.trim() === `v${process.versions.node}`;

test("Node.js runs this file with the same results", { skip: !nodeIsTheReportedVersion }, () => {
  const { status, stdout, stderr } = spawnSync(
    node,
    ["--experimental-vm-modules", "--no-warnings", "--test", import.meta.filename],
    { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" } },
  );
  assert.strictEqual(status, 0, stdout + stderr);
});

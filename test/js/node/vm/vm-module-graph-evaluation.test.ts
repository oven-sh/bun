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
 *   node --experimental-vm-modules vm-module-graph-evaluation.test.ts
 *
 * Every expectation is what Node v26.3.0 does. For the same reason the file
 * does not import from "harness".
 */
import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
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

      test("a link() that ends after an importer's instantiate() linked the module changes nothing", async () => {
        const g = graph(kind, {
          a: `import { c } from "c"; log("a " + c);`,
          c: `import { e } from "e"; log("c " + e); export const c = e;`,
          e1: `log("e1"); export const e = 1;`,
          e2: `log("e2"); export const e = 2;`,
        });
        const { a, c, e1, e2 } = g.modules as Record<string, vm.SourceTextModule>;
        let release!: () => void;
        const gate = new Promise<void>(resolve => (release = resolve));
        e1.linkRequests([]);
        c.linkRequests([e1]);
        // This link() waits in its linker. Its answer is another module than the one of linkRequests().
        const late = c.link(async () => {
          await gate;
          return e2;
        });
        await turn();
        a.linkRequests([c]);
        a.instantiate();
        assert.deepStrictEqual(g.statuses(), { a: "linked", c: "linking", e1: "linked", e2: "unlinked" });
        release();
        await late;
        assert.deepStrictEqual(g.statuses(), { a: "linked", c: "linked", e1: "linked", e2: "unlinked" });
        await c.evaluate();
        assert.deepStrictEqual(g.log, ["e1", "c 1"]);
      });

      test("a link() of a module without imports that ends after an importer's instantiate() linked the module changes nothing", async () => {
        const g = graph(kind, { a: `import { d } from "d"; log("a " + d);`, d: `log("d"); export const d = 1;` });
        const { a, d } = g.modules as Record<string, vm.SourceTextModule>;
        // d requests no module, so this link() never calls its linker. It ends one job later.
        const late = d.link(() => assert.fail("the linker was called"));
        a.linkRequests([d]);
        a.instantiate();
        assert.deepStrictEqual(g.statuses(), { a: "linked", d: "linking" });
        await late;
        assert.deepStrictEqual(g.statuses(), { a: "linked", d: "linked" });
        await a.evaluate();
        assert.deepStrictEqual(g.log, ["d", "a 1"]);
      });

      test("a link() that fails: the modules that linked before the failure are 'linked' and can be evaluated", async () => {
        const g = graph(kind, {
          a: `import "b"; import { nope } from "c"; log("a");`,
          b: `import "d"; log("b");`,
          c: `export const y = 1; log("c");`,
          d: `log("d");`,
        });
        const { a, b } = g.modules as Record<string, vm.SourceTextModule>;
        await assert.rejects(g.link(), { name: "SyntaxError" });
        assert.deepStrictEqual(g.statuses(), { a: "unlinked", b: "linked", c: "linked", d: "linked" });
        await assert.rejects(b.link(g.linker), { code: "ERR_VM_MODULE_ALREADY_LINKED" });
        await assert.rejects(a.evaluate(), { code: "ERR_VM_MODULE_STATUS" });
        assert.throws(() => a.namespace, { code: "ERR_VM_MODULE_STATUS" });
        assert.deepStrictEqual(Reflect.ownKeys(g.modules.c.namespace), ["y", Symbol.toStringTag]);
        assert.strictEqual(await b.evaluate(), undefined);
        assert.deepStrictEqual(g.log, ["d", "b"]);
        assert.deepStrictEqual(g.statuses(), { a: "unlinked", b: "evaluated", c: "linked", d: "evaluated" });
        await assert.rejects(g.link(), { name: "SyntaxError" });
        assert.deepStrictEqual(g.statuses(), { a: "unlinked", b: "evaluated", c: "linked", d: "evaluated" });
      });

      test("a link() that fails in a module of a cycle: the cycle and the modules that import it stay 'unlinked'", async () => {
        const g = graph(kind, {
          a: `import "d"; import "b"; import "e"; log("a");`,
          b: `import "c"; log("b");`,
          c: `import "b"; import { nope } from "d"; log("c");`,
          d: `export const y = 1; log("d");`,
          e: `log("e");`,
        });
        await assert.rejects(g.link(), { name: "SyntaxError" });
        assert.deepStrictEqual(g.statuses(), {
          a: "unlinked",
          b: "unlinked",
          c: "unlinked",
          d: "linked",
          e: "unlinked",
        });
        await assert.rejects(g.link("b"), { name: "SyntaxError" });
        await g.link("e");
        assert.deepStrictEqual(g.statuses(), { a: "unlinked", b: "unlinked", c: "unlinked", d: "linked", e: "linked" });
      });

      test("an instantiate() that fails leaves the same statuses as a link() that fails", () => {
        const g = graph(kind, {
          a: `import "b"; import { nope } from "c"; log("a");`,
          b: `import "d"; log("b");`,
          c: `export const y = 1; log("c");`,
          d: `log("d");`,
        });
        const { a, b, c, d } = g.modules as Record<string, vm.SourceTextModule>;
        a.linkRequests([b, c]);
        b.linkRequests([d]);
        c.linkRequests([]);
        d.linkRequests([]);
        assert.throws(() => a.instantiate(), { name: "SyntaxError" });
        assert.deepStrictEqual(g.statuses(), { a: "unlinked", b: "linked", c: "linked", d: "linked" });
        assert.throws(() => a.instantiate(), { name: "SyntaxError" });
        assert.throws(() => b.instantiate(), { code: "ERR_VM_MODULE_STATUS" });
      });

      test("a link() that failed can be called again with another module for the specifier that failed", async () => {
        const g = graph(kind, {
          a: `import "b"; import { nope } from "c"; log("a " + nope);`,
          b: `log("b");`,
          c1: `export const y = 1; log("c1");`,
          c2: `export const nope = 2; log("c2");`,
        });
        const { a, b, c1, c2 } = g.modules as Record<string, vm.SourceTextModule>;
        await assert.rejects(
          a.link(specifier => (specifier === "b" ? b : c1)),
          { name: "SyntaxError" },
        );
        assert.deepStrictEqual(g.statuses(), { a: "unlinked", b: "linked", c1: "linked", c2: "unlinked" });
        await a.link(specifier => (specifier === "b" ? b : c2));
        assert.deepStrictEqual(g.statuses(), { a: "linked", b: "linked", c1: "linked", c2: "linked" });
        await a.evaluate();
        assert.deepStrictEqual(g.log, ["b", "c2", "a 2"]);
        assert.deepStrictEqual(g.statuses(), { a: "evaluated", b: "evaluated", c1: "linked", c2: "evaluated" });
      });

      test("a link() that reaches a module that failed rejects, and names the request", async () => {
        const g = graph(kind, { a: `import "b"; log("a");`, b: `throw new Error("from b");` });
        await g.link("b");
        await assert.rejects(g.modules.b.evaluate(), { message: "from b" });
        await assert.rejects(g.link("a"), {
          code: "ERR_VM_MODULE_LINK_FAILURE",
          message: "request for 'b' resolved to an errored module",
          cause: g.modules.b.error,
        });
        assert.deepStrictEqual(g.statuses(), { a: "errored", b: "errored" });
        assert.strictEqual(g.modules.a.error.code, "ERR_VM_MODULE_LINK_FAILURE");
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

      test("each evaluate() of a SyntheticModule whose evaluateCallback threw gives a new rejection", async () => {
        const g = graph(kind, {});
        const error = new Error("from s");
        const s = synthetic(g, "s", [], () => {
          throw error;
        });
        const calls = [s.evaluate(), s.evaluate(), s.evaluate()];
        assert.strictEqual(new Set(calls).size, 3);
        // The call that ran the evaluateCallback rejects with what it threw, in the realm of the caller. The later
        // calls give a promise of the realm of the module, or of the caller's realm for an afterEvaluate context.
        const ofModule =
          g.context && kind !== "an afterEvaluate context" ? vm.runInContext("Promise", g.context) : Promise;
        assert.deepStrictEqual(
          calls.map(call => [call instanceof Promise, call instanceof ofModule]),
          [
            [true, ofModule === Promise],
            [ofModule === Promise, true],
            [ofModule === Promise, true],
          ],
        );
        for (const call of calls) await assert.rejects(call, reason => reason === error);
      });

      test("two modules with one source and one identifier read the exports of their own SyntheticModule", async () => {
        const g = graph(kind, {});
        const exportLists = [
          ["x"],
          ["x", "alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa", "lambda", "mu"],
          ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "x"],
        ];
        for (const lists of [exportLists, [...exportLists].reverse()]) {
          const readers: (() => string)[] = [];
          for (const [i, exportNames] of lists.entries()) {
            const s = new vm.SyntheticModule(
              exportNames,
              function (this: vm.SyntheticModule) {
                for (const name of exportNames) this.setExport(name, `${i}:${name}`);
              },
              { context: g.context },
            );
            const importer = new vm.SourceTextModule(`import { x } from "s"; export function read() { return x; }`, {
              identifier: "file:///same.mjs",
              context: g.context,
            });
            await importer.link(() => s);
            await importer.evaluate();
            readers.push((importer.namespace as any).read);
          }
          for (let n = 0; n < 50; n++)
            assert.deepStrictEqual(
              readers.map(read => read()),
              ["0:x", "1:x", "2:x"],
            );
        }
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

    describe("AsyncLocalStorage", () => {
      test("a module body and an evaluateCallback run in the context that evaluate() was called in", async () => {
        const storage = new AsyncLocalStorage<string>();
        // Not in the context that a module was made in, or linked in.
        const g = storage.run("construct", () => {
          const g = graph(
            kind,
            {
              r: `import "a"; import "s"; log("r " + store());`,
              a: `log("a " + store());`,
            },
            { store: () => storage.getStore() },
          );
          synthetic(g, "s", [], () => void g.log.push("s " + storage.getStore()));
          return g;
        });
        await storage.run("link", () => g.link());
        await storage.run("evaluate", () => g.modules.r.evaluate());
        assert.deepStrictEqual(g.log, ["a evaluate", "s evaluate", "r evaluate"]);
      });
    });

    describe("initializeImportMeta", () => {
      // Node calls it when the code of the module evaluates import.meta for the first time, and Bun calls it
      // before the body of the module. No test of this group can tell the two apart.
      function metaGraph(sources: Record<string, string>) {
        const g = graph(kind, {});
        const calls: unknown[] = [];
        for (const [identifier, source] of Object.entries(sources)) {
          g.modules[identifier] = new vm.SourceTextModule(source, {
            identifier,
            context: g.context,
            initializeImportMeta(meta, module) {
              calls.push([identifier, module === g.modules[identifier]]);
              (meta as any).id = identifier;
            },
          });
        }
        const link = (root = Object.keys(sources)[0]) => (g.modules[root] as vm.SourceTextModule).link(g.linker);
        return { ...g, calls, link };
      }

      test("it is not called for a module whose source has no import.meta", async () => {
        const g = metaGraph({ a: `import "b"; log("a");`, b: `log("b " + import.meta.id);` });
        await g.link();
        await g.modules.a.evaluate();
        assert.deepStrictEqual(g.log, ["b b", "a"]);
        assert.deepStrictEqual(g.calls, [["b", true]]);
      });

      test("each module of a cycle has its properties when its body reads import.meta", async () => {
        const g = metaGraph({
          a: `import "b"; log("a " + import.meta.id);`,
          b: `import "c"; log("b " + import.meta.id);`,
          c: `import "a"; log("c " + import.meta.id);`,
        });
        await g.link();
        await g.modules.a.evaluate();
        assert.deepStrictEqual(g.log, ["c c", "b b", "a a"]);
      });

      test("a module that waits for a top-level await has its properties too", async () => {
        const g = metaGraph({
          r: `import "t"; log("r " + import.meta.id);`,
          t: `log("t " + import.meta.id); await 0; log("t again " + import.meta.id);`,
        });
        await g.link();
        assert.deepStrictEqual(await g.settle(g.modules.r.evaluate()), { fulfilled: undefined });
        assert.deepStrictEqual(g.log, ["t t", "t again t", "r r"]);
      });

      test("it is called once, with the import.meta of the module and the module", async () => {
        const g = metaGraph({
          a: `log(import.meta.id); log(import.meta === import.meta); export const meta = () => import.meta;`,
        });
        await g.link();
        await g.modules.a.evaluate();
        assert.deepStrictEqual(g.log, ["a", true]);
        assert.strictEqual((g.modules.a.namespace as any).meta().id, "a");
        assert.deepStrictEqual(g.calls, [["a", true]]);
      });

      test("what it throws fails the module", async () => {
        const g = graph(kind, { a: `import "b"; log("a");` });
        const error = new Error("from initializeImportMeta");
        g.modules.b = new vm.SourceTextModule(`import.meta; log("b");`, {
          identifier: "b",
          context: g.context,
          initializeImportMeta() {
            throw error;
          },
        });
        await g.link();
        await assert.rejects(g.modules.a.evaluate(), reason => reason === error);
        assert.deepStrictEqual(g.log, []);
        assert.deepStrictEqual(g.statuses(), { a: "errored", b: "errored" });
        assert.strictEqual(g.modules.b.error, error);
      });
    });

    describe("evaluate() from inside an evaluation", () => {
      test("an evaluateCallback evaluates a root that imports a module that is 'evaluating': the root runs at once", async () => {
        const g = graph(kind, {
          r1: `import { x } from "s"; log("r1"); export const v = x + 1;`,
          r2: `import { v } from "r1"; let seen; try { seen = v; } catch (error) { seen = error.name; } log("r2 " + seen);`,
        });
        let inner: Promise<unknown> | undefined;
        synthetic(g, "s", ["x"], module => {
          inner = g.modules.r2.evaluate();
          g.log.push("s " + JSON.stringify(g.statuses()));
          module.setExport("x", 1);
        });
        await g.link("r1");
        await g.link("r2");
        await g.modules.r1.evaluate();
        assert.strictEqual(await inner, undefined);
        assert.deepStrictEqual(g.log, [
          "r2 ReferenceError",
          `s {"r1":"evaluating","r2":"evaluated","s":"evaluating"}`,
          "r1",
        ]);
        assert.deepStrictEqual(g.statuses(), { r1: "evaluated", r2: "evaluated", s: "evaluated" });
      });

      test("that root fails on a binding of the 'evaluating' module, and an outer root that imports it fails with the same error", async () => {
        const g = graph(kind, {
          r1: `import { x } from "s"; import "r2"; log("r1"); export const v = x + 1;`,
          r2: `import { v } from "r1"; log("r2 " + v);`,
        });
        let inner: Promise<unknown> | undefined;
        synthetic(g, "s", ["x"], module => {
          inner = g.modules.r2.evaluate();
          inner.catch(noop);
          module.setExport("x", 1);
        });
        await g.link("r1");
        await assert.rejects(g.modules.r1.evaluate(), { name: "ReferenceError" });
        await assert.rejects(inner!, reason => reason === g.modules.r2.error);
        assert.strictEqual(g.modules.r1.error, g.modules.r2.error);
        assert.deepStrictEqual(g.log, []);
        assert.deepStrictEqual(g.statuses(), { r1: "errored", r2: "errored", s: "evaluated" });
      });

      test("a body evaluates a root that imports its module", async () => {
        let inner: Promise<unknown> | undefined;
        const g = graph(
          kind,
          {
            r1: `log("r1 start"); reenter(); log("r1 end"); export const v = 1;`,
            r2: `import { v } from "r1"; let seen; try { seen = v; } catch (error) { seen = error.name; } log("r2 " + seen);`,
          },
          { reenter: () => void (inner = g.modules.r2.evaluate()) },
        );
        await g.link("r1");
        await g.link("r2");
        await g.modules.r1.evaluate();
        assert.strictEqual(await inner, undefined);
        assert.deepStrictEqual(g.log, ["r1 start", "r2 ReferenceError", "r1 end"]);
      });

      test("the root that a callback evaluated stays 'evaluated' when the outer root fails later", async () => {
        const g = graph(kind, {
          r1: `import "s"; log("r1"); throw new Error("from r1");`,
          r2: `import "r1"; log("r2");`,
        });
        let inner: Promise<unknown> | undefined;
        synthetic(g, "s", [], () => void (inner = g.modules.r2.evaluate()));
        await g.link("r1");
        await g.link("r2");
        await assert.rejects(g.modules.r1.evaluate(), { message: "from r1" });
        assert.strictEqual(await inner, undefined);
        assert.deepStrictEqual(g.log, ["r2", "r1"]);
        assert.deepStrictEqual(g.statuses(), { r1: "errored", r2: "evaluated", s: "evaluated" });
        assert.strictEqual(await g.modules.r2.evaluate(), undefined);
      });

      // The loop ends only when the timeout works, so it runs in a child.
      test("the timeout of an inner evaluate() does not stop the evaluate() around it", async () => {
        const { status, stdout, stderr } = await runChild(
          "-e",
          `${childPrelude(kind)}
          define({ a: 'import "s"; log("a");', spin: 'for (;;) {}' });
          let inner;
          modules.s = new vm.SyntheticModule(
            [],
            () => {
              inner = modules.spin.evaluate({ timeout: 10 });
              log("s after the inner evaluate()");
            },
            { identifier: "s", context },
          );
          (async () => {
            await modules.spin.link(linker);
            await modules.a.link(linker);
            await modules.a.evaluate();
            const code = await inner.then(() => "fulfilled", error => error.code);
            console.log(JSON.stringify({ log: entries, code, statuses: statuses() }));
          })();
        `,
        );
        assert.strictEqual(stderr, "");
        assert.deepStrictEqual(JSON.parse(stdout), {
          log: ["s after the inner evaluate()", "a"],
          code: "ERR_SCRIPT_EXECUTION_TIMEOUT",
          statuses: { a: "evaluated", spin: "errored", s: "evaluated" },
        });
        assert.strictEqual(status, 0);
      });
    });

    describe("the promise of evaluate()", () => {
      // In an afterEvaluate context every call gives a new promise of the caller's realm.
      const ownQueue = kind === "an afterEvaluate context";

      test("it is a promise of the realm of the module, or of the caller's realm for an afterEvaluate context", async () => {
        const g = graph(kind, { sync: `log("sync");`, waits: `await 0;`, throws: `throw new Error("from throws");` });
        for (const name of Object.keys(g.modules)) await g.link(name);
        const promises = [g.modules.sync.evaluate(), g.modules.waits.evaluate(), g.modules.throws.evaluate()];
        promises[2].catch(noop);
        const realm = g.context && !ownQueue ? vm.runInContext("Promise", g.context) : Promise;
        assert.deepStrictEqual(
          promises.map(promise => promise instanceof realm),
          [true, true, true],
        );
        await g.settle(promises[1], "waits");
      });

      test("evaluate() of a module that failed as a dependency gives a new rejection of that realm for each call", async () => {
        const g = graph(kind, {
          r1: `import "throws";`,
          r2: `import "throwsLater";`,
          r3: `import "s";`,
          throws: `throw new Error("from throws");`,
          throwsLater: `await 0; throw new Error("from throwsLater");`,
        });
        synthetic(g, "s", [], () => {
          throw new Error("from s");
        });
        for (const root of ["r1", "r2", "r3"]) {
          await g.link(root);
          assert.deepStrictEqual(Object.keys(await g.settle(g.modules[root].evaluate(), root)), ["rejected"]);
        }
        const realm = g.context && !ownQueue ? vm.runInContext("Promise", g.context) : Promise;
        for (const name of ["throws", "throwsLater", "s"]) {
          const module = g.modules[name];
          const calls = [module.evaluate(), module.evaluate()];
          assert.notStrictEqual(calls[0], calls[1]);
          assert.deepStrictEqual(
            calls.map(call => call instanceof realm),
            [true, true],
          );
          for (const call of calls) await assert.rejects(call, reason => reason === module.error);
        }
      });

      test("evaluate() of an evaluated module gives the promise of the first call", async () => {
        const g = graph(kind, { a: `import "b"; log("a");`, b: `log("b1"); await 0; log("b2");` });
        await g.link();
        const first = g.modules.a.evaluate();
        const second = g.modules.a.evaluate();
        assert.strictEqual(second === first, !ownQueue);
        assert.deepStrictEqual(await g.settle(first), { fulfilled: undefined });
        assert.strictEqual(await second, undefined);
        // b ran as a dependency. Its first evaluate() makes the promise that the later calls give.
        const ofB = g.modules.b.evaluate();
        assert.notStrictEqual(ofB, first);
        assert.strictEqual(g.modules.b.evaluate() === ofB, !ownQueue);
        assert.strictEqual(await ofB, undefined);
        assert.deepStrictEqual(g.log, ["b1", "b2", "a"]);
      });

      test("evaluate() of a root that failed gives its promise again", async () => {
        const g = graph(kind, { a: `import "b"; log("a");`, b: `throw new Error("from b");` });
        await g.link();
        const first = g.modules.a.evaluate();
        await assert.rejects(first, { message: "from b" });
        const second = g.modules.a.evaluate();
        assert.strictEqual(second === first, !ownQueue);
        await assert.rejects(second, reason => reason === g.modules.a.error);
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

  test("evaluate() and runInContext() from inside a job of the context do no checkpoint of their own", async () => {
    const g = graph(kind, { other: `Promise.resolve().then(() => log("job of other")); log("other");` });
    await g.link();
    (g.context as any).nested = () => {
      g.modules.other.evaluate().then(noop, noop);
      g.log.push("after the nested evaluate()");
      vm.runInContext(`Promise.resolve().then(() => log("job of the nested script"))`, g.context!);
      g.log.push("after the nested script");
    };
    vm.runInContext(`Promise.resolve().then(() => { nested(); log("end of the outer job"); })`, g.context!);
    assert.deepStrictEqual(g.log, [
      "other",
      "after the nested evaluate()",
      "after the nested script",
      "end of the outer job",
      "job of other",
      "job of the nested script",
    ]);
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

  test("a job of the main program and a process.nextTick() callback do not run in the checkpoint", async () => {
    const { status, stdout, stderr } = await runChild(
      "-e",
      `${childPrelude(kind)}
      define({ a: 'Promise.resolve().then(() => log("job 1")); Promise.resolve().then(() => log("job 2"));' });
      (async () => {
        await modules.a.link(linker);
        let inside = false;
        const ranInside = {};
        Promise.resolve().then(() => (ranInside.job = inside));
        process.nextTick(() => (ranInside.tick = inside));
        inside = true;
        const promise = modules.a.evaluate();
        inside = false;
        await promise;
        await turn();
        console.log(JSON.stringify({ log: entries, ranInside }));
      })();
    `,
    );
    assert.strictEqual(stderr, "");
    assert.deepStrictEqual(JSON.parse(stdout), { log: ["job 1", "job 2"], ranInside: { job: false, tick: false } });
    assert.strictEqual(status, 0);
  });

  // The loop ends only when the timeout works, so it runs in a child.
  test("a timeout that stops a job of the checkpoint rejects that evaluate(), and the module stays 'evaluated'", async () => {
    const { status, stdout, stderr } = await runChild(
      "-e",
      `
      const vm = require("node:vm");
      const outcome = promise => promise.then(() => "fulfilled", error => error.code);
      (async () => {
        // The deadline can pass before the job starts. The test is about a run that reached the job.
        for (let attempt = 0; attempt < 100; attempt++) {
          const log = [];
          const context = vm.createContext({ log: entry => void log.push(entry) }, { microtaskMode: "afterEvaluate" });
          const a = new vm.SourceTextModule(
            'log("a"); Promise.resolve().then(() => { log("job"); for (;;) {} }); export const x = 1;',
            { context },
          );
          await a.link(() => {});
          const first = await outcome(a.evaluate({ timeout: 10 }));
          if (!log.includes("job")) continue;
          const then = a.status;
          const second = await outcome(a.evaluate());
          console.log(JSON.stringify({ log, first, then, second, x: a.namespace.x }));
          return;
        }
        console.log("no run reached the job");
      })();
    `,
    );
    assert.strictEqual(stderr, "");
    assert.deepStrictEqual(JSON.parse(stdout), {
      log: ["a", "job"],
      first: "ERR_SCRIPT_EXECUTION_TIMEOUT",
      then: "evaluated",
      second: "fulfilled",
      x: 1,
    });
    assert.strictEqual(status, 0);
  });
});

// The child prints what it saw to stdout, and an unhandled rejection ends it with exit code 1.
function runChild(...args: string[]) {
  const { promise, resolve } = Promise.withResolvers<{ status: number | null; stdout: string; stderr: string }>();
  execFile(
    process.execPath,
    [...(isBun ? [] : ["--experimental-vm-modules", "--no-warnings"]), ...args],
    { encoding: "utf8", env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" } },
    (error, stdout, stderr) => resolve({ status: error ? (error.code as number | null) : 0, stdout, stderr }),
  );
  return promise;
}

// The start of a child's program: what graph() gives a test of this file.
function childPrelude(kind: Kind = "the main context") {
  return `
    const vm = require("node:vm");
    const entries = [];
    globalThis.log = entry => void entries.push(entry);
    const options = ${JSON.stringify(kinds[kind] ?? null)};
    const context = options ? vm.createContext({ log }, options) : undefined;
    const modules = {};
    const define = sources => {
      for (const [identifier, source] of Object.entries(sources))
        modules[identifier] = new vm.SourceTextModule(source, { identifier, context });
    };
    const linker = specifier => modules[specifier];
    const statuses = () => Object.fromEntries(Object.entries(modules).map(([name, module]) => [name, module.status]));
    const turn = () => new Promise(resolve => setImmediate(resolve));
  `;
}

describe("module.evaluate() and unhandled rejections", () => {
  test("a module that throws after a top-level await, when the program handles every evaluate()", async () => {
    const { status, stdout, stderr } = await runChild(
      "-e",
      `${childPrelude()}
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
    `,
    );
    assert.strictEqual(stderr, "");
    assert.deepStrictEqual(JSON.parse(stdout), {
      log: ["b1"],
      outcomes: ["a: from b", "b: from b"],
      statuses: ["errored", "errored"],
    });
    assert.strictEqual(status, 0);
  });

  test("a module that throws, when the program handles every evaluate()", async () => {
    const { status, stdout, stderr } = await runChild(
      "-e",
      `${childPrelude()}
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
    `,
    );
    assert.strictEqual(stderr, "");
    assert.deepStrictEqual(JSON.parse(stdout), { log: ["b"], outcomes: ["a: from b", "b: from b"] });
    assert.strictEqual(status, 0);
  });

  test("a later evaluate() of a root that failed, which the program drops, is not reported", async () => {
    const { status, stdout, stderr } = await runChild(
      "-e",
      `${childPrelude()}
      define({
        a: 'import "b"; log("a");',
        b: 'log("b"); throw new Error("from b");',
      });
      (async () => {
        await modules.a.link(linker);
        await modules.a.evaluate().catch(error => console.log("caught: " + error.message));
        // Not a new promise: the one that the line above handled.
        modules.a.evaluate();
        await turn();
        console.log("done " + modules.a.status);
      })();
    `,
    );
    assert.strictEqual(stderr, "");
    assert.strictEqual(stdout, "caught: from b\ndone errored\n");
    assert.strictEqual(status, 0);
  });

  for (const kind of everyKind) {
    test(`a later evaluate() of a SyntheticModule that failed in ${kind}, which the program drops, is reported`, async () => {
      const { status, stderr } = await runChild(
        "-e",
        `${childPrelude(kind)}
        const s = new vm.SyntheticModule([], () => { throw new Error("from s, dropped"); }, { context });
        (async () => {
          await s.evaluate().catch(error => console.log("caught: " + error.message));
          s.evaluate();
        })();
      `,
      );
      assert.match(stderr, /from s, dropped/);
      assert.strictEqual(status, 1);
    });
  }

  test("a rejection of evaluate() that the program drops is reported", async () => {
    const { status, stderr } = await runChild(
      "-e",
      `${childPrelude()}
      define({
        a: 'import "b"; log("a");',
        b: 'log("b1"); await 0; throw new Error("from b, dropped");',
      });
      (async () => {
        await modules.a.link(linker);
        modules.a.evaluate();
      })();
    `,
    );
    assert.match(stderr, /from b, dropped/);
    assert.strictEqual(status, 1);
  });

  test("a rejection of evaluate() in an afterEvaluate context that the program drops is reported", async () => {
    const { status, stderr } = await runChild(
      "-e",
      `${childPrelude("an afterEvaluate context")}
      define({ a: 'import "b";', b: 'await 0; throw new Error("from the context, dropped");' });
      (async () => {
        await modules.a.link(linker);
        modules.a.evaluate();
      })();
    `,
    );
    assert.match(stderr, /from the context, dropped/);
    assert.strictEqual(status, 1);
  });

  test("a rejection of evaluate() of a cycle that the program drops is reported", async () => {
    const { status, stderr } = await runChild(
      "-e",
      `${childPrelude()}
      define({
        a: 'import "b"; log("a");',
        b: 'import "a"; log("b1"); await 0; throw new Error("from the cycle, dropped");',
      });
      (async () => {
        await modules.a.link(linker);
        modules.a.evaluate();
      })();
    `,
    );
    assert.match(stderr, /from the cycle, dropped/);
    assert.strictEqual(status, 1);
  });
});

// vm-module-graph-random-fixture.js makes a random graph from a seed (modules that import each other and
// themselves, wait at a top-level await, throw before or after it, SyntheticModules), evaluates some of its
// modules, and prints the order of the bodies, the statuses, the errors, what each evaluate() gave and what the
// process reported as unhandled. Each entry here is a seed and a digest of the line that Node.js v26.3.0 prints
// for it. scripts/vm-module-graph-random.ts compares any range of seeds with the `node` on PATH.
const randomGraphs: Record<Kind, string[]> = {
  "the main context": [
    "2:7f5ec38ca8 4:8c3fa5dfbb 5:22b5ca7d33 6:e0f63ddf24 7:7dbaeb8f1a 9:6551705f03",
    "10:e940767a22 23:8f1243c9a6 24:b320460b25 29:8bee57733c 30:e83c58e8e7 36:ffd7bccf4f",
  ],
  "a context": [
    "2:7f5ec38ca8 4:8c3fa5dfbb 5:22b5ca7d33 6:e0f63ddf24 7:7dbaeb8f1a 9:6551705f03",
    "10:e940767a22 23:8f1243c9a6 24:b320460b25 29:8bee57733c 30:e83c58e8e7 36:ffd7bccf4f",
  ],
  "an afterEvaluate context": [
    "2:4da14877a1 4:8c3fa5dfbb 5:22b5ca7d33 6:e0f63ddf24 7:cebb607601 9:6551705f03",
    "10:b4d098fbe0 23:8f1243c9a6 24:b320460b25 29:8bee57733c 30:e83c58e8e7 36:7e399bf3ee",
  ],
};

describe("random module graphs", () => {
  const fixture = fileURLToPath(new URL("./vm-module-graph-random-fixture.js", import.meta.url));
  const kindArgument: Record<Kind, string> = {
    "the main context": "main",
    "a context": "context",
    "an afterEvaluate context": "afterEvaluate",
  };

  for (const kind of everyKind) {
    test(`in ${kind}, every graph gives what Node.js gives`, async () => {
      const expected = new Map(
        randomGraphs[kind]
          .join(" ")
          .split(" ")
          .map(entry => entry.split(":") as [string, string]),
      );
      const { status, stdout, stderr } = await runChild(fixture, kindArgument[kind], ...expected.keys());
      const lines = stdout.trim().split("\n");
      // What this runtime printed for each graph that is not the graph of Node.js.
      const different = lines.filter(
        line =>
          createHash("sha1").update(line).digest("hex").slice(0, 10) !== expected.get(String(JSON.parse(line).seed)),
      );
      assert.deepStrictEqual(
        { status, stderr, graphs: lines.length, different },
        { status: 0, stderr: "", graphs: expected.size, different: [] },
      );
    });
  }
});

// Only in Bun: when Node.js runs this file it must not start itself again. The expectations above were taken
// from the Node.js version that Bun reports as process.versions.node, so only that version checks them here.
if (isBun) {
  const { bunEnv, nodeExe } = await import("harness");
  const node: string | null = nodeExe();
  const nodeIsTheReportedVersion =
    !!node &&
    Bun.spawnSync({ cmd: [node, "--version"] })
      .stdout.toString()
      .trim() === `v${process.versions.node}`;

  describe("Node.js compatibility", () => {
    // The timeout is for Node's run of the whole file, which starts children of its own.
    (nodeIsTheReportedVersion ? test : test.skip)("all tests pass in Node.js", { timeout: 30_000 }, async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--experimental-vm-modules", "--no-warnings", "--v8-pool-size=1", fileURLToPath(import.meta.url)],
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}

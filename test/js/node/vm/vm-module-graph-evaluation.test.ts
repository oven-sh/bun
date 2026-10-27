/**
 * What module.evaluate() of node:vm does with a graph that has an import
 * cycle: the order of the module bodies, the status and the error of each
 * module, and the rejections that it reports.
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
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const isBun = typeof process.versions.bun === "string";
// A case that Bun does not pass yet. Node runs it as a test, so its expectation stays what Node does.
const notYetInBun = isBun ? test.todo : test;

type Module = vm.SourceTextModule | vm.SyntheticModule;
type Modules = Record<string, Module>;
type Outcome = { fulfilled: unknown } | { rejected: unknown } | { pending: true };

// Where the modules of a test live. A context with microtaskMode "afterEvaluate" has its own microtask queue.
const kinds = {
  "the main context": undefined,
  "a context": {},
  "an afterEvaluate context": { microtaskMode: "afterEvaluate" },
} as const;
type Kind = keyof typeof kinds;
const everyKind = Object.keys(kinds) as Kind[];

const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const message = (outcome: Outcome) => ("rejected" in outcome ? (outcome.rejected as Error).message : outcome);

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
  const define = (identifier: string, source: string, more: vm.SourceTextModuleOptions = {}) =>
    (modules[identifier] = new vm.SourceTextModule(source, { identifier, context, ...more }));
  for (const [identifier, source] of Object.entries(sources)) define(identifier, source);

  const linker = (specifier: string) => modules[specifier];
  // An afterEvaluate context runs its jobs only in a microtask checkpoint, and evaluate() of a module of the
  // context does one. This module has no code: its evaluate() is only that checkpoint.
  const pump =
    options && "microtaskMode" in options ? new vm.SourceTextModule("", { identifier: "pump", context }) : undefined;
  return {
    log,
    context,
    modules,
    define,
    linker,
    link: (root = Object.keys(sources)[0]) => (modules[root] as vm.SourceTextModule).link(linker),
    statuses: () => Object.fromEntries(Object.entries(modules).map(([name, module]) => [name, module.status])),
    // Waits until `promise` settles. A promise that never settles is { pending: true } and not a test that hangs.
    async settle(promise: Promise<unknown>): Promise<Outcome> {
      let outcome: Outcome | undefined;
      promise.then(
        fulfilled => (outcome = { fulfilled }),
        rejected => (outcome = { rejected }),
      );
      if (pump?.status === "unlinked") await pump.link(linker);
      for (let turns = 0; turns < 50 && !outcome; turns++) {
        await turn();
        if (!outcome) await pump?.evaluate();
      }
      return outcome ?? { pending: true };
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
      test("the entry of a cycle runs after the module that it imports", async () => {
        const g = graph(kind, {
          a: `import { helper } from "b"; log("a"); export const x = helper() + 1;`,
          b: `import { x } from "a"; log("b"); export const helper = () => 41; export const later = () => x;`,
        });
        await g.link();
        assert.strictEqual(await g.modules.a.evaluate(), undefined);
        assert.deepStrictEqual(g.log, ["b", "a"]);
        assert.deepStrictEqual(g.statuses(), { a: "evaluated", b: "evaluated" });
        assert.strictEqual((g.modules.b.namespace as any).later(), 42);
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

      test("a module that is imported after a member of a cycle runs after that member", async () => {
        const g = graph(kind, {
          a: `import "b"; import "z"; log("a");`,
          b: `import "a"; import "y"; log("b");`,
          y: `log("y");`,
          z: `log("z");`,
        });
        await g.link();
        await g.modules.a.evaluate();
        assert.deepStrictEqual(g.log, ["y", "b", "z", "a"]);
        assert.deepStrictEqual(g.statuses(), { a: "evaluated", b: "evaluated", y: "evaluated", z: "evaluated" });
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

      test("a module outside a cycle waits for the top-level await of the cycle", async () => {
        const g = graph(kind, {
          entry: `import "db"; import "app"; log("entry");`,
          db: `import "models"; log("db1"); await 0; log("db2"); export const db = "connected";`,
          models: `export { db } from "db"; log("models");`,
          app: `import { db } from "models"; log("app sees " + db);`,
        });
        await g.link();
        assert.deepStrictEqual(await g.settle(g.modules.entry.evaluate()), { fulfilled: undefined });
        assert.deepStrictEqual(g.log, ["models", "db1", "db2", "app sees connected", "entry"]);
      });

      test("in a body, a module of its cycle that has not run yet is 'linked', and one that runs is 'evaluating'", async () => {
        const g = graph(
          kind,
          {
            m1: `import "m0"; import "m2"; log("m1");`,
            m0: `import "m1"; log("m0 " + statuses());`,
            m2: `import "m0"; log("m2 " + statuses());`,
          },
          { statuses: () => JSON.stringify(g.statuses()) },
        );
        await g.link();
        await g.modules.m1.evaluate();
        assert.deepStrictEqual(g.log, [
          `m0 {"m1":"evaluating","m0":"evaluating","m2":"linked"}`,
          `m2 {"m1":"evaluating","m0":"evaluating","m2":"evaluating"}`,
          "m1",
        ]);
      });

      // What a loader does for a require() of an ES module: it evaluates a module that is 'linked'.
      test("a body evaluates a module of its cycle that has not run yet: that module runs at once", async () => {
        let inner: Promise<unknown> | undefined;
        const g = graph(
          kind,
          {
            m1: `import "m0"; import "m2"; log("m1");`,
            m0: `import "m1"; log("m0 1"); evaluateIfLinked("m2"); log("m0 2");`,
            m2: `import "m0"; log("m2");`,
          },
          {
            evaluateIfLinked(name: string) {
              if (g.modules[name].status === "linked") inner = g.modules[name].evaluate();
              g.log.push(`${name} is ${g.modules[name].status}`);
            },
          },
        );
        await g.link();
        await g.modules.m1.evaluate();
        assert.strictEqual(await inner, undefined);
        assert.deepStrictEqual(g.log, ["m0 1", "m2", "m2 is evaluated", "m0 2", "m1"]);
        assert.deepStrictEqual(g.statuses(), { m1: "evaluated", m0: "evaluated", m2: "evaluated" });
      });
    });

    describe("errors", () => {
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
        assert.strictEqual(g.modules.c.error, g.modules.b.error);
        // c ran, and it is not evaluated again.
        await assert.rejects(g.modules.c.evaluate(), reason => reason === g.modules.b.error);
        assert.deepStrictEqual(g.log, ["c", "b"]);
      });

      test("a body that throws after a top-level await in a cycle", async () => {
        const g = graph(kind, {
          a: `import "b"; log("a");`,
          b: `import "a"; log("b1"); await 0; log("b2"); throw new Error("from b");`,
        });
        await g.link();
        assert.strictEqual(message(await g.settle(g.modules.a.evaluate())), "from b");
        assert.deepStrictEqual(g.log, ["b1", "b2"]);
        assert.deepStrictEqual(g.statuses(), { a: "errored", b: "errored" });
        assert.strictEqual(g.modules.a.error, g.modules.b.error);
      });

      test("a member that ran before its cycle failed is 'evaluated', and its evaluate() rejects", async () => {
        const g = graph(kind, {
          a: `import "b"; log("a1"); await 0; log("a2"); throw new Error("from a");`,
          b: `import "a"; log("b");`,
        });
        await g.link();
        assert.strictEqual(message(await g.settle(g.modules.a.evaluate())), "from a");
        assert.deepStrictEqual(g.log, ["b", "a1", "a2"]);
        assert.deepStrictEqual(g.statuses(), { a: "errored", b: "evaluated" });
        assert.strictEqual(message(await g.settle(g.modules.b.evaluate())), "from a");
      });

      test("a root that imports a cycle that failed gets the error, and nothing runs", async () => {
        const g = graph(kind, {
          a: `import "b"; log("a");`,
          b: `import "a"; log("b"); throw new Error("from b");`,
          r: `import "a"; import "x"; log("r");`,
          x: `log("x");`,
        });
        await g.link();
        await g.link("r");
        await assert.rejects(g.modules.a.evaluate(), { message: "from b" });
        await assert.rejects(g.modules.r.evaluate(), reason => reason === g.modules.b.error);
        assert.deepStrictEqual(g.log, ["b"]);
        assert.deepStrictEqual(g.statuses(), { a: "errored", b: "errored", r: "errored", x: "linked" });
      });

      test("a member of a cycle that the walk did not reach is 'linked', and its evaluate() gets the error", async () => {
        const g = graph(kind, {
          a: `import "b"; import "c"; log("a");`,
          b: `import "a"; log("b"); throw new Error("from b");`,
          c: `import "a"; log("c");`,
        });
        await g.link();
        await assert.rejects(g.modules.a.evaluate(), { message: "from b" });
        assert.deepStrictEqual(g.statuses(), { a: "errored", b: "errored", c: "linked" });
        await assert.rejects(g.modules.c.evaluate(), reason => reason === g.modules.b.error);
        assert.deepStrictEqual(g.log, ["b"]);
        assert.deepStrictEqual(g.statuses(), { a: "errored", b: "errored", c: "errored" });
      });

      for (const [shape, d] of [
        ["a module of its cycle", `import "r"; log("d");`],
        ["a module without imports", `log("d");`],
      ]) {
        test(`a dependency that failed stops the importer: ${shape} that it imports later does not run`, async () => {
          const g = graph(kind, {
            r: `import "e"; import "d"; log("r");`,
            e: `log("e"); throw new Error("from e");`,
            d,
          });
          await g.link();
          await assert.rejects(g.modules.e.evaluate(), { message: "from e" });
          await assert.rejects(g.modules.r.evaluate(), reason => reason === g.modules.e.error);
          assert.deepStrictEqual(g.log, ["e"]);
          assert.deepStrictEqual(g.statuses(), { r: "errored", e: "errored", d: "linked" });
        });
      }

      test("a second root that imports a module that failed gets the error and does not run", async () => {
        const g = graph(kind, {
          r1: `import "t"; log("r1");`,
          r2: `import "t"; log("r2");`,
          t: `log("t1"); await 0; throw new Error("from t");`,
        });
        await g.link("r1");
        await g.link("r2");
        const first = await g.settle(g.modules.r1.evaluate());
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
          g.settle(g.modules.r1.evaluate()),
          g.settle(g.modules.r2.evaluate()),
        ]);
        assert.ok("rejected" in first && "rejected" in second);
        assert.strictEqual((first.rejected as Error).message, "from t");
        assert.strictEqual(second.rejected, first.rejected);
        assert.deepStrictEqual(g.log, ["t1"]);
        assert.deepStrictEqual(g.statuses(), { r1: "errored", r2: "errored", t: "errored" });
      });
    });

    describe("SyntheticModule", () => {
      test("a cycle imports it: its exports are set when the bodies of the cycle run", async () => {
        const g = graph(kind, {
          a: `import "b"; import { x } from "s"; log("a " + x);`,
          b: `import "a"; import { x } from "s"; log("b " + x);`,
        });
        synthetic(g, "s", ["x"], module => module.setExport("x", 7));
        await g.link();
        await g.modules.a.evaluate();
        assert.deepStrictEqual(g.log, ["b 7", "a 7"]);
        assert.deepStrictEqual(g.statuses(), { a: "evaluated", b: "evaluated", s: "evaluated" });
      });

      for (const shape of ["a cycle", "a chain"]) {
        test(`an evaluateCallback that throws below ${shape}: a later root gets the error, and nothing runs`, async () => {
          const g = graph(kind, {
            r: `import "e"; log("r");`,
            e: `import "d"; import "x"; log("e");`,
            d: `${shape === "a cycle" ? `import "e"; ` : ""}import "s"; log("d");`,
            x: `log("x");`,
          });
          synthetic(g, "s", ["v"], () => {
            g.log.push("s");
            throw new Error("from s");
          });
          await g.link();
          await assert.rejects(g.modules.e.evaluate(), { message: "from s" });
          assert.deepStrictEqual(g.statuses(), { r: "linked", e: "errored", d: "errored", x: "linked", s: "errored" });
          await assert.rejects(g.modules.r.evaluate(), reason => reason === g.modules.e.error);
          assert.deepStrictEqual(g.log, ["s"]);
          assert.deepStrictEqual(g.statuses(), { r: "errored", e: "errored", d: "errored", x: "linked", s: "errored" });
        });
      }

      // Bun calls the evaluateCallback before the first body of the cycle.
      notYetInBun("in a cycle, after the member that was imported before it", async () => {
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

      // Bun runs r1 inside the evaluate() of r2, before the evaluateCallback returns.
      notYetInBun(
        "an evaluateCallback evaluates a root that imports a module that is 'evaluating': the root runs at once",
        async () => {
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
        },
      );
    });

    describe("import.meta", () => {
      test("each module of a cycle has the properties of initializeImportMeta when its body runs", async () => {
        const g = graph(kind, {});
        for (const [identifier, source] of Object.entries({
          a: `import "b"; log("a " + import.meta.id);`,
          b: `import "c"; log("b " + import.meta.id);`,
          c: `import "a"; log("c " + import.meta.id);`,
        }))
          g.define(identifier, source, { initializeImportMeta: meta => void ((meta as any).id = identifier) });
        await g.link("a");
        await g.modules.a.evaluate();
        assert.deepStrictEqual(g.log, ["c c", "b b", "a a"]);
      });

      test("a function that another member of the cycle calls reads the import.meta of its own module", async () => {
        const g = graph(kind, {});
        const initializeImportMeta = (meta: ImportMeta, module: vm.SourceTextModule) =>
          void ((meta as any).id = module.identifier);
        g.define("a", `import "b"; export function where() { return import.meta.id; } log("a");`, {
          initializeImportMeta,
        });
        g.define("b", `import { where } from "a"; log("b sees " + where());`, { initializeImportMeta });
        await g.link("a");
        await g.modules.a.evaluate();
        assert.deepStrictEqual(g.log, ["b sees a", "a"]);
      });
    });

    describe("a module that waits for a top-level await of its cycle", () => {
      // Bun says 'evaluating' until the await ends, and rejects a second evaluate() with ERR_VM_MODULE_STATUS.
      notYetInBun("is 'evaluated', and a second evaluate() fulfils when the await ends", async () => {
        const g = graph(kind, {
          a: `import "b"; log("a");`,
          b: `import "a"; log("b1"); await 0; log("b2");`,
        });
        await g.link();
        const first = g.modules.a.evaluate();
        const whileItWaits = g.statuses();
        const second = g.settle(g.modules.a.evaluate());
        assert.deepStrictEqual(whileItWaits, { a: "evaluated", b: "evaluated" });
        assert.deepStrictEqual(await g.settle(first), { fulfilled: undefined });
        assert.deepStrictEqual(await second, { fulfilled: undefined });
        assert.deepStrictEqual(g.log, ["b1", "b2", "a"]);
      });

      // Bun runs such a body in a job, where the store of the evaluate() call is not set.
      notYetInBun("runs in the AsyncLocalStorage store of the evaluate() call", async () => {
        const storage = new AsyncLocalStorage<string>();
        const g = graph(
          kind,
          {
            a: `import "b"; store("a");`,
            b: `import "c"; store("b");`,
            c: `import "a"; store("c1"); await 0; store("c2");`,
          },
          { store: (name: string) => void g.log.push(`${name} ${storage.getStore()}`) },
        );
        await g.link();
        assert.deepStrictEqual(await g.settle(storage.run("set", () => g.modules.a.evaluate())), {
          fulfilled: undefined,
        });
        assert.deepStrictEqual(g.log, ["c1 set", "c2 set", "b set", "a set"]);
      });
    });
  });
}

describe("module.evaluate() in an afterEvaluate context", () => {
  test("a job that waits in the queue of the context runs after the bodies of a cycle", async () => {
    const g = graph("an afterEvaluate context", {
      a: `import "b"; log("a");`,
      b: `import "a"; log("b");`,
    });
    vm.runInContext(`new Promise(resolve => (globalThis.open = resolve)).then(() => log("job"));`, g.context!);
    await g.link();
    // The main context resolves the promise: its job waits for the next checkpoint of the context.
    (g.context as any).open();
    await g.modules.a.evaluate();
    assert.deepStrictEqual(g.log, ["b", "a", "job"]);
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
  test("a module that throws after a top-level await, when the program handles every evaluate()", async () => {
    const { status, stdout, stderr } = await runChild(
      "-e",
      `${childPrelude}
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
      `${childPrelude}
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

  test("a rejection of evaluate() that the program drops is reported", async () => {
    const { status, stderr } = await runChild(
      "-e",
      `${childPrelude}
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

  test("a rejection of evaluate() of a cycle that the program drops is reported", async () => {
    const { status, stderr } = await runChild(
      "-e",
      `${childPrelude}
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

  // r imports "x" two times, with and without an attribute, and the linker gives two modules. A second root
  // imports the one that is in a cycle with r. The promise of r.evaluate() is the promise of that cycle.
  const twoModulesForOneSpecifier = (handleFirst: string) => `${childPrelude}
    let open;
    globalThis.gate = new Promise(resolve => (open = resolve));
    define({
      r: 'import "x"; import "x" with { type: "json" }; log("r");',
      xa: 'import "r"; log("xa1"); await gate; throw new Error("from xa");',
      xb: 'log("xb");',
      second: 'import "xa"; log("second");',
    });
    const linkX = (specifier, referrer, extra) =>
      specifier === "x" ? (extra.attributes.type === "json" ? modules.xb : modules.xa) : modules[specifier];
    (async () => {
      for (const name of ["xa", "r", "second"]) if (modules[name].status === "unlinked") await modules[name].link(linkX);
      const first = modules.r.evaluate();
      ${handleFirst}
      modules.second.evaluate().catch(error => console.log("second: " + error.message));
      open();
    })();
  `;

  test("a rejection that the program drops is reported when a second root imports a module of that cycle", async () => {
    const { status, stdout, stderr } = await runChild("-e", twoModulesForOneSpecifier(""));
    assert.match(stderr, /from xa/);
    assert.strictEqual(stdout, "second: from xa\n");
    assert.strictEqual(status, 1);
  });

  test("a rejection that the program handles is not reported when a second root imports a module of that cycle", async () => {
    const { status, stdout, stderr } = await runChild(
      "-e",
      twoModulesForOneSpecifier(`first.catch(error => console.log("first: " + error.message));`),
    );
    assert.strictEqual(stderr, "");
    assert.strictEqual(stdout, "first: from xa\nsecond: from xa\n");
    assert.strictEqual(status, 0);
  });
});

// Only in Bun: when Node.js runs this file it must not start itself again.
if (isBun) {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  // The version whose results this file has.
  const node = nodeExeAtLeast("26.3.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
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

  // Node runs x and d before the evaluateCallback of s. Bun calls that callback before the first body of the cycle.
  describe("initializeImportMeta", () => {
    test("is called once for a module, also when its first evaluate() ended before the module ran", async () => {
      const calls: string[] = [];
      const log: string[] = [];
      (globalThis as any).logOnce = (entry: string) => void log.push(entry);
      const options = (identifier: string) => ({
        identifier,
        initializeImportMeta(meta: ImportMeta) {
          calls.push(identifier);
          (meta as any).id = identifier;
        },
      });
      const modules: Record<string, vm.SourceTextModule | vm.SyntheticModule> = {
        e: new vm.SourceTextModule(`import "d"; import "x"; import "s"; logOnce(import.meta.id);`, options("e")),
        d: new vm.SourceTextModule(`import "e"; logOnce(import.meta.id);`, options("d")),
        x: new vm.SourceTextModule(`logOnce(import.meta.id);`, options("x")),
        s: new vm.SyntheticModule([], () => {
          throw new Error("from s");
        }),
      };
      await (modules.e as vm.SourceTextModule).link(specifier => modules[specifier]);
      await assert.rejects(modules.e.evaluate(), { message: "from s" });
      assert.strictEqual(await modules.x.evaluate(), undefined);
      await assert.rejects(modules.d.evaluate(), reason => reason === modules.e.error);
      assert.deepStrictEqual({ calls, log }, { calls: ["d", "x"], log: ["x"] });
    });
  });

  // Node v26.3.0 does not parse `import defer`.
  describe("import defer", () => {
    test("of a module that imports the cycle back: that module runs at the first read of its namespace", async () => {
      const log: unknown[] = [];
      (globalThis as any).logDefer = (entry: unknown) => void log.push(entry);
      const modules: Record<string, vm.SourceTextModule> = {
        a: new vm.SourceTextModule(`import "b"; logDefer("a");`, { identifier: "a" }),
        b: new vm.SourceTextModule(
          `import defer * as c from "c"; logDefer("b"); globalThis.readDeferred = () => c.x;`,
          {
            identifier: "b",
          },
        ),
        c: new vm.SourceTextModule(`import "a"; logDefer("c"); export const x = 1;`, { identifier: "c" }),
      };
      await modules.a.link(specifier => modules[specifier]);
      await modules.a.evaluate();
      assert.deepStrictEqual({ log: [...log], c: modules.c.status }, { log: ["b", "a"], c: "linked" });
      assert.strictEqual((globalThis as any).readDeferred(), 1);
      assert.deepStrictEqual({ log, c: modules.c.status }, { log: ["b", "a", "c"], c: "evaluated" });
    });
  });

  // Node leaves such a module 'errored' with the error null.
  describe("module.evaluate({ timeout })", () => {
    test("a module of a cycle that the timeout stops gets the error of the call", async () => {
      const modules: Record<string, vm.SourceTextModule> = {
        a: new vm.SourceTextModule(`import "b";`, { identifier: "a" }),
        b: new vm.SourceTextModule(`import "a"; for (;;) {}`, { identifier: "b" }),
        later: new vm.SourceTextModule(`import "b";`, { identifier: "later" }),
      };
      const linker = (specifier: string) => modules[specifier];
      await modules.a.link(linker);
      await modules.later.link(linker);
      await assert.rejects(modules.a.evaluate({ timeout: 50 }), { code: "ERR_SCRIPT_EXECUTION_TIMEOUT" });
      assert.strictEqual(modules.b.status, "errored");
      assert.strictEqual(modules.b.error, modules.a.error);
      await assert.rejects(modules.later.evaluate(), reason => reason === modules.a.error);
    });
  });
}

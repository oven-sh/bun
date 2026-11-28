/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js. They are not in
 * vm.test.ts because that file uses bun:test, which Node.js cannot run.
 *
 *   node --experimental-vm-modules vm-module-link-status.test.ts
 *
 * Link() of ECMA-262 links every module record of a graph, and when it fails
 * only the records that did not finish go back to unlinked:
 * https://tc39.es/ecma262/#sec-moduledeclarationlinking
 *
 * The status of a vm.SourceTextModule is the state of its record, whichever
 * link() or evaluate() changed that. Every expectation is what Node.js v26.3.0
 * does.
 */
import assert from "node:assert";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import vm from "node:vm";

type Modules = Record<string, vm.SourceTextModule>;

// The error code of a call that throws or rejects, or "no error".
function errorCode(call: () => unknown): string;
function errorCode(promise: Promise<unknown>): Promise<string>;
function errorCode(value: (() => unknown) | Promise<unknown>) {
  const code = (error: any) => error.code ?? error.name;
  if (typeof value !== "function")
    return value.then(
      () => "no error",
      error => code(error),
    );
  try {
    value();
    return "no error";
  } catch (error) {
    return code(error);
  }
}

const statuses = (modules: Modules): Record<string, string> =>
  Object.fromEntries(Object.entries(modules).map(([name, module]) => [name, module.status]));

// Module code in the main context calls back into the test through a global.
function withGlobal<T>(name: string, value: unknown, run: () => Promise<T>) {
  (globalThis as any)[name] = value;
  return run().finally(() => delete (globalThis as any)[name]);
}

const contexts: [string, () => vm.Context | undefined][] = [
  ["the main context", () => undefined],
  ["a vm context", () => vm.createContext({})],
];

for (const [contextName, makeContext] of contexts) {
  function graph(sources: Record<string, string>) {
    const context = makeContext();
    const modules: Modules = {};
    for (const [identifier, source] of Object.entries(sources))
      modules[identifier] = new vm.SourceTextModule(source, { identifier, context });
    return { context, modules, linker: (specifier: string) => modules[specifier] };
  }
  type Graph = ReturnType<typeof graph>;

  describe(`status after the link() of an importer, in ${contextName}`, () => {
    // The two ways to link the first module of a graph.
    const entries: [string, (g: Graph) => Promise<void>][] = [
      ["link()", g => Object.values(g.modules)[0].link(g.linker)],
      [
        "linkRequests() + instantiate()",
        async g => {
          for (const module of Object.values(g.modules))
            if (module.status === "unlinked")
              module.linkRequests(module.moduleRequests.map(request => g.modules[request.specifier]));
          Object.values(g.modules)[0].instantiate();
        },
      ],
    ];

    // The sources of a graph whose first module does not link, and the statuses after that.
    const shapes: [string, Record<string, string>, Record<string, string>][] = [
      [
        "root -> leaf",
        { root: `import { nope } from "leaf";`, leaf: `export const y = 1;` },
        { root: "unlinked", leaf: "linked" },
      ],
      [
        "root -> mid -> leaf, where root fails",
        { root: `import { nope } from "mid";`, mid: `import "leaf"; export const y = 1;`, leaf: `export {};` },
        { root: "unlinked", mid: "linked", leaf: "linked" },
      ],
      [
        "root -> mid -> leaf, where mid fails",
        { root: `import "mid";`, mid: `import { nope } from "leaf";`, leaf: `export const y = 1;` },
        { root: "unlinked", mid: "unlinked", leaf: "linked" },
      ],
      [
        "root <-> a, and a leaf",
        { root: `import "a"; import { nope } from "leaf";`, a: `import "root";`, leaf: `export const y = 1;` },
        { root: "unlinked", a: "unlinked", leaf: "linked" },
      ],
      [
        "root -> [good -> leaf, bad -> leaf2]",
        {
          root: `import "good"; import "bad";`,
          good: `import "leaf";`,
          bad: `import { nope } from "leaf2";`,
          leaf: `export {};`,
          leaf2: `export const y = 1;`,
        },
        { root: "unlinked", good: "linked", bad: "unlinked", leaf: "linked", leaf2: "linked" },
      ],
    ];

    for (const [entryName, entry] of entries) {
      for (const [shapeName, sources, expected] of shapes) {
        test(`${entryName} fails, ${shapeName}: the modules that linked are linked`, async () => {
          const g = graph(sources);
          assert.strictEqual(await errorCode(entry(g)), "SyntaxError");
          assert.deepStrictEqual(statuses(g.modules), expected);

          for (const [name, status] of Object.entries(expected)) {
            const module = g.modules[name];
            if (status === "linked") {
              assert.deepStrictEqual(
                {
                  name,
                  inspect: /status: '(\w+)'/.exec(inspect(module))?.[1],
                  hasAsyncGraph: module.hasAsyncGraph(),
                  namespacePrototype: Object.getPrototypeOf(module.namespace),
                  link: await errorCode(module.link(g.linker)),
                  linkRequests: errorCode(() => module.linkRequests([])),
                  instantiate: errorCode(() => module.instantiate()),
                },
                {
                  name,
                  inspect: "linked",
                  hasAsyncGraph: false,
                  namespacePrototype: null,
                  link: "ERR_VM_MODULE_ALREADY_LINKED",
                  linkRequests: "ERR_VM_MODULE_STATUS",
                  instantiate: "ERR_VM_MODULE_STATUS",
                },
              );
            } else {
              assert.deepStrictEqual(
                {
                  name,
                  namespace: errorCode(() => module.namespace),
                  hasAsyncGraph: errorCode(() => module.hasAsyncGraph()),
                  evaluate: await errorCode(module.evaluate()),
                },
                {
                  name,
                  namespace: "ERR_VM_MODULE_STATUS",
                  hasAsyncGraph: "ERR_VM_MODULE_STATUS",
                  evaluate: "ERR_VM_MODULE_STATUS",
                },
              );
            }
          }

          // A module that linked runs on its own.
          const evaluated: Record<string, string> = {};
          for (const [name, status] of Object.entries(expected)) {
            if (status === "linked") assert.strictEqual(await g.modules[name].evaluate(), undefined);
            evaluated[name] = status === "linked" ? "evaluated" : status;
          }
          assert.deepStrictEqual(statuses(g.modules), evaluated);

          // The module that failed can be linked again, and fails the same way.
          assert.strictEqual(await errorCode(entry(g)), "SyntaxError");
          assert.deepStrictEqual(statuses(g.modules), evaluated);
        });
      }
    }

    test("import() gets the namespace of a module that linked before its importer failed", async () => {
      const g = graph({ root: `import { nope } from "leaf";`, leaf: `export const y = 1;` });
      assert.strictEqual(await errorCode(g.modules.root.link(g.linker)), "SyntaxError");
      const importModuleDynamically = () => g.modules.leaf;
      // The module has not run, so only the names of its exports can be read.
      const names = (namespace: object) => Reflect.ownKeys(namespace).filter(key => typeof key === "string");

      const importer = new vm.SourceTextModule(`export default await import("x");`, {
        context: g.context,
        importModuleDynamically,
      });
      await importer.link(() => assert.fail("the importer has no static import"));
      await importer.evaluate();
      assert.deepStrictEqual(names((importer.namespace as any).default), ["y"]);

      const script = new vm.Script(`import("x")`, { importModuleDynamically });
      assert.deepStrictEqual(names(await (g.context ? script.runInContext(g.context) : script.runInThisContext())), [
        "y",
      ]);

      const fn = vm.compileFunction(`return import("x")`, [], { parsingContext: g.context, importModuleDynamically });
      assert.deepStrictEqual(names(await fn()), ["y"]);
      assert.strictEqual(g.modules.leaf.status, "linked");
    });

    test("a later importer does not link the module again", async () => {
      const calls: string[] = [];
      const g = graph({
        bad: `import { value, nope } from "e";`,
        good: `import { value } from "e";`,
        e: `export { value } from "dep";`,
        dep: `export const value = 1;`,
      });
      const linker = (specifier: string, referrer: { identifier: string }) => {
        calls.push(`${referrer.identifier} > ${specifier}`);
        return g.modules[specifier];
      };
      assert.strictEqual(await errorCode(g.modules.bad.link(linker)), "SyntaxError");
      await g.modules.good.link(linker);
      assert.deepStrictEqual(calls, ["bad > e", "e > dep", "good > e"]);
      assert.deepStrictEqual(statuses(g.modules), { bad: "unlinked", good: "linked", e: "linked", dep: "linked" });
    });

    // c.link() waits in its linker. The instantiate() of an importer links the record of c with e1. Then c.link()
    // ends with e2, which c does not get.
    async function linkThatEndsLate(importerSource: string) {
      const g = graph({
        a: importerSource,
        c: `import { e } from "e"; export const c = e;`,
        e1: `export const e = 1;`,
        e2: `export const e = 2;`,
      });
      const { a, c, e1, e2 } = g.modules;
      const gate = Promise.withResolvers<void>();
      e1.linkRequests([]);
      c.linkRequests([e1]);
      const late = c.link(async () => (await gate.promise, e2));
      a.linkRequests([c]);
      const instantiate = errorCode(() => a.instantiate());
      assert.strictEqual(c.status, "linking");
      gate.resolve();
      assert.strictEqual(await errorCode(late), "no error");
      assert.strictEqual(await c.evaluate(), undefined);
      assert.strictEqual((c.namespace as any).c, 1);
      return { instantiate, statuses: statuses(g.modules) };
    }

    test("a link() that ends after the instantiate() of an importer failed changes nothing", async () => {
      assert.deepStrictEqual(await linkThatEndsLate(`import { nope } from "c";`), {
        instantiate: "SyntaxError",
        statuses: { a: "unlinked", c: "evaluated", e1: "evaluated", e2: "unlinked" },
      });
    });

    test("a link() that ends after the instantiate() of an importer linked the module changes nothing", async () => {
      assert.deepStrictEqual(await linkThatEndsLate(`import { c } from "c";`), {
        instantiate: "no error",
        statuses: { a: "linked", c: "evaluated", e1: "evaluated", e2: "unlinked" },
      });
    });

    // Which link() ends first depends on how many ticks the linker takes, so each order runs with both kinds.
    const linkers: [string, (modules: Modules) => (specifier: string) => any][] = [
      ["an async function", modules => async specifier => modules[specifier]],
      [
        "a thenable",
        modules => specifier => ({ then: (resolve: (module: vm.Module) => void) => resolve(modules[specifier]) }),
      ],
    ];
    for (const order of [
      ["leaf", "importer"],
      ["importer", "leaf"],
    ]) {
      test(`link() of a module and of its importer at once, ${order[0]} first`, async () => {
        for (const [linkerName, makeLinker] of linkers) {
          const g = graph({
            leaf: `export const value = 1;`,
            importer: `import { value } from "leaf"; export const seen = value;`,
          });
          const linker = makeLinker(g.modules);
          assert.deepStrictEqual(
            {
              linkerName,
              link: await Promise.all(order.map(name => errorCode(g.modules[name].link(linker)))),
              statuses: statuses(g.modules),
            },
            { linkerName, link: ["no error", "no error"], statuses: { leaf: "linked", importer: "linked" } },
          );
          await g.modules.importer.evaluate();
          assert.strictEqual((g.modules.importer.namespace as any).seen, 1);
        }
      });
    }
  });
}

describe("two modules for one specifier with different import attributes", () => {
  function graph(firstSource: string) {
    const a = new vm.SourceTextModule(firstSource, { identifier: "a" });
    const b = new vm.SourceTextModule(`export default "b";`, { identifier: "b" });
    const root = new vm.SourceTextModule(
      `import x from "dep"; import y from "dep" with { type: "json" }; export const seen = x + y;`,
      { identifier: "root" },
    );
    const link = () => root.link((_specifier, _referrer, extra) => (extra.attributes.type === "json" ? b : a));
    return { modules: { root, a, b }, link };
  }

  test("both are linked", async () => {
    const g = graph(`export default "a";`);
    await g.link();
    assert.deepStrictEqual(statuses(g.modules), { root: "linked", a: "linked", b: "linked" });
    assert.strictEqual(Object.getPrototypeOf(g.modules.a.namespace), null);
    assert.strictEqual(await g.modules.a.evaluate(), undefined);
    await g.modules.root.evaluate();
    assert.deepStrictEqual(statuses(g.modules), { root: "evaluated", a: "evaluated", b: "evaluated" });
    assert.strictEqual((g.modules.root.namespace as any).seen, "ab");
  });

  test("the first one can be evaluated while it waits at a top-level await", async () => {
    const gate = Promise.withResolvers<void>();
    await withGlobal("gate", gate.promise, async () => {
      const g = graph(`await gate; export default "a";`);
      await g.link();
      const evaluated = [g.modules.root.evaluate(), g.modules.a.evaluate()];
      gate.resolve();
      assert.deepStrictEqual(await Promise.all(evaluated), [undefined, undefined]);
      assert.deepStrictEqual(statuses(g.modules), { root: "evaluated", a: "evaluated", b: "evaluated" });
      assert.strictEqual((g.modules.root.namespace as any).seen, "ab");
    });
  });
});

describe("status while the evaluate() of an importer runs", () => {
  function graph(sources: Record<string, string>) {
    const modules: Modules = {};
    for (const [identifier, source] of Object.entries(sources))
      modules[identifier] = new vm.SourceTextModule(source, { identifier });
    return { modules, link: (root: string) => modules[root].link(specifier => modules[specifier]) };
  }

  // jest-runtime reads the status of a module like this in a synchronous require() of an ES module.
  test("a module that waits for its imports is evaluating in the body of a module it imports", async () => {
    const g = graph({ a: `import "b"; import "c";`, b: `import "a";`, c: `import "d";`, d: `inBodyOfD();` });
    let seen: Record<string, string> | undefined;
    await withGlobal(
      "inBodyOfD",
      () => (seen = statuses(g.modules)),
      async () => {
        await g.link("a");
        await g.modules.a.evaluate();
      },
    );
    assert.deepStrictEqual(seen, { a: "evaluating", b: "evaluating", c: "evaluating", d: "evaluating" });
    assert.deepStrictEqual(statuses(g.modules), { a: "evaluated", b: "evaluated", c: "evaluated", d: "evaluated" });
  });

  test("a module that imports a running module links from the body of that module", async () => {
    const g = graph({ D: `import "W"; import "Z";`, W: `import "D";`, Z: `inBodyOfZ(); export const z = 1;` });
    const byRequests = new vm.SourceTextModule(`import "Z";`, { identifier: "byRequests" });
    const byLinker = new vm.SourceTextModule(`import "Z";`, { identifier: "byLinker" });
    const seen: { instantiate?: string; link?: Promise<string>; statuses?: string[] } = {};
    await withGlobal(
      "inBodyOfZ",
      () => {
        byRequests.linkRequests([g.modules.Z]);
        seen.instantiate = errorCode(() => byRequests.instantiate());
        seen.link = errorCode(byLinker.link(() => g.modules.Z));
        seen.statuses = [g.modules.Z.status, byRequests.status];
      },
      async () => {
        await g.link("D");
        await g.modules.D.evaluate();
      },
    );
    assert.deepStrictEqual(
      { ...seen, link: await seen.link, byLinker: byLinker.status },
      { instantiate: "no error", link: "no error", statuses: ["evaluating", "linked"], byLinker: "linked" },
    );
  });

  test("a module of a cycle with a top-level await ends evaluated", async () => {
    const gate = Promise.withResolvers<void>();
    await withGlobal("gate", gate.promise, async () => {
      const g = graph({
        D: `import "W"; import { z } from "Z"; export const d = z;`,
        W: `import "D";`,
        Z: `await gate; export const z = 7;`,
      });
      await g.link("D");
      const evaluated = g.modules.D.evaluate();
      gate.resolve();
      assert.strictEqual(await evaluated, undefined);
      assert.deepStrictEqual(statuses(g.modules), { D: "evaluated", W: "evaluated", Z: "evaluated" });
      assert.strictEqual((g.modules.D.namespace as any).d, 7);
    });
  });

  // Bun evaluates m2 before m0, where Node.js evaluates m0 first. So in Bun m2 is "evaluating" in the body of m0, and
  // a loader that evaluates a "linked" module there (jest-runtime in a require() of an ES module) refuses m2.
  test.todo("a module of a cycle that has not run yet is linked in the body of another one", async () => {
    const g = graph({ m0: `import "m1"; inBodyOfM0();`, m1: `import "m0"; import "m2";`, m2: `import "m0";` });
    let seen: string | undefined;
    await withGlobal(
      "inBodyOfM0",
      () => (seen = g.modules.m2.status),
      async () => {
        await g.link("m1");
        await g.modules.m1.evaluate();
      },
    );
    assert.strictEqual(seen, "linked");
  });
});

test("a link() that fails leaves the status of a module that linked or ran before it", async () => {
  const noImport = () => assert.fail("the module has no import");
  const linked = new vm.SourceTextModule(`export const a = 1;`, { identifier: "linked" });
  await linked.link(noImport);
  const evaluated = new vm.SourceTextModule(`export const b = 2;`, { identifier: "evaluated" });
  await evaluated.link(noImport);
  await evaluated.evaluate();
  const synthetic = new vm.SyntheticModule(["s"], function () {
    this.setExport("s", 3);
  });
  // Not linked yet. It links on top of the SyntheticModule in the link() of root.
  const onSynthetic = new vm.SourceTextModule(`export { s } from "synthetic";`, { identifier: "onSynthetic" });
  const root = new vm.SourceTextModule(`import "evaluated"; import "onSynthetic"; import { nope } from "linked";`, {
    identifier: "root",
  });
  const modules: Record<string, vm.Module> = { linked, evaluated, synthetic, onSynthetic };

  assert.strictEqual(await errorCode(root.link(specifier => modules[specifier])), "SyntaxError");
  assert.deepStrictEqual(
    {
      root: root.status,
      linked: linked.status,
      evaluated: evaluated.status,
      synthetic: synthetic.status,
      onSynthetic: onSynthetic.status,
    },
    { root: "unlinked", linked: "linked", evaluated: "evaluated", synthetic: "linked", onSynthetic: "linked" },
  );
  await onSynthetic.evaluate();
  assert.strictEqual((onSynthetic.namespace as any).s, 3);
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
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
}

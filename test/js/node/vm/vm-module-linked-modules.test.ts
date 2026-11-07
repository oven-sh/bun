/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js. So the file uses
 * node:test and node:assert, which both have, and not bun:test. What only Bun
 * can run is in vm.test.ts.
 *
 *   node --experimental-vm-modules vm-module-linked-modules.test.ts
 *
 * link() and linkRequests() give a vm.SourceTextModule one module for each of
 * its module requests. Two requests can have the same specifier and differ in
 * their `type` attribute, and then they can get two different modules.
 * instantiate() links the module to the modules it has at that moment.
 *
 * Every expectation is what Node.js v26.3.0 does. A `todo` for Bun is a result
 * that another change of node:vm gives it: the test says which one.
 */
import assert from "node:assert";
import { spawn } from "node:child_process";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

// Node.js has no "harness": a static import of it would keep Node.js from loading this file.
const harness = process.versions.bun ? await import("harness") : undefined;

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

const statuses = (modules: Record<string, vm.Module>): Record<string, string> =>
  Object.fromEntries(Object.entries(modules).map(([name, module]) => [name, module.status]));

// Where the modules of a test are: `context` is the option for their constructor, and `globals` is the global
// object that their code sees.
type Realm = { context: vm.Context | undefined; globals: Record<string, unknown> };
const realms: [string, () => Realm][] = [
  ["the main context", () => ({ context: undefined, globals: globalThis as any })],
  [
    "a vm context",
    () => {
      const globals = {};
      return { context: vm.createContext(globals), globals };
    },
  ],
];
const mainRealm = realms[0][1]();

// Module code calls back into the test through a global of its context.
async function withGlobal<T>(realm: Realm, name: string, value: unknown, run: () => Promise<T>) {
  realm.globals[name] = value;
  try {
    return await run();
  } finally {
    delete realm.globals[name];
  }
}

function graph(sources: Record<string, string>, realm = mainRealm) {
  const modules: Modules = {};
  for (const [identifier, source] of Object.entries(sources))
    modules[identifier] = new vm.SourceTextModule(source, { identifier, context: realm.context });
  return modules;
}

type Child = { stdout: string[]; stderr: string; signal: string | null; status: number | null };

// Runs `script` in a process of its own, for an input that ends a Bun without the fix.
function runInChild(script: string) {
  const child = harness
    ? spawn(harness.bunExe(), ["-e", script], { env: harness.bunEnv, stdio: ["ignore", "pipe", "pipe"] })
    : spawn(process.execPath, ["--experimental-vm-modules", "--no-warnings", "-e", script], {
        stdio: ["ignore", "pipe", "pipe"],
      });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
  child.stderr.setEncoding("utf8").on("data", chunk => (stderr += chunk));
  return new Promise<Child>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status, signal) => resolve({ stdout: stdout.trim().split("\n"), stderr, signal, status }));
  });
}

const bunTodo = process.versions.bun ? test.todo : test;

describe("two modules for one specifier with different import attributes", () => {
  // One `import ... from "dep"` for each type, in this order. `undefined` is an import without attributes.
  const importsOfDep = (types: (string | undefined)[]) =>
    types.map((type, i) => `import v${i} from "dep"${type ? ` with { type: "${type}" }` : ""};`).join(" ");
  const exportOfValues = (types: unknown[]) => `export const r = [${types.map((_, i) => `v${i}`)}];`;
  // Gives the request with `types[i]` the module `modules[i]`.
  const linker = (types: (string | undefined)[], modules: vm.Module[]) => {
    return (_specifier: string, _referrer: vm.Module, extra: any) => modules[types.indexOf(extra.attributes.type)];
  };
  const twoTypes = [undefined, "json"];

  test("a SyntheticModule that is the first one runs its evaluate callback", async () => {
    const ran: string[] = [];
    const first = new vm.SyntheticModule(
      ["default"],
      function () {
        ran.push("first");
        this.setExport("default", 1);
      },
      { identifier: "first" },
    );
    const second = new vm.SourceTextModule(`export default 2;`, { identifier: "second" });
    const root = new vm.SourceTextModule(`${importsOfDep(twoTypes)} ${exportOfValues(twoTypes)}`, {
      identifier: "root",
    });

    await root.link(linker(twoTypes, [first, second]));
    await root.evaluate();
    assert.deepStrictEqual({ ran, r: (root.namespace as any).r }, { ran: ["first"], r: [1, 2] });
    assert.deepStrictEqual(statuses({ root, first, second }), {
      root: "evaluated",
      first: "evaluated",
      second: "evaluated",
    });
  });

  for (const types of [twoTypes, ["json", undefined], [undefined, "json", "webassembly"]]) {
    test(`${types.length} modules run in the order of the requests (${types.map(String)}), each with its import.meta`, async () => {
      const order: number[] = [];
      const metas: string[] = [];
      await withGlobal(mainRealm, "order", order, async () => {
        const make = (identifier: string, source: string) =>
          new vm.SourceTextModule(source, {
            identifier,
            initializeImportMeta: (_meta, module) => void metas.push(module.identifier),
          });
        const modules = types.map((_, i) => make(`m${i}`, `order.push(${i}); import.meta; export default ${i};`));
        const root = make("root", `${importsOfDep(types)} order.push(-1); import.meta; ${exportOfValues(types)}`);
        const indices = types.map((_, i) => i);

        await root.link(linker(types, modules));
        assert.deepStrictEqual(
          modules.map(module => module.status),
          types.map(() => "linked"),
        );
        await root.evaluate();
        assert.deepStrictEqual(
          { order, metas, r: (root.namespace as any).r },
          { order: [...indices, -1], metas: [...indices.map(i => `m${i}`), "root"], r: indices },
        );
        assert.deepStrictEqual(
          modules.map(module => module.status),
          types.map(() => "evaluated"),
        );
      });
    });
  }

  test("the first one is errored with its error when its body throws", async () => {
    const first = new vm.SourceTextModule(`throw new Error("from the first");`, { identifier: "first" });
    const second = new vm.SourceTextModule(`export default 2;`, { identifier: "second" });
    const root = new vm.SourceTextModule(`import "dep"; import "dep" with { type: "json" };`, { identifier: "root" });

    await root.link(linker(twoTypes, [first, second]));
    await assert.rejects(root.evaluate(), { message: "from the first" });
    assert.deepStrictEqual(statuses({ root, first }), { root: "errored", first: "errored" });
    assert.strictEqual(first.error.message, "from the first");
    assert.strictEqual(root.error, first.error);
  });

  test("hasAsyncGraph() sees a top-level await in the first one", async () => {
    const first = new vm.SourceTextModule(`await 0; export default 1;`, { identifier: "first" });
    const second = new vm.SourceTextModule(`export default 2;`, { identifier: "second" });
    const root = new vm.SourceTextModule(importsOfDep(twoTypes), { identifier: "root" });

    await root.link(linker(twoTypes, [first, second]));
    assert.strictEqual(root.hasAsyncGraph(), true);
    assert.strictEqual(second.hasAsyncGraph(), false);
  });

  // `first` and `root` import each other, so the link() that fails leaves both unlinked.
  const cycle = (sumOfRoot: string) => {
    const modules = graph({
      first: `import { one } from "root"; export const two = () => one + 1;`,
      second: `export default 1;`,
      root: `import { two } from "dep"; import y from "dep" with { type: "json" }; import { third } from "third";
             export const one = 1; export const sum = ${sumOfRoot};`,
      bad: `export const other = 0;`,
      good: `export const third = "ok";`,
    });
    const link = (third: string) =>
      modules.root.link((specifier: string, _referrer: vm.Module, extra: any) =>
        specifier === "root"
          ? modules.root
          : specifier === "third"
            ? modules[third]
            : extra.attributes.type === "json"
              ? modules.second
              : modules.first,
      );
    return { modules, link };
  };

  test("a cycle through the first one links again after a link() that failed", async () => {
    const { modules, link } = cycle(`() => two() + y + third`);
    assert.strictEqual(await errorCode(link("bad")), "SyntaxError");
    assert.deepStrictEqual(statuses({ root: modules.root, first: modules.first }), {
      root: "unlinked",
      first: "unlinked",
    });

    await link("good");
    await modules.root.evaluate();
    assert.strictEqual((modules.root.namespace as any).sum(), "3ok");
    assert.deepStrictEqual(statuses({ root: modules.root, first: modules.first }), {
      root: "evaluated",
      first: "evaluated",
    });
  });

  // The input runs in a child process: a Bun without the fix ends with a segmentation fault.
  test("the first one of a cycle that failed to link links to another module", async () => {
    const child = await runInChild(`
      const vm = require("node:vm");
      const make = context => {
        const module = (identifier, source) => new vm.SourceTextModule(source, { identifier, context });
        return {
          a: module("a", 'import * as ns from "b"; export const read = () => Object.keys(ns).join();'),
          f: module("f", "export default 0;"),
          b1: module("b1", 'import "a"; import "a" with { type: "json" }; import { nope } from "c"; export var v = 1;'),
          b2: module("b2", 'import "a"; export var v2 = 2;'),
          c: module("c", "export var y = 1;"),
        };
      };
      (async () => {
        for (const context of [undefined, vm.createContext({})]) {
          {
            const { a, f, b1, b2, c } = make(context);
            const linker = b => (specifier, referrer, extra) =>
              specifier === "a" ? (extra.attributes.type === "json" ? f : a) : specifier === "b" ? b : c;
            await b1.link(linker(b1)).catch(error => console.log("b1.link() rejected:", error.name));
            await a.link(linker(b2));
            await a.evaluate();
            console.log("a reads:", a.namespace.read());
          }
          {
            const { a, f, b1, b2, c } = make(context);
            f.linkRequests([]);
            c.linkRequests([]);
            a.linkRequests([b1]);
            b1.linkRequests([a, f, c]);
            try {
              b1.instantiate();
            } catch (error) {
              console.log("b1.instantiate() threw:", error.name);
            }
            b2.linkRequests([a]);
            a.linkRequests([b2]);
            a.instantiate();
            await a.evaluate();
            console.log("a reads:", a.namespace.read());
          }
        }
      })();
    `);
    const inOneContext = [
      "b1.link() rejected: SyntaxError",
      "a reads: v2",
      "b1.instantiate() threw: SyntaxError",
      "a reads: v2",
    ];
    assert.deepStrictEqual(child, { stdout: [...inOneContext, ...inOneContext], stderr: "", signal: null, status: 0 });
  });

  // The four below are what Bun does for every module that another module imports. The first of two modules for
  // one specifier was not such a module before: Bun ran it only as a part of its importer.

  // Bun runs the entry of an import cycle before the modules it imports (#46004): evaluate() rejects with
  // "ReferenceError: Cannot access 'two' before initialization."
  bunTodo("the first one runs before the entry of a cycle that both are in", async () => {
    const { modules, link } = cycle(`two() + y + third`);
    await link("good");
    await modules.root.evaluate();
    assert.strictEqual((modules.root.namespace as any).sum, "3ok");
  });

  // Bun reports the rejection of a module that an importer runs as unhandled too (#40939): the child ends with
  // exit code 1.
  bunTodo("a rejection after a top-level await in the first one has one report", async () => {
    const child = await runInChild(`
      const vm = require("node:vm");
      const first = new vm.SourceTextModule('await 0; throw new Error("from the first");');
      const second = new vm.SourceTextModule("export default 2;");
      const root = new vm.SourceTextModule('import "dep"; import "dep" with { type: "json" };');
      (async () => {
        await root.link((specifier, referrer, extra) => (extra.attributes.type === "json" ? second : first));
        await root.evaluate().catch(error => console.log("caught:", error.message));
      })();
    `);
    assert.deepStrictEqual(child, { stdout: ["caught: from the first"], stderr: "", signal: null, status: 0 });
  });

  // Bun rejects the link() of a module that an importer linked in the meantime (#47101): ERR_VM_MODULE_STATUS, and
  // the module is "errored".
  bunTodo("a link() of the first one that is in flight ends when an importer links it", async () => {
    const first = new vm.SourceTextModule(`export default 1;`, { identifier: "first" });
    const second = new vm.SourceTextModule(`export default 2;`, { identifier: "second" });
    const root = new vm.SourceTextModule(importsOfDep(twoTypes), { identifier: "root" });
    second.linkRequests([]);

    const linkOfFirst = errorCode(first.link(() => assert.fail("the module has no import")));
    root.linkRequests([first, second]);
    root.instantiate();
    assert.strictEqual(first.status, "linking");
    assert.deepStrictEqual({ link: await linkOfFirst, status: first.status }, { link: "no error", status: "linked" });
  });

  // Bun runs the microtasks of an afterEvaluate context after each module that an importer runs (#46004): the first
  // one is through before the second one runs, and exports "no registry".
  bunTodo(
    "the second one runs while the first one waits at a top-level await, in an afterEvaluate context",
    async () => {
      const globals: Record<string, unknown> = {};
      const context = vm.createContext(globals, { microtaskMode: "afterEvaluate" });
      const make = (identifier: string, source: string) => new vm.SourceTextModule(source, { identifier, context });
      const first = make(
        "first",
        `await 0; export default typeof registry === "undefined" ? "no registry" : registry;`,
      );
      const second = make("second", `globalThis.registry = "set by the second"; export default 2;`);
      const root = make("root", `${importsOfDep(twoTypes)} ${exportOfValues(twoTypes)}`);

      await root.link(linker(twoTypes, [first, second]));
      await root.evaluate();
      assert.deepStrictEqual([...(root.namespace as any).r], ["set by the second", 2]);
    },
  );
});

for (const [realmName, makeRealm] of realms) {
  describe(`a module that another module got before a link() failed, in ${realmName}`, () => {
    // Module code counts its runs with `ran()`.
    async function countingRuns<T>(run: (realm: Realm, runs: () => number) => Promise<T>) {
      const realm = makeRealm();
      let runs = 0;
      return withGlobal(
        realm,
        "ran",
        () => ++runs,
        () => run(realm, () => runs),
      );
    }

    test("with linkRequests(): it runs once, for the importer that was there first", async () => {
      await countingRuns(async (realm, runs) => {
        const modules = graph(
          {
            root: `import "bad"; import "shared";`,
            bad: `import { nope } from "leaf";`,
            leaf: `export const x = 1;`,
            shared: `ran(); export const x = 2;`,
            early: `import { x } from "shared"; export const got = x;`,
          },
          realm,
        );
        const linker = (specifier: string) => modules[specifier];
        modules.shared.linkRequests([]);
        modules.early.linkRequests([modules.shared]);

        // Link() fails in `bad`, before it reaches `shared`.
        assert.strictEqual(await errorCode(modules.root.link(linker)), "SyntaxError");
        modules.early.instantiate();
        await modules.early.evaluate();
        assert.deepStrictEqual(statuses({ early: modules.early, shared: modules.shared }), {
          early: "evaluated",
          shared: "evaluated",
        });
        assert.strictEqual((modules.shared.namespace as any).x, 2);
        assert.strictEqual(await errorCode(modules.shared.link(linker)), "ERR_VM_MODULE_STATUS");
        await modules.shared.evaluate();
        assert.strictEqual(runs(), 1);
      });
    });

    // link() and evaluate() only: what a loader does when one of its files arrives late.
    test("with a link() that is in flight: it runs once, and every importer gets that one instance", async () => {
      await countingRuns(async (realm, runs) => {
        const modules = graph(
          {
            root: `import "bad"; import "shared";`,
            bad: `import { nope } from "leaf";`,
            leaf: `export const x = 1;`,
            shared: `ran(); export const token = {};`,
            early: `import { token } from "shared"; export const got = token;`,
            waiting: `import { got } from "early"; import "slow"; export { got };`,
            slow: `export default 0;`,
            later: `import { token } from "shared"; export const got = token;`,
          },
          realm,
        );
        const slow = Promise.withResolvers<vm.Module>();
        const linker = (specifier: string) => (specifier === "slow" ? slow.promise : modules[specifier]);

        // `early` gets `shared` inside this link(), which then waits for "slow". The status of `early` is the
        // only thing that shows its part is over: no promise settles then.
        const waiting = modules.waiting.link(linker);
        for (let i = 0; i < 100 && modules.early.status !== "linking"; i++) await null;
        assert.strictEqual(modules.early.status, "linking");
        for (let i = 0; i < 100 && modules.early.status === "linking"; i++) await null;
        assert.deepStrictEqual(statuses({ early: modules.early, waiting: modules.waiting }), {
          early: "unlinked",
          waiting: "linking",
        });

        // Link() fails in `bad`, before it reaches `shared`.
        assert.strictEqual(await errorCode(modules.root.link(linker)), "SyntaxError");
        assert.strictEqual(modules.waiting.status, "linking");

        slow.resolve(modules.slow);
        await waiting;
        await modules.waiting.evaluate();
        const sharedAfterItsImporterRan = modules.shared.status;
        await modules.later.link(linker);
        await modules.later.evaluate();
        assert.deepStrictEqual(
          {
            runs: runs(),
            shared: sharedAfterItsImporterRan,
            oneInstance: (modules.later.namespace as any).got === (modules.waiting.namespace as any).got,
          },
          { runs: 1, shared: "evaluated", oneInstance: true },
        );
      });
    });

    test("it is the module that the second link() of its graph linked", async () => {
      const modules = graph(
        {
          root: `import "b"; import { read } from "a"; export { read };`,
          a: `import * as ns from "b"; export const read = () => Object.keys(ns) + " v=" + ns.v;`,
          b1: `import "a"; import { missing } from "c"; export var v = "b1";`,
          b2: `import "a"; export var v = "b2"; export var only2;`,
          c: `export var y = 1;`,
          // Not in the graph of `root`.
          early: `import { read } from "a"; export { read };`,
        },
        makeRealm(),
      );
      const linker = (b: string) => (specifier: string) => (specifier === "b" ? modules[b] : modules[specifier]);
      modules.early.linkRequests([modules.a]);

      assert.strictEqual(await errorCode(modules.root.link(linker("b1"))), "SyntaxError");
      await modules.root.link(linker("b2"));
      await modules.root.evaluate();
      assert.strictEqual((modules.root.namespace as any).read(), "only2,v v=b2");

      modules.early.instantiate();
      await modules.early.evaluate();
      assert.strictEqual((modules.early.namespace as any).read(), "only2,v v=b2");
    });

    for (const place of ["first", "second"]) {
      test(`it is that module when it is the ${place} of two modules for one specifier`, async () => {
        await countingRuns(async (realm, runs) => {
          const modules = graph(
            {
              root: `import "bad"; import "dep"; import "dep" with { type: "json" };`,
              bad: `import { nope } from "leaf";`,
              leaf: `export const x = 1;`,
              shared: `ran(); export const name = "shared";`,
              other: `export default 2;`,
              early: `import { name } from "shared"; export const got = name;`,
            },
            realm,
          );
          const typeOfShared = place === "first" ? undefined : "json";
          const linker = (specifier: string, _referrer: vm.Module, extra: any) =>
            specifier !== "dep"
              ? modules[specifier]
              : modules[extra.attributes.type === typeOfShared ? "shared" : "other"];
          modules.shared.linkRequests([]);
          modules.early.linkRequests([modules.shared]);

          assert.strictEqual(await errorCode(modules.root.link(linker)), "SyntaxError");
          modules.early.instantiate();
          await modules.early.evaluate();
          assert.deepStrictEqual(
            {
              got: (modules.early.namespace as any).got,
              name: (modules.shared.namespace as any).name,
              runs: runs(),
              shared: modules.shared.status,
            },
            { got: "shared", name: "shared", runs: 1, shared: "evaluated" },
          );
        });
      });
    }
  });
}

describe("instantiate() links a module to the modules it has then", () => {
  test("the modules of the last linkRequests()", async () => {
    const modules = graph({
      x: `export default "x";`,
      y: `export default "y";`,
      importer: `import name from "dep"; export const got = name;`,
    });
    modules.x.linkRequests([]);
    modules.y.linkRequests([]);
    modules.importer.linkRequests([modules.x]);
    modules.importer.linkRequests([modules.y]);

    modules.importer.instantiate();
    await modules.importer.evaluate();
    assert.strictEqual((modules.importer.namespace as any).got, "y");
    assert.deepStrictEqual(statuses(modules), { x: "unlinked", y: "evaluated", importer: "evaluated" });
  });

  test("the modules of the last linkRequests() after an instantiate() that failed", async () => {
    const modules = graph({
      x: `export default "x";`,
      y: `export default "y";`,
      late: `import "leaf";`,
      leaf: `export default "leaf";`,
      importer: `import name from "dep"; import "late"; export const got = name;`,
    });
    // `late` has no modules yet, so this instantiate() fails after it gave `importer` the module x.
    modules.importer.linkRequests([modules.x, modules.late]);
    assert.strictEqual(
      errorCode(() => modules.importer.instantiate()),
      "ERR_VM_MODULE_LINK_FAILURE",
    );

    modules.late.linkRequests([modules.leaf]);
    modules.importer.linkRequests([modules.y, modules.late]);
    modules.importer.instantiate();
    await modules.importer.evaluate();
    assert.strictEqual((modules.importer.namespace as any).got, "y");
    assert.deepStrictEqual(statuses(modules), {
      x: "unlinked",
      y: "evaluated",
      late: "evaluated",
      leaf: "evaluated",
      importer: "evaluated",
    });
  });

  test("a module whose linkRequests() ran after the one of its importer", async () => {
    const modules = graph({
      importer: `import name from "middle"; export const got = name;`,
      middle: `export { default } from "leaf";`,
      leaf: `export default "leaf";`,
    });
    modules.importer.linkRequests([modules.middle]);
    assert.strictEqual(
      errorCode(() => modules.importer.instantiate()),
      "ERR_VM_MODULE_LINK_FAILURE",
    );
    assert.deepStrictEqual(statuses(modules), { importer: "unlinked", middle: "unlinked", leaf: "unlinked" });

    modules.middle.linkRequests([modules.leaf]);
    modules.importer.instantiate();
    await modules.importer.evaluate();
    assert.strictEqual((modules.importer.namespace as any).got, "leaf");
    assert.deepStrictEqual(statuses(modules), { importer: "evaluated", middle: "evaluated", leaf: "evaluated" });
  });

  // A vm timeout ends the Link() of instantiate(), and no error handler of instantiate() runs for that. The
  // child tries until a deadline passes inside Link(): a longer Link() when Link() was through first, a later
  // deadline when it passed before Link() made a module environment. Only Bun can count those environments. For
  // Node.js a deadline that leaves the modules unlinked is enough.
  test("a module links to another module after a timeout ended the Link() of an importer", async () => {
    const child = await runInChild(`
      const vm = require("node:vm");
      const environments = process.versions.bun
        ? () => require("bun:jsc").heapStats().objectTypeCounts.JSModuleEnvironment ?? 0
        : undefined;
      const make = (identifier, source) => new vm.SourceTextModule(source, { identifier });
      // Nothing of a graph is collected, so the number of environments only goes up.
      const kept = [];
      const graph = leafCount => {
        // A leaf that is slow to link: Link() makes its 100 functions. No graph has the source of another one.
        let body = "";
        for (let j = 0; j < 100; j++) body += "export function f" + j + "(x) { return x + " + leafCount + "; }\\n";
        let importsOfLeaves = "";
        for (let i = 0; i < leafCount; i++) importsOfLeaves += 'import "leaf' + i + '";\\n';
        const a = make("a", 'import * as ns from "b"; export const read = () => Object.keys(ns).join();');
        // a is the first request: Link() makes its environment, with the namespace of b1, before it reaches a leaf.
        const b1 = make("b1", 'import "a";\\n' + importsOfLeaves + "export var v = 1;");
        const b2 = make("b2", 'import "a"; export var v = 2; export var only2;');
        const leaves = Array.from({ length: leafCount }, (_, i) => make("leaf" + i, body + "export default " + i + ";"));
        a.linkRequests([b1]);
        b1.linkRequests([a, ...leaves]);
        kept.push(a, b1, b2, leaves);
        return { a, b1, b2 };
      };
      const instantiate = (b1, timeout) => {
        try {
          vm.runInContext("b1.instantiate()", vm.createContext({ b1 }), { timeout });
          return "no error";
        } catch (error) {
          return error.code;
        }
      };

      (async () => {
        // What loads at its first use does so here, before an environment counts.
        instantiate(graph(1).b1, 60_000);
        environments?.();

        let leafCount = 2;
        let timeout = 1;
        let result = "no deadline passed inside Link()";
        while (leafCount <= 2048 && timeout <= 64) {
          // A new graph for each attempt: a Link() that ended early makes the next instantiate() parse again.
          const { a, b1, b2 } = graph(leafCount);
          const before = environments?.();
          const code = instantiate(b1, timeout);
          if (code === "no error" || (code === "ERR_SCRIPT_EXECUTION_TIMEOUT" && a.status !== "unlinked")) {
            leafCount *= 2;
            continue;
          }
          if (code !== "ERR_SCRIPT_EXECUTION_TIMEOUT") {
            result = "instantiate() threw " + code;
            break;
          }
          if (environments && environments() <= before) {
            timeout *= 2;
            continue;
          }
          a.linkRequests([b2]);
          b2.linkRequests([a]);
          a.instantiate();
          await a.evaluate();
          result = "a reads: " + a.namespace.read();
          break;
        }
        console.log(result);
      })();
    `);
    assert.deepStrictEqual(child, { stdout: ["a reads: only2,v"], stderr: "", signal: null, status: 0 });
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (harness) {
  const { bunEnv, nodeExeAtLeast } = harness;
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

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const { ModuleGraph } = Bun.unsafe as any;

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const invalidArgType = expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" });
const invalidState = { code: "ERR_INVALID_STATE" };

describe("Bun.unsafe.ModuleGraph API shape", () => {
  test("the constructor", () => {
    expect({
      type: typeof ModuleGraph,
      name: ModuleGraph.name,
      length: ModuleGraph.length,
      ownKeys: Reflect.ownKeys(ModuleGraph).sort(),
      stable: Bun.unsafe.ModuleGraph === Bun.unsafe.ModuleGraph,
      prototypeOf: Object.getPrototypeOf(ModuleGraph) === Function.prototype,
    }).toEqual({
      type: "function",
      name: "ModuleGraph",
      length: 0,
      ownKeys: ["length", "name", "prototype"],
      stable: true,
      prototypeOf: true,
    });

    const { value, ...flags } = Object.getOwnPropertyDescriptor(ModuleGraph, "prototype")!;
    expect(flags).toEqual({ writable: false, enumerable: false, configurable: false });
    expect(value.constructor).toBe(ModuleGraph);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
  });

  test("the prototype's members", () => {
    const proto = ModuleGraph.prototype;
    expect(Reflect.ownKeys(proto)).toEqual([
      "import",
      "dispose",
      "mainModule",
      "constructor",
      Symbol.dispose,
      Symbol.toStringTag,
    ]);

    const describeMethod = (key: PropertyKey) => {
      const { value, ...flags } = Object.getOwnPropertyDescriptor(proto, key)!;
      return { type: typeof value, name: value.name, length: value.length, ...flags };
    };
    expect({
      import: describeMethod("import"),
      dispose: describeMethod("dispose"),
      symbolDispose: describeMethod(Symbol.dispose),
      constructor: describeMethod("constructor"),
    }).toEqual({
      import: { type: "function", name: "import", length: 1, writable: true, enumerable: true, configurable: true },
      dispose: { type: "function", name: "dispose", length: 0, writable: true, enumerable: true, configurable: true },
      symbolDispose: {
        type: "function",
        name: "dispose",
        length: 0,
        writable: true,
        enumerable: false,
        configurable: true,
      },
      constructor: {
        type: "function",
        name: "ModuleGraph",
        length: 0,
        writable: true,
        enumerable: false,
        configurable: true,
      },
    });
    expect(proto[Symbol.dispose]).toBe(proto.dispose);

    const { get, ...mainModule } = Object.getOwnPropertyDescriptor(proto, "mainModule")!;
    expect(mainModule).toEqual({ set: undefined, enumerable: true, configurable: true });
    expect({ type: typeof get, name: get!.name, length: get!.length }).toEqual({
      type: "function",
      name: "get mainModule",
      length: 0,
    });

    expect(Object.getOwnPropertyDescriptor(proto, Symbol.toStringTag)).toEqual({
      value: "ModuleGraph",
      writable: false,
      enumerable: false,
      configurable: true,
    });
  });

  test("methods are not constructors", () => {
    expect(() => new ModuleGraph.prototype.import("x")).toThrow(TypeError);
    expect(() => new ModuleGraph.prototype.dispose()).toThrow(TypeError);
  });

  test("an instance", () => {
    using graph = new ModuleGraph();
    expect({
      tag: Object.prototype.toString.call(graph),
      string: String(graph),
      instance: graph instanceof ModuleGraph,
      prototype: Object.getPrototypeOf(graph) === ModuleGraph.prototype,
      ownKeys: Reflect.ownKeys(graph),
      json: JSON.stringify(graph),
      extensible: Object.isExtensible(graph),
      mainModule: graph.mainModule,
    }).toEqual({
      tag: "[object ModuleGraph]",
      string: "[object ModuleGraph]",
      instance: true,
      prototype: true,
      ownKeys: [],
      json: "{}",
      extensible: true,
      mainModule: undefined,
    });
  });

  test("Bun.inspect() shows the members and the main module", async () => {
    using dir = tempDir("module-graph-lifecycle-inspect", { "inspected.mjs": `export default 1;` });
    const file = join(String(dir), "inspected.mjs");

    using graph = new ModuleGraph({ globals: { hidden: 1 }, onError() {} });
    const inspected = (mainModule: string) =>
      [
        "ModuleGraph {",
        "  import: [Function: import],",
        "  dispose: [Function: dispose],",
        `  mainModule: ${mainModule},`,
        "  [Symbol(Symbol.dispose)]: [Function: dispose],",
        "}",
      ].join("\n");
    expect(Bun.inspect(graph)).toBe(inspected("undefined"));
    await graph.import(file);
    expect(Bun.inspect(graph)).toBe(inspected(JSON.stringify(file)));
    graph.dispose();
    expect(Bun.inspect(graph)).toBe(inspected(JSON.stringify(file)));
    expect(Bun.inspect(ModuleGraph)).toBe("[class ModuleGraph]");
  });

  test("cannot be structured-cloned", () => {
    using graph = new ModuleGraph();
    const errors: unknown[] = [];
    for (const clone of [() => structuredClone(graph), () => structuredClone({ nested: [graph] })]) {
      try {
        clone();
      } catch (error) {
        errors.push(error);
      }
    }
    expect(errors.map((error: any) => [error instanceof DOMException, error.name])).toEqual([
      [true, "DataCloneError"],
      [true, "DataCloneError"],
    ]);

    const { port1, port2 } = new MessageChannel();
    try {
      expect(() => port1.postMessage(graph)).toThrow(expect.objectContaining({ name: "DataCloneError" }));
      expect(() => port1.postMessage(null, [graph])).toThrow();
    } finally {
      port1.close();
      port2.close();
    }
  });

  test("takes expando properties, and works frozen", async () => {
    using dir = tempDir("module-graph-lifecycle-frozen", { "frozen.mjs": `export const value = "loaded";` });
    const file = join(String(dir), "frozen.mjs");

    using graph = new ModuleGraph();
    graph.label = "mine";
    graph[Symbol.for("module-graph-lifecycle")] = 1;
    expect(Reflect.ownKeys(graph)).toEqual(["label", Symbol.for("module-graph-lifecycle")]);

    Object.freeze(graph);
    expect(Object.isFrozen(graph)).toBe(true);
    expect((await graph.import(file)).value).toBe("loaded");
    expect(graph.mainModule).toBe(file);
    graph.dispose();
    await expect(graph.import(file)).rejects.toMatchObject(invalidState);
  });

  test("`mainModule` is read-only and an own property can shadow nothing in the graph", async () => {
    "use strict";
    using dir = tempDir("module-graph-lifecycle-readonly", {
      "first.mjs": `export const main = import.meta.main;`,
      "second.mjs": `export const main = import.meta.main;`,
    });
    const first = join(String(dir), "first.mjs");
    const second = join(String(dir), "second.mjs");

    using graph = new ModuleGraph();
    expect(() => {
      graph.mainModule = second;
    }).toThrow(TypeError);
    Object.defineProperty(graph, "mainModule", { value: second, configurable: true });
    const getter = Object.getOwnPropertyDescriptor(ModuleGraph.prototype, "mainModule")!.get!;

    expect({
      first: (await graph.import(first)).main,
      second: (await graph.import(second)).main,
      own: graph.mainModule,
      real: getter.call(graph),
    }).toEqual({ first: true, second: false, own: second, real: first });
  });

  test("import() returns a promise of the realm and never throws for a bad specifier", async () => {
    using graph = new ModuleGraph();
    const results = [
      graph.import(),
      graph.import(Symbol("s")),
      graph.import({ toString: () => ({}) }),
      graph.import(""),
    ];
    expect(results.map(promise => promise instanceof Promise)).toEqual([true, true, true, true]);
    const settled = await Promise.allSettled(results);
    expect(settled.map(result => result.status)).toEqual(["rejected", "rejected", "rejected", "rejected"]);
    expect(settled.slice(1, 3).map((result: any) => result.reason instanceof TypeError)).toEqual([true, true]);
    expect(graph.mainModule).toBeUndefined();
  });
});

describe("new ModuleGraph(options)", () => {
  test("accepts no options, undefined, any object, and ignores unknown options", async () => {
    using dir = tempDir("module-graph-lifecycle-options", {
      "options.mjs": `export const seen = [typeof globals, typeof onError, typeof unknown];`,
    });
    const file = join(String(dir), "options.mjs");

    const candidates = [
      [],
      [undefined],
      [{}],
      [{ globals: undefined, onError: undefined }],
      [{ unknown: 1, Globals: { unknown: 1 }, onerror: 1 }],
      [Object.create(null)],
      [function () {}],
      [[]],
      [undefined, { globals: { unknown: 1 } }],
    ];
    for (const args of candidates) {
      using graph = new ModuleGraph(...args);
      expect((await graph.import(file)).seen).toEqual(["undefined", "undefined", "undefined"]);
    }
  });

  test("options are read from the prototype chain too", async () => {
    using dir = tempDir("module-graph-lifecycle-inherited", { "inherited.mjs": `export const value = inherited;` });
    using graph = new ModuleGraph(Object.create({ globals: { inherited: "from the prototype" } }));
    expect((await graph.import(join(String(dir), "inherited.mjs"))).value).toBe("from the prototype");
  });

  test("rejects options that are not an object", () => {
    for (const options of [null, 0, 1, "", "options", true, false, Symbol("options"), 1n]) {
      expect(() => new ModuleGraph(options)).toThrow(invalidArgType);
      expect(() => new ModuleGraph(options)).toThrow(TypeError);
    }
  });

  test("rejects `globals` that is not an object and `onError` that is not a function", () => {
    for (const globals of [null, 0, 1, "", "globals", true, Symbol("globals"), 1n]) {
      expect(() => new ModuleGraph({ globals })).toThrow(invalidArgType);
    }
    for (const onError of [null, 0, 1, "", "onError", true, Symbol("onError"), 1n, {}, [], /x/]) {
      expect(() => new ModuleGraph({ onError })).toThrow(invalidArgType);
    }
    // Callable objects of every kind are functions.
    for (const onError of [
      () => {},
      async () => {},
      function* () {},
      class {},
      new Proxy(() => {}, {}),
      (() => {}).bind(null),
    ]) {
      using graph = new ModuleGraph({ onError });
      expect(graph).toBeInstanceOf(ModuleGraph);
    }
  });

  test("reads `globals` then `onError`, each once, and validates as it goes", () => {
    const log: string[] = [];
    const options = (globals: unknown, onError: unknown) => ({
      get onError() {
        log.push("onError");
        return onError;
      },
      get globals() {
        log.push("globals");
        return globals;
      },
    });

    using graph = new ModuleGraph(options({}, () => {}));
    expect(log.splice(0)).toEqual(["globals", "onError"]);
    expect(() => new ModuleGraph(options(1, () => {}))).toThrow(invalidArgType);
    expect(log.splice(0)).toEqual(["globals"]);
    expect(() => new ModuleGraph(options({}, 1))).toThrow(invalidArgType);
    expect(log.splice(0)).toEqual(["globals", "onError"]);
  });

  test("a throwing option getter propagates", () => {
    const thrown = new RangeError("from a getter");
    const throwing = {
      get() {
        throw thrown;
      },
      enumerable: true,
    };
    const capture = (options: object) => {
      try {
        new ModuleGraph(options);
      } catch (error) {
        return error;
      }
    };
    expect([
      capture(Object.defineProperty({}, "globals", throwing)),
      capture(Object.defineProperty({}, "onError", throwing)),
      capture({ globals: Object.defineProperty({}, "value", throwing) }),
      capture(new Proxy({}, throwing)),
      capture({
        globals: new Proxy(
          {},
          {
            ownKeys() {
              throw thrown;
            },
          },
        ),
      }),
    ]).toEqual([thrown, thrown, thrown, thrown, thrown]);
  });

  test("options and `globals` may be Proxies", async () => {
    using dir = tempDir("module-graph-lifecycle-proxy", {
      "proxied.mjs": `export const read = () => [first, second];`,
    });

    const log: string[] = [];
    const logging = (name: string): ProxyHandler<any> => ({
      get(target, key, receiver) {
        log.push(`${name}.get ${String(key)}`);
        return Reflect.get(target, key, receiver);
      },
      ownKeys(target) {
        log.push(`${name}.ownKeys`);
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        log.push(`${name}.getOwnPropertyDescriptor ${String(key)}`);
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    const globals = new Proxy({ first: 1, second: 2, [Symbol("ignored")]: 3 }, logging("globals"));
    using graph = new ModuleGraph(new Proxy({ globals }, logging("options")));
    expect(log).toEqual([
      "options.get globals",
      "options.get onError",
      "globals.ownKeys",
      "globals.getOwnPropertyDescriptor first",
      "globals.getOwnPropertyDescriptor second",
      "globals.get first",
      "globals.get second",
    ]);

    log.length = 0;
    expect((await graph.import(join(String(dir), "proxied.mjs"))).read()).toEqual([1, 2]);
    expect(log).toEqual([]);
  });

  test("must be called with `new`", () => {
    expect(() => ModuleGraph()).toThrow(TypeError);
    expect(() => ModuleGraph({})).toThrow(TypeError);
    expect(() => Reflect.apply(ModuleGraph, undefined, [])).toThrow(TypeError);
    expect(() => ModuleGraph.call(new ModuleGraph())).toThrow(TypeError);
  });

  test("Reflect.construct() takes the prototype from newTarget", async () => {
    using dir = tempDir("module-graph-lifecycle-new-target", { "target.mjs": `export const value = "loaded";` });
    const file = join(String(dir), "target.mjs");

    class Unrelated {}
    const graph: any = Reflect.construct(ModuleGraph, [], Unrelated);
    function NoPrototype() {}
    NoPrototype.prototype = 1 as any;
    const fallback = Reflect.construct(ModuleGraph, [], NoPrototype);
    const proxied = Reflect.construct(ModuleGraph, [], new Proxy(ModuleGraph, {}));
    const bound = Reflect.construct(ModuleGraph, [], ModuleGraph.bind(null));

    expect({
      graph: [Object.getPrototypeOf(graph) === Unrelated.prototype, graph instanceof ModuleGraph, "import" in graph],
      fallback: Object.getPrototypeOf(fallback) === ModuleGraph.prototype,
      proxied: Object.getPrototypeOf(proxied) === ModuleGraph.prototype,
      bound: Object.getPrototypeOf(bound) === ModuleGraph.prototype,
    }).toEqual({ graph: [true, false, false], fallback: true, proxied: true, bound: true });

    // It is still a ModuleGraph underneath.
    expect((await ModuleGraph.prototype.import.call(graph, file)).value).toBe("loaded");
    expect(Object.getOwnPropertyDescriptor(ModuleGraph.prototype, "mainModule")!.get!.call(graph)).toBe(file);
    ModuleGraph.prototype.dispose.call(graph);
    await expect(ModuleGraph.prototype.import.call(graph, file)).rejects.toMatchObject(invalidState);
    expect(() => Reflect.construct(ModuleGraph, [], () => {})).toThrow(TypeError);
  });

  test("can be subclassed", async () => {
    using dir = tempDir("module-graph-lifecycle-subclass", {
      "subclassed.mjs": `export const read = () => tenant; export const again = () => import("./subclassed.mjs");`,
    });
    const file = join(String(dir), "subclassed.mjs");

    const log: string[] = [];
    class TenantGraph extends ModuleGraph {
      tenant: string;
      constructor(tenant: string) {
        super({ globals: { tenant } });
        this.tenant = tenant;
      }
      async import(specifier: string) {
        log.push(`${this.tenant} imports`);
        return { namespace: await super.import(specifier) };
      }
      dispose() {
        log.push(`${this.tenant} disposed through the override`);
        super.dispose();
      }
      get extra() {
        return this.mainModule;
      }
    }

    let escaped;
    {
      using graph = new TenantGraph("a") as any;
      escaped = graph;
      const { namespace } = await graph.import(file);
      expect({
        instances: [graph instanceof TenantGraph, graph instanceof ModuleGraph],
        chain: [
          Object.getPrototypeOf(graph) === TenantGraph.prototype,
          Object.getPrototypeOf(TenantGraph.prototype) === ModuleGraph.prototype,
          Object.getPrototypeOf(TenantGraph) === ModuleGraph,
        ],
        tag: Object.prototype.toString.call(graph),
        ownKeys: Reflect.ownKeys(graph),
        read: namespace.read(),
        extra: graph.extra,
        sameNamespace: (await namespace.again()) === namespace,
      }).toEqual({
        instances: [true, true],
        chain: [true, true, true],
        tag: "[object ModuleGraph]",
        ownKeys: ["tenant"],
        read: "a",
        extra: file,
        sameNamespace: true,
      });
    }
    // `using` calls the inherited [Symbol.dispose], which is the base `dispose`, not the override.
    expect(log).toEqual(["a imports"]);
    await expect(ModuleGraph.prototype.import.call(escaped, file)).rejects.toMatchObject(invalidState);

    // A subclass that returns before calling super() never makes a graph.
    class Broken extends ModuleGraph {
      constructor() {
        return {} as any;
        super();
      }
    }
    expect(() => ModuleGraph.prototype.dispose.call(new Broken())).toThrow(TypeError);
  });

  test("constructed from a node:vm context, the graph still belongs to the constructor's realm", async () => {
    using dir = tempDir("module-graph-lifecycle-vm-realm", {
      "realm.mjs": `export const intrinsics = [Array, globalThis]; export const read = () => tenant;`,
    });
    const file = join(String(dir), "realm.mjs");

    const context = vm.createContext({ ModuleGraph, file });
    const graph = vm.runInContext(`new ModuleGraph({ globals: { tenant: "made in a context" } })`, context);
    const namespace = await vm.runInContext(`(graph => graph.import(file))`, context)(graph);
    const ForeignTarget = vm.runInContext(`(function ForeignTarget() {})`, context);
    const foreign = Reflect.construct(ModuleGraph, [], ForeignTarget);
    const NoPrototype = vm.runInContext(`function NoPrototype() {} NoPrototype.prototype = 1; NoPrototype`, context);
    const fallback = Reflect.construct(ModuleGraph, [], NoPrototype);

    expect({
      prototype: Object.getPrototypeOf(graph) === ModuleGraph.prototype,
      intrinsics: [namespace.intrinsics[0] === Array, namespace.intrinsics[1] === globalThis],
      read: namespace.read(),
      mainModule: graph.mainModule,
      foreign: Object.getPrototypeOf(foreign) === ForeignTarget.prototype,
      fallback: Object.getPrototypeOf(fallback) === ModuleGraph.prototype,
    }).toEqual({
      prototype: true,
      intrinsics: [true, true],
      read: "made in a context",
      mainModule: file,
      foreign: true,
      fallback: true,
    });
    expect(() => vm.runInContext(`ModuleGraph()`, context)).toThrow("cannot be invoked without 'new'");
    expect(() => vm.runInContext(`new ModuleGraph(1)`, context)).toThrow(invalidArgType);
  });

  test("a ShadowRealm has its own ModuleGraph whose modules run in that realm", async () => {
    using dir = tempDir("module-graph-lifecycle-shadow-realm", {
      "shadow.mjs": `
        let count = 0;
        export const increment = () => ++count;
        export const intrinsics = [Array, globalThis];
        export const read = () => tenant;
      `,
    });
    const file = join(String(dir), "shadow.mjs");

    const realm = new (globalThis as any).ShadowRealm();
    const load = realm.evaluate(`(file, done) => {
      const { ModuleGraph } = Bun.unsafe;
      globalThis.graphs ??= [];
      const graph = new ModuleGraph({ globals: { tenant: "shadow " + graphs.length } });
      graphs.push(graph);
      graph.import(file).then(
        namespace => done(JSON.stringify({
          count: [namespace.increment(), namespace.increment()],
          realmIntrinsics: [namespace.intrinsics[0] === Array, namespace.intrinsics[1] === globalThis],
          read: namespace.read(),
          mainModule: graph.mainModule === file,
          sameGraph: graph instanceof ModuleGraph,
        })),
        error => done(JSON.stringify({ rejected: String(error) })),
      );
    }`) as (file: string, done: (result: string) => void) => void;

    const results: unknown[] = [];
    for (let i = 0; i < 2; i++) {
      const { promise, resolve } = Promise.withResolvers<string>();
      load(file, resolve);
      results.push(JSON.parse(await promise));
      Bun.gc(true);
    }
    const host = await import(file);
    expect(results).toEqual([
      { count: [1, 2], realmIntrinsics: [true, true], read: "shadow 0", mainModule: true, sameGraph: true },
      { count: [1, 2], realmIntrinsics: [true, true], read: "shadow 1", mainModule: true, sameGraph: true },
    ]);
    expect(host.increment()).toBe(1);
    expect(host.intrinsics).toEqual([Array, globalThis]);
    expect(realm.evaluate(`Bun.unsafe.ModuleGraph === Bun.unsafe.ModuleGraph`)).toBe(true);
  });
});

describe("receivers", () => {
  test("methods throw a TypeError synchronously on anything but a ModuleGraph", () => {
    using graph = new ModuleGraph();
    class Sub extends ModuleGraph {}
    const getter = Object.getOwnPropertyDescriptor(ModuleGraph.prototype, "mainModule")!.get!;
    const receivers = [
      undefined,
      null,
      1,
      "graph",
      Symbol("graph"),
      {},
      () => {},
      ModuleGraph,
      ModuleGraph.prototype,
      Sub.prototype,
      Object.create(graph),
      new Proxy(graph, {}),
      Promise.resolve(),
    ];
    for (const receiver of receivers) {
      expect(() => ModuleGraph.prototype.import.call(receiver, "node:fs")).toThrow(TypeError);
      expect(() => ModuleGraph.prototype.dispose.call(receiver)).toThrow(TypeError);
      expect(() => ModuleGraph.prototype[Symbol.dispose].call(receiver)).toThrow(TypeError);
      expect(() => getter.call(receiver)).toThrow(TypeError);
    }
    expect(() => ModuleGraph.prototype.mainModule).toThrow(TypeError);
    expect(() => ModuleGraph.prototype.import.call({}, "x")).toThrow(
      "ModuleGraph.prototype.import called on an incompatible receiver",
    );
  });

  test("a method borrowed from one graph works on another", async () => {
    using dir = tempDir("module-graph-lifecycle-borrowed", {
      "borrowed.mjs": `let count = 0; export const increment = () => ++count; export const read = () => tenant;`,
    });
    const file = join(String(dir), "borrowed.mjs");

    using a = new ModuleGraph({ globals: { tenant: "a" } });
    using b = new ModuleGraph({ globals: { tenant: "b" } });
    const { import: importOfA, dispose: disposeOfA } = a;
    const inB = await importOfA.call(b, file);
    const inA = await a.import(file);
    inB.increment();

    expect({
      read: [inA.read(), inB.read()],
      counts: [inA.increment(), inB.increment()],
      same: (await b.import(file)) === inB,
      mainModules: [a.mainModule, b.mainModule],
    }).toEqual({ read: ["a", "b"], counts: [1, 2], same: true, mainModules: [file, file] });

    disposeOfA.call(b);
    await expect(b.import(file)).rejects.toMatchObject(invalidState);
    expect(await a.import(file)).toBe(inA);
  });

  test("an unbound import() resolves relative specifiers against its caller", async () => {
    using dir = tempDir("module-graph-lifecycle-unbound", {
      // Not a tail call: the caller's frame has to be on the stack to be the referrer.
      "unbound.mjs": `export async function load(importInto, graph) { return await importInto.call(graph, "./sibling.mjs"); }`,
      "sibling.mjs": `export const name = "sibling";`,
    });
    using a = new ModuleGraph();
    using b = new ModuleGraph();
    const { load } = await a.import(join(String(dir), "unbound.mjs"));
    const sibling = await load(ModuleGraph.prototype.import, b);
    expect(sibling.name).toBe("sibling");
    expect(sibling).toBe(await b.import(join(String(dir), "sibling.mjs")));
    expect(sibling).not.toBe(await a.import(join(String(dir), "sibling.mjs")));
  });
});

describe("using", () => {
  test("`using` disposes the graph at scope exit", async () => {
    using dir = tempDir("module-graph-lifecycle-using", {
      "scoped.mjs": `export const again = () => import("./scoped.mjs");`,
    });
    const file = join(String(dir), "scoped.mjs");

    let escaped, namespace;
    {
      using graph = new ModuleGraph();
      escaped = graph;
      namespace = await graph.import(file);
      expect(await namespace.again()).toBe(namespace);
    }
    await expect(escaped.import(file)).rejects.toMatchObject(invalidState);
    await expect(namespace.again()).rejects.toMatchObject(invalidState);
  });

  test("`using` disposes the graph when the scope throws", async () => {
    using dir = tempDir("module-graph-lifecycle-using-throw", { "thrown.mjs": `export default 1;` });
    const file = join(String(dir), "thrown.mjs");

    let escaped;
    const thrown = new Error("out of the scope");
    async function scope() {
      using graph = new ModuleGraph();
      escaped = graph;
      await graph.import(file);
      throw thrown;
    }
    await expect(scope()).rejects.toBe(thrown);
    await expect(escaped.import(file)).rejects.toMatchObject(invalidState);
  });

  test("`await using` falls back to [Symbol.dispose]; there is no [Symbol.asyncDispose]", async () => {
    using dir = tempDir("module-graph-lifecycle-await-using", { "awaited.mjs": `export default 1;` });
    const file = join(String(dir), "awaited.mjs");

    expect(Symbol.asyncDispose in ModuleGraph.prototype).toBe(false);
    let escaped;
    {
      await using graph = new ModuleGraph();
      escaped = graph;
      await graph.import(file);
    }
    await expect(escaped.import(file)).rejects.toMatchObject(invalidState);
  });

  test("DisposableStack and AsyncDisposableStack dispose graphs", async () => {
    using dir = tempDir("module-graph-lifecycle-stack", { "stacked.mjs": `export default 1;` });
    const file = join(String(dir), "stacked.mjs");

    const stack = new DisposableStack();
    const used = stack.use(new ModuleGraph());
    const adopted = stack.adopt(new ModuleGraph(), (graph: any) => graph.dispose());
    const asyncStack = new AsyncDisposableStack();
    const usedAsync = asyncStack.use(new ModuleGraph());
    const graphs = [used, adopted, usedAsync];
    for (const graph of graphs) await graph.import(file);

    stack.dispose();
    await asyncStack.disposeAsync();
    const results = await Promise.allSettled(graphs.map(graph => graph.import(file)));
    expect(results.map((result: any) => result.reason?.code)).toEqual([
      "ERR_INVALID_STATE",
      "ERR_INVALID_STATE",
      "ERR_INVALID_STATE",
    ]);
  });
});

describe("dispose()", () => {
  test("is idempotent and returns undefined", async () => {
    using dir = tempDir("module-graph-lifecycle-idempotent", { "idempotent.mjs": `export const value = 1;` });
    const file = join(String(dir), "idempotent.mjs");

    const graph = new ModuleGraph();
    const namespace = await graph.import(file);
    const returned: unknown[] = [];
    for (let i = 0; i < 5; i++) {
      returned.push(graph.dispose(), graph[Symbol.dispose]());
      Bun.gc(true);
    }
    expect(returned).toEqual(Array(10).fill(undefined));
    expect(namespace.value).toBe(1);
    expect(graph.mainModule).toBe(file);
  });

  test("before any import", async () => {
    using dir = tempDir("module-graph-lifecycle-dispose-first", { "never.mjs": `evaluated();` });
    const file = join(String(dir), "never.mjs");

    let evaluations = 0;
    const graph = new ModuleGraph({ globals: { evaluated: () => evaluations++ } });
    graph.dispose();
    const results = await Promise.allSettled([
      graph.import(file),
      graph.import("node:fs"),
      graph.import("./missing.mjs"),
    ]);
    expect(results.map((result: any) => [result.reason instanceof Error, result.reason?.code])).toEqual([
      [true, "ERR_INVALID_STATE"],
      [true, "ERR_INVALID_STATE"],
      [true, "ERR_INVALID_STATE"],
    ]);
    expect({ evaluations, mainModule: graph.mainModule }).toEqual({ evaluations: 0, mainModule: undefined });
  });

  test("rejects import() of a module the graph had already loaded, and keeps `mainModule`", async () => {
    using dir = tempDir("module-graph-lifecycle-dispose-loaded", {
      "loaded.mjs": `import "./loaded-dep.mjs"; export const value = 1;`,
      "loaded-dep.mjs": `export const value = 2;`,
    });
    const loaded = join(String(dir), "loaded.mjs");
    const dep = join(String(dir), "loaded-dep.mjs");

    const graph = new ModuleGraph();
    const namespace = await graph.import(loaded);
    expect(await graph.import(dep)).toEqual({ value: 2 });
    graph.dispose();

    const results = await Promise.allSettled([graph.import(loaded), graph.import(dep), graph.import("node:path")]);
    expect(results.map((result: any) => result.reason?.code)).toEqual([
      "ERR_INVALID_STATE",
      "ERR_INVALID_STATE",
      "ERR_INVALID_STATE",
    ]);
    expect({ mainModule: graph.mainModule, value: namespace.value }).toEqual({ mainModule: loaded, value: 1 });
    // The host and other graphs are unaffected.
    using other = new ModuleGraph();
    expect((await other.import(loaded)).value).toBe(1);
    expect((await import(loaded)).value).toBe(1);
  });

  test("everything already obtained keeps working", async () => {
    using dir = tempDir("module-graph-lifecycle-dispose-survivors", {
      "survivor-dep.mjs": `
        export let live = 0;
        export const bump = () => ++live;
      `,
      "survivor.mjs": `
        import { EventEmitter } from "node:events";
        import * as dep from "./survivor-dep.mjs";
        export { live, bump } from "./survivor-dep.mjs";
        export class Counter extends EventEmitter {
          #count = 0;
          static created = 0;
          constructor() { super(); Counter.created++; }
          increment() { this.emit("count", ++this.#count); return this; }
        }
        export const closure = (() => { let calls = 0; return () => [++calls, tenant, dep.live]; })();
        export function* generate() { yield tenant; yield dep.bump(); }
        export async function later() { await null; return [tenant, import.meta.url, new.target === undefined]; }
        export const meta = import.meta;
        export const requireEsm = () => import.meta.require("./survivor-dep.mjs");
        export const resolved = () => import.meta.resolve("./survivor-dep.mjs");
        export const loadDep = () => import("./survivor-dep.mjs");
        export const loadBuiltin = () => import("node:events");
      `,
    });
    const file = join(String(dir), "survivor.mjs");

    const graph = new ModuleGraph({ globals: { tenant: "kept" } });
    const namespace = await graph.import(file);
    graph.dispose();
    Bun.gc(true);

    const counts: number[] = [];
    new namespace.Counter()
      .on("count", (count: number) => counts.push(count))
      .increment()
      .increment();
    expect({
      counts,
      created: namespace.Counter.created,
      closure: [namespace.closure(), namespace.closure()],
      bump: namespace.bump(),
      live: namespace.live,
      generated: [...namespace.generate()],
      liveAfterGenerate: namespace.live,
      later: await namespace.later(),
      metaMain: namespace.meta.main,
      resolved: namespace.resolved(),
      keys: Object.keys(namespace).sort(),
    }).toEqual({
      counts: [1, 2],
      created: 1,
      closure: [
        [1, "kept", 0],
        [2, "kept", 0],
      ],
      bump: 1,
      live: 1,
      generated: ["kept", 2],
      liveAfterGenerate: 2,
      later: ["kept", namespace.meta.url, true],
      metaMain: true,
      resolved: Bun.pathToFileURL(join(String(dir), "survivor-dep.mjs")).href,
      keys: [
        "Counter",
        "bump",
        "closure",
        "generate",
        "later",
        "live",
        "loadBuiltin",
        "loadDep",
        "meta",
        "requireEsm",
        "resolved",
      ],
    });

    await expect(namespace.loadDep()).rejects.toMatchObject(invalidState);
    await expect(namespace.loadBuiltin()).rejects.toMatchObject(invalidState);
    expect(() => namespace.requireEsm()).toThrow(expect.objectContaining(invalidState));
  });

  test("while an import is in flight, the import still completes", async () => {
    using dir = tempDir("module-graph-lifecycle-dispose-in-flight", {
      "in-flight.mjs": `
        import { value as dep } from "./in-flight-dep.mjs";
        export const before = dep;
        started();
        export const value = await gate;
        export const dynamic = await import("./in-flight-dep.mjs").then(() => "fulfilled", error => error.code);
        export const after = "evaluated to the end";
      `,
      "in-flight-dep.mjs": `export const value = "dep";`,
    });
    const file = join(String(dir), "in-flight.mjs");

    const gate = Promise.withResolvers<string>();
    const started = Promise.withResolvers<void>();
    const graph = new ModuleGraph({ globals: { gate: gate.promise, started: started.resolve } });
    const pending = graph.import(file);
    await started.promise;
    graph.dispose();
    Bun.gc(true);
    gate.resolve("opened");

    expect({ ...(await pending) }).toEqual({
      before: "dep",
      value: "opened",
      dynamic: "ERR_INVALID_STATE",
      after: "evaluated to the end",
    });
    expect(graph.mainModule).toBe(file);
    await expect(graph.import(file)).rejects.toMatchObject(invalidState);
  });

  test("right after import() was called, the import still completes", async () => {
    using dir = tempDir("module-graph-lifecycle-dispose-just-called", {
      "just-called.mjs": `
        import { value } from "./just-called-dep.mjs";
        export const seen = [value, typeof tenant];
      `,
      "just-called-dep.mjs": `export const value = "dep";`,
    });
    const file = join(String(dir), "just-called.mjs");

    const graph = new ModuleGraph({ globals: { tenant: 1 } });
    const pending = graph.import(file);
    graph.dispose();
    expect((await pending).seen).toEqual(["dep", "number"]);
    expect(graph.mainModule).toBe(file);
    await expect(graph.import(file)).rejects.toMatchObject(invalidState);
  });

  test("while an import is in flight and the module then throws, the import rejects with that error", async () => {
    using dir = tempDir("module-graph-lifecycle-dispose-in-flight-throw", {
      "in-flight-throw.mjs": `started(); await gate; throw new Error("after the gate");`,
    });

    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const graph = new ModuleGraph({ globals: { gate: gate.promise, started: started.resolve } });
    const pending = graph.import(join(String(dir), "in-flight-throw.mjs"));
    await started.promise;
    graph.dispose();
    gate.resolve();
    await expect(pending).rejects.toThrow("after the gate");
  });

  test("from the graph's own module during evaluation", async () => {
    using dir = tempDir("module-graph-lifecycle-dispose-self", {
      "self.mjs": `
        import * as dep from "./self-dep.mjs";
        self().dispose();
        export const count = dep.increment();
        export const dynamic = await import("./self-dep.mjs").then(() => "fulfilled", error => error.code);
        export const viaGraph = await self().import("./self-dep.mjs").then(() => "fulfilled", error => error.code);
        export const late = () => import("./self-dep.mjs");
      `,
      "self-dep.mjs": `let count = 0; export const increment = () => ++count;`,
    });
    const file = join(String(dir), "self.mjs");

    const graph = new ModuleGraph({ globals: { self: () => graph } });
    const namespace = await graph.import(file);
    expect({ count: namespace.count, dynamic: namespace.dynamic, viaGraph: namespace.viaGraph }).toEqual({
      count: 1,
      dynamic: "ERR_INVALID_STATE",
      viaGraph: "ERR_INVALID_STATE",
    });
    await expect(namespace.late()).rejects.toMatchObject(invalidState);
    expect(graph.mainModule).toBe(file);
  });

  test("from a dependency, before the importer is evaluated", async () => {
    using dir = tempDir("module-graph-lifecycle-dispose-dependency", {
      "importer.mjs": `
        import { disposed } from "./disposer.mjs";
        import { value } from "./innocent.mjs";
        export const seen = [disposed, value];
      `,
      "disposer.mjs": `self().dispose(); export const disposed = true;`,
      "innocent.mjs": `export const value = "evaluated after the dispose";`,
    });

    const graph = new ModuleGraph({ globals: { self: () => graph } });
    expect((await graph.import(join(String(dir), "importer.mjs"))).seen).toEqual([true, "evaluated after the dispose"]);
  });

  test("from inside onError", async () => {
    using dir = tempDir("module-graph-lifecycle-dispose-on-error", {
      "faulty.mjs": `
        export const throwInTimer = message => { setTimeout(() => { throw new Error(message); }, 0); };
        export const again = () => import("./faulty.mjs");
      `,
    });
    const file = join(String(dir), "faulty.mjs");

    const errors: string[] = [];
    const graph = new ModuleGraph({
      onError(error: Error) {
        graph.dispose();
        Bun.gc(true);
        errors.push(error.message);
      },
    });
    const namespace = await graph.import(file);
    namespace.throwInTimer("first");
    while (errors.length < 1) await tick();
    await expect(namespace.again()).rejects.toMatchObject(invalidState);

    // onError outlives the dispose.
    namespace.throwInTimer("second");
    while (errors.length < 2) await tick();
    expect(errors).toEqual(["first", "second"]);
  });

  test("in the middle of loading many large modules, the import still completes and evaluates each once", async () => {
    // Large enough that the modules are still being fetched when import() returns.
    const padding = Buffer.alloc(
      128 * 1024,
      "// padding padding padding padding padding padding padding padding\n",
    ).toString();
    const leaves = 8;
    const files: Record<string, string> = {
      "large-shared.mjs": `${padding}\nevaluated("shared"); export const shared = {};`,
      "large-entry.mjs": `
        ${Array.from({ length: leaves }, (_, i) => `import { shared as shared${i} } from "./large-${i}.mjs";`).join("\n")}
        export const shared = [${Array.from({ length: leaves }, (_, i) => `shared${i}`).join(", ")}];
      `,
    };
    for (let i = 0; i < leaves; i++) {
      files[`large-${i}.mjs`] = `${padding}\nexport { shared } from "./large-shared.mjs"; evaluated("leaf");`;
    }
    using dir = tempDir("module-graph-lifecycle-dispose-loading", files);
    const file = join(String(dir), "large-entry.mjs");

    const outcomes: unknown[] = [];
    for (const ticksBeforeDispose of [0, 1, 3]) {
      const evaluated: string[] = [];
      const graph = new ModuleGraph({ globals: { evaluated: (name: string) => evaluated.push(name) } });
      const pending = graph.import(file);
      for (let i = 0; i < ticksBeforeDispose; i++) await tick();
      graph.dispose();
      Bun.gc(true);
      const { shared } = await pending;
      outcomes.push({
        distinctShared: new Set(shared).size,
        evaluated: evaluated.toSorted(),
        importAfter: await graph.import(file).then(
          () => "fulfilled",
          error => error.code,
        ),
      });
    }
    const outcome = {
      distinctShared: 1,
      evaluated: [...Array(leaves).fill("leaf"), "shared"],
      importAfter: "ERR_INVALID_STATE",
    };
    expect(outcomes).toEqual([outcome, outcome, outcome]);
  });

  // The disposed check runs before the specifier is converted to a string, so this import()
  // loads a module into a graph that is already disposed.
  test("from the specifier's toString(), the import() that is converting it rejects", async () => {
    using dir = tempDir("module-graph-lifecycle-dispose-to-string", { "converted.mjs": `export default 1;` });
    const file = join(String(dir), "converted.mjs");

    const graph = new ModuleGraph();
    const specifier = {
      toString() {
        graph.dispose();
        return file;
      },
    };
    await expect(graph.import(specifier)).rejects.toMatchObject(invalidState);
  });

  test("`import.meta` first touched after dispose() and a collection is still the graph's", async () => {
    using dir = tempDir("module-graph-lifecycle-dispose-meta", {
      "lazy-meta.mjs": `import "./lazy-meta-dep.mjs"; export const meta = () => import.meta;`,
      "lazy-meta-dep.mjs": `export const meta = () => import.meta;`,
    });
    const file = join(String(dir), "lazy-meta.mjs");

    const graph = new ModuleGraph();
    const main = await graph.import(file);
    const dep = await graph.import(join(String(dir), "lazy-meta-dep.mjs"));
    const host = await import(file);
    graph.dispose();
    Bun.gc(true);
    expect({
      main: [main.meta().main, main.meta().path],
      dep: [dep.meta().main, dep.meta().file],
      distinct: main.meta() !== host.meta(),
      stable: main.meta() === main.meta(),
    }).toEqual({ main: [true, file], dep: [false, "lazy-meta-dep.mjs"], distinct: true, stable: true });
  });

  test("import() from inside onError, into the same graph and into a new one", async () => {
    using dir = tempDir("module-graph-lifecycle-on-error-import", {
      "reporter.mjs": `export const throwInTimer = message => { setTimeout(() => { throw new Error(message); }, 0); };`,
      "recovery.mjs": `export const recovered = message => tenant + " recovered from " + message;`,
    });
    const recovery = join(String(dir), "recovery.mjs");

    const results: string[] = [];
    const graph = new ModuleGraph({
      globals: { tenant: "same graph" },
      async onError(error: Error) {
        const fresh = new ModuleGraph({ globals: { tenant: "new graph" } });
        const namespaces = await Promise.all([graph.import(recovery), fresh.import(recovery)]);
        results.push(...namespaces.map(namespace => namespace.recovered(error.message)));
        fresh.dispose();
      },
    });
    (await graph.import(join(String(dir), "reporter.mjs"))).throwInTimer("a timer");
    while (results.length < 2) await tick();
    expect(results).toEqual(["same graph recovered from a timer", "new graph recovered from a timer"]);
    graph.dispose();
  });

  test("of one graph leaves its siblings and the host alone", async () => {
    using dir = tempDir("module-graph-lifecycle-dispose-siblings", {
      "sibling-a.mjs": `export const again = () => import("./sibling-b.mjs");`,
      "sibling-b.mjs": `export const name = "b";`,
    });
    const file = join(String(dir), "sibling-a.mjs");

    const graphs = Array.from({ length: 4 }, () => new ModuleGraph());
    const namespaces = await Promise.all(graphs.map(graph => graph.import(file)));
    graphs[1].dispose();
    graphs[3].dispose();
    const results = await Promise.allSettled(namespaces.map(namespace => namespace.again()));
    expect(results.map((result: any) => result.value?.name ?? result.reason?.code)).toEqual([
      "b",
      "ERR_INVALID_STATE",
      "b",
      "ERR_INVALID_STATE",
    ]);
    expect((await (await import(file)).again()).name).toBe("b");
    graphs[0].dispose();
    graphs[2].dispose();
  });
});

// Records which registered objects the garbage collector has finalized. `until()` never touches
// the objects themselves (a WeakRef#deref() would keep its target alive for the current job).
function finalizations() {
  const collected = new Set<string>();
  const registry = new FinalizationRegistry<string>(name => collected.add(name));
  return {
    collected,
    register: (target: object, name: string) => registry.register(target, name),
    async until(done: () => boolean) {
      for (let i = 0; i < 200 && !done(); i++) {
        Bun.gc(true);
        await tick();
      }
      return done();
    },
    async settle(rounds = 10) {
      for (let i = 0; i < rounds; i++) {
        Bun.gc(true);
        await tick();
      }
    },
  };
}

describe("garbage collection", () => {
  test("a dropped graph whose namespace is retained keeps working, and import() stays in it", async () => {
    using dir = tempDir("module-graph-lifecycle-gc-namespace", {
      "retained.mjs": `
        import { increment } from "./retained-state.mjs";
        export { increment };
        export const loadState = () => import("./retained-state.mjs");
        export const loadFresh = () => import("./retained-fresh.mjs");
      `,
      "retained-state.mjs": `let count = 0; export const increment = () => ++count; export const read = () => [tenant, count];`,
      "retained-fresh.mjs": `import { read } from "./retained-state.mjs"; export const seen = [tenant, read()];`,
    });
    const file = join(String(dir), "retained.mjs");

    async function load() {
      const graph = new ModuleGraph({ globals: { tenant: { name: "a dropped graph" } } });
      return await graph.import(file);
    }
    const namespace = await load();
    Bun.gc(true);
    namespace.increment();
    await tick();
    Bun.gc(true);

    const state = await namespace.loadState();
    Bun.gc(true);
    expect(state.increment).toBe(namespace.increment);
    expect(state.read()).toEqual([{ name: "a dropped graph" }, 1]);
    expect(await namespace.loadState()).toBe(state);
    // A module first loaded after the ModuleGraph object was dropped joins the same graph.
    expect((await namespace.loadFresh()).seen).toEqual([{ name: "a dropped graph" }, [{ name: "a dropped graph" }, 1]]);
    expect((await import(file)).increment()).toBe(1);
  });

  test("a retained graph whose namespaces were dropped still has the same module instances", async () => {
    using dir = tempDir("module-graph-lifecycle-gc-registry", {
      "registered.mjs": `
        import "./registered-dep.mjs";
        evaluated("registered");
        let count = 0;
        export const increment = () => ++count;
      `,
      "registered-dep.mjs": `evaluated("registered-dep");`,
    });
    const file = join(String(dir), "registered.mjs");

    const evaluations: string[] = [];
    using graph = new ModuleGraph({ globals: { evaluated: (name: string) => evaluations.push(name) } });
    const counts: number[] = [];
    for (let i = 0; i < 5; i++) {
      await (async () => counts.push((await graph.import(file)).increment()))();
      Bun.gc(true);
      await tick();
      Bun.gc(true);
    }
    expect({ counts, evaluations }).toEqual({ counts: [1, 2, 3, 4, 5], evaluations: ["registered-dep", "registered"] });
  });

  test("only `import.meta` retained: its require() still returns the graph's instances", async () => {
    using dir = tempDir("module-graph-lifecycle-gc-meta", {
      "meta-holder.mjs": `import { increment } from "./meta-state.mjs"; increment(); export const meta = import.meta;`,
      "meta-state.mjs": `let count = 0; export const increment = () => ++count; export const read = () => [tenant, count];`,
    });
    const file = join(String(dir), "meta-holder.mjs");

    const meta = await (async () => (await new ModuleGraph({ globals: { tenant: "meta" } }).import(file)).meta)();
    Bun.gc(true);
    await tick();
    Bun.gc(true);
    expect(meta.require("./meta-state.mjs").read()).toEqual(["meta", 1]);
    expect(meta.main).toBe(true);
  });

  test("a graph with nothing retained but a pending import() still settles it", async () => {
    using dir = tempDir("module-graph-lifecycle-gc-pending", {
      "pending.mjs": `
        import { value } from "./pending-dep.mjs";
        started();
        const opened = await gate;
        export const seen = [value, opened, tenant, (await import("./pending-late.mjs")).value];
      `,
      "pending-dep.mjs": `export const value = "dep";`,
      "pending-late.mjs": `export const value = "loaded after the gate, " + tenant;`,
    });
    const file = join(String(dir), "pending.mjs");

    const gate = Promise.withResolvers<string>();
    const started = Promise.withResolvers<void>();
    const pending = (() =>
      new ModuleGraph({ globals: { gate: gate.promise, started: started.resolve, tenant: "t" } }).import(file))();
    Bun.gc(true);
    await started.promise;
    for (let i = 0; i < 3; i++) {
      Bun.gc(true);
      await tick();
    }
    gate.resolve("opened");
    expect((await pending).seen).toEqual(["dep", "opened", "t", "loaded after the gate, t"]);
  });

  test("collections in the middle of loading and evaluating", async () => {
    const files: Record<string, string> = {
      "gc-entry.mjs": `
        import { chain } from "./gc-0.mjs";
        Bun.gc(true);
        export const result = [chain, (await import("./gc-dynamic.mjs")).value];
      `,
      "gc-dynamic.mjs": `Bun.gc(true); await null; Bun.gc(true); export const value = tenant.name;`,
    };
    for (let i = 0; i < 10; i++) {
      files[`gc-${i}.mjs`] =
        i === 9
          ? `Bun.gc(true); export const chain = [tenant.name];`
          : `import { chain as rest } from "./gc-${i + 1}.mjs"; Bun.gc(true); export const chain = [...rest, ${i}];`;
    }
    using dir = tempDir("module-graph-lifecycle-gc-during", files);
    const file = join(String(dir), "gc-entry.mjs");

    const pending: Promise<any>[] = [];
    for (const name of ["a", "b", "c"]) {
      pending.push(new ModuleGraph({ globals: { tenant: { name } } }).import(file));
      Bun.gc(true);
    }
    const results = (await Promise.all(pending)).map(namespace => namespace.result);
    expect(results).toEqual(["a", "b", "c"].map(name => [[name, 8, 7, 6, 5, 4, 3, 2, 1, 0], name]));
  });

  describe.each(["dropped", "disposed and dropped"])("300 graphs, %s, are reclaimed", mode => {
    test("along with their modules' state", async () => {
      using dir = tempDir("module-graph-lifecycle-gc-reclaim", {
        "heavy.mjs": `
          const buffer = new ArrayBuffer(1024 * 1024);
          export const token = { buffer };
          export const size = () => buffer.byteLength;
        `,
      });
      const file = join(String(dir), "heavy.mjs");

      const total = 300;
      const { collected, register, until } = finalizations();
      async function create(i: number) {
        const graph = new ModuleGraph({ globals: { index: i } });
        const namespace = await graph.import(file);
        register(namespace.token, `token ${i}`);
        register(graph, `graph ${i}`);
        if (mode === "disposed and dropped") graph.dispose();
        return namespace.size();
      }
      let bytes = 0;
      for (let i = 0; i < total; i++) bytes += await create(i);
      expect(bytes).toBe(total * 1024 * 1024);

      const count = (prefix: string) => [...collected].filter(name => name.startsWith(prefix)).length;
      await until(() => count("token") >= total - 10 && count("graph") >= total - 10);
      expect(count("token")).toBeGreaterThanOrEqual(total - 10);
      expect(count("graph")).toBeGreaterThanOrEqual(total - 10);
    });
  });

  // The tests below make several graphs at a time and require all but one to be collected: a
  // graph with `globals` that imported something has been observed to stay uncollected until the
  // next such graph is made.
  const several = 6;
  const count = (collected: Set<string>, prefix: string) =>
    [...collected].filter(name => name.startsWith(prefix)).length;

  test("the ModuleGraph object, its globals and its onError live exactly as long as its code", async () => {
    using dir = tempDir("module-graph-lifecycle-gc-globals", {
      "holder.mjs": `export const unrelated = () => 1; export const read = () => token.name;`,
    });
    const file = join(String(dir), "holder.mjs");

    const { collected, register, until, settle } = finalizations();
    // The graphs' code is held through this array only, never in a local of this async function.
    const held: (() => number)[] = [];
    async function create(i: number) {
      const token = { name: "the token" };
      const onError = () => {};
      const graph = new ModuleGraph({ globals: { token }, onError });
      register(token, `token ${i}`);
      register(onError, `onError ${i}`);
      register(graph, `graph ${i}`);
      // A function that does not even mention `token`.
      held.push((await graph.import(file)).unrelated);
    }
    for (let i = 0; i < several; i++) await create(i);
    await settle();
    expect([...collected]).toEqual([]);
    expect(held.map(unrelated => unrelated())).toEqual(Array(several).fill(1));

    held.length = 0;
    const counts = () => ["token", "onError", "graph"].map(prefix => count(collected, prefix));
    await until(() => counts().every(n => n >= several - 1));
    expect(Math.min(...counts())).toBeGreaterThanOrEqual(several - 1);
  });

  test("a disposed graph's globals are still alive for its code, and are released with it", async () => {
    using dir = tempDir("module-graph-lifecycle-gc-disposed-globals", {
      "disposed-holder.mjs": `export const read = () => token.name;`,
    });
    const file = join(String(dir), "disposed-holder.mjs");

    const { collected, register, until, settle } = finalizations();
    const held: (() => string)[] = [];
    async function create(i: number) {
      const token = { name: `token ${i}` };
      register(token, token.name);
      const graph = new ModuleGraph({ globals: { token } });
      held.push((await graph.import(file)).read);
      graph.dispose();
    }
    for (let i = 0; i < several; i++) await create(i);
    await settle();
    expect([...collected]).toEqual([]);
    expect(held.map(read => read())).toEqual(Array.from({ length: several }, (_, i) => `token ${i}`));

    held.length = 0;
    await until(() => collected.size >= several - 1);
    expect(collected.size).toBeGreaterThanOrEqual(several - 1);
  });

  test("graphs that were never used are collected", async () => {
    const { collected, register, until } = finalizations();
    (() => {
      register(new ModuleGraph(), "no options");
      register(new ModuleGraph({ globals: { big: new ArrayBuffer(1024) }, onError() {} }), "options");
      const disposed = new ModuleGraph({ globals: { big: new ArrayBuffer(1024) } });
      disposed.dispose();
      register(disposed, "disposed");
    })();
    expect(await until(() => collected.size === 3)).toBe(true);
  });

  test("graphs that refer to themselves through their globals and onError are collected", async () => {
    using dir = tempDir("module-graph-lifecycle-gc-cycle", {
      "cycle.mjs": `export const self = () => graph(); export const token = holder;`,
    });
    const file = join(String(dir), "cycle.mjs");

    const { collected, register, until } = finalizations();
    async function create(i: number) {
      const holder: any = {};
      const graph = new ModuleGraph({ globals: { holder, graph: () => graph }, onError: () => graph });
      holder.graph = graph;
      holder.namespace = await graph.import(file);
      register(graph, `graph ${i}`);
      register(holder, `holder ${i}`);
      return holder.namespace.self() === graph;
    }
    for (let i = 0; i < several; i++) expect(await create(i)).toBe(true);
    const counts = () => ["graph", "holder"].map(prefix => count(collected, prefix));
    await until(() => counts().every(n => n >= several - 1));
    expect(Math.min(...counts())).toBeGreaterThanOrEqual(several - 1);
  });

  test("abandoned import()s that never finish evaluating do not pin their graphs", async () => {
    using dir = tempDir("module-graph-lifecycle-gc-abandoned", {
      "abandoned.mjs": `started(); await never; export const unreachable = token;`,
    });
    const file = join(String(dir), "abandoned.mjs");

    const { collected, register, until } = finalizations();
    async function create(i: number) {
      const token = {};
      const started = Promise.withResolvers<void>();
      const graph = new ModuleGraph({ globals: { token, never: new Promise(() => {}), started: started.resolve } });
      register(token, `token ${i}`);
      register(graph, `graph ${i}`);
      graph.import(file);
      await started.promise;
    }
    for (let i = 0; i < several; i++) await create(i);
    const counts = () => ["graph", "token"].map(prefix => count(collected, prefix));
    await until(() => counts().every(n => n >= several - 1));
    expect(Math.min(...counts())).toBeGreaterThanOrEqual(several - 1);
  });

  test("heap snapshots can be taken while graphs are alive", async () => {
    using dir = tempDir("module-graph-lifecycle-gc-snapshot", {
      "snapshotted.mjs": `export const read = () => tenant;`,
    });
    using graph = new ModuleGraph({ globals: { tenant: { name: "snapshotted" } }, onError() {} });
    const { read } = await graph.import(join(String(dir), "snapshotted.mjs"));

    expect((Bun.generateHeapSnapshot() as any).nodeClassNames).toContain("ModuleGraph");
    expect(Bun.generateHeapSnapshot("v8")).toContain("ModuleGraph");
    expect(read()).toEqual({ name: "snapshotted" });
  });

  test("one graph's function held only by another graph's globals", async () => {
    using dir = tempDir("module-graph-lifecycle-gc-cross", {
      "producer.mjs": `let count = 0; export const produce = () => [tenant, ++count];`,
      "consumer.mjs": `export const consume = () => [tenant, produce()];`,
    });

    async function create() {
      const producer = await new ModuleGraph({ globals: { tenant: "producer" } }).import(
        join(String(dir), "producer.mjs"),
      );
      const graph = new ModuleGraph({ globals: { tenant: "consumer", produce: producer.produce } });
      return (await graph.import(join(String(dir), "consumer.mjs"))).consume;
    }
    const consume = await create();
    Bun.gc(true);
    await tick();
    Bun.gc(true);
    expect([consume(), consume()]).toEqual([
      ["consumer", ["producer", 1]],
      ["consumer", ["producer", 2]],
    ]);
  });

  describe.each([
    ["BUN_JSC_collectContinuously", "1", 10],
    ["BUN_JSC_slowPathAllocsBetweenGCs", "10", 24],
  ])("under %s=%s", (option, value, graphs) => {
    test.concurrent("graphs are created, nested, disposed mid-import, dropped and still used", async () => {
      using dir = tempDir("module-graph-lifecycle-gc-stress", {
        "stressed-state.mjs": `let count = 0; export const increment = () => ++count;`,
        "stressed-inner.mjs": `
          import { increment } from "./stressed-state.mjs";
          export const read = () => [tenant.name, increment()];
        `,
        "stressed.mjs": `
          import { increment } from "./stressed-state.mjs";
          export { increment };
          started();
          export const opened = await gate;
          export const dynamic = await import("./stressed-state.mjs").then(state => state.increment === increment, error => error.code);
          const innerGraph = new Bun.unsafe.ModuleGraph({ globals: { tenant: { name: tenant.name + " > inner" } } });
          export const inner = await innerGraph.import("./stressed-inner.mjs");
          export const meta = import.meta;
          export const rejectLater = () => { Promise.reject(new Error("rejected by " + tenant.name)); };
        `,
        "main.mjs": `
          const { ModuleGraph } = Bun.unsafe;
          const file = import.meta.dir + "/stressed.mjs";
          const errors = [];
          async function load(i) {
            const gate = Promise.withResolvers();
            const started = Promise.withResolvers();
            const graph = new ModuleGraph({
              globals: { tenant: { name: "graph " + i }, gate: gate.promise, started: started.resolve },
              onError: error => errors.push(error.message),
            });
            const pending = graph.import(file);
            await started.promise;
            if (i % 2) graph.dispose();
            gate.resolve("opened " + i);
            return pending;
          }
          function required(namespace) {
            try {
              return namespace.meta.require("./stressed-state.mjs").increment === namespace.increment;
            } catch (error) {
              return error.code;
            }
          }
          const results = [];
          for (let i = 0; i < ${graphs}; i++) {
            const namespace = await load(i);
            namespace.increment();
            results.push([namespace.opened, namespace.dynamic, namespace.inner.read(), namespace.increment(), required(namespace)]);
            namespace.rejectLater();
          }
          while (errors.length < ${graphs}) await new Promise(resolve => setImmediate(resolve));
          console.log(JSON.stringify({ results, errors }));
        `,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.mjs"],
        env: { ...bunEnv, [option]: value },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        results: Array.from({ length: graphs }, (_, i) => {
          const disposed = i % 2 === 1;
          return [
            `opened ${i}`,
            disposed ? "ERR_INVALID_STATE" : true,
            [`graph ${i} > inner`, 1],
            2,
            disposed ? "ERR_INVALID_STATE" : true,
          ];
        }),
        errors: Array.from({ length: graphs }, (_, i) => `rejected by graph ${i}`),
      });
      expect(exitCode).toBe(0);
    });
  });
});

describe("scale", () => {
  describe("1,000 live graphs of the same module", () => {
    const total = 1000;
    const namespaces: any[] = [];

    // In batches, so that no single test is slow on a debug build.
    test.each([0, 250, 500, 750])("graphs %d and up", async first => {
      using dir = tempDir("module-graph-lifecycle-scale-graphs", {
        "scaled.mjs": `
          export let count = 0;
          export const increment = () => ++count;
          export const read = () => [index, count];
        `,
      });
      const file = join(String(dir), "scaled.mjs");
      for (let i = first; i < first + 250; i++) {
        const graph = new ModuleGraph({ globals: { index: i } });
        const namespace = await graph.import(file);
        for (let n = 0; n <= i % 3; n++) namespace.increment();
        if (i % 2) graph.dispose();
        namespaces.push(namespace);
      }
    });

    test("each has its own state", () => {
      Bun.gc(true);
      expect(new Set(namespaces).size).toBe(total);
      expect(namespaces.map(namespace => namespace.read())).toEqual(
        Array.from({ length: total }, (_, i) => [i, (i % 3) + 1]),
      );
      expect(namespaces.map(namespace => namespace.count)).toEqual(
        Array.from({ length: total }, (_, i) => (i % 3) + 1),
      );
      namespaces.length = 0;
    });
  });

  test("one graph imports 300 modules", async () => {
    const total = 300;
    const files: Record<string, string> = {
      "wide.mjs": `
        ${Array.from({ length: total }, (_, i) => `import { value as v${i} } from "./wide-${i}.mjs";`).join("\n")}
        export const values = [${Array.from({ length: total }, (_, i) => `v${i}`).join(", ")}];
      `,
    };
    for (let i = 0; i < total; i++) {
      // Every module also imports its predecessor, so the graph is wide and 300 deep.
      files[`wide-${i}.mjs`] =
        i === 0
          ? `evaluated(); export const value = base;`
          : `import { value as previous } from "./wide-${i - 1}.mjs"; evaluated(); export const value = previous + 1;`;
    }
    using dir = tempDir("module-graph-lifecycle-scale-modules", files);
    const file = join(String(dir), "wide.mjs");

    const evaluations = { a: 0, b: 0 };
    using a = new ModuleGraph({ globals: { base: 0, evaluated: () => evaluations.a++ } });
    using b = new ModuleGraph({ globals: { base: 1000, evaluated: () => evaluations.b++ } });
    const [inA, inB] = await Promise.all([a.import(file), b.import(file)]);
    expect(inA.values).toEqual(Array.from({ length: total }, (_, i) => i));
    expect(inB.values).toEqual(Array.from({ length: total }, (_, i) => 1000 + i));
    expect(evaluations).toEqual({ a: total, b: total });
    expect((await a.import(join(String(dir), "wide-299.mjs"))).value).toBe(299);
  });

  test("50 graphs import concurrently", async () => {
    using dir = tempDir("module-graph-lifecycle-scale-concurrent", {
      "concurrent.mjs": `
        import { order } from "./concurrent-dep.mjs";
        await Promise.resolve();
        export const result = [index, order, (await import("./concurrent-late.mjs")).late];
      `,
      "concurrent-dep.mjs": `await null; export const order = next();`,
      "concurrent-late.mjs": `export const late = index * 2;`,
    });
    const file = join(String(dir), "concurrent.mjs");

    let order = 0;
    const graphs = Array.from(
      { length: 50 },
      (_, index) => new ModuleGraph({ globals: { index, next: () => order++ } }),
    );
    const namespaces = await Promise.all(graphs.map(graph => graph.import(file)));
    const results = namespaces.map(namespace => namespace.result);
    expect(results.map(([index, , late]) => [index, late])).toEqual(Array.from({ length: 50 }, (_, i) => [i, i * 2]));
    expect(results.map(([, order]) => order).sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i));
    for (const graph of graphs) graph.dispose();
  });

  test("100 concurrent import()s of one module in one graph evaluate it once", async () => {
    using dir = tempDir("module-graph-lifecycle-scale-same", {
      "same.mjs": `evaluated(); await gate; export const value = "once";`,
    });
    const file = join(String(dir), "same.mjs");

    let evaluations = 0;
    const gate = Promise.withResolvers<void>();
    using graph = new ModuleGraph({ globals: { evaluated: () => evaluations++, gate: gate.promise } });
    const pending = Array.from({ length: 100 }, () => graph.import(file));
    Bun.gc(true);
    gate.resolve();
    const namespaces = await Promise.all(pending);
    expect({ distinct: new Set(namespaces).size, evaluations, value: namespaces[0].value }).toEqual({
      distinct: 1,
      evaluations: 1,
      value: "once",
    });
  });
});

describe("nesting", () => {
  test("a graph made by another graph's code, from a constructor passed through `globals`", async () => {
    using dir = tempDir("module-graph-lifecycle-nested-globals", {
      "outer.mjs": `
        import * as state from "./nested-state.mjs";
        state.increment();
        export const inner = new Graph({ globals: { tenant: tenant + " > inner" } });
        // Relative to this module, which is the caller.
        export const innerState = await inner.import("./nested-state.mjs");
        export { state };
      `,
      "nested-state.mjs": `let count = 0; export const increment = () => ++count; export const read = () => [tenant, count];`,
    });

    using outer = new ModuleGraph({ globals: { tenant: "outer", Graph: ModuleGraph } });
    const namespace = await outer.import(join(String(dir), "outer.mjs"));
    namespace.innerState.increment();
    namespace.innerState.increment();
    expect({
      inner: namespace.inner instanceof ModuleGraph,
      distinct: namespace.innerState !== namespace.state,
      outer: namespace.state.read(),
      innerState: namespace.innerState.read(),
      mainModules: [outer.mainModule, namespace.inner.mainModule],
    }).toEqual({
      inner: true,
      distinct: true,
      outer: ["outer", 1],
      innerState: ["outer > inner", 2],
      mainModules: [join(String(dir), "outer.mjs"), join(String(dir), "nested-state.mjs")],
    });

    // Disposing the outer graph leaves the inner one usable.
    outer.dispose();
    expect(await namespace.inner.import(join(String(dir), "nested-state.mjs"))).toBe(namespace.innerState);
    namespace.inner.dispose();
  });

  test("a module that loads itself into a new graph, five levels deep", async () => {
    using dir = tempDir("module-graph-lifecycle-nested-recursive", {
      "recursive.mjs": `
        export const level = depth;
        export const main = import.meta.main;
        export const child = depth < 5
          ? await new Bun.unsafe.ModuleGraph({ globals: { depth: depth + 1 } }).import(import.meta.path)
          : null;
      `,
    });

    using graph = new ModuleGraph({ globals: { depth: 1 } });
    const levels: unknown[] = [];
    for (
      let namespace = await graph.import(join(String(dir), "recursive.mjs"));
      namespace;
      namespace = namespace.child
    ) {
      levels.push([namespace.level, namespace.main]);
      Bun.gc(true);
    }
    expect(levels).toEqual([
      [1, true],
      [2, true],
      [3, true],
      [4, true],
      [5, true],
    ]);
  });

  test("one graph's namespace as another graph's global", async () => {
    using dir = tempDir("module-graph-lifecycle-nested-namespace", {
      "library.mjs": `let count = 0; export const increment = () => ++count; export const owner = () => tenant;`,
      "consumer.mjs": `
        import * as own from "./library.mjs";
        export const result = () => [library.increment(), library.owner(), own.increment(), own.owner(), library === own];
      `,
    });

    using a = new ModuleGraph({ globals: { tenant: "a" } });
    const library = await a.import(join(String(dir), "library.mjs"));
    using b = new ModuleGraph({ globals: { tenant: "b", library } });
    const consumer = await b.import(join(String(dir), "consumer.mjs"));
    library.increment();
    expect(consumer.result()).toEqual([2, "a", 1, "b", false]);
    a.dispose();
    expect(consumer.result()).toEqual([3, "a", 2, "b", false]);
  });

  test("a module that imports itself through its own graph object while it evaluates", async () => {
    using dir = tempDir("module-graph-lifecycle-nested-self", {
      "reentrant.mjs": `
        export const viaGraph = self().import(import.meta.path);
        export const viaSibling = self().import("./reentrant-sibling.mjs");
        export const value = "evaluated";
      `,
      "reentrant-sibling.mjs": `export const sibling = typeof self;`,
    });
    const file = join(String(dir), "reentrant.mjs");

    const graph = new ModuleGraph({ globals: { self: () => graph } });
    const namespace = await graph.import(file);
    expect(await namespace.viaGraph).toBe(namespace);
    expect((await namespace.viaSibling).sibling).toBe("function");
    expect(graph.mainModule).toBe(file);
    graph.dispose();
  });
});

describe("shared runtime state", () => {
  test("builtin modules: a record per graph, the same exports", async () => {
    using graph = new ModuleGraph();
    const [fs, bun, bunTest] = await Promise.all([
      graph.import("node:fs"),
      graph.import("bun"),
      graph.import("bun:test"),
    ]);
    expect({
      mainModule: graph.mainModule,
      readFileSync: fs.readFileSync === readFileSync,
      again: (await graph.import("node:fs")) === fs,
      bun: bun.default === Bun,
      expect: bunTest.expect === expect,
    }).toEqual({ mainModule: "node:fs", readFileSync: true, again: true, bun: true, expect: true });
  });

  test("a graph's module can use bun:test's expect and mocks", async () => {
    using dir = tempDir("module-graph-lifecycle-bun-test", {
      "asserts.mjs": `
        import { expect, mock } from "bun:test";
        export const check = value => { expect(value).toBe(tenant); };
        export const spy = mock(() => tenant);
      `,
    });
    using graph = new ModuleGraph({ globals: { tenant: "expected" } });
    const { check, spy } = await graph.import(join(String(dir), "asserts.mjs"));
    check("expected");
    expect(() => check("something else")).toThrow();
    expect(spy()).toBe("expected");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  test("timers interoperate with the host's", async () => {
    using dir = tempDir("module-graph-lifecycle-runtime-timers", {
      "timers.mjs": `
        export const start = callback => setTimeout(callback, 0, "from the graph");
        export const startInterval = callback => setInterval(callback, 1);
        export const cancel = timer => clearTimeout(timer);
        export const sameFunctions = [setTimeout === globalThis.setTimeout, clearTimeout === globalThis.clearTimeout];
      `,
    });
    using graph = new ModuleGraph();
    const namespace = await graph.import(join(String(dir), "timers.mjs"));

    const fired: string[] = [];
    const done = Promise.withResolvers<void>();
    const cancelledByHost = namespace.start(() => fired.push("cancelled by the host"));
    clearTimeout(cancelledByHost);
    const cancelledByGraph = setTimeout(() => fired.push("cancelled by the graph"), 0);
    namespace.cancel(cancelledByGraph);
    let ticks = 0;
    const interval = namespace.startInterval(() => {
      if (++ticks === 3) {
        clearInterval(interval);
        namespace.start((message: string) => {
          fired.push(message);
          done.resolve();
        });
      }
    });
    graph.dispose();
    await done.promise;

    expect({ fired, ticks, sameFunctions: namespace.sameFunctions, timeout: cancelledByHost.constructor.name }).toEqual(
      {
        fired: ["from the graph"],
        ticks: 3,
        sameFunctions: [true, true],
        timeout: "Timeout",
      },
    );
  });

  test("AsyncLocalStorage context flows into and through graph code", async () => {
    using dir = tempDir("module-graph-lifecycle-runtime-als", {
      "als.mjs": `
        import { AsyncLocalStorage } from "node:async_hooks";
        export const own = new AsyncLocalStorage();
        export async function observe(storage) {
          const seen = [storage.getStore()];
          await null;
          seen.push(storage.getStore());
          await new Promise(resolve => setImmediate(resolve));
          seen.push(storage.getStore());
          await import("./als-late.mjs");
          seen.push(storage.getStore());
          return seen;
        }
        export const runOwn = (store, fn) => own.run(store, fn);
      `,
      "als-late.mjs": `export default 1;`,
    });
    using graph = new ModuleGraph();
    const namespace = await graph.import(join(String(dir), "als.mjs"));

    const storage = new AsyncLocalStorage<string>();
    const [first, second, outside] = await Promise.all([
      storage.run("first", () => namespace.observe(storage)),
      storage.run("second", () => namespace.observe(storage)),
      namespace.observe(storage),
    ]);
    expect({ first, second, outside }).toEqual({
      first: ["first", "first", "first", "first"],
      second: ["second", "second", "second", "second"],
      outside: [undefined, undefined, undefined, undefined],
    });
    // A store the graph created is visible to host code it calls.
    expect(namespace.runOwn("graph store", () => namespace.own.getStore())).toBe("graph store");
    expect(namespace.own).toBeInstanceOf(AsyncLocalStorage);
  });

  test("microtasks and process.nextTick interleave with the host's in order", async () => {
    using dir = tempDir("module-graph-lifecycle-runtime-ordering", {
      "ordering.mjs": `
        export function schedule(log) {
          process.nextTick(() => log.push("graph nextTick"));
          queueMicrotask(() => log.push("graph microtask"));
          Promise.resolve().then(() => log.push("graph then"));
          setImmediate(() => log.push("graph immediate"));
        }
      `,
    });
    using graph = new ModuleGraph();
    const { schedule } = await graph.import(join(String(dir), "ordering.mjs"));
    function scheduleHost(log: string[]) {
      process.nextTick(() => log.push("host nextTick"));
      queueMicrotask(() => log.push("host microtask"));
      Promise.resolve().then(() => log.push("host then"));
      setImmediate(() => log.push("host immediate"));
    }

    const log: string[] = [];
    const done = Promise.withResolvers<void>();
    setImmediate(() => {
      scheduleHost(log);
      schedule(log);
      scheduleHost(log);
      setImmediate(() => done.resolve());
    });
    await done.promise;

    const interleaved = (phase: string) => [`host ${phase}`, `graph ${phase}`, `host ${phase}`];
    const microtasks = ["host microtask", "host then", "graph microtask", "graph then", "host microtask", "host then"];
    expect(log.filter(entry => entry.endsWith("nextTick"))).toEqual(interleaved("nextTick"));
    expect(log.filter(entry => entry.endsWith("immediate"))).toEqual(interleaved("immediate"));
    expect(log.filter(entry => entry.endsWith("microtask") || entry.endsWith("then"))).toEqual(microtasks);
    expect(log.slice(-3)).toEqual(interleaved("immediate"));
  });

  test("values made in a graph are ordinary values of the realm", async () => {
    using dir = tempDir("module-graph-lifecycle-runtime-values", {
      "values.mjs": `
        export class Point { constructor(x) { this.x = x; } }
        export const make = () => ({
          map: new Map([["key", new Set([1])]]),
          date: new Date(0),
          error: new RangeError("from the graph"),
          bytes: new Uint8Array([1, 2, 3]),
          point: new Point(1),
          now: performance.now(),
        });
        export const samePerformance = performance === globalThis.performance;
      `,
    });
    using graph = new ModuleGraph();
    const namespace = await graph.import(join(String(dir), "values.mjs"));

    const before = performance.now();
    const made = namespace.make();
    const after = performance.now();
    const cloned = structuredClone(made);
    expect({
      instances: [made.map instanceof Map, made.error instanceof RangeError, made.bytes instanceof Uint8Array],
      cloned: [
        cloned.map.get("key").has(1),
        cloned.date.getTime(),
        cloned.error.message,
        [...cloned.bytes],
        cloned.point,
      ],
      clock: before <= made.now && made.now <= after,
      samePerformance: namespace.samePerformance,
      inspected: Bun.inspect(made.point),
    }).toEqual({
      instances: [true, true, true],
      cloned: [true, 0, "from the graph", [1, 2, 3], { x: 1 }],
      clock: true,
      samePerformance: true,
      inspected: "Point {\n  x: 1,\n}",
    });
    // The namespace object itself is not cloneable, like the host's.
    expect(() => structuredClone(namespace)).toThrow(expect.objectContaining({ name: "DataCloneError" }));
  });

  test("Bun.serve() with a graph's fetch handler, fetched by another graph", async () => {
    using dir = tempDir("module-graph-lifecycle-runtime-serve", {
      "handler.mjs": `
        let requests = 0;
        export default {
          async fetch(request) {
            const body = await request.text();
            return Response.json({ tenant, requests: ++requests, body, url: new URL(request.url).pathname });
          },
        };
      `,
      "client.mjs": `
        export const call = async (url, body) => (await fetch(url, { method: "POST", body })).json();
      `,
    });
    using serverGraph = new ModuleGraph({ globals: { tenant: "server graph" } });
    using clientGraph = new ModuleGraph();
    const handler = (await serverGraph.import(join(String(dir), "handler.mjs"))).default;
    const { call } = await clientGraph.import(join(String(dir), "client.mjs"));

    await using server = Bun.serve({ port: 0, fetch: handler.fetch });
    serverGraph.dispose();
    Bun.gc(true);
    const responses = [await call(`${server.url}first`, "one"), await call(`${server.url}second`, "two")];
    expect(responses).toEqual([
      { tenant: "server graph", requests: 1, body: "one", url: "/first" },
      { tenant: "server graph", requests: 2, body: "two", url: "/second" },
    ]);
  });

  test("an error thrown by a graph's Bun.serve() handler reaches the server's error handler", async () => {
    using dir = tempDir("module-graph-lifecycle-runtime-serve-error", {
      "throwing-handler.mjs": `export const fetch = () => { throw new Error("from the handler"); };`,
    });
    const errors: string[] = [];
    using graph = new ModuleGraph({ onError: (error: Error) => errors.push(`onError: ${error.message}`) });
    const handler = await graph.import(join(String(dir), "throwing-handler.mjs"));

    await using server = Bun.serve({
      port: 0,
      fetch: handler.fetch,
      error(error) {
        errors.push(`server.error: ${error.message}`);
        return new Response("handled", { status: 500 });
      },
    });
    const response = await fetch(server.url);
    expect([response.status, await response.text()]).toEqual([500, "handled"]);
    expect(errors).toEqual(["server.error: from the handler"]);
  });

  test("EventEmitter and EventTarget across the graph boundary", async () => {
    using dir = tempDir("module-graph-lifecycle-runtime-events", {
      "events.mjs": `
        import { EventEmitter } from "node:events";
        export const emitter = new EventEmitter();
        export const listen = (target, log) => {
          target.on?.("ping", value => log.push("graph heard " + value));
          target.addEventListener?.("ping", event => log.push("graph heard " + event.type));
        };
        export const emit = (target, value) => target.emit(value, "from the graph");
        export const sameClass = [EventEmitter];
      `,
    });
    using graph = new ModuleGraph();
    const namespace = await graph.import(join(String(dir), "events.mjs"));

    const log: string[] = [];
    const hostEmitter = new EventEmitter();
    const hostTarget = new EventTarget();
    namespace.listen(hostEmitter, log);
    namespace.listen(hostTarget, log);
    namespace.emitter.on("pong", (value: string) => log.push(`host heard ${value}`));
    hostEmitter.emit("ping", "the host");
    hostTarget.dispatchEvent(new Event("ping"));
    namespace.emit(namespace.emitter, "pong");

    expect(log).toEqual(["graph heard the host", "graph heard ping", "host heard from the graph"]);
    expect(namespace.sameClass).toEqual([EventEmitter]);
  });

  test("MessageChannel and BroadcastChannel between a graph and the host", async () => {
    using dir = tempDir("module-graph-lifecycle-runtime-channels", {
      "channels.mjs": `
        export function echo(port) {
          port.onmessage = event => { port.postMessage({ echoed: event.data, tenant }); port.close(); };
        }
        export function broadcast(name, message) {
          const channel = new BroadcastChannel(name);
          channel.postMessage({ message, tenant });
          channel.close();
        }
      `,
    });
    using graph = new ModuleGraph({ globals: { tenant: "channels" } });
    const namespace = await graph.import(join(String(dir), "channels.mjs"));

    const { port1, port2 } = new MessageChannel();
    const echoed = Promise.withResolvers<unknown>();
    port1.onmessage = event => echoed.resolve(event.data);
    namespace.echo(port2);
    port1.postMessage(["to the graph"]);
    expect(await echoed.promise).toEqual({ echoed: ["to the graph"], tenant: "channels" });
    port1.close();

    const name = `module-graph-lifecycle-${crypto.randomUUID()}`;
    const receiver = new BroadcastChannel(name);
    const received = Promise.withResolvers<unknown>();
    receiver.onmessage = event => received.resolve(event.data);
    namespace.broadcast(name, "hello");
    expect(await received.promise).toEqual({ message: "hello", tenant: "channels" });
    receiver.close();
  });
});

describe("Worker threads", () => {
  const workerFiles = {
    "worker-state.mjs": `let count = 0; export const increment = () => ++count; export const read = () => [tenant, count];`,
    "worker.mjs": `
      const { ModuleGraph } = Bun.unsafe;
      const file = import.meta.dir + "/worker-state.mjs";
      self.onmessage = async ({ data: graphs }) => {
        const results = [];
        for (let i = 0; i < graphs; i++) {
          using graph = new ModuleGraph({ globals: { tenant: "worker graph " + i } });
          const state = await graph.import(file);
          for (let n = 0; n <= i; n++) state.increment();
          results.push(state.read());
          Bun.gc(true);
        }
        // The worker's own instance has no \`tenant\`.
        const own = await import(file);
        let ownRead;
        try { ownRead = own.read(); } catch (error) { ownRead = error.name; }
        postMessage({ results, ownRead });
      };
    `,
  };

  test("a worker makes its own graphs while the main thread makes some too", async () => {
    using dir = tempDir("module-graph-lifecycle-worker", workerFiles);
    const file = join(String(dir), "worker-state.mjs");

    const worker = new Worker(join(String(dir), "worker.mjs"));
    const message = Promise.withResolvers<any>();
    worker.onmessage = event => message.resolve(event.data);
    worker.onerror = event => message.reject(new Error(event.message));
    worker.postMessage(4);

    // Main-thread graphs of the same file, concurrently with the worker's.
    const mine: unknown[] = [];
    for (let i = 0; i < 4; i++) {
      using graph = new ModuleGraph({ globals: { tenant: `main graph ${i}` } });
      const state = await graph.import(file);
      state.increment();
      mine.push(state.read());
    }

    expect(await message.promise).toEqual({
      results: [
        ["worker graph 0", 1],
        ["worker graph 1", 2],
        ["worker graph 2", 3],
        ["worker graph 3", 4],
      ],
      ownRead: "ReferenceError",
    });
    expect(mine).toEqual([
      ["main graph 0", 1],
      ["main graph 1", 1],
      ["main graph 2", 1],
      ["main graph 3", 1],
    ]);
    const closed = Promise.withResolvers<void>();
    worker.addEventListener("close", () => closed.resolve());
    worker.terminate();
    await closed.promise;
  });

  test("a worker terminated while it holds graphs with imports in flight", async () => {
    using dir = tempDir("module-graph-lifecycle-worker-terminate", {
      "busy-state.mjs": `
        let ticks = 0;
        export const spin = () => { setInterval(() => ticks++, 1); };
      `,
      "busy-pending.mjs": `await new Promise(() => {}); export const unreachable = true;`,
      "busy-worker.mjs": `
        const { ModuleGraph } = Bun.unsafe;
        const graphs = [];
        for (let i = 0; i < 8; i++) {
          const graph = new ModuleGraph({ globals: { tenant: { i } }, onError() {} });
          graphs.push(graph);
          (await graph.import(import.meta.dir + "/busy-state.mjs")).spin();
          graph.import(import.meta.dir + "/busy-pending.mjs");
          if (i % 2) graph.dispose();
        }
        postMessage("holding " + graphs.length + " graphs");
      `,
    });

    const worker = new Worker(join(String(dir), "busy-worker.mjs"));
    const ready = Promise.withResolvers<string>();
    const closed = Promise.withResolvers<number>();
    worker.onmessage = event => ready.resolve(event.data);
    worker.onerror = event => ready.reject(new Error(event.message));
    worker.addEventListener("close", event => closed.resolve((event as any).code));
    expect(await ready.promise).toBe("holding 8 graphs");
    worker.terminate();
    expect(await closed.promise).toBe(0);

    // The main thread's graphs are unaffected.
    Bun.gc(true);
    using graph = new ModuleGraph();
    expect(typeof (await graph.import(join(String(dir), "busy-state.mjs"))).spin).toBe("function");
  });

  test("a worker that finishes while one of its graphs has an import in flight", async () => {
    using dir = tempDir("module-graph-lifecycle-worker-finish", {
      "finish-state.mjs": `let count = 0; export const increment = () => ++count;`,
      "finish-pending.mjs": `await new Promise(() => {}); export const unreachable = true;`,
      "finish-worker.mjs": `
        const { ModuleGraph } = Bun.unsafe;
        new ModuleGraph({ globals: { tenant: {} } }).import(import.meta.dir + "/finish-pending.mjs");
        const state = await new ModuleGraph().import(import.meta.dir + "/finish-state.mjs");
        postMessage("counted to " + state.increment());
      `,
    });

    const worker = new Worker(join(String(dir), "finish-worker.mjs"));
    const message = Promise.withResolvers<string>();
    const closed = Promise.withResolvers<number>();
    worker.onmessage = event => message.resolve(event.data);
    worker.onerror = event => message.reject(new Error(event.message));
    worker.addEventListener("close", event => closed.resolve((event as any).code));
    expect(await message.promise).toBe("counted to 1");
    expect(await closed.promise).toBe(0);
  });

  test("a graph cannot be posted or transferred to a worker", async () => {
    using dir = tempDir("module-graph-lifecycle-worker-post", { "idle-worker.mjs": `self.onmessage = () => {};` });
    const worker = new Worker(join(String(dir), "idle-worker.mjs"));
    try {
      using graph = new ModuleGraph();
      const dataCloneError = expect.objectContaining({ name: "DataCloneError" });
      expect(() => worker.postMessage(graph)).toThrow(dataCloneError);
      expect(() => worker.postMessage({ graph })).toThrow(dataCloneError);
      expect(() => worker.postMessage("graph", [graph])).toThrow();
      expect(() => new Worker(join(String(dir), "idle-worker.mjs"), { workerData: graph } as any)).toThrow(
        dataCloneError,
      );
    } finally {
      const closed = Promise.withResolvers<void>();
      worker.addEventListener("close", () => closed.resolve());
      worker.terminate();
      await closed.promise;
    }
  });

  test.concurrent("a process exits while graphs in the main thread and a worker have imports in flight", async () => {
    using dir = tempDir("module-graph-lifecycle-worker-exit", {
      "exit-pending.mjs": `started(); await new Promise(() => {});`,
      "exit-worker.mjs": `
        const started = Promise.withResolvers();
        globalThis.graph = new Bun.unsafe.ModuleGraph({ globals: { started: started.resolve } });
        graph.import(import.meta.dir + "/exit-pending.mjs");
        await started.promise;
        postMessage("pending");
        setInterval(() => {}, 1000);
      `,
      "main.mjs": `
        const started = Promise.withResolvers();
        const graph = new Bun.unsafe.ModuleGraph({ globals: { started: started.resolve } });
        graph.import(import.meta.dir + "/exit-pending.mjs");
        await started.promise;
        const worker = new Worker(import.meta.dir + "/exit-worker.mjs");
        worker.onmessage = event => {
          console.log(JSON.stringify({ worker: event.data, mainModule: graph.mainModule === import.meta.dir + "/exit-pending.mjs" }));
          process.exit(0);
        };
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ worker: "pending", mainModule: true });
    expect(exitCode).toBe(0);
  });
});

describe("node:vm", () => {
  test("vm code run by a graph's module sees neither its `globals` nor its module scope", async () => {
    using dir = tempDir("module-graph-lifecycle-vm-run", {
      "vm-user.mjs": `
        import vm from "node:vm";
        const secret = "module scope";
        export const results = {
          own: [typeof tenant, typeof secret],
          thisContext: vm.runInThisContext("[typeof tenant, typeof secret, typeof Bun]"),
          newContext: vm.runInNewContext("[typeof tenant, typeof secret, typeof Bun, passed]", { passed: tenant }),
          script: new vm.Script("[typeof tenant, typeof secret, value * 2]").runInContext(vm.createContext({ value: 21 })),
          compiled: vm.compileFunction("return [typeof tenant, typeof secret, argument]", ["argument"])(tenant),
          viaFunction: new Function("return [typeof tenant, typeof secret]")(),
          viaIndirectEval: (0, eval)("[typeof tenant, typeof secret]"),
          viaDirectEval: eval("[typeof tenant, typeof secret]"),
        };
      `,
    });
    using graph = new ModuleGraph({ globals: { tenant: "vm tenant" } });
    const { results } = await graph.import(join(String(dir), "vm-user.mjs"));
    expect(results).toEqual({
      own: ["string", "string"],
      thisContext: ["undefined", "undefined", "object"],
      newContext: ["undefined", "undefined", "undefined", "vm tenant"],
      script: ["undefined", "undefined", 42],
      compiled: ["undefined", "undefined", "vm tenant"],
      viaFunction: ["undefined", "undefined"],
      viaIndirectEval: ["undefined", "undefined"],
      viaDirectEval: ["string", "string"],
    });
  });

  test("vm.SourceTextModule and vm.SyntheticModule made by a graph's module", async () => {
    using dir = tempDir("module-graph-lifecycle-vm-modules", {
      "vm-modules.mjs": `
        import vm from "node:vm";
        export async function run() {
          // The callback is the graph's code; the module source is not.
          const synthetic = new vm.SyntheticModule(["seen"], function () { this.setExport("seen", typeof tenant); });
          const module = new vm.SourceTextModule(
            'import { seen } from "synthetic"; export default [seen, typeof tenant]; export const load = () => import("anything");',
            { importModuleDynamically: () => synthetic },
          );
          await module.link(() => synthetic);
          await module.evaluate();
          return [module.namespace.default, (await module.namespace.load()).seen];
        }
      `,
    });
    using graph = new ModuleGraph({ globals: { tenant: "vm modules" } });
    const { run } = await graph.import(join(String(dir), "vm-modules.mjs"));
    expect(await run()).toEqual([["string", "undefined"], "string"]);
  });

  test("import() from code a graph's module compiles at run time", async () => {
    using dir = tempDir("module-graph-lifecycle-vm-import", {
      "vm-importer.mjs": `
        import vm from "node:vm";
        const target = import.meta.dir + "/vm-target.mjs";
        export const own = () => import("./vm-target.mjs");
        export const viaDirectEval = () => eval("import(target)");
        export const viaIndirectEval = () => (0, eval)("target => import(target)")(target);
        export const viaFunction = () => new Function("target", "return import(target)")(target);
        const source = "import(" + JSON.stringify(target) + ")";
        export const viaScript = options => new vm.Script(source, options).runInThisContext();
        export const viaScriptInContext = options => new vm.Script(source, options).runInContext(vm.createContext({}));
        export const useMainContextDefaultLoader = vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER;
      `,
      "vm-target.mjs": `export const state = {};`,
    });
    using graph = new ModuleGraph();
    const importer = await graph.import(join(String(dir), "vm-importer.mjs"));
    const inGraph = await importer.own();
    const inHost = await import(join(String(dir), "vm-target.mjs"));
    const owner = (namespace: unknown) => (namespace === inGraph ? "graph" : namespace === inHost ? "host" : namespace);

    const callbackCalls: unknown[] = [];
    const importModuleDynamically = (specifier: string, script: unknown, attributes: unknown) => {
      callbackCalls.push([specifier, script instanceof vm.Script, attributes]);
      return inGraph;
    };
    expect({
      own: owner(inGraph),
      viaDirectEval: owner(await importer.viaDirectEval()),
      viaIndirectEval: owner(await importer.viaIndirectEval()),
      viaFunction: owner(await importer.viaFunction()),
      viaScriptCallback: owner(await importer.viaScript({ importModuleDynamically })),
      viaScriptDefaultLoader: owner(
        await importer.viaScript({ importModuleDynamically: importer.useMainContextDefaultLoader }),
      ),
      viaScriptInContextDefaultLoader: owner(
        await importer.viaScriptInContext({ importModuleDynamically: importer.useMainContextDefaultLoader }),
      ),
    }).toEqual({
      own: "graph",
      viaDirectEval: "graph",
      // Code with no module of its own belongs to the host.
      viaIndirectEval: "host",
      viaFunction: "host",
      viaScriptCallback: "graph",
      viaScriptDefaultLoader: "host",
      viaScriptInContextDefaultLoader: "host",
    });
    expect(callbackCalls).toEqual([[join(String(dir), "vm-target.mjs"), true, {}]]);
    await expect(importer.viaScript()).rejects.toMatchObject({ code: "ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING" });

    // After dispose(), only import() from the graph's own modules is refused.
    graph.dispose();
    const afterDispose = await Promise.allSettled([importer.own(), importer.viaDirectEval(), importer.viaFunction()]);
    expect(afterDispose.map((result: any) => result.reason?.code ?? owner(result.value))).toEqual([
      "ERR_INVALID_STATE",
      "ERR_INVALID_STATE",
      "host",
    ]);
  });
});

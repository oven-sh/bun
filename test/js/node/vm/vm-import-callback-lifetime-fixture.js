// Scenarios for vm-script-fetcher-leak.test.ts and vm-module-graph-evaluation-bun.test.ts; prints one JSON line.
// Also runs on node --expose-gc --experimental-vm-modules --no-compilation-cache.
const vm = require("node:vm");
const { setImmediate: tick } = require("node:timers/promises");

const gc = globalThis.Bun ? () => Bun.gc(true) : globalThis.gc;

async function collect(done) {
  for (let i = 0; i < 50 && !done(); i++) {
    gc();
    await tick();
  }
}

// Collects until a closure nothing references is gone.
async function collectGarbage() {
  const control = new WeakRef(() => {});
  await collect(() => control.deref() === undefined);
}

const N = 20;
async function countAlive(build) {
  let finalized = 0;
  const registry = new FinalizationRegistry(() => finalized++);
  for (let i = 0; i < N; i++) registry.register(await build(i), undefined);
  // The most recently used context stays alive until another one is used.
  vm.runInContext("1", vm.createContext({}));
  await collect(() => finalized === N);
  return N - finalized;
}

function kindOf(referrer) {
  if (referrer instanceof vm.Script) return "Script";
  if (referrer instanceof vm.SourceTextModule) return "SourceTextModule";
  return typeof referrer;
}

// A hook and the import() outcome it leads to.
function makeHook() {
  const seen = { referrer: undefined };
  const hook = (specifier, referrer) => {
    seen.referrer = kindOf(referrer);
    throw new Error("hooked");
  };
  return { hook, seen };
}
async function outcome(seen, fn) {
  try {
    await fn();
    return { result: "resolved" };
  } catch (e) {
    return { result: e?.code ?? e?.message, referrer: seen?.referrer };
  }
}

// An initializeImportMeta callback and what it was called with.
function makeInitializeImportMeta() {
  const seen = { calls: 0, referrer: undefined };
  const initializeImportMeta = (meta, referrer) => {
    seen.calls++;
    seen.referrer = kindOf(referrer);
    meta.initialized = true;
  };
  return { initializeImportMeta, seen };
}

async function evaluated(module) {
  await module.link(() => {
    throw new Error("no dependencies");
  });
  await module.evaluate();
  return module;
}

const inContextHook = c => vm.runInContext("() => { throw new Error('no import'); }", c);

const scenarios = {
  // The callback reaches its context, and code compiled with it is left on that context.
  "leak-script": async () => ({
    alive: await countAlive(() => {
      const c = vm.createContext({});
      vm.runInContext("globalThis.f = () => 1", c, { importModuleDynamically: inContextHook(c) });
      return c;
    }),
  }),
  "leak-compileFunction": async () => ({
    alive: await countAlive(() => {
      const c = vm.createContext({});
      c.f = vm.compileFunction("return 1", [], { parsingContext: c, importModuleDynamically: inContextHook(c) });
      return c;
    }),
  }),
  "leak-module": async () => ({
    alive: await countAlive(async () => {
      const c = vm.createContext({});
      await evaluated(
        new vm.SourceTextModule("globalThis.f = () => 1", { context: c, importModuleDynamically: inContextHook(c) }),
      );
      return c;
    }),
  }),

  // Code built by the host's Function constructor outlives the Script and the context it came from.
  async "alive-hostFunction"() {
    const { hook, seen } = makeHook();
    let contextCollected = false;
    const registry = new FinalizationRegistry(() => (contextCollected = true));
    const f = (hook => {
      const c = vm.createContext({ hostFunction: Function });
      registry.register(c, undefined);
      return new vm.Script('hostFunction("return import(\\"x\\")")', { importModuleDynamically: hook }).runInContext(c);
    })(hook);
    vm.runInContext("1", vm.createContext({}));
    await collect(() => contextCollected);
    await collectGarbage();
    return { contextCollected, ...(await outcome(seen, f)) };
  },
  async "alive-compiledBeforeRun"() {
    const c = vm.createContext({});
    const { script, seen } = (() => {
      const { hook, seen } = makeHook();
      return { script: new vm.Script("globalThis.f = () => import('x')", { importModuleDynamically: hook }), seen };
    })();
    await collectGarbage();
    script.runInContext(c);
    return outcome(seen, () => vm.runInContext("f()", c));
  },
  // Only the executables root these fetchers: the Script wrapper is discarded at once.
  async "alive-runInContext"() {
    const c = vm.createContext({});
    const seen = (() => {
      const { hook, seen } = makeHook();
      vm.runInContext("globalThis.f = () => import('x')", c, { importModuleDynamically: hook });
      return seen;
    })();
    await collectGarbage();
    return outcome(seen, () => vm.runInContext("f()", c));
  },
  async "alive-compileFunction"() {
    const c = vm.createContext({});
    const seen = (() => {
      const { hook, seen } = makeHook();
      c.fn = vm.compileFunction("return import('x')", [], { parsingContext: c, importModuleDynamically: hook });
      return seen;
    })();
    await collectGarbage();
    return outcome(seen, () => vm.runInContext("fn()", c));
  },

  async "alive-module"() {
    const { f, seen } = await (async () => {
      const { hook, seen } = makeHook();
      const m = await evaluated(
        new vm.SourceTextModule("export const f = () => import('x')", { importModuleDynamically: hook }),
      );
      return { f: m.namespace.f, seen };
    })();
    await collectGarbage();
    return outcome(seen, f);
  },

  // initializeImportMeta is called before the body of its module. Until then the code of the module keeps the
  // callback, and the module that the callback gets, alive. A deferred module runs at the first read of its
  // namespace (`import defer` is not in Node v26.3.0).
  async "alive-importMetaDeferred"() {
    const { touch, seen } = await (async () => {
      const { initializeImportMeta, seen } = makeInitializeImportMeta();
      const dep = new vm.SourceTextModule("export const value = import.meta.initialized", { initializeImportMeta });
      const root = new vm.SourceTextModule('import defer * as dep from "dep"; export const touch = () => dep.value;');
      await root.link(() => dep);
      await root.evaluate();
      return { touch: root.namespace.touch, seen };
    })();
    await collectGarbage();
    return { before: seen.calls, result: touch(), ...seen };
  },
  // After the call, code of the module that is alive keeps neither the callback nor the module alive. Node keeps
  // both.
  async "freed-importMeta"() {
    let finalized = 0;
    const registry = new FinalizationRegistry(() => finalized++);
    const build = async i => {
      const initializeImportMeta = meta => void (meta.i = i);
      const m = await evaluated(
        new vm.SourceTextModule("export const f = () => import.meta.i; f();", { initializeImportMeta }),
      );
      registry.register(initializeImportMeta, undefined);
      registry.register(m, undefined);
      return m.namespace.f;
    };
    const kept = [];
    for (let i = 0; i < N; i++) kept.push(await build(i));
    await collect(() => finalized === 2 * N);
    return { alive: 2 * N - finalized, last: kept[N - 1]() };
  },

  // The evaluateCallback of a SyntheticModule runs where Evaluate() reaches the module. Until then the record of
  // the module keeps the module, and so the callback, alive. A deferred module runs at the first read of its
  // namespace (`import defer` is not in Node v26.3.0).
  async "alive-evaluateCallbackDeferred"() {
    let calls = 0;
    const touch = await (async () => {
      const dep = new vm.SyntheticModule(["value"], function () {
        calls++;
        this.setExport("value", true);
      });
      const root = new vm.SourceTextModule('import defer * as dep from "dep"; export const touch = () => dep.value;');
      await root.link(() => dep);
      await root.evaluate();
      return root.namespace.touch;
    })();
    await collectGarbage();
    return { before: calls, result: touch(), calls };
  },
  // After the call, the record of the SyntheticModule keeps neither the callback nor the module alive.
  async "freed-evaluateCallback"() {
    let finalized = 0;
    const registry = new FinalizationRegistry(() => finalized++);
    const build = async i => {
      const evaluateCallback = function () {
        this.setExport("value", i);
      };
      const dep = new vm.SyntheticModule(["value"], evaluateCallback);
      const importer = new vm.SourceTextModule('import { value } from "dep"; export const f = () => value;');
      await importer.link(() => dep);
      await importer.evaluate();
      registry.register(evaluateCallback, undefined);
      registry.register(dep, undefined);
      return importer.namespace.f;
    };
    const kept = [];
    for (let i = 0; i < N; i++) kept.push(await build(i));
    await collect(() => finalized === 2 * N);
    return { alive: 2 * N - finalized, last: kept[N - 1]() };
  },
  // Two requests with one specifier, and a linker that keeps no module: both modules run.
  async "alive-evaluateCallbackSameSpecifier"() {
    const ran = [];
    const root = new vm.SourceTextModule(
      'import one from "dep"; import two from "dep" with { type: "json" }; export const got = [one, two];',
    );
    await root.link((specifier, referrer, { attributes }) => {
      const name = attributes.type === "json" ? "two" : "one";
      return new vm.SyntheticModule(["default"], function () {
        ran.push(name);
        this.setExport("default", name);
      });
    });
    await collectGarbage();
    await root.evaluate();
    return { got: root.namespace.got, ran };
  },
  // A module keeps the modules that it was linked to alive, as the ModuleWrap of Node does. Before instantiate()
  // no code of the dependency exists that keeps its callbacks, and the module that they get, alive.
  async "alive-linkedDependency-importMeta"() {
    const { initializeImportMeta, seen } = makeInitializeImportMeta();
    const root = new vm.SourceTextModule('import { value } from "dep"; export { value };');
    (() => {
      root.linkRequests([
        new vm.SourceTextModule("export const value = import.meta.initialized", { initializeImportMeta }),
      ]);
    })();
    await collectGarbage();
    root.instantiate();
    await root.evaluate();
    return { result: root.namespace.value, ...seen };
  },
  async "alive-linkedDependency-import"() {
    const { hook, seen } = makeHook();
    const root = new vm.SourceTextModule('export { f } from "dep";');
    (() => {
      root.linkRequests([
        new vm.SourceTextModule("export const f = () => import('x')", { importModuleDynamically: hook }),
      ]);
    })();
    await collectGarbage();
    root.instantiate();
    await root.evaluate();
    return outcome(seen, root.namespace.f);
  },
  // The modules that a timeout stopped are collected like any other.
  async "freed-modulesStoppedByTimeout"() {
    return {
      alive: await countAlive(async () => {
        for (;;) {
          const context = vm.createContext({});
          let started = false;
          const s = new vm.SyntheticModule(
            [],
            () => {
              started = true;
              for (;;) {}
            },
            { context },
          );
          const a = new vm.SourceTextModule('import "s";', { context });
          await a.link(() => s);
          await a.evaluate({ timeout: 5 }).catch(() => {});
          // The timeout stopped the evaluateCallback, and not the walk before it.
          if (started) return s;
        }
      }),
    };
  },

  // One closure per Script run in a long-lived context, as a REPL does.
  async "freed-perScriptClosures"() {
    const c = vm.createContext({});
    let finalized = 0;
    const registry = new FinalizationRegistry(() => finalized++);
    function evaluate(i) {
      const hook = () => i;
      registry.register(hook, undefined);
      new vm.Script("1 + " + i, { importModuleDynamically: hook }).runInContext(c);
    }
    for (let i = 0; i < N; i++) evaluate(i);
    await collect(() => finalized === N);
    return { alive: N - finalized };
  },

  async "stringFilename"() {
    const c = vm.createContext({});
    new vm.Script("globalThis.f = () => import('x')", "file.js").runInContext(c);
    return outcome(undefined, () => vm.runInContext("f()", c));
  },
};

scenarios[process.argv[2]]().then(result => console.log(JSON.stringify(result)));

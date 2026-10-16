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

  // import.meta is created when code evaluates it for the first time. initializeImportMeta and the module it
  // gets live as long as code of the module that can still do that.
  async "alive-importMeta"() {
    const { f, seen } = await (async () => {
      const { initializeImportMeta, seen } = makeInitializeImportMeta();
      const m = await evaluated(
        new vm.SourceTextModule("export const f = () => import.meta.initialized", { initializeImportMeta }),
      );
      return { f: m.namespace.f, seen };
    })();
    await collectGarbage();
    return { before: seen.calls, result: f(), again: f(), ...seen };
  },
  async "alive-importMetaAfterAwait"() {
    let open;
    const c = vm.createContext({ gate: new Promise(resolve => (open = resolve)) });
    const { done, seen } = await (async () => {
      const { initializeImportMeta, seen } = makeInitializeImportMeta();
      const m = new vm.SourceTextModule("await gate; globalThis.result = import.meta.initialized", {
        context: c,
        initializeImportMeta,
      });
      await m.link(() => {
        throw new Error("no dependencies");
      });
      return { done: m.evaluate(), seen };
    })();
    await collectGarbage();
    const before = seen.calls;
    open();
    await done;
    return { before, result: c.result, ...seen };
  },
  // `import defer` is not in Node v26.3.0. The deferred module runs, and evaluates import.meta, at the first
  // read of its namespace.
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
  async "freed-importMeta"() {
    let finalized = 0;
    const registry = new FinalizationRegistry(() => finalized++);
    const kept = [];
    for (let i = 0; i < N; i++) {
      const initializeImportMeta = meta => void (meta.i = i);
      registry.register(initializeImportMeta, undefined);
      const m = await evaluated(
        new vm.SourceTextModule("export const f = () => import.meta.i; f();", { initializeImportMeta }),
      );
      // The code is alive, and import.meta exists: nothing calls the callback again.
      kept.push(m.namespace.f);
    }
    await collect(() => finalized === N);
    return { alive: N - finalized, last: kept[N - 1]() };
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

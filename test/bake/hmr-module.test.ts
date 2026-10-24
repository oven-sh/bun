// The HMR module loader of the dev server (src/runtime/bake/hmr-module.ts) on its own: no bundler
// and no dev server. Each case gets a fresh loader and gives it modules in the format that the
// bundler prints for the dev server. The tests in test/bake/dev run the same loader end to end.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";

type Side = "client" | "server";
type Hmr = any;
type Body = (hmr: Hmr, imports: any[]) => unknown;

const envKey = Symbol.for("bun:test:hmr-module");
const dir = tempDir("hmr-module", {
  "entry.ts": `export * from ${JSON.stringify(join(import.meta.dir, "../../src/runtime/bake/hmr-module.ts"))};`,
});
const bundles = {} as Record<Side, string>;
let instances = 0;

beforeAll(async () => {
  for (const side of ["client", "server"] as const) {
    const result = await Bun.build({
      entrypoints: [join(String(dir), "entry.ts")],
      outdir: join(String(dir), side),
      target: "bun",
      conditions: [side],
      define: { side: JSON.stringify(side), IS_ERROR_RUNTIME: "false", IS_BUN_DEVELOPMENT: "true" },
      // The names that the dev server passes to the loader as parameters.
      banner: `const { unloadedModuleRegistry, config, location, sessionStorage, DEBUG, console } = globalThis[Symbol.for("bun:test:hmr-module")];`,
    });
    bundles[side] = result.outputs[0].path;
  }
});
afterAll(() => dir[Symbol.dispose]());

/** An ES module as the bundler prints it: `[imports, exports, stars, body, hasTopLevelAwait]`. */
function esm(deps: string[], body: Body, hasTopLevelAwait = false) {
  const load = (hmr: Hmr) => {
    const imports = [...hmr.imports];
    hmr.updateImport = deps.map((_, i) => (exports: any) => void (imports[i] = exports));
    return body(hmr, imports);
  };
  return [deps.flatMap(dep => [dep, 0]), [], [], load, hasTopLevelAwait];
}

/** A CommonJS module as the bundler prints it. */
function cjs(body: (hmr: Hmr, module: { exports: any }, exports: any) => void) {
  return function (hmr: Hmr, module: { exports: any }, exports: any) {
    body(hmr, module, exports);
  };
}

/** A fresh loader for one case. `config` is what the dev server gives the runtime: `main`, and for a router `route`. */
async function loader(side: Side, config: { main?: string; route?: { page: string | null; layouts: string[] } } = {}) {
  const logs: string[] = [];
  const log = (line: string) => void logs.push(line);
  const modules: Record<string, unknown> = {};
  const env = {
    unloadedModuleRegistry: modules,
    config,
    location: { origin: "http://localhost", reload: () => log("<location.reload()>") },
    sessionStorage: { setItem: (_: string, value: string) => log("<message> " + JSON.parse(value).message) },
    DEBUG: {
      ASSERT(condition: unknown, message?: string) {
        if (!condition) throw new Error("ASSERTION FAILED" + (message ? ": " + message : ""));
      },
    },
    console: {
      ...console,
      warn: (...args: unknown[]) => log("<warn> " + String(args[0]).split("\n")[0]),
      error: (...args: any[]) => log("<error> " + (args[0]?.message ?? args[0])),
    },
  };
  (globalThis as any)[envKey] = env;
  const hmr = await import(`${bundles[side]}?${instances++}`);
  let updates = 0;
  return {
    log,
    /** The lines that were logged since the last call. */
    take: () => logs.splice(0),
    define: (definitions: Record<string, unknown>) => void Object.assign(modules, definitions),
    /** What the runtime does for the page's entry point, a route, and the framework entry. */
    load: (id: string) => hmr.loadExports(id),
    /** A hot update. A rejection is logged, as the client and the server both do with it. */
    async save(definitions: Record<string, unknown>) {
      const sourceMap = { id: "map" + updates++, url: "blob:map", refs: 1, size: 0 };
      try {
        await hmr.replaceModules(definitions, side === "client" ? sourceMap : undefined);
      } catch (error: any) {
        const nested = error instanceof AggregateError ? ": " + error.errors.map(e => e.message).join("; ") : "";
        log("<rejected> " + (error?.message ?? error) + nested);
      }
    },
    onEvent: hmr.onEvent as (event: string, cb: () => void) => void,
    /** What the client runtime does with the React Fast Refresh runtime of the page. */
    useRefreshRuntime: async (id: string) => hmr.setRefreshRuntime(await hmr.loadModuleAsync(id, false, null)),
  };
}

const leaf = (log: (line: string) => void, value: string) =>
  esm([], hmr => {
    log("leaf ran");
    hmr.exports = { leaf: value };
  });

describe("a hot update evaluates the modules between the saved module and the accepting module", () => {
  test("chain: app -> mid -> leaf", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      root: esm(["app"], () => log("root ran")),
      app: esm(["mid"], (hmr, [mid]) => {
        hmr.accept();
        log("app ran " + mid.mid);
      }),
      mid: esm(["leaf"], (hmr, [leaf]) => {
        log("mid ran");
        hmr.exports = { mid: "mid(" + leaf.leaf + ")" };
      }),
      leaf: leaf(log, "v1"),
    });
    await load("root");
    expect(take()).toEqual(["leaf ran", "mid ran", "app ran mid(v1)", "root ran"]);
    await save({ leaf: leaf(log, "v2") });
    expect(take()).toEqual(["leaf ran", "mid ran", "app ran mid(v2)"]);
    // The new `mid` takes part in the next update like the first `mid` did.
    await save({ leaf: leaf(log, "v3") });
    expect(take()).toEqual(["leaf ran", "mid ran", "app ran mid(v3)"]);
  });

  for (const hasTopLevelAwait of [false, true]) {
    const where = hasTopLevelAwait ? " in a module with top-level await" : "";
    test(`accept(cb)${where}: the callback of the body that is replaced gets the new module, which saw the new module between`, async () => {
      const { log, take, define, load, save } = await loader("client");
      let bodies = 0;
      const body: Body = (hmr, [mid]) => {
        const number = ++bodies;
        hmr.accept((next: any) => log("body " + number + " of app accepted " + next.seen));
        hmr.exports = { seen: mid.mid };
      };
      define({
        app: hasTopLevelAwait
          ? esm(
              ["mid"],
              async (hmr, imports) => {
                body(hmr, imports);
                await null;
              },
              true,
            )
          : esm(["mid"], body),
        mid: esm(["leaf"], (hmr, [leaf]) => {
          hmr.exports = { mid: "mid(" + leaf.leaf + ")" };
        }),
        leaf: leaf(log, "v1"),
      });
      await load("app");
      take();
      await save({ leaf: leaf(log, "v2") });
      await save({ leaf: leaf(log, "v3") });
      expect(take()).toEqual([
        "leaf ran",
        "body 1 of app accepted mid(v2)",
        "leaf ran",
        "body 2 of app accepted mid(v3)",
      ]);
    });
  }

  test("accept(cb): a callback that is the same function in every body is called for each save", async () => {
    const { log, take, define, load, save } = await loader("client");
    // For example a function that the module imports from a module that no save reaches.
    const render = (next: any) => log("render " + next.version);
    const app = (version: string) =>
      esm([], hmr => {
        hmr.accept(render);
        hmr.exports = { version };
      });
    define({ app: app("v1") });
    await load("app");
    await save({ app: app("v2") });
    await save({ app: app("v3") });
    expect(take()).toEqual(["render v2", "render v3"]);
  });

  test("an import is evaluated before its importer, whatever order the walk found them in", async () => {
    const { log, take, define, load, save } = await loader("client");
    const d = (value: string) => esm([], hmr => void (hmr.exports = { d: value }));
    define({
      // `b` imports `d` before `a`, so the walk up from `d` finds `b` first. `b` also imports `a`.
      app: esm(["b"], (hmr, [b]) => {
        hmr.accept();
        log("app ran " + b.b);
      }),
      b: esm(["d", "a"], (hmr, [d, a]) => {
        log("b ran");
        hmr.exports = { b: "b(" + d.d + "," + a.a + ")" };
      }),
      a: esm(["d"], (hmr, [d]) => {
        log("a ran");
        hmr.exports = { a: "a(" + d.d + ")" };
      }),
      d: d("d1"),
    });
    await load("app");
    expect(take()).toEqual(["a ran", "b ran", "app ran b(d1,a(d1))"]);
    await save({ d: d("d2") });
    expect(take()).toEqual(["a ran", "b ran", "app ran b(d2,a(d2))"]);
  });

  test("a save of the accepting module evaluates only that module", async () => {
    const { log, take, define, load, save } = await loader("client");
    const app = (version: string) =>
      esm(["mid"], (hmr, [mid]) => {
        hmr.accept();
        log("app " + version + " ran " + mid.mid);
      });
    define({
      app: app("a1"),
      mid: esm(["leaf"], (hmr, [leaf]) => {
        log("mid ran");
        hmr.exports = { mid: "mid(" + leaf.leaf + ")" };
      }),
      leaf: leaf(log, "v1"),
    });
    await load("app");
    take();
    await save({ app: app("a2") });
    expect(take()).toEqual(["app a2 ran mid(v1)"]);
  });

  test("server: the save evaluates nothing, and the next request evaluates the route and the modules below it", async () => {
    const { log, take, define, load, save } = await loader("server");
    const config = (value: string) =>
      esm([], hmr => {
        log("config ran");
        hmr.exports = { value };
      });
    define({
      route: esm(["derived"], (hmr, [derived]) => {
        log("route ran");
        const banner = "banner(" + derived.derived + ")";
        hmr.exports = { render: () => banner };
      }),
      derived: esm(["config"], (hmr, [config]) => {
        log("derived ran");
        hmr.exports = { derived: "derived(" + config.value + ")" };
      }),
      config: config("v1"),
    });
    expect((await load("route")).render()).toBe("banner(derived(v1))");
    take();
    // A server has no page that shows the update. The modules wait for the request that needs them.
    await save({ config: config("v2") });
    expect(take()).toEqual([]);
    expect((await load("route")).render()).toBe("banner(derived(v2))");
    expect(take()).toEqual(["config ran", "derived ran", "route ran"]);
  });
});

describe("dispose", () => {
  test("two saved modules under one accepting module dispose of it once", async () => {
    const { log, take, define, load, save } = await loader("client");
    const value = (name: string, version: number) =>
      esm([], hmr => {
        log(name + " ran " + version);
        hmr.exports = { value: version };
      });
    define({
      x: esm(["a", "b"], (hmr, [a, b]) => {
        hmr.accept();
        hmr.dispose(() => log("x disposed"));
        log("x ran " + a.value + b.value);
      }),
      a: value("a", 1),
      b: value("b", 1),
    });
    await load("x");
    take();
    await save({ a: value("a", 2), b: value("b", 2) });
    expect(take()).toEqual(["x disposed", "a ran 2", "b ran 2", "x ran 22"]);
  });

  test("a module between is disposed of once, before any module runs, and its listener is removed", async () => {
    const { log, take, define, load, save } = await loader("client");
    let bodies = 0;
    define({
      app: esm(["mid"], (hmr, [mid]) => {
        hmr.accept();
        log("app ran " + mid.mid);
      }),
      mid: esm(["leaf"], (hmr, [leaf]) => {
        const body = ++bodies;
        hmr.dispose(() => log("mid#" + body + " disposed"));
        hmr.on("bun:afterUpdate", () => log("afterUpdate seen by mid#" + body));
        hmr.exports = { mid: "mid(" + leaf.leaf + ")" };
      }),
      leaf: leaf(log, "v1"),
    });
    await load("app");
    take();
    await save({ leaf: leaf(log, "v2") });
    expect(take()).toEqual(["mid#1 disposed", "leaf ran", "app ran mid(v2)", "afterUpdate seen by mid#2"]);
    await save({ leaf: leaf(log, "v3") });
    expect(take()).toEqual(["mid#2 disposed", "leaf ran", "app ran mid(v3)", "afterUpdate seen by mid#3"]);
  });

  test("a module is disposed of before the modules that it imports", async () => {
    const { log, take, define, load, save } = await loader("client");
    const disposing = (name: string, deps: string[], accepts = false) =>
      esm(deps, hmr => {
        if (accepts) hmr.accept();
        hmr.dispose(() => log(name + " disposed"));
      });
    define({ app: disposing("app", ["mid"], true), mid: disposing("mid", ["leaf"]), leaf: disposing("leaf", []) });
    await load("app");
    await save({ leaf: disposing("leaf", []) });
    expect(take()).toEqual(["app disposed", "mid disposed", "leaf disposed"]);
  });

  /** A module that logs when it is disposed of. */
  const disposable = (log: (line: string) => void, name: string, deps: string[], accepts = false) =>
    esm(deps, hmr => {
      if (accepts) hmr.accept();
      hmr.dispose(() => log(name + " disposed"));
    });

  // `store` imports `config` too. The order of the two import statements in `app` does not change the order.
  for (const imports of [
    ["config", "store"],
    ["store", "config"],
  ]) {
    test(`a module that imports ${imports.join(" and then ")} is disposed of before both, and store before config`, async () => {
      const { log, take, define, load, save } = await loader("client");
      define({
        // The update does not reach `above` and `side`, so they are not disposed of.
        above: disposable(log, "above", ["app"]),
        app: disposable(log, "app", [...imports, "side"], true),
        store: disposable(log, "store", ["config"]),
        config: disposable(log, "config", []),
        side: disposable(log, "side", []),
      });
      await load("above");
      await save({ config: disposable(log, "config", []) });
      expect(take()).toEqual(["app disposed", "store disposed", "config disposed"]);
    });
  }

  for (const keys of [
    ["app", "store"],
    ["store", "app"],
  ]) {
    test(`a module that is saved with a module that it imports is disposed of first, when the update has ${keys.join(" and then ")}`, async () => {
      const { log, take, define, load, save } = await loader("client");
      const modules: Record<string, () => unknown> = {
        app: () => disposable(log, "app", ["store"], true),
        store: () => disposable(log, "store", []),
      };
      define({ app: modules.app(), store: modules.store() });
      await load("app");
      await save(Object.fromEntries(keys.map(key => [key, modules[key]()])));
      expect(take()).toEqual(["app disposed", "store disposed"]);
    });
  }

  test("a dispose callback that requires a module that the update reaches gets the copy that is disposed of", async () => {
    const { log, take, define, load, save } = await loader("client");
    const leaf = (version: string) =>
      esm([], hmr => {
        log("leaf " + version + " ran");
        hmr.dispose(() => log("leaf " + version + " is disposed of"));
        hmr.exports = { leaf: version };
      });
    define({
      app: esm(["leaf"], hmr => {
        hmr.accept();
        // For example a last write through the module that `app` imports.
        hmr.dispose(() => log("app is disposed of, and requires leaf " + hmr.require("leaf").leaf));
      }),
      leaf: leaf("v1"),
    });
    await load("app");
    await save({ leaf: leaf("v2") });
    // The callback did not evaluate the new copy, so that copy was not disposed of with the old one.
    await save({ leaf: leaf("v3") });
    expect(take()).toEqual([
      "leaf v1 ran",
      "app is disposed of, and requires leaf v1",
      "leaf v1 is disposed of",
      "leaf v2 ran",
      "app is disposed of, and requires leaf v2",
      "leaf v2 is disposed of",
      "leaf v3 ran",
    ]);
  });

  // As before this loader re-ran the modules between: the page reloads for the error, so nothing else runs in it.
  // A dispose callback fails with a throw, or with a promise that rejects.
  const failing = (message: string, how: string) =>
    how === "throws"
      ? () => {
          throw new Error(message);
        }
      : () => Promise.reject(new Error(message));

  describe.each(["throws", "returns a promise that rejects"])("a dispose callback that %s", how => {
    test("client: ends the update before any module runs", async () => {
      const { log, take, define, load, save, onEvent } = await loader("client");
      define({
        app: esm(["leaf"], hmr => {
          hmr.accept();
          hmr.dispose(failing("dispose failed", how));
          log("app ran");
        }),
        leaf: leaf(log, "v1"),
      });
      onEvent("bun:afterUpdate", () => log("<afterUpdate>"));
      await load("app");
      take();
      await save({ leaf: leaf(log, "v2") });
      expect(take()).toEqual(["<rejected> dispose failed"]);
    });

    test("server: does not stop the update, and every error is thrown", async () => {
      const { take, define, load, save } = await loader("server");
      const config = (value: string) => esm([], hmr => void (hmr.exports = { value }));
      const throwing = (name: string, dep: string) =>
        esm([dep], (hmr, [imported]) => {
          const made = name + "(" + (imported.value ?? imported.made) + ")";
          hmr.dispose(failing("dispose of " + made + " failed", how));
          hmr.exports = { made, render: () => made };
        });
      define({ route: throwing("route", "mid"), mid: throwing("mid", "config"), config: config("v1") });
      expect((await load("route")).render()).toBe("route(mid(v1))");
      await save({ config: config("v2") });
      expect(take()).toEqual([
        "<rejected> Errors in a hot update: dispose of route(mid(v1)) failed; dispose of mid(v1) failed",
      ]);
      expect((await load("route")).render()).toBe("route(mid(v2))");
      await save({ config: config("v3") });
      expect((await load("route")).render()).toBe("route(mid(v3))");
    });
  });

  test("a module that requires a module is disposed of before that module", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      // `app` has an import statement for `config`, and a require() call for `store`. `store` imports `config`.
      app: esm(["config"], hmr => {
        hmr.accept();
        hmr.require("store");
        hmr.dispose(() => log("app disposed"));
      }),
      store: disposable(log, "store", ["config"]),
      config: disposable(log, "config", []),
    });
    await load("app");
    await save({ config: disposable(log, "config", []) });
    expect(take()).toEqual(["app disposed", "store disposed", "config disposed"]);
  });

  test("a module that awaits an import() of a module is disposed of before that module", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      app: esm(
        ["config"],
        async hmr => {
          hmr.accept();
          await hmr.dynamicImport("store");
          hmr.dispose(() => log("app disposed"));
        },
        true,
      ),
      store: disposable(log, "store", ["config"]),
      config: disposable(log, "config", []),
    });
    await load("app");
    await save({ config: disposable(log, "config", []) });
    expect(take()).toEqual(["app disposed", "store disposed", "config disposed"]);
  });
});

describe("the walk from the saved module", () => {
  test("modules beside the path and above the accepting module do not run again", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      root: esm(["app"], () => log("root ran")),
      app: esm(["m1", "side"], (hmr, [m1, side]) => {
        hmr.accept();
        log("app ran " + m1.m1 + " " + side.side);
      }),
      m1: esm(["m2"], (hmr, [m2]) => {
        log("m1 ran");
        hmr.exports = { m1: "m1(" + m2.m2 + ")" };
      }),
      m2: esm(["leaf"], (hmr, [leaf]) => {
        log("m2 ran");
        hmr.exports = { m2: "m2(" + leaf.leaf + ")" };
      }),
      side: esm([], hmr => {
        log("side ran");
        hmr.exports = { side: "side" };
      }),
      leaf: leaf(log, "v1"),
    });
    await load("root");
    take();
    await save({ leaf: leaf(log, "v2") });
    expect(take()).toEqual(["leaf ran", "m2 ran", "m1 ran", "app ran m1(m2(v2)) side"]);
  });

  test("a module between two accepting modules runs once", async () => {
    const { log, take, define, load, save } = await loader("client");
    const accepting = (name: string) =>
      esm(["util"], (hmr, [util]) => {
        hmr.accept();
        log(name + " ran " + util.util);
      });
    define({
      root: esm(["A", "B"], () => log("root ran")),
      A: accepting("A"),
      B: accepting("B"),
      util: esm(["leaf"], (hmr, [leaf]) => {
        log("util ran");
        hmr.exports = { util: "util(" + leaf.leaf + ")" };
      }),
      leaf: leaf(log, "v1"),
    });
    await load("root");
    take();
    await save({ leaf: leaf(log, "v2") });
    expect(take()).toEqual(["leaf ran", "util ran", "A ran util(v2)", "B ran util(v2)"]);
  });

  test("a module that was never loaded is not evaluated", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      app: esm([], hmr => {
        hmr.accept();
        log("app ran");
      }),
      other: esm(["leaf"], () => log("other ran")),
      leaf: leaf(log, "v1"),
    });
    await load("app");
    take();
    await save({ leaf: leaf(log, "v2") });
    expect(take()).toEqual([]);
  });

  test("an update that nothing accepts only reloads the page", async () => {
    const { log, take, define, load, save, onEvent } = await loader("client");
    define({
      root: esm(["side", "mid"], () => log("root ran")),
      side: esm(["leaf"], hmr => {
        hmr.accept();
        hmr.dispose(() => log("side disposed"));
        log("side ran");
      }),
      mid: esm(["leaf"], () => log("mid ran")),
      leaf: leaf(log, "v1"),
    });
    onEvent("bun:beforeFullReload", () => log("<beforeFullReload>"));
    onEvent("bun:afterUpdate", () => log("<afterUpdate>"));
    await load("root");
    take();
    await save({ leaf: leaf(log, "v2") });
    expect(take()).toEqual([
      "<message> [Bun] Hot update was not accepted because it or its importers do not call `import.meta.hot.accept`. To prevent full page reloads, call `import.meta.hot.accept` in one of the following files to handle the update:\n\n" +
        'Module "leaf" is not accepted by mid,\n└ imported by "root", a root module that does not self-accept.',
      "<beforeFullReload>",
      "<location.reload()>",
    ]);
  });

  test("the message for a saved module that the entry point imports", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({ root: esm(["leaf"], () => log("root ran")), leaf: leaf(log, "v1") });
    await load("root");
    take();
    await save({ leaf: leaf(log, "v2") });
    expect(take()[0]).toEndWith('\n\nModule "leaf" is not accepted by root, a root module that does not self-accept.');
    await save({ root: esm(["leaf"], () => log("root ran")) });
    expect(take()[0]).toEndWith('\n\nModule "root" is a root module that does not self-accept.');
  });
});

describe("import.meta.hot.accept of a dependency", () => {
  const value = (log: (line: string) => void, name: string, version: string) =>
    esm([], hmr => {
      log(name + " ran " + version);
      hmr.exports = { [name]: version };
    });

  test("takes a save of the dependency itself", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      root: esm(["b"], () => log("root ran")),
      b: esm(["d"], hmr => {
        log("b ran");
        hmr.acceptSpecifiers("d", (next: any) => log("b accepted " + next.d));
      }),
      d: value(log, "d", "d1"),
    });
    await load("root");
    take();
    await save({ d: value(log, "d", "d2") });
    expect(take()).toEqual(["d ran d2", "b accepted d2"]);
  });

  test("takes a save that reaches the dependency through its imports", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      root: esm(["a"], () => log("root ran")),
      a: esm(["b"], (hmr, imports) => {
        log("a ran");
        // `imports[0]` is the live binding of `b`, which the loader patches before the callback.
        hmr.acceptSpecifiers("b", (next: any) => log("a accepted " + next.b + ", imports " + imports[0].b));
      }),
      b: esm(["c"], (hmr, [c]) => {
        log("b ran");
        hmr.exports = { b: "b(" + c.c + ")" };
      }),
      c: value(log, "c", "c1"),
    });
    await load("root");
    take();
    await save({ c: value(log, "c", "c2") });
    expect(take()).toEqual(["c ran c2", "b ran", "a accepted b(c2), imports b(c2)"]);
    await save({ c: value(log, "c", "c3") });
    expect(take()).toEqual(["c ran c3", "b ran", "a accepted b(c3), imports b(c3)"]);
  });

  test("does not take a save that also reaches the importer through an import that it does not accept", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      root: esm(["index"], () => log("root ran")),
      index: esm(["d", "a"], hmr => {
        log("index ran");
        hmr.acceptSpecifiers("d", (next: any) => log("index accepted " + next.d));
      }),
      a: esm(["d"], (hmr, [d]) => {
        log("a ran");
        hmr.exports = { a: "a(" + d.d + ")" };
      }),
      d: value(log, "d", "d1"),
    });
    await load("root");
    take();
    await save({ d: value(log, "d", "d2") });
    // The message, then the reload. Nothing is evaluated and no callback runs.
    expect(take().map(line => line.split(" ")[0])).toEqual(["<message>", "<location.reload()>"]);
  });

  for (const saves of [1, 2]) {
    const title =
      saves === 1
        ? "server: a save that also reaches the importer through an import that it does not accept evaluates nothing until the next request"
        : "server: two saves that also reach the importer through an import that it does not accept evaluate nothing until the next request";
    test(title, async () => {
      const { log, take, define, load, save } = await loader("server");
      const between = (name: string) =>
        esm(["shared"], (hmr, [shared]) => {
          log(name + " ran");
          hmr.exports = { [name]: name + "(" + shared.shared + ")" };
        });
      define({
        route: esm(["d", "e"], (hmr, [d, e]) => {
          log("route ran");
          hmr.acceptSpecifiers("d", () => log("route accepted d"));
          hmr.exports = { render: () => d.d + " " + e.e };
        }),
        d: between("d"),
        e: between("e"),
        shared: value(log, "shared", "s1"),
      });
      await load("route");
      take();
      // `route` is evaluated again for `e`, so its callback for `d` does not count, and `d` waits for the request too.
      for (let i = 2; i < 2 + saves; i++) await save({ shared: value(log, "shared", "s" + i) });
      expect(take()).toEqual([]);
      const last = "s" + (1 + saves);
      expect((await load("route")).render()).toBe(`d(${last}) e(${last})`);
      expect(take()).toEqual(["shared ran " + last, "d ran", "e ran", "route ran"]);
    });
  }

  test("is called once for each accepted module that is replaced, one module for each call", async () => {
    const { log, take, define, load, save } = await loader("client");
    const accepting = (name: string, deps: string[]) =>
      esm(deps, hmr => {
        hmr.acceptSpecifiers(["d", "a"], (next: any[]) => log(name + " accepted " + next[0]?.d + " " + next[1]?.a));
      });
    const a = (prefix: string) => esm(["d"], (hmr, [d]) => void (hmr.exports = { a: prefix + "(" + d.d + ")" }));
    define({
      root: esm(["index"], () => log("root ran")),
      // Each of `index` and `other` reaches `d` by two paths.
      index: accepting("index", ["d", "a", "other"]),
      other: accepting("other", ["d", "a"]),
      a: a("a"),
      d: value(log, "d", "d1"),
    });
    await load("root");
    take();
    await save({ d: value(log, "d", "d2") });
    expect(take()).toEqual([
      "d ran d2",
      "index accepted d2 undefined",
      "index accepted undefined a(d2)",
      "other accepted d2 undefined",
      "other accepted undefined a(d2)",
    ]);
    await save({ a: a("A") });
    expect(take()).toEqual(["index accepted undefined A(d2)", "other accepted undefined A(d2)"]);
  });

  test("is not called for an importer that the same update evaluates again", async () => {
    const { log, take, define, load, save } = await loader("client");
    let bodies = 0;
    define({
      index: esm(["mid"], hmr => hmr.accept()),
      mid: esm(["d", "e"], (hmr, [d, e]) => {
        const number = ++bodies;
        log("body " + number + " of mid ran " + d.d + " " + e.e);
        hmr.acceptSpecifiers("d", (next: any) => log("body " + number + " of mid accepted " + next.d));
      }),
      d: value(log, "d", "d1"),
      e: value(log, "e", "e1"),
    });
    await load("index");
    take();
    // `mid` accepts `d`, and not `e`. The save of `e` evaluates `mid` again, so its first body gets no call.
    await save({ d: value(log, "d", "d2"), e: value(log, "e", "e2") });
    expect(take()).toEqual(["d ran d2", "e ran e2", "body 2 of mid ran d2 e2"]);
    await save({ d: value(log, "d", "d3") });
    expect(take()).toEqual(["d ran d3", "body 2 of mid accepted d3"]);
  });

  for (const how of ["an import statement", "require()"] as const) {
    test(`a module between that runs again through ${how} loses the registration of its old body`, async () => {
      const { log, take, define, load, save } = await loader("client");
      let bodies = 0;
      define({
        app:
          how === "require()"
            ? esm([], hmr => {
                hmr.accept();
                hmr.require("mid");
              })
            : esm(["mid"], hmr => hmr.accept()),
        mid: esm(["leaf", "other"], hmr => {
          const body = ++bodies;
          log("mid#" + body + " ran");
          if (body === 1) hmr.acceptSpecifiers("other", () => log("mid#1 accepted"));
        }),
        leaf: leaf(log, "v1"),
        other: value(log, "other", "o1"),
      });
      await load("app");
      take();
      await save({ leaf: leaf(log, "v2") });
      expect(take()).toEqual(["leaf ran", "mid#2 ran"]);
      // `mid#2` does not accept `other`, so the save goes on to `app`.
      await save({ other: value(log, "other", "o2") });
      expect(take()).toEqual(["other ran o2", "mid#3 ran"]);
    });
  }
});

describe("an import made by require() or import()", () => {
  const x = (log: (line: string) => void, version: string) =>
    esm([], hmr => {
      log("x ran " + version);
      hmr.exports = { x: version };
    });

  test("a save of a lazily imported module runs the module that holds the import() again, each time", async () => {
    const { log, take, define, load, save } = await loader("client");
    let open!: () => Promise<void>;
    const lazy = (version: string) =>
      esm([], hmr => {
        log("x ran " + version);
        hmr.dispose(() => log("x " + version + " is disposed of"));
        hmr.exports = { x: version };
      });
    define({
      app: esm([], hmr => {
        hmr.accept();
        log("app ran");
        open = () => hmr.dynamicImport("x").then((next: any) => log("opened " + next.x));
      }),
      x: lazy("x1"),
    });
    await load("app");
    await open();
    expect(take()).toEqual(["app ran", "x ran x1", "opened x1"]);
    // The first save disposes of `x`. The new body of `app` has not called import() again when `x` is saved the second time.
    await save({ x: lazy("x2") });
    await save({ x: lazy("x3") });
    expect(take()).toEqual(["x x1 is disposed of", "app ran", "app ran"]);
    // The next copy of `x` runs at the next import().
    await open();
    expect(take()).toEqual(["x ran x3", "opened x3"]);
  });

  test("counts until an update replaces the code of the importer", async () => {
    const { log, take, define, load, save } = await loader("client");
    let open!: () => Promise<void>;
    const holder = (holds: boolean) =>
      esm([], hmr => {
        log("a ran");
        if (holds) open = () => hmr.dynamicImport("x").then((next: any) => log("opened " + next.x));
        hmr.exports = { a: "a" };
      });
    const requirer = (requires: boolean) =>
      esm([], hmr => {
        log("r ran" + (requires ? " " + hmr.require("x").x : ""));
        hmr.exports = {};
      });
    define({
      index: esm(["a", "r", "x"], (hmr, [, , x]) => {
        hmr.accept();
        log("index ran " + x.x);
      }),
      a: holder(true),
      r: requirer(true),
      x: x(log, "x1"),
    });
    await load("index");
    await open();
    take();
    await save({ x: x(log, "x2") });
    expect(take()).toEqual(["a ran", "x ran x2", "r ran x2", "index ran x2"]);
    // The new code of `a` and of `r` does not import `x`.
    await save({ a: holder(false), r: requirer(false) });
    expect(take()).toEqual(["a ran", "r ran", "index ran x2"]);
    await save({ x: x(log, "x3") });
    expect(take()).toEqual(["x ran x3", "index ran x3"]);
  });

  test("accept of a lazily imported dependency is called after the importer ran again for another module", async () => {
    const { log, take, define, load, save } = await loader("client");
    let open!: () => Promise<void>;
    const util = (version: string) => esm([], hmr => void (hmr.exports = { util: version }));
    define({
      app: esm(["mid"], hmr => hmr.accept()),
      mid: esm(["util"], (hmr, [util]) => {
        log("mid ran " + util.util);
        open = () => hmr.dynamicImport("x").then(() => {});
        hmr.acceptSpecifiers("x", (next: any) => log("mid accepted " + next.x));
      }),
      util: util("u1"),
      x: x(log, "x1"),
    });
    await load("app");
    await open();
    take();
    await save({ util: util("u2") });
    expect(take()).toEqual(["mid ran u2"]);
    await save({ x: x(log, "x2") });
    expect(take()).toEqual(["x ran x2", "mid accepted x2"]);
  });

  test("a saved module that no module imports any more waits for its next import", async () => {
    const { log, take, define, load, save, onEvent } = await loader("client");
    const mid = (imports: boolean) =>
      esm(imports ? ["leaf"] : [], hmr => {
        hmr.accept();
        log("mid ran");
      });
    define({ app: esm(["mid"], hmr => hmr.accept()), mid: mid(true), leaf: leaf(log, "v1") });
    onEvent("bun:afterUpdate", () => log("<afterUpdate>"));
    await load("app");
    take();
    await save({ mid: mid(false) });
    expect(take()).toEqual(["mid ran", "<afterUpdate>"]);
    await save({ leaf: leaf(log, "v2") });
    expect(take()).toEqual(["<afterUpdate>"]);
  });
});

describe("import.meta.hot.data", () => {
  test("a body that uses it takes its own updates", async () => {
    const { log, take, define, load, save } = await loader("client");
    const root = (version: string, assign: boolean) =>
      esm([], hmr => {
        if (assign) hmr.data = { count: (hmr.data.count ?? 0) + 1 };
        else hmr.data.count = (hmr.data.count ?? 0) + 1;
        log("root " + version + " ran count=" + hmr.data.count);
      });
    define({ root: root("v1", false) });
    await load("root");
    await save({ root: root("v2", false) });
    await save({ root: root("v3", true) });
    await save({ root: root("v4", true) });
    expect(take()).toEqual([
      "root v1 ran count=1",
      "root v2 ran count=2",
      "root v3 ran count=3",
      "root v4 ran count=4",
    ]);
  });

  test("a body that only assigns to it takes its own updates too", async () => {
    const { log, take, define, load, save } = await loader("client");
    const root = (version: string) =>
      esm([], hmr => {
        hmr.data = { version };
        log("root " + version + " ran");
      });
    define({ root: root("v1") });
    await load("root");
    await save({ root: root("v2") });
    expect(take()).toEqual(["root v1 ran", "root v2 ran"]);
  });

  test.each(["a read", "an assignment"])(
    "%s from a function that runs later does not change what a save does",
    async use => {
      const { log, take, define, load, save } = await loader("client");
      let touch!: () => void;
      define({
        root: esm(["state"], () => log("root ran")),
        state: esm(["leaf"], hmr => {
          log("state ran");
          touch = () => void (use === "a read" ? hmr.data.touched : (hmr.data = { touched: true }));
        }),
        leaf: leaf(log, "v1"),
      });
      await load("root");
      take();
      await save({ leaf: leaf(log, "v2") });
      const before = take().map(line => line.split(" ")[0]);
      touch();
      await save({ leaf: leaf(log, "v3") });
      expect({ before, after: take().map(line => line.split(" ")[0]) }).toEqual({
        before: ["<message>", "<location.reload()>"],
        after: ["<message>", "<location.reload()>"],
      });
    },
  );

  test("a dispose callback that writes to it does not make a module between accept the next save", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      app: esm(["mid"], (hmr, [mid]) => {
        hmr.accept();
        log("app ran " + mid.mid);
      }),
      mid: esm(["leaf"], (hmr, [leaf]) => {
        hmr.dispose((data: any) => void (data.saved = true));
        hmr.exports = { mid: "mid(" + leaf.leaf + ")" };
      }),
      leaf: leaf(log, "v1"),
    });
    await load("app");
    take();
    await save({ leaf: leaf(log, "v2") });
    await save({ leaf: leaf(log, "v3") });
    expect(take()).toEqual(["leaf ran", "app ran mid(v2)", "leaf ran", "app ran mid(v3)"]);
  });
});

describe("a module that is loaded from outside the module graph", () => {
  test("client: the entry point in an import cycle that nothing accepts reloads the page", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      main: esm(["component"], () => log("main ran")),
      // `component` imports `main` back, for example for a store that `main` exports.
      component: esm(["leaf", "main"], () => log("component ran")),
      leaf: leaf(log, "v1"),
    });
    await load("main");
    take();
    await save({ leaf: leaf(log, "v2") });
    expect(take().map(line => line.split(" ")[0])).toEqual(["<message>", "<location.reload()>"]);
  });

  test("client: a save that comes while the entry point waits on top-level await reloads the page", async () => {
    const { log, take, define, load, save } = await loader("client");
    const { promise: gate, resolve: open } = Promise.withResolvers<void>();
    define({
      entry: esm(
        ["leaf"],
        async () => {
          await gate;
          log("entry ran");
        },
        true,
      ),
      leaf: leaf(log, "v1"),
    });
    const loading = load("entry");
    await save({ leaf: leaf(log, "v2") });
    open();
    await loading;
    expect(take().map(line => line.split(" ")[0])).toEqual(["leaf", "<message>", "<location.reload()>", "entry"]);
  });

  // The body of the page's entry point starts the page, so only a page reload runs it again.
  test.each(["imports it back", "imports it back and accepts it with accept(dep)"])(
    "client: a save that reaches the entry point reloads the page, also when a module that accepts %s",
    async how => {
      const { log, take, define, load, save } = await loader("client", { main: "entry" });
      const utils = (version: string) => esm([], hmr => void (hmr.exports = { utils: version }));
      define({
        entry: esm(["utils", "app"], hmr => {
          log("entry mounted the page");
          hmr.exports = { client: "client" };
        }),
        // With accept(dep), `app` also imports `utils`: the update evaluates `app` again, so that accept does not count.
        app: esm(how === "imports it back" ? ["entry"] : ["entry", "utils"], hmr => {
          hmr.accept();
          if (how !== "imports it back") hmr.acceptSpecifiers("entry", () => log("app accepted entry"));
        }),
        utils: utils("v1"),
      });
      await load("entry");
      await save({ utils: utils("v2") });
      expect(take()).toEqual([
        "entry mounted the page",
        expect.stringMatching(
          /\n\nModule "utils" is not accepted by entry, a root module that does not self-accept\.$/,
        ),
        "<location.reload()>",
      ]);
    },
  );

  test("client: the entry point that a module accepts with accept(dep) runs again for that module", async () => {
    const { log, take, define, load, save } = await loader("client", { main: "entry" });
    const entry = (version: string) =>
      esm(["shell"], hmr => {
        log("entry " + version + " ran");
        hmr.exports = { version };
      });
    define({
      entry: entry("v1"),
      shell: esm(["entry"], hmr => hmr.acceptSpecifiers("entry", (next: any) => log("shell accepted " + next.version))),
    });
    await load("entry");
    await save({ entry: entry("v2") });
    expect(take()).toEqual(["entry v1 ran", "entry v2 ran", "shell accepted v2"]);
  });

  test("client: an accept(dep) of a module in an import cycle with the entry point does not count when that module is saved", async () => {
    const { log, take, define, load, save } = await loader("client");
    const app = (version: string) =>
      esm(["entry"], hmr => {
        log("app " + version + " ran");
        hmr.acceptSpecifiers("entry", () => log("app " + version + " accepted entry"));
      });
    define({ entry: esm(["app"], () => log("entry ran")), app: app("v1") });
    await load("entry");
    take();
    await save({ app: app("v2") });
    expect(take().map(line => line.split(" ")[0])).toEqual(["<message>", "<location.reload()>"]);
  });

  // A page or a layout of a route only has exports. It runs again like a module between.
  test("client: a page that an accepting module imports runs again under that module", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      entry: esm(["page"], hmr => {
        hmr.accept();
        log("entry ran");
      }),
      page: esm(["leaf"], () => log("page ran")),
      leaf: leaf(log, "v1"),
    });
    await load("entry");
    await load("page");
    take();
    await save({ leaf: leaf(log, "v2") });
    expect(take()).toEqual(["leaf ran", "page ran", "entry ran"]);
  });

  test("client: a layout of a route that a page imports, and that is not a Fast Refresh boundary, runs again under the page", async () => {
    const { log, take, define, load, save, useRefreshRuntime } = await loader("client", {
      main: "client",
      route: { page: "page", layouts: ["layout"] },
    });
    const layout = (version: string) =>
      esm([], hmr => {
        log("layout " + version + " ran");
        hmr.exports = { default: function Layout() {}, useTheme() {} };
        hmr.reactRefreshAccept();
      });
    define({
      runtime: cjs((hmr, module) => {
        module.exports = {
          isLikelyComponentType: (type: any) => typeof type === "function" && /^[A-Z]/.test(type.name),
          performReactRefresh: () => log("<performReactRefresh>"),
        };
      }),
      // As the client entry of `bun bake` does: it loads the page and the layouts of the route, then mounts them.
      client: esm(
        ["bun:bake/client"],
        async (hmr, [{ route }]) => {
          await Promise.all([route.page(), route.layouts()]);
          log("client mounted the page");
        },
        true,
      ),
      layout: layout("v1"),
      page: esm(["layout"], hmr => {
        log("page ran");
        hmr.exports = { default: function Page() {} };
        hmr.reactRefreshAccept();
      }),
    });
    await useRefreshRuntime("runtime");
    await load("client");
    await save({ layout: layout("v2") });
    expect(take().filter(line => !line.startsWith("<warn>"))).toEqual([
      "layout v1 ran",
      "page ran",
      "client mounted the page",
      "layout v2 ran",
      "page ran",
      "<performReactRefresh>",
    ]);
  });

  for (const how of ["import()", "require()"] as const) {
    test(`client: a page that an accepting module imports with ${how} from a function that runs later is evaluated again by the update`, async () => {
      const { log, take, define, load, save } = await loader("client");
      let prefetch!: () => unknown;
      define({
        nav: esm([], hmr => {
          hmr.accept();
          log("nav ran");
          prefetch = () => (how === "import()" ? hmr.dynamicImport("page") : hmr.require("page"));
        }),
        page: esm(["leaf"], (hmr, [leaf]) => log("page ran " + leaf.leaf)),
        leaf: leaf(log, "v1"),
      });
      await load("nav");
      await load("page");
      await prefetch();
      take();
      // The new body of `nav` does not import `page`, so the update loads `page` too. The page does not reload.
      await save({ leaf: leaf(log, "v2") });
      expect(take()).toEqual(["nav ran", "leaf ran", "page ran v2"]);
      await save({ leaf: leaf(log, "v3") });
      expect(take()).toEqual(["nav ran", "leaf ran", "page ran v3"]);
    });
  }

  test.each([
    ["the module above it takes the update", ["leaf ran", "page ran v2", "shell ran", "app ran"]],
    ["nothing above it takes the update", ["<message>", "<location.reload()>"]],
  ] as const)(
    "client: a page whose accept(dep) the update discards, because it also evaluates the importer: %s",
    async (what, lines) => {
      const { log, take, define, load, save } = await loader("client");
      define({
        app: esm(["shell"], hmr => {
          if (what === "the module above it takes the update") hmr.accept();
          log("app ran");
        }),
        // `shell` accepts `page`, and imports `leaf` too: the update evaluates `shell` again, so that accept does not count.
        shell: esm(["page", "leaf"], hmr => {
          log("shell ran");
          hmr.acceptSpecifiers("page", (next: any) => log("shell accepted " + next.page));
        }),
        page: esm(["leaf"], (hmr, [leaf]) => {
          log("page ran " + leaf.leaf);
          hmr.exports = { page: "page(" + leaf.leaf + ")" };
        }),
        leaf: leaf(log, "v1"),
      });
      await load("app");
      await load("page");
      take();
      await save({ leaf: leaf(log, "v2") });
      expect(take().map(line => (line.startsWith("<message>") ? "<message>" : line))).toEqual([...lines]);
    },
  );

  test("client: one accept(dep) of a page that the update does not discard is enough", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      app: esm(["shell", "nav"], hmr => {
        hmr.accept();
        log("app ran");
      }),
      shell: esm(["page", "leaf"], hmr => {
        log("shell ran");
        hmr.acceptSpecifiers("page", (next: any) => log("shell accepted " + next.page));
      }),
      nav: esm(["page"], hmr => hmr.acceptSpecifiers("page", (next: any) => log("nav accepted " + next.page))),
      page: esm(["leaf"], (hmr, [leaf]) => void (hmr.exports = { page: "page(" + leaf.leaf + ")" })),
      leaf: leaf(log, "v1"),
    });
    await load("app");
    await load("page");
    take();
    await save({ leaf: leaf(log, "v2") });
    expect(take()).toEqual(["leaf ran", "shell ran", "app ran", "nav accepted page(v2)"]);
  });

  test("client: a page that another module accepts as a dependency runs again for that module", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      shell: esm(["page"], hmr => {
        hmr.acceptSpecifiers("page", (next: any) => log("shell accepted " + next.page));
      }),
      page: esm(["leaf"], (hmr, [leaf]) => void (hmr.exports = { page: "page(" + leaf.leaf + ")" })),
      leaf: leaf(log, "v1"),
    });
    await load("shell");
    await load("page");
    take();
    await save({ leaf: leaf(log, "v2") });
    expect(take()).toEqual(["leaf ran", "shell accepted page(v2)"]);
  });

  test("server: a route in an import cycle with a module that it imports runs again", async () => {
    const { log, define, load, save } = await loader("server");
    define({
      route: esm(["component"], (hmr, [component]) => {
        const made = component.component;
        hmr.exports = { render: () => made };
      }),
      component: esm(["leaf", "route"], (hmr, [leaf]) => {
        hmr.exports = { component: "component(" + leaf.leaf + ")" };
      }),
      leaf: leaf(log, "v1"),
    });
    expect((await load("route")).render()).toBe("component(v1)");
    await save({ leaf: leaf(log, "v2") });
    expect((await load("route")).render()).toBe("component(v2)");
  });

  test("server: a route that failed is evaluated again at its next request after a save below it", async () => {
    const { log, take, define, load, save } = await loader("server");
    const shared = (value: string) => esm([], hmr => void (hmr.exports = { value }));
    define({
      bad: esm(["shared"], (hmr, [shared]) => {
        log("bad ran " + shared.value);
        if (shared.value !== "v3") throw new Error("bad route failed with " + shared.value);
        hmr.exports = { render: () => "bad " + shared.value };
      }),
      good: esm(["shared"], (hmr, [shared]) => {
        const made = "good " + shared.value;
        hmr.exports = { render: () => made };
      }),
      shared: shared("v1"),
    });
    await load("good");
    await load("bad").catch(error => log("request failed: " + error.message));
    expect(take()).toEqual(["bad ran v1", "request failed: bad route failed with v1"]);
    // No route runs at the save, so nothing is thrown.
    await save({ shared: shared("v2") });
    expect(take()).toEqual([]);
    expect((await load("good")).render()).toBe("good v2");
    await save({ shared: shared("v3") });
    expect((await load("bad")).render()).toBe("bad v3");
    expect(take()).toEqual(["bad ran v3"]);
  });
});

/** Lets every promise job that is already queued run. It does not wait for time to pass. */
async function settleJobs() {
  for (let i = 0; i < 20; i++) await null;
}

describe("an update that fails", () => {
  test("server: a module that failed passes the save that repairs it to the modules that failed with it", async () => {
    const { log, take, define, load, save } = await loader("server");
    // `dep` accepts before it throws, so the repairing save ends at `dep`. `route` got the error through require().
    const dep = (version: string, throws: boolean) =>
      esm([], hmr => {
        hmr.accept();
        if (throws) throw new Error("dep " + version + " failed");
        hmr.exports = { value: version };
      });
    define({
      route: esm([], hmr => {
        const made = "route(" + hmr.require("mid").mid + ")";
        hmr.exports = { render: () => made };
      }),
      mid: esm(["dep"], (hmr, [dep]) => void (hmr.exports = { mid: "mid(" + dep.value + ")" })),
      dep: esm([], hmr => void (hmr.exports = { value: "v1" })),
    });
    const request = () =>
      load("route").then(
        route => route.render(),
        error => "failed: " + error.message,
      );
    expect(await request()).toBe("route(mid(v1))");
    await save({ dep: dep("v2", true) });
    expect(await request()).toBe("failed: dep v2 failed");
    await save({ dep: dep("v3", false) });
    expect(await request()).toBe("route(mid(v3))");
    expect(take()).toEqual([]);
  });

  test("server: a route whose body failed is evaluated again when a module that it imports is saved", async () => {
    const { log, take, define, load, save } = await loader("server");
    const dep = (ok: boolean) =>
      esm([], hmr => {
        hmr.accept();
        hmr.exports = { ok };
      });
    const route = () =>
      esm(["dep"], (hmr, [dep]) => {
        log("route ran");
        if (!dep.ok) throw new Error("route needs dep to be ok");
        hmr.exports = { render: () => "ok" };
      });
    define({ route: route(), dep: dep(false) });
    const request = () =>
      load("route").then(
        route => route.render(),
        error => "failed: " + error.message,
      );
    expect(await request()).toBe("failed: route needs dep to be ok");
    expect(take()).toEqual(["route ran"]);
    // `dep` accepts the save itself. The route is in State.Error, so the save reaches it too,
    // and its next request evaluates it again.
    await save({ dep: dep(true) });
    expect(take()).toEqual([]);
    expect(await request()).toBe("ok");
    expect(take()).toEqual(["route ran"]);
    // The route is loaded now, and `dep` accepts: a save of `dep` does not reach the route.
    await save({ dep: dep(false) });
    expect(await request()).toBe("ok");
    expect(take()).toEqual([]);
  });

  test("server: a module that an update did not evaluate keeps its hooks for the next update", async () => {
    const { log, take, define, load, save } = await loader("server");
    const config = (version: string, throws: boolean) =>
      esm([], hmr => {
        if (throws) throw new Error("config " + version + " failed");
        hmr.exports = { value: version };
      });
    define({
      route: esm(["boundary"], (hmr, imports) => void (hmr.exports = { render: () => imports[0].boundary })),
      boundary: esm(["mid"], (hmr, [mid]) => {
        hmr.accept((next: any) => log("boundary accepted " + next.boundary));
        hmr.exports = { boundary: "boundary(" + mid.mid + ")" };
      }),
      mid: esm(["config"], (hmr, [config]) => {
        const mid = "mid(" + config.value + ")";
        hmr.dispose(() => log("disposed " + mid));
        hmr.exports = { mid };
      }),
      config: config("v1", false),
    });
    expect((await load("route")).render()).toBe("boundary(mid(v1))");
    await save({ config: config("v2", true) });
    expect(take()).toEqual(["disposed mid(v1)", "<rejected> config v2 failed"]);
    // `boundary` did not run, so the callback of its last body is still there for the repairing save.
    await save({ config: config("v3", false) });
    expect(take()).toEqual(["boundary accepted boundary(mid(v3))"]);
    expect((await load("route")).render()).toBe("boundary(mid(v3))");
  });

  test("server: an accepting module that fails does not stop the rest of the update", async () => {
    const { log, take, define, load, save, onEvent } = await loader("server");
    const shared = (version: string) => esm([], hmr => void (hmr.exports = { value: version }));
    define({
      fragile: esm(["shared"], (hmr, [shared]) => {
        hmr.accept();
        if (shared.value === "v2") throw new Error("fragile failed with v2");
        hmr.exports = { render: () => "fragile " + shared.value };
      }),
      healthy: esm(["shared", "fragile"], hmr => {
        hmr.acceptSpecifiers(["shared", "fragile"], (next: any[]) =>
          log("healthy accepted " + (next[0]?.value ?? "fragile")),
        );
        hmr.exports = { render: () => "healthy" };
      }),
      shared: shared("v1"),
    });
    onEvent("bun:afterUpdate", () => log("<afterUpdate>"));
    await load("healthy");
    await load("fragile");
    await save({ shared: shared("v2") });
    // `healthy` gets `shared`. It does not get `fragile`, which did not load.
    expect(take()).toEqual(["healthy accepted v2", "<afterUpdate>", "<rejected> fragile failed with v2"]);
  });

  // As before this loader re-ran the modules between: the page reloads for the first error.
  test("client: an error in one accepting module ends the update, and does not wait for another one", async () => {
    const { log, take, define, load, save } = await loader("client");
    const { promise: gate, resolve: open } = Promise.withResolvers<void>();
    let saves = 0;
    const d = () => esm([], hmr => void (hmr.exports = { d: ++saves }));
    define({
      root: esm(["a", "b"], () => {}),
      a: esm(["d"], hmr => {
        hmr.accept();
        if (saves > 1) throw new Error("a failed");
      }),
      b: esm(
        ["d"],
        async hmr => {
          hmr.accept();
          if (saves > 1) await gate;
          log("b ran");
        },
        true,
      ),
      d: d(),
    });
    await load("root");
    take();
    const saving = save({ d: d() });
    await settleJobs();
    expect(take()).toEqual(["<rejected> a failed"]);
    open();
    await saving;
  });
});

describe("the order of the loads", () => {
  test("two accepting modules in an import cycle with the saved module run in first-load order", async () => {
    const { log, take, define, load, save } = await loader("client");
    // `d` imports `entry` back and uses it from a function only, so the first load is valid.
    const d = (version: string) =>
      esm(["entry"], (hmr, imports) => void (hmr.exports = { d: version, entry: () => imports[0].name }));
    define({
      entry: esm(["b", "d"], (hmr, [b, d]) => {
        hmr.accept();
        hmr.exports = { name: "entry" };
        log("entry ran " + d.d + " " + b.b);
      }),
      b: esm(["d"], (hmr, [d]) => {
        hmr.accept();
        hmr.exports = { b: "b(" + d.d + ")" };
      }),
      d: d("v1"),
    });
    await load("entry");
    await save({ d: d("v2") });
    await save({ d: d("v3") });
    expect(take()).toEqual(["entry ran v1 b(v1)", "entry ran v2 b(v2)", "entry ran v3 b(v3)"]);
  });
});

describe("a body that an update replaced", () => {
  test("its accept of a dependency is not called after the module was disposed of", async () => {
    const { log, take, define, load, save } = await loader("client");
    let open!: () => Promise<unknown>;
    const part = (version: string) => esm([], hmr => void (hmr.exports = { part: version }));
    define({
      app: esm([], hmr => {
        hmr.accept();
        log("app ran");
        open = () => hmr.dynamicImport("lazy");
      }),
      lazy: esm(["store", "other"], hmr => {
        log("lazy ran");
        hmr.acceptSpecifiers("store", () => log("lazy accepted store"));
        hmr.dispose(() => log("lazy disposed"));
      }),
      store: part("s1"),
      other: part("o1"),
    });
    await load("app");
    await open();
    await save({ other: part("o2") });
    expect(take()).toEqual(["app ran", "lazy ran", "lazy disposed", "app ran"]);
    // `lazy` waits for its next import(). Its body is gone, so the save of `store` goes on to `app`.
    await save({ store: part("s2") });
    expect(take()).toEqual(["app ran"]);
    await open();
    expect(take()).toEqual(["lazy ran"]);
  });

  test("a saved module that waits for its next import() does not pass a save of a module that its old code imported", async () => {
    const { log, take, define, load, save } = await loader("client");
    let open!: () => Promise<unknown>;
    const lazy = (version: string) =>
      esm(["store"], hmr => {
        log("lazy " + version + " ran");
        hmr.acceptSpecifiers("store", () => log("lazy " + version + " accepted store"));
      });
    const store = (version: string) => esm([], hmr => void (hmr.exports = { store: version }));
    define({
      app: esm([], hmr => {
        hmr.accept();
        log("app ran");
        open = () => hmr.dynamicImport("lazy");
      }),
      lazy: lazy("v1"),
      store: store("s1"),
    });
    await load("app");
    await open();
    await save({ lazy: lazy("v2") });
    expect(take()).toEqual(["app ran", "lazy v1 ran", "app ran"]);
    // The new code of `lazy` did not run yet. The import and the accept of its old code do not count.
    await save({ store: store("s2") });
    expect(take()).toEqual([]);
    await open();
    expect(take()).toEqual(["lazy v2 ran"]);
  });

  test("server: the accept of a body that threw is not called", async () => {
    const { log, take, define, load, save } = await loader("server");
    const dep = (ok: boolean) => esm([], hmr => void (hmr.exports = { ok }));
    define({
      route: esm(["dep"], (hmr, [dep]) => {
        hmr.acceptSpecifiers("dep", () => log("route accepted dep"));
        if (!dep.ok) throw new Error("route failed");
        hmr.exports = { render: () => "ok" };
      }),
      dep: dep(false),
    });
    await load("route").catch(() => {});
    await save({ dep: dep(true) });
    expect(take()).toEqual([]);
    expect((await load("route")).render()).toBe("ok");
  });

  test("keeps the imports that it has", async () => {
    const { log, take, define, load, save } = await loader("client");
    let firstBody: (() => string) | undefined;
    define({
      app: esm(["mid"], hmr => hmr.accept()),
      mid: esm(["leaf"], (hmr, imports) => {
        // For example a timer that the first body started and did not stop in a dispose callback.
        firstBody ??= () => imports[0].leaf;
      }),
      leaf: leaf(log, "v1"),
    });
    await load("app");
    await save({ leaf: leaf(log, "v2") });
    const afterOne = firstBody!();
    await save({ leaf: leaf(log, "v3") });
    expect([afterOne, firstBody!()]).toEqual(["v1", "v1"]);
  });

  test("keeps the imports that it has when another accepting importer of the saved module loads first", async () => {
    const { log, define, load, save } = await loader("client");
    let firstBody: (() => string) | undefined;
    define({
      root: esm(["other", "app"], () => {}),
      // The update loads `other` first. That evaluates `leaf` before the new body of `mid` starts.
      other: esm(["leaf"], hmr => hmr.accept()),
      app: esm(["mid"], hmr => hmr.accept()),
      mid: esm(["leaf"], (hmr, imports) => {
        firstBody ??= () => imports[0].leaf;
      }),
      leaf: leaf(log, "v1"),
    });
    await load("root");
    await save({ leaf: leaf(log, "v2") });
    const afterOne = firstBody!();
    await save({ leaf: leaf(log, "v3") });
    expect([afterOne, firstBody!()]).toEqual(["v1", "v1"]);
  });

  test("accept(cb): its callback reads the imports that it has, which are the modules from before the save", async () => {
    const { log, take, define, load, save } = await loader("client");
    const view = (version: string) => esm([], hmr => void (hmr.exports = { view: version }));
    let bodies = 0;
    define({
      app: esm(["view"], (hmr, imports) => {
        const number = ++bodies;
        // The callback gets the new module as its argument. It reads `view` through the import of its own body.
        hmr.accept(() => log("the callback of body " + number + " reads " + imports[0].view));
      }),
      view: view("v1"),
    });
    await load("app");
    await save({ view: view("v2") });
    await save({ view: view("v3") });
    expect(take()).toEqual(["the callback of body 1 reads v1", "the callback of body 2 reads v2"]);
  });
});

describe("the loader that require() uses", () => {
  test("gives the importers of an accepting ES module its new exports", async () => {
    const { log, take, define, load, save } = await loader("client");
    let read!: () => string;
    define({
      // `c` loads first, and its body reaches `a` through require() before the update gets to `a`.
      root: esm(["c", "a", "reader"], () => {}),
      c: esm(["leaf"], hmr => {
        hmr.accept();
        hmr.require("a");
      }),
      a: esm(["leaf"], (hmr, [leaf]) => {
        hmr.accept(() => log("a accepted"));
        hmr.exports = { a: "a(" + leaf.leaf + ")" };
      }),
      reader: esm(["a"], (hmr, imports) => void (read = () => imports[0].a)),
      leaf: leaf(log, "v1"),
    });
    await load("root");
    take();
    await save({ leaf: leaf(log, "v2") });
    expect(take()).toEqual(["leaf ran", "a accepted"]);
    expect(read()).toBe("a(v2)");
  });

  test("evaluates a CommonJS module between again, and a saved CommonJS module", async () => {
    const { log, take, define, load, save } = await loader("client");
    const leafCjs = (version: string, extra: boolean) =>
      cjs((hmr, module, exports) => {
        exports.leaf = version;
        if (extra) exports.extra = true;
      });
    define({
      app: esm(["mid"], (hmr, [mid]) => {
        hmr.accept();
        log("app ran " + mid.default.mid + " " + Object.keys(hmr.require("leaf")).join(","));
      }),
      mid: cjs((hmr, module) => {
        module.exports = { mid: "mid(" + hmr.require("leaf").leaf + ")" };
      }),
      leaf: leafCjs("v1", true),
    });
    await load("app");
    await save({ leaf: leafCjs("v2", false) });
    expect(take()).toEqual(["app ran mid(v1) leaf,extra", "app ran mid(v2) leaf"]);
  });

  test("an ES module in an import cycle with a saved CommonJS module reads its new exports", async () => {
    const { log, take, define, load, save } = await loader("client");
    const c = (version: string) =>
      cjs((hmr, module, exports) => {
        exports.early = version;
        hmr.require("e");
      });
    define({
      app: esm(["c"], hmr => hmr.accept()),
      c: c("v1"),
      e: esm(["c"], (hmr, [c]) => log("e saw " + c.early)),
    });
    await load("app");
    await save({ c: c("v2") });
    expect(take()).toEqual(["e saw v1", "e saw v2"]);
  });
});

describe("top-level await in a module that an update evaluates again", () => {
  const t = (version: string, hasTopLevelAwait = true) =>
    hasTopLevelAwait
      ? esm(
          [],
          async hmr => {
            await null;
            hmr.exports = { t: version };
          },
          true,
        )
      : esm([], hmr => void (hmr.exports = { t: version }));

  test("every importer waits for the module, not only the first one", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      app: esm(["a", "b"], (hmr, [a, b]) => {
        hmr.accept();
        log("app ran " + a.a + " " + b.b);
      }),
      a: esm(["t"], (hmr, [t]) => void (hmr.exports = { a: "a(" + t.t + ")" })),
      b: esm(["t"], (hmr, [t]) => void (hmr.exports = { b: "b(" + t.t + ")" })),
      t: t("v1", false),
    });
    await load("app");
    await save({ t: t("v2") });
    await save({ t: t("v3") });
    expect(take()).toEqual(["app ran a(v1) b(v1)", "app ran a(v2) b(v2)", "app ran a(v3) b(v3)"]);
  });

  test("require() of a module that waits for it throws, and names the module that has the await", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      app: esm(["top", "reader"], hmr => hmr.accept()),
      top: esm(["mid"], (hmr, [mid]) => void (hmr.exports = { top: mid.mid })),
      mid: esm(["t"], (hmr, [t]) => void (hmr.exports = { mid: t.t })),
      reader: esm([], hmr => {
        try {
          log("reader got " + hmr.require("top").top);
        } catch (error: any) {
          log(error.message);
        }
      }),
      t: t("v1", false),
    });
    await load("app");
    await save({ t: t("v2") });
    expect(take()).toEqual([
      "reader got v1",
      `Cannot require "top" because "t" uses top-level await, but 'require' is a synchronous operation.`,
    ]);
  });

  test("a module that it imports with import() after the await, and that imports it back, does not wait for it", async () => {
    const { log, take, define, load, save } = await loader("client");
    const waiting = (version: string) =>
      esm(
        [],
        async hmr => {
          hmr.accept();
          await null;
          log("t " + version + " got " + (await hmr.dynamicImport("x")).x);
        },
        true,
      );
    const x = () => esm(["t"], hmr => void (hmr.exports = { x: "x" }));
    define({ t: waiting("v1"), x: x() });
    await load("t");
    const saving = save({ t: waiting("v2"), x: x() });
    await settleJobs();
    expect(take()).toEqual(["t v1 got x", "t v2 got x"]);
    await saving;
  });

  test("a module that has no top-level await any more can be required while it is evaluated again", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      app: esm(["t"], hmr => hmr.accept()),
      t: t("v1"),
      reader: esm([], hmr => {
        try {
          hmr.require("t");
          log("reader required t");
        } catch (error: any) {
          log(error.message);
        }
      }),
    });
    await load("app");
    await save({ t: esm(["reader"], hmr => void (hmr.exports = { t: "v2" })) });
    expect(take()).toEqual(["reader required t"]);
  });

  test("require() of a module that did not start yet throws, and the module still loads for its importer", async () => {
    const { log, take, define, load, save } = await loader("client");
    const reader = () =>
      esm([], hmr => {
        try {
          hmr.require("t");
        } catch (error: any) {
          log(error.message);
        }
      });
    define({
      app: esm(["reader", "t"], (hmr, imports) => {
        hmr.accept();
        log("app ran " + imports[1].t);
      }),
      reader: reader(),
      t: t("v1"),
    });
    const refusal = `Cannot require "t" because "t" uses top-level await, but 'require' is a synchronous operation.`;
    await load("app");
    await save({ reader: reader(), t: t("v2") });
    expect(take()).toEqual([refusal, "app ran v1", refusal, "app ran v2"]);
  });
});

describe("an evaluation that an update replaces while it waits", () => {
  const answer = (request: Promise<any>) =>
    request.then(
      route => "request got " + route.version,
      error => "request failed: " + error.message,
    );

  test("server: the old body does not run when the import that it waited for arrives", async () => {
    const { log, take, define, load, save } = await loader("server");
    const { promise: gate, resolve: open } = Promise.withResolvers<void>();
    const route = (version: string, deps: string[]) =>
      esm(deps, hmr => {
        log("route " + version + " ran");
        hmr.exports = { version };
      });
    define({
      route: route("v1", ["slow"]),
      slow: esm([], () => gate, true),
    });
    const request = answer(load("route"));
    await save({ route: route("v2", []) });
    open();
    expect([await request, ...take()]).toEqual(["request got v2", "route v2 ran"]);
  });

  test("server: a request that waits for the old body gets the module when the new body is done", async () => {
    const { log, take, define, load, save } = await loader("server");
    const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const route = (version: string, gate: Promise<void>) =>
      esm(
        [],
        async hmr => {
          await gate;
          log("route " + version + " is done");
          hmr.exports = { version };
        },
        true,
      );
    define({ route: route("v1", gates[0].promise) });
    const first = answer(load("route")).then(log);
    await save({ route: route("v2", gates[1].promise) });
    // The second request starts the new body.
    const second = answer(load("route")).then(log);
    gates[0].resolve();
    await settleJobs();
    expect(take()).toEqual(["route v1 is done"]);
    gates[1].resolve();
    await Promise.all([first, second]);
    expect(take()).toEqual(["route v2 is done", "request got v2", "request got v2"]);
  });

  test("server: the old body that fails after that does not fail the module", async () => {
    const { define, load, save } = await loader("server");
    const { promise: gate, resolve: open } = Promise.withResolvers<void>();
    define({
      route: esm(
        [],
        async () => {
          await gate;
          throw new Error("route v1 failed");
        },
        true,
      ),
    });
    const request = answer(load("route"));
    await save({ route: esm([], hmr => void (hmr.exports = { version: "v2" })) });
    open();
    expect([await request, await answer(load("route"))]).toEqual(["request got v2", "request got v2"]);
  });

  test("server: the old body that ends while a dispose callback of the update waits does not take the place of the new code", async () => {
    const { log, take, define, load, save } = await loader("server");
    const body = Promise.withResolvers<void>();
    const disposed = Promise.withResolvers<void>();
    define({
      route: esm(
        [],
        async hmr => {
          hmr.dispose(() => disposed.promise);
          await body.promise;
          hmr.exports = { version: "v1" };
        },
        true,
      ),
    });
    const request = answer(load("route"));
    const saving = save({
      route: esm([], hmr => {
        log("route v2 ran");
        hmr.exports = { version: "v2" };
      }),
    });
    await settleJobs();
    body.resolve();
    await settleJobs();
    disposed.resolve();
    await saving;
    expect([await request, ...take()]).toEqual(["request got v2", "route v2 ran"]);
  });

  test("server: an import of the old code that fails after that does not fail the module or evaluate it again", async () => {
    const { log, take, define, load, save } = await loader("server");
    const { promise: gate, resolve: open } = Promise.withResolvers<void>();
    const route = (version: string, deps: string[]) =>
      esm(deps, hmr => {
        log("route " + version + " ran");
        hmr.exports = { version };
      });
    define({
      route: route("v1", ["slow"]),
      slow: esm(
        [],
        async () => {
          await gate;
          throw new Error("slow failed");
        },
        true,
      ),
    });
    const request = answer(load("route"));
    await save({ route: route("v2", []) });
    open();
    expect([await request, await answer(load("route"))]).toEqual(["request got v2", "request got v2"]);
    expect(take()).toEqual(["route v2 ran"]);
  });
});

describe("a body with top-level await that goes on after an update replaced it", () => {
  const gatesOf = (count: number) => Array.from({ length: count }, () => Promise.withResolvers<void>());
  const answer = (request: Promise<any>) =>
    request.then(
      route => "got " + route.version,
      error => "failed: " + error.message,
    );
  const route = (log: (line: string) => void, version: string, gate: Promise<void>) =>
    esm(
      [],
      async hmr => {
        await gate;
        log("route " + version + " is done");
        hmr.exports = { version };
      },
      true,
    );
  /** The new code of a route that has no exports. The bundler prints no `hmr.exports` for it. */
  const noExports = (log: (line: string) => void, gate: Promise<void>) =>
    esm(
      [],
      async () => {
        await gate;
        log("route v2 is done");
      },
      true,
    );

  test("server: its exports do not take the place of the exports of the new body, which ended first", async () => {
    const { log, take, define, load, save } = await loader("server");
    const gates = gatesOf(2);
    define({ route: route(log, "v1", gates[0].promise) });
    const first = answer(load("route"));
    await save({ route: route(log, "v2", gates[1].promise) });
    const second = answer(load("route"));
    gates[1].resolve();
    const secondGot = await second;
    gates[0].resolve();
    const firstGot = await first;
    expect([...take(), "second " + secondGot, "first " + firstGot, "later " + (await answer(load("route")))]).toEqual([
      "route v2 is done",
      "route v1 is done",
      "second got v2",
      "first got v2",
      "later got v2",
    ]);
  });

  test("server: a route that waits above a saved module answers with the new module after its first body ended last", async () => {
    const { define, load, save } = await loader("server");
    const gates = gatesOf(2);
    let bodies = 0;
    const config = (version: string) => esm([], hmr => void (hmr.exports = { config: version }));
    define({
      route: esm(
        ["config"],
        async (hmr, [config]) => {
          const banner = "banner(" + config.config + ")";
          await gates[bodies++].promise;
          hmr.exports = { render: () => banner };
        },
        true,
      ),
      config: config("v1"),
    });
    const render = (request: Promise<any>) => request.then(route => route.render());
    const first = render(load("route"));
    await save({ config: config("v2") });
    const second = render(load("route"));
    gates[1].resolve();
    const secondGot = await second;
    gates[0].resolve();
    expect([secondGot, await first, await render(load("route"))]).toEqual(["banner(v2)", "banner(v2)", "banner(v2)"]);
  });

  test("client: its exports do not take the place of the exports of the new body, which ended first", async () => {
    const { define, load, save } = await loader("client");
    const gates = gatesOf(2);
    const slow = (version: string, gate: Promise<void>) =>
      esm(
        [],
        async hmr => {
          hmr.accept();
          await gate;
          hmr.exports = { version };
        },
        true,
      );
    define({ slow: slow("v1", gates[0].promise) });
    const first = answer(load("slow"));
    const saving = save({ slow: slow("v2", gates[1].promise) });
    await settleJobs();
    gates[1].resolve();
    await saving;
    const afterNew = await answer(load("slow"));
    gates[0].resolve();
    expect([afterNew, "first " + (await first), "later " + (await answer(load("slow")))]).toEqual([
      "got v2",
      "first got v2",
      "later got v2",
    ]);
  });

  test("server: it ends before a request starts the new body, and every request gets the new exports", async () => {
    const { log, take, define, load, save } = await loader("server");
    const gates = gatesOf(2);
    define({ route: route(log, "v1", gates[0].promise) });
    const first = answer(load("route"));
    await save({ route: route(log, "v2", gates[1].promise) });
    gates[0].resolve();
    await settleJobs();
    // The end of the first body started the new body, for the request that waits.
    expect(take()).toEqual(["route v1 is done"]);
    gates[1].resolve();
    expect(["first " + (await first), "later " + (await answer(load("route"))), ...take()]).toEqual([
      "first got v2",
      "later got v2",
      "route v2 is done",
    ]);
  });

  test.each(["before a request starts the new body", "while the new body waits"])(
    "server: it ends %s, and the new code has no exports: no request gets the exports of the old code",
    async when => {
      const { log, take, define, load, save } = await loader("server");
      const gates = gatesOf(2);
      const keys = (request: Promise<any>) => request.then(route => "keys [" + Object.keys(route) + "]");
      define({ route: route(log, "v1", gates[0].promise) });
      const first = keys(load("route"));
      await save({ route: noExports(log, gates[1].promise) });
      const second = when === "while the new body waits" ? keys(load("route")) : first;
      gates[0].resolve();
      await settleJobs();
      gates[1].resolve();
      expect([await first, await second, await keys(load("route")), ...take()]).toEqual([
        "keys []",
        "keys []",
        "keys []",
        "route v1 is done",
        "route v2 is done",
      ]);
    },
  );

  test("server: it ends after a third version is done, and every request gets the third version", async () => {
    const { log, take, define, load, save } = await loader("server");
    const gates = gatesOf(2);
    define({ route: route(log, "v1", gates[0].promise) });
    const first = answer(load("route"));
    await save({ route: route(log, "v2", gates[1].promise) });
    const second = answer(load("route"));
    gates[1].resolve();
    const answers = ["second " + (await second)];
    await save({ route: route(log, "v3", Promise.resolve()) });
    answers.push("third " + (await answer(load("route"))));
    gates[0].resolve();
    answers.push("first " + (await first), "later " + (await answer(load("route"))));
    expect([...answers, ...take()]).toEqual([
      "second got v2",
      "third got v3",
      "first got v3",
      "later got v3",
      "route v2 is done",
      "route v3 is done",
      "route v1 is done",
    ]);
  });

  // The hooks of a replaced body would land on the module that the new body owns.
  const hooks: Record<string, (hmr: Hmr, log: (line: string) => void) => void> = {
    "accept()": hmr => hmr.accept(),
    "accept(cb)": (hmr, log) => hmr.accept(() => log("the callback of the replaced body ran")),
    "accept(dep, cb)": (hmr, log) => hmr.acceptSpecifiers("dep", () => log("the callback of the replaced body ran")),
    "on()": (hmr, log) => hmr.on("bun:beforeUpdate", () => log("the handler of the replaced body ran")),
    // The last statement that the bundler prints for a module with React components.
    "reactRefreshAccept()": hmr => hmr.reactRefreshAccept(),
  };
  test.each(Object.keys(hooks))("client: %s that it calls after the new body is done does nothing", async hook => {
    const { log, take, define, load, save, useRefreshRuntime } = await loader("client");
    const { promise: gate, resolve: open } = Promise.withResolvers<void>();
    const dep = (version: string) => esm([], hmr => void (hmr.exports = { dep: version }));
    define({
      app: esm(["m"], (hmr, [m]) => {
        hmr.accept();
        log("app ran " + m.m);
      }),
      m: esm(["dep"], (hmr, [dep]) => void (hmr.exports = { m: "m0(" + dep.dep + ")" })),
      dep: dep("d1"),
      refresh: esm([], hmr => void (hmr.exports = { isLikelyComponentType: () => true, performReactRefresh() {} })),
    });
    await useRefreshRuntime("refresh");
    await load("app");
    // The first save starts a body of `m` that waits. The second save replaces that body.
    const first = save({
      m: esm(
        ["dep"],
        async (hmr, [dep]) => {
          await gate;
          hmr.exports = { m: "m1(" + dep.dep + ")" };
          hooks[hook](hmr, log);
        },
        true,
      ),
    });
    await settleJobs();
    await save({ m: esm(["dep"], (hmr, [dep]) => void (hmr.exports = { m: "m2(" + dep.dep + ")" })) });
    open();
    await first;
    take();
    // `m` does not accept and has no handler, so the save of `dep` goes on to `app`.
    await save({ dep: dep("d2") });
    expect(take()).toEqual(["app ran m2(d2)"]);
  });

  test("client: accept(cb) that it calls after the new body is done does not register, and the one of the new body does", async () => {
    const { log, take, define, load, save } = await loader("client");
    const gates = gatesOf(2);
    const app = (version: string, gate: Promise<void>) =>
      esm(
        [],
        async hmr => {
          hmr.accept();
          await gate;
          hmr.accept((next: any) => log("the callback of " + version + " got " + next.version));
          hmr.exports = { version };
        },
        true,
      );
    define({ app: app("v1", gates[0].promise) });
    const first = load("app");
    const saving = save({ app: app("v2", gates[1].promise) });
    await settleJobs();
    gates[1].resolve();
    await saving;
    gates[0].resolve();
    await first;
    await save({ app: app("v3", Promise.resolve()) });
    expect(take()).toEqual(["the callback of v2 got v3"]);
  });

  test("server: on() that it calls after the new body is done does not register, and the one of the new body does", async () => {
    const { log, take, define, load, save } = await loader("server");
    const gates = gatesOf(2);
    const route = (version: string, gate: Promise<void>) =>
      esm(
        [],
        async hmr => {
          await gate;
          hmr.on("bun:afterUpdate", () => log("the handler of " + version + " ran"));
          hmr.exports = { version };
        },
        true,
      );
    define({ route: route("v1", gates[0].promise) });
    const first = load("route");
    await save({ route: route("v2", gates[1].promise) });
    const second = load("route");
    gates[1].resolve();
    await second;
    gates[0].resolve();
    await first;
    await save({ other: esm([], () => {}) });
    expect(take()).toEqual(["the handler of v2 ran"]);
  });

  test("server: accept(cb) that it calls while the module waits for its next request does not register", async () => {
    const { log, take, define, load, save } = await loader("server");
    const gates = gatesOf(2);
    const done = Promise.resolve();
    const route = (version: string, before: Promise<void>, after: Promise<void>) =>
      esm(
        [],
        async hmr => {
          await before;
          hmr.accept((next: any) => log("the callback of " + version + " got " + next.version));
          await after;
          log("route " + version + " is done");
          hmr.exports = { version };
        },
        true,
      );
    define({ route: route("v1", gates[0].promise, gates[1].promise) });
    const first = answer(load("route"));
    await save({ route: route("v2", done, done) });
    gates[0].resolve();
    await settleJobs();
    // A server evaluates a module that accepts at the save. The first body did not make the module accept.
    await save({ route: route("v3", done, done) });
    expect(take()).toEqual([]);
    gates[1].resolve();
    expect(["first " + (await first), "later " + (await answer(load("route"))), ...take()]).toEqual([
      "first got v3",
      "later got v3",
      "route v1 is done",
      "route v3 is done",
    ]);
  });

  test.each(["a read", "an assignment"])(
    "client: %s of import.meta.hot.data that it makes while the new body waits does not make the module accept",
    async use => {
      const { log, take, define, load, save } = await loader("client");
      const gates = gatesOf(2);
      const m = (version: string, gate: Promise<void>, usesData: boolean) =>
        esm(
          [],
          async hmr => {
            await gate;
            if (usesData && use === "a read") hmr.data.from = version;
            if (usesData && use === "an assignment") hmr.data = { from: version };
            hmr.exports = { m: version };
          },
          true,
        );
      define({
        app: esm(["m"], (hmr, [m]) => {
          hmr.accept();
          log("app ran " + m.m);
        }),
        m: esm([], hmr => void (hmr.exports = { m: "v0" })),
      });
      await load("app");
      const first = save({ m: m("v1", gates[0].promise, true) });
      await settleJobs();
      const second = save({ m: m("v2", gates[1].promise, false) });
      await settleJobs();
      gates[0].resolve();
      await settleJobs();
      gates[1].resolve();
      await Promise.all([first, second]);
      expect(take()).toEqual(["app ran v0", "app ran v2"]);
      // `m` does not accept, so this save goes on to `app`. The data that the first body wrote is kept.
      await save({
        m: esm([], hmr => {
          log("m v3 has the data from " + hmr.data.from);
          hmr.exports = { m: "v3" };
        }),
      });
      expect(take()).toEqual(["m v3 has the data from v1", "app ran v3"]);
    },
  );

  // What a replaced body opens after its await has to be closed too. Its dispose callbacks run once: when it ends, or
  // before that at a save that reaches the module.
  const resource = (log: (line: string) => void, version: string, gate: Promise<void>) =>
    esm(
      [],
      async hmr => {
        await gate;
        log(version + " opens");
        hmr.dispose(() => log(version + " closes"));
        hmr.exports = { version };
      },
      true,
    );
  test.each([
    ["before a request starts the new body", ["v1 opens", "v1 closes", "v2 opens"]],
    ["while the new body waits", ["v1 opens", "v1 closes", "v2 opens"]],
    ["after the new body is done", ["v2 opens", "v1 opens", "v1 closes"]],
  ] as const)("server: a dispose callback that it registers %s runs when it ends", async (when, lines) => {
    const { log, take, define, load, save } = await loader("server");
    const gates = gatesOf(2);
    define({ route: resource(log, "v1", gates[0].promise) });
    const first = load("route");
    await save({ route: resource(log, "v2", gates[1].promise) });
    const second = when === "before a request starts the new body" ? first : load("route");
    if (when === "after the new body is done") {
      gates[1].resolve();
      await second;
    }
    gates[0].resolve();
    await settleJobs();
    gates[1].resolve();
    await Promise.all([first, second]);
    const before = take();
    // The next save runs the callback of the new body, and the callback of the replaced body not again.
    await save({ route: resource(log, "v3", Promise.resolve()) });
    expect({ before, atTheNextSave: take() }).toEqual({ before: [...lines], atTheNextSave: ["v2 closes"] });
  });

  test("server: the ones that wait for it get the new code after the promise of its dispose callback", async () => {
    const { log, take, define, load, save } = await loader("server");
    const gates = gatesOf(2);
    const route = (version: string, body: (hmr: Hmr) => Promise<void>) =>
      esm(
        [],
        async hmr => {
          await body(hmr);
          log(version + " is done");
          hmr.exports = { version };
        },
        true,
      );
    define({
      route: route("v1", async hmr => {
        await gates[0].promise;
        hmr.dispose((data: any) => gates[1].promise.then(() => void (data.closed = "v1")));
      }),
    });
    const first = answer(load("route"));
    await save({ route: route("v2", async hmr => log("v2 starts, closed: " + hmr.data.closed)) });
    gates[0].resolve();
    await settleJobs();
    const waiting = take();
    gates[1].resolve();
    expect([...waiting, await first, ...take()]).toEqual([
      "v1 is done",
      "got v2",
      "v2 starts, closed: v1",
      "v2 is done",
    ]);
  });

  test.each(["after an update replaced it and it ended", "after it ended and an update replaced it"])(
    "client: a dispose callback that it registers %s runs at the next save",
    async order => {
      const { log, take, define, load, save } = await loader("client");
      const gate = Promise.withResolvers<void>();
      let later!: () => void;
      const m = (version: string, wait: Promise<void>) =>
        esm(
          [],
          async hmr => {
            hmr.accept();
            await wait;
            if (version === "v1") later = () => hmr.dispose(() => log("the late callback of v1 ran"));
            hmr.exports = { version };
          },
          true,
        );
      define({ m: m("v1", gate.promise) });
      const first = load("m");
      if (order === "after it ended and an update replaced it") {
        gate.resolve();
        await first;
      }
      const saving = save({ m: m("v2", Promise.resolve()) });
      gate.resolve();
      await Promise.all([first, saving]);
      later();
      expect(take()).toEqual([]);
      await save({ m: m("v3", Promise.resolve()) });
      expect(take()).toEqual(["the late callback of v1 ran"]);
    },
  );

  test("server: a dispose callback that it registers runs at a save that reaches the module before it ends, and not again", async () => {
    const { log, take, define, load, save } = await loader("server");
    const gates = gatesOf(2);
    const done = Promise.resolve();
    const route = (version: string, before: Promise<void>, after: Promise<void>) =>
      esm(
        [],
        async hmr => {
          await before;
          log(version + " opens");
          hmr.dispose(() => log(version + " closes"));
          await after;
          hmr.exports = { version };
        },
        true,
      );
    define({ route: route("v1", gates[0].promise, gates[1].promise) });
    const first = answer(load("route"));
    await save({ route: route("v2", done, done) });
    gates[0].resolve();
    await settleJobs();
    // The first body has the resource and waits again. This save reaches the module before that body ends.
    await save({ route: route("v3", done, done) });
    const atTheSave = take();
    gates[1].resolve();
    const got = await first;
    await save({ route: route("v4", done, done) });
    expect({ atTheSave, got, later: take() }).toEqual({
      atTheSave: ["v1 opens", "v1 closes"],
      got: "got v3",
      later: ["v3 opens", "v3 closes"],
    });
  });

  test.each(["throws", "returns a promise that rejects"])(
    "server: a dispose callback of it that %s does not stop the other callbacks or the new code, and the error is logged",
    async how => {
      const { log, take, define, load, save } = await loader("server");
      const gate = Promise.withResolvers<void>();
      const route = (version: string, wait: Promise<void>) =>
        esm(
          [],
          async hmr => {
            await wait;
            log(version + " opens");
            if (version === "v1") {
              hmr.dispose(() => {
                if (how === "throws") throw new Error("dispose of v1 failed");
                return Promise.reject(new Error("dispose of v1 failed"));
              });
            }
            hmr.dispose(() => log(version + " closes"));
            hmr.exports = { version };
          },
          true,
        );
      define({ route: route("v1", gate.promise) });
      const first = answer(load("route"));
      await save({ route: route("v2", Promise.resolve()) });
      gate.resolve();
      expect([await first, ...take()]).toEqual([
        "got v2",
        "v1 opens",
        "v1 closes",
        "<error> dispose of v1 failed",
        "v2 opens",
      ]);
    },
  );

  test.each(["ends", "throws"])(
    "server: a port that the replaced body opens after its await is closed when that body %s, and the new body gets it",
    async how => {
      const { take, define, load, save } = await loader("server");
      let holder: string | null = null;
      const gates = gatesOf(2);
      const route = (version: string, gate: Promise<void>, throws = false) =>
        esm(
          [],
          async hmr => {
            await gate;
            if (holder) throw new Error(version + ": port in use by " + holder);
            holder = version;
            hmr.dispose(() => void (holder = null));
            if (throws) throw new Error(version + " failed after it opened the port");
            hmr.exports = { version };
          },
          true,
        );
      define({ route: route("v1", gates[0].promise, how === "throws") });
      const first = answer(load("route"));
      await save({ route: route("v2", gates[1].promise) });
      const second = answer(load("route"));
      // The first body gets the port, after the save that replaced it, and gives it back when it ends.
      gates[0].resolve();
      await settleJobs();
      gates[1].resolve();
      const answers = ["first " + (await first), "second " + (await second) + ", holder " + holder];
      for (const version of ["v3", "v4"]) {
        // The save runs the dispose callback that the body before it registered.
        await save({ route: route(version, Promise.resolve()) });
        answers.push("after the save of " + version + ": " + (await answer(load("route"))) + ", holder " + holder);
      }
      expect([...answers, ...take()]).toEqual([
        "first got v2",
        "second got v2, holder v2",
        "after the save of v3: got v3, holder v3",
        "after the save of v4: got v4, holder v4",
      ]);
    },
  );

  test("client: the hooks that the live body registers after it is done work", async () => {
    const { log, take, define, load, save } = await loader("client");
    let later!: () => void;
    const m = (version: string) =>
      esm(
        [],
        async hmr => {
          await null;
          hmr.accept();
          later = () => {
            hmr.dispose(() => log(version + " is disposed of"));
            hmr.on("bun:beforeUpdate", () => log(version + " saw beforeUpdate"));
            hmr.accept((next: any) => log("the callback of " + version + " got " + next.version));
          };
          hmr.exports = { version };
        },
        true,
      );
    define({ m: m("v1") });
    await load("m");
    later();
    await save({ m: m("v2") });
    expect(take()).toEqual(["v1 saw beforeUpdate", "v1 is disposed of", "the callback of v1 got v2"]);
  });

  test("client: require() and import() after the await work, and count as imports of the module", async () => {
    const { log, take, define, load, save } = await loader("client");
    const dep = (version: string) => esm([], hmr => void (hmr.exports = { dep: version }));
    define({
      // `app` has an import statement for `dep` too. The module is one importer of `dep`, not two.
      app: esm(
        ["dep"],
        async hmr => {
          hmr.accept();
          hmr.dispose(() => log("app is disposed of"));
          await null;
          const lazy = await hmr.dynamicImport("lazy");
          log("app ran " + hmr.require("dep").dep + " " + lazy.dep + " " + hmr.importMeta.url);
        },
        true,
      ),
      dep: dep("d1"),
      lazy: dep("l1"),
    });
    await load("app");
    await save({ dep: dep("d2") });
    await save({ lazy: dep("l2") });
    expect(take()).toEqual([
      "app ran d1 l1 http://localhost/app",
      "app is disposed of",
      "app ran d2 l1 http://localhost/app",
      "app is disposed of",
      "app ran d2 l2 http://localhost/app",
    ]);
  });
});

describe("an update that comes while another update is applied", () => {
  for (const side of ["client", "server"] as const) {
    test(`${side}: the accept callback of the replaced body is called once for the body that both updates load`, async () => {
      const { log, take, define, load, save, onEvent } = await loader(side);
      const { promise: disposed, resolve: finish } = Promise.withResolvers<void>();
      const m = (version: string, dispose?: Promise<void>) =>
        esm([], hmr => {
          hmr.accept((next: any) => log("the callback of " + version + " got " + next.version));
          if (dispose) hmr.dispose(() => dispose);
          hmr.exports = { version };
        });
      define({ m: m("v1", disposed) });
      onEvent("bun:afterUpdate", () => log("<afterUpdate>"));
      await load("m");
      // The first update waits for the dispose callback. The second update does not wait, and loads `m`.
      const first = save({ m: m("v2") });
      await settleJobs();
      await save({ m: m("v3") });
      expect(take()).toEqual(["the callback of v1 got v3", "<afterUpdate>"]);
      finish();
      await first;
      expect(take()).toEqual(["<afterUpdate>"]);
    });
  }

  test("client: the callbacks of two bodies that two updates replaced each get the module that is loaded last, once", async () => {
    const { log, take, define, load, save } = await loader("client");
    const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    const app = (version: string, gate: Promise<void>) =>
      esm(
        [],
        async hmr => {
          hmr.accept((next: any) => log("the callback of " + version + " got " + next.version));
          await gate;
          hmr.exports = { version };
        },
        true,
      );
    define({ app: app("v1", Promise.resolve()) });
    await load("app");
    // The body of v2 waits when v3 is saved. The body of v3 ends first.
    const second = save({ app: app("v2", gates[0].promise) });
    await settleJobs();
    const third = save({ app: app("v3", gates[1].promise) });
    await settleJobs();
    gates[1].resolve();
    await third;
    expect(take()).toEqual(["the callback of v2 got v3"]);
    gates[0].resolve();
    await second;
    expect(take()).toEqual(["the callback of v1 got v3"]);
  });
});

describe("an event handler that throws", () => {
  for (const side of ["server", "client"] as const) {
    test(`${side}: does not stop the other handlers${side === "server" ? " or the update" : ", and ends the update"}`, async () => {
      const { log, take, define, load, save, onEvent } = await loader(side);
      define({
        app: esm(["leaf"], (hmr, [leaf]) => {
          hmr.accept();
          log("app ran " + leaf.leaf);
        }),
        leaf: leaf(log, "v1"),
      });
      onEvent("bun:beforeUpdate", () => {
        throw new Error("handler failed");
      });
      onEvent("bun:beforeUpdate", () => log("second handler ran"));
      await load("app");
      take();
      await save({ leaf: leaf(log, "v2") });
      expect(take()).toEqual(
        side === "server"
          ? ["second handler ran", "leaf ran", "app ran v2", "<rejected> handler failed"]
          : ["second handler ran", "<rejected> handler failed"],
      );
    });
  }
});

describe("the errors of one update", () => {
  test("server: the error of a bun:afterUpdate handler is thrown together with the errors before it", async () => {
    const { log, take, define, load, save, onEvent } = await loader("server");
    define({
      route: esm(["leaf"], hmr => {
        hmr.dispose(() => {
          throw new Error("dispose failed");
        });
      }),
      leaf: leaf(log, "v1"),
    });
    onEvent("bun:afterUpdate", () => {
      throw new Error("handler failed");
    });
    await load("route");
    take();
    await save({ leaf: leaf(log, "v2") });
    expect(take()).toEqual(["<rejected> Errors in a hot update: dispose failed; handler failed"]);
  });
});

describe("a module that did not load", () => {
  const request = (loaded: Promise<any>) =>
    loaded.then(
      route => route.render(),
      error => "failed: " + error.message,
    );

  test("server: a route keeps failing until the module that failed is saved, and then loads", async () => {
    const { take, define, load, save } = await loader("server");
    const config = (version: string, throws: boolean) =>
      esm([], hmr => {
        if (throws) throw new Error("config " + version + " failed");
        hmr.exports = { value: "config " + version };
      });
    const other = (version: string) => esm([], hmr => void (hmr.exports = { value: "other " + version }));
    define({
      route: esm(["config", "other"], (hmr, [config, other]) => {
        const made = config.value + ", " + other.value;
        hmr.exports = { render: () => made };
      }),
      config: config("v1", false),
      other: other("v1"),
    });
    const answers = [await request(load("route"))];
    await save({ config: config("v2", true) });
    answers.push(await request(load("route")));
    await save({ other: other("v2") });
    answers.push(await request(load("route")));
    await save({ config: config("v3", false) });
    answers.push(await request(load("route")));
    expect(answers).toEqual([
      "config v1, other v1",
      "failed: config v2 failed",
      "failed: config v2 failed",
      "config v3, other v2",
    ]);
    expect(take()).toEqual([]);
  });

  test("client: a save of a root whose first load threw reloads the page", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      page: esm([], () => {
        throw new Error("page failed");
      }),
    });
    expect(await request(load("page"))).toBe("failed: page failed");
    await save({ page: esm([], () => log("page ran")) });
    expect(take().map(line => line.split(" ")[0])).toEqual(["<message>", "<location.reload()>"]);
  });

  for (const how of ["require()", "import()"] as const) {
    test(`server: a route that reached a failed module with ${how} is evaluated again after the save that repairs the module`, async () => {
      const { define, load, save } = await loader("server");
      const dep = (ok: boolean) =>
        esm([], hmr => {
          if (!ok) throw new Error("dep failed");
          hmr.exports = { value: "ok" };
        });
      const route = () =>
        how === "require()"
          ? esm([], hmr => {
              const { value } = hmr.require("dep");
              hmr.exports = { render: () => value };
            })
          : esm(
              [],
              async hmr => {
                const { value } = await hmr.dynamicImport("dep");
                hmr.exports = { render: () => value };
              },
              true,
            );
      define({ first: route(), second: route(), dep: dep(false) });
      // `dep` fails when `first` loads it. `second` finds it failed.
      expect([await request(load("first")), await request(load("second"))]).toEqual([
        "failed: dep failed",
        "failed: dep failed",
      ]);
      await save({ dep: dep(true) });
      expect([await request(load("first")), await request(load("second"))]).toEqual(["ok", "ok"]);
    });
  }

  const theme = (log: (line: string) => void, version: string) =>
    esm([], hmr => {
      hmr.accept();
      log("theme ran " + version);
      hmr.exports = { version };
    });
  /** An import() that the importer catches, as a router does for a page that fails. */
  const opener = (hmr: Hmr, id: string) => async () => {
    try {
      await hmr.dynamicImport(id);
      return "opened";
    } catch (error: any) {
      return "failed: " + error.message;
    }
  };

  test("client: a save of an accepting module does not reload the page for an importer that failed, and the next import() evaluates that importer", async () => {
    const { log, take, define, load, save } = await loader("client");
    let open!: () => Promise<string>;
    define({
      root: esm(["theme"], hmr => void (open = opener(hmr, "page"))),
      page: esm(["theme"], (hmr, [theme]) => {
        log("page ran " + theme.version);
        if (theme.version === "v1") throw new Error("page failed with v1");
      }),
      theme: theme(log, "v1"),
    });
    await load("root");
    expect([await open(), ...take()]).toEqual(["failed: page failed with v1", "theme ran v1", "page ran v1"]);
    await save({ theme: theme(log, "v2") });
    expect(take()).toEqual(["theme ran v2"]);
    expect([await open(), ...take()]).toEqual(["opened", "page ran v2"]);
  });

  test("client: the modules that did not load above that importer are evaluated at their next load, and a loaded module above them is not", async () => {
    const { log, take, define, load, save } = await loader("client");
    let open!: () => Promise<string>;
    define({
      root: esm(["theme"], hmr => {
        log("root ran");
        hmr.dispose(() => log("root is disposed of"));
        open = opener(hmr, "page");
      }),
      // `page` has the error of `widget` as its own. `frame` did not run, because its import failed.
      page: esm([], hmr => {
        log("page ran");
        hmr.require("frame");
      }),
      frame: esm(["widget"], () => log("frame ran")),
      widget: esm(["theme"], (hmr, [theme]) => {
        log("widget ran " + theme.version);
        if (theme.version === "v1") throw new Error("widget failed with v1");
      }),
      theme: theme(log, "v1"),
    });
    await load("root");
    expect([await open(), ...take()]).toEqual([
      "failed: widget failed with v1",
      "theme ran v1",
      "root ran",
      "page ran",
      "widget ran v1",
    ]);
    await save({ theme: theme(log, "v2") });
    expect(take()).toEqual(["theme ran v2"]);
    expect([await open(), ...take()]).toEqual(["opened", "page ran", "widget ran v2", "frame ran"]);
  });

  test("server: a save of an accepting module lets a module that failed above it load again, and does not evaluate a route that caught the failure", async () => {
    const { log, take, define, load, save } = await loader("server");
    define({
      // `first` caught the failure of `page` and answers without it. `second` needs `page`.
      first: esm(
        ["theme"],
        async hmr => {
          log("first ran");
          const opened = await opener(hmr, "page")();
          hmr.exports = { render: () => "first " + opened };
        },
        true,
      ),
      second: esm(["page"], (hmr, [page]) => void (hmr.exports = { render: () => "second has " + page.name })),
      page: esm(["theme"], (hmr, [theme]) => {
        log("page ran " + theme.version);
        if (theme.version === "v1") throw new Error("page failed with v1");
        hmr.exports = { name: "page(" + theme.version + ")" };
      }),
      theme: theme(log, "v1"),
    });
    expect([await request(load("first")), await request(load("second")), ...take()]).toEqual([
      "first failed: page failed with v1",
      "failed: page failed with v1",
      "theme ran v1",
      "first ran",
      "page ran v1",
    ]);
    await save({ theme: theme(log, "v2") });
    expect(take()).toEqual(["theme ran v2"]);
    expect([await request(load("first")), await request(load("second")), ...take()]).toEqual([
      "first failed: page failed with v1",
      "second has page(v2)",
      "page ran v2",
    ]);
  });

  test("server: a failed module whose new code does not import the module that failed above the saved module stays failed", async () => {
    const { log, take, define, load, save } = await loader("server");
    define({
      page: esm(["widget"], (hmr, [widget]) => void (hmr.exports = { render: () => "page with " + widget.name })),
      widget: esm(["theme"], (hmr, [theme]) => {
        if (theme.version === "v1") throw new Error("widget failed with v1");
        hmr.exports = { name: "widget" };
      }),
      theme: theme(log, "v1"),
    });
    const answers = [await request(load("page"))];
    // The new code of `page` does not import `widget`, and fails for its own reason.
    await save({
      page: esm([], () => {
        log("page v2 ran");
        throw new Error("page v2 failed");
      }),
    });
    answers.push(await request(load("page")));
    // The import of `widget` was made by the old code of `page`, so this save does not reach `page`.
    await save({ theme: theme(log, "v2") });
    answers.push(await request(load("page")));
    expect([...answers, ...take()]).toEqual([
      "failed: widget failed with v1",
      "failed: page v2 failed",
      "failed: page v2 failed",
      "theme ran v1",
      "page v2 ran",
      "theme ran v2",
    ]);
  });
});

describe("a load that comes while an update is applied", () => {
  test("server: a request that comes while a dispose callback waits gets the new code", async () => {
    const { log, take, define, load, save } = await loader("server");
    const { promise: gate, resolve: open } = Promise.withResolvers<void>();
    define({
      route: esm(["leaf"], (hmr, [leaf]) => {
        log("route ran");
        hmr.dispose(() => gate);
        hmr.exports = { render: () => leaf.leaf };
      }),
      leaf: leaf(log, "v1"),
    });
    await load("route");
    take();
    const saving = save({ leaf: leaf(log, "v2") });
    const during = (await load("route")).render();
    open();
    await saving;
    // The request evaluated the route. The update does not evaluate it a second time.
    expect([during, ...take()]).toEqual(["v2", "leaf ran", "route ran"]);
  });

  // A load that waited for the dispose callbacks here would wait for the callback that made it.
  test("client: a dispose callback that imports a module of the update after its first await gets the new code, and the update ends", async () => {
    const { log, take, define, load, save } = await loader("client");
    define({
      app: esm(["leaf"], (hmr, [leaf]) => {
        hmr.accept();
        log("app ran " + leaf.leaf);
        hmr.dispose(async () => {
          await null;
          log("dispose read " + (await hmr.dynamicImport("leaf")).leaf);
        });
      }),
      leaf: leaf(log, "v1"),
    });
    await load("app");
    take();
    await save({ leaf: leaf(log, "v2") });
    expect(take()).toEqual(["leaf ran", "dispose read v2", "app ran v2"]);
  });
});

describe("an import that fails", () => {
  test("an import that rejects after another import of the same importer threw is not left with no handler", async () => {
    const { define, load } = await loader("server");
    const { promise: gate, resolve: open } = Promise.withResolvers<void>();
    define({
      route: esm(["slow", "bad"], () => {}),
      slow: esm(
        [],
        async () => {
          await gate;
          throw new Error("slow failed");
        },
        true,
      ),
      bad: esm([], () => {
        throw new Error("bad failed");
      }),
    });
    expect(await load("route").catch(error => error.message)).toBe("bad failed");
    open();
    // The test runner fails a test for a rejection that nothing handles. Bun reports such a
    // rejection after the promise jobs, so take one turn of the event loop before the test ends.
    await new Promise<void>(resolve => setImmediate(resolve));
  });
});

describe("top-level await and import()", () => {
  // A known limit. An importer waits for a module on top-level await only after an update reached
  // that module. On a first load the second importer gets the module as it is, so `b` runs first.
  // The assertion is the order of ES modules. #37759 and #39488 have the wait on a first load.
  test.failing("on a first load, every importer waits for a module that waits on top-level await", async () => {
    const { log, take, define, load } = await loader("client");
    define({
      app: esm(["a", "b"], () => log("app ran")),
      a: esm(["t"], () => log("a ran")),
      b: esm(["t"], () => log("b ran")),
      t: esm(
        [],
        async () => {
          await null;
          log("t is done");
        },
        true,
      ),
    });
    await load("app");
    expect(take()).toEqual(["t is done", "a ran", "b ran", "app ran"]);
  });

  // The same limit. A load that is tried again after it failed is a first load too: no update
  // reached `t`. The second attempt must not wait where the first load does not.
  test.failing(
    "on a first load that takes two attempts, every importer waits for a module that waits on top-level await",
    async () => {
      const { log, take, define, load } = await loader("client");
      let attempts = 0;
      define({
        app: esm(["a", "b"], () => log("app ran")),
        a: esm(["t"], () => log("a ran")),
        b: esm(["t"], () => log("b ran")),
        t: esm(
          ["flaky"],
          async () => {
            await null;
            log("t is done");
          },
          true,
        ),
        // For example a file that is not there yet when the page loads.
        flaky: cjs(() => {
          if (++attempts === 1) throw new Error("flaky failed");
        }),
      });
      const firstAttempt = await load("app").catch(error => error.message);
      await load("app");
      expect([firstAttempt, ...take()]).toEqual(["flaky failed", "t is done", "a ran", "b ran", "app ran"]);
    },
  );

  test("the first load of a module that awaits an import() which another module makes, of a module that imports it back, completes", async () => {
    const { log, take, define, load } = await loader("client");
    let open!: () => Promise<any>;
    define({
      root: esm(["helper", "t"], () => {}),
      helper: esm([], hmr => void (open = () => hmr.dynamicImport("x"))),
      t: esm(
        [],
        async () => {
          await null;
          log("t got " + (await open()).x);
        },
        true,
      ),
      x: esm(["t"], hmr => void (hmr.exports = { x: "x" })),
    });
    void load("root");
    await settleJobs();
    expect(take()).toEqual(["t got x"]);
  });

  const gated = (version: string, gate: Promise<void>, deps: string[] = []) =>
    esm(
      deps,
      async hmr => {
        await gate;
        hmr.exports = { t: version };
      },
      true,
    );

  test("a module in an import cycle with the waiting module, saved while it waits, waits for it", async () => {
    const { log, take, define, load, save } = await loader("client");
    const { promise: gate, resolve: open } = Promise.withResolvers<void>();
    const b = () =>
      esm(["t"], (hmr, imports) => {
        hmr.accept();
        log("b saw " + imports[0]?.t);
      });
    define({
      app: esm(["t"], hmr => {
        hmr.accept();
        // An import() that fails is over. It must not make the loads after it look like a part of an import().
        try {
          hmr.dynamicImport("bad").catch(() => {});
        } catch {}
      }),
      t: esm(["b"], hmr => void (hmr.exports = { t: "v1" })),
      b: b(),
      bad: esm([], () => {
        throw new Error("bad failed");
      }),
    });
    await load("app");
    const first = save({ t: gated("v2", gate, ["b"]) });
    await settleJobs();
    take();
    // `t` is evaluated again and waits. Its import of `b` is done, so `b` can wait for `t`.
    const second = save({ b: b() });
    await settleJobs();
    expect(take()).toEqual([]);
    open();
    await Promise.all([first, second]);
    expect(take()).toEqual(["b saw v2"]);
  });
});

describe("a first load, with no update", () => {
  test("require() of a module that waits on top-level await gets the module as it is", async () => {
    const { log, take, define, load } = await loader("client");
    define({
      app: esm(["t", "reader"], () => {}),
      t: esm([], () => Promise.resolve(), true),
      reader: esm([], hmr => {
        try {
          hmr.require("t");
          log("reader required t");
        } catch (error: any) {
          log(error.message);
        }
      }),
    });
    await load("app");
    expect(take()).toEqual(["reader required t"]);
  });

  test.each(["a CommonJS module", "an ES module"])(
    "an ES module in an import cycle that %s loads with require() gets the exports of the module that it imports back",
    async entry => {
      const { define, load } = await loader("client");
      let read!: () => string;
      const requires = (hmr: Hmr) => void hmr.require("a");
      define({
        entry: entry === "a CommonJS module" ? cjs(requires) : esm([], requires),
        // `b` runs before `a` is done. It reads its import of `a` from a function that runs later.
        a: esm(["b"], hmr => void (hmr.exports = { value: "a-value" })),
        b: esm(["a"], (hmr, imports) => void (read = () => imports[0].value)),
      });
      await load("entry");
      expect(read()).toBe("a-value");
    },
  );

  test("an ES module in an import cycle with a CommonJS module reads the final module.exports from a function that runs later", async () => {
    const { define, load } = await loader("client");
    let read!: () => string;
    define({
      app: esm(["c"], () => {}),
      c: cjs((hmr, module) => {
        hmr.require("e");
        module.exports = { value: "v1" };
      }),
      e: esm(["c"], (hmr, imports) => void (read = () => imports[0].default.value)),
    });
    await load("app");
    expect(read()).toBe("v1");
  });

  test("a module with top-level await whose import threw, and that require() refused after that, loads at the next import()", async () => {
    const { log, take, define, load } = await loader("server");
    let attempts = 0;
    let step!: (how: "import()" | "require()") => Promise<string>;
    define({
      driver: esm([], hmr => {
        step = async how => {
          try {
            return "got " + (how === "import()" ? await hmr.dynamicImport("m") : hmr.require("m")).value;
          } catch (error: any) {
            return error.message;
          }
        };
      }),
      m: esm(
        ["flaky"],
        async (hmr, [flaky]) => {
          await null;
          log("m ran");
          hmr.exports = { value: "m(" + flaky.default.attempt + ")" };
        },
        true,
      ),
      // For example a file that is not there yet at the first request.
      flaky: cjs((hmr, module) => {
        if (++attempts === 1) throw new Error("flaky failed");
        module.exports = { attempt: attempts };
      }),
    });
    await load("driver");
    expect([await step("import()"), await step("require()"), await step("import()"), ...take()]).toEqual([
      "flaky failed",
      `Cannot require "m" because "m" uses top-level await, but 'require' is a synchronous operation.`,
      "got m(2)",
      "m ran",
    ]);
  });
});

describe("a CommonJS module that an update evaluates again", () => {
  test("gives the final module.exports to an ES module, after an ES module in an import cycle read the first one", async () => {
    const { log, take, define, load, save } = await loader("client");
    const c = (version: string) =>
      cjs((hmr, module) => {
        hmr.require("e");
        module.exports = { value: version };
      });
    define({
      app: esm(["c"], (hmr, [c]) => {
        hmr.accept();
        log("app saw " + c.default.value);
      }),
      c: c("v1"),
      e: esm(["c"], () => {}),
    });
    await load("app");
    await save({ c: c("v2") });
    expect(take()).toEqual(["app saw v1", "app saw v2"]);
  });

  test("gives its new exports to an importer that accepts it", async () => {
    const { log, take, define, load, save } = await loader("client");
    let read!: () => string;
    const c = (version: string) => cjs((hmr, module) => void (module.exports = { value: version }));
    define({
      app: esm(["c"], (hmr, imports) => {
        hmr.acceptSpecifiers("c", (next: any) => log("app accepted " + next.default.value));
        read = () => imports[0].default.value;
      }),
      c: c("v1"),
    });
    await load("app");
    await save({ c: c("v2") });
    expect([...take(), read()]).toEqual(["app accepted v2", "v2"]);
  });

  test("is evaluated once when require() reaches it first and it is in a require() cycle", async () => {
    const { log, take, define, load, save } = await loader("client");
    const leaf = (version: string) =>
      cjs((hmr, module, exports) => {
        log("leaf " + version + " ran");
        exports.leaf = version;
        hmr.require("back");
      });
    define({
      app: esm([], hmr => {
        hmr.accept();
        log("app got " + hmr.require("leaf").leaf);
      }),
      leaf: leaf("v1"),
      back: cjs(hmr => void hmr.require("leaf")),
    });
    await load("app");
    await save({ leaf: leaf("v2") });
    expect(take()).toEqual(["leaf v1 ran", "app got v1", "leaf v2 ran", "app got v2"]);
  });

  test("a module that changes from an ES module to CommonJS and back", async () => {
    const { log, take, define, load, save } = await loader("client");
    let read!: () => string;
    define({
      app: esm(["leaf"], (hmr, imports) => {
        hmr.accept();
        log("app saw " + imports[0].leaf);
        read = () => imports[0].leaf;
      }),
      leaf: esm([], hmr => {
        hmr.accept();
        hmr.exports = { leaf: "v1" };
      }),
    });
    await load("app");
    // The ES module accepted its own updates, so `app` does not run. Its import is the new module.
    await save({ leaf: cjs((hmr, module, exports) => void (exports.leaf = "v2")) });
    const afterCommonJS = read();
    // The CommonJS body did not accept, so this save goes on to `app`.
    await save({ leaf: esm([], hmr => void (hmr.exports = { leaf: "v3" })) });
    expect([afterCommonJS, ...take()]).toEqual(["v2", "app saw v1", "app saw v3"]);
  });
});

describe("require() inside a load that import() started", () => {
  test("server: gets the module that awaits that import() as it is, also after an update reached the module", async () => {
    const { log, take, define, load, save } = await loader("server");
    const helper = (version: string) =>
      cjs((hmr, module) => {
        hmr.require("route");
        log("helper ran " + version);
        module.exports = {};
      });
    define({
      route: esm(
        [],
        async hmr => {
          hmr.exports = { render: () => "page" };
          await null;
          await hmr.dynamicImport("helper");
          log("route ran");
        },
        true,
      ),
      helper: helper("v1"),
    });
    expect((await load("route")).render()).toBe("page");
    await save({ helper: helper("v2") });
    // `route` waits for the import() that loads `helper`, so a refusal here would fail the route for good.
    expect((await load("route")).render()).toBe("page");
    expect(take()).toEqual(["helper ran v1", "route ran", "helper ran v2", "route ran"]);
  });
});

describe("import.meta.hot.accept of a module that only import() reaches", () => {
  test("client: counts for the new code of the importer before that code imports the module", async () => {
    const { log, take, define, load, save } = await loader("client");
    let open!: () => Promise<unknown>;
    const app = (version: string) =>
      esm([], hmr => {
        hmr.accept();
        hmr.acceptSpecifiers("page", (next: any) => log("app " + version + " accepted " + next.page));
        open = () => hmr.dynamicImport("page");
      });
    const page = (version: string) =>
      esm([], hmr => {
        log("page " + version + " ran");
        hmr.exports = { page: version };
      });
    define({ app: app("v1"), page: page("v1") });
    await load("app");
    await open();
    // The new code of `app` accepts `page` again. It does not call import() until `open()` runs.
    await save({ app: app("v2") });
    await save({ page: page("v2") });
    expect(take()).toEqual(["page v1 ran", "page v2 ran", "app v2 accepted v2"]);
  });

  test("client: does not count for the code that was replaced while the new code of the importer waits for an import", async () => {
    const { log, take, define, load, save } = await loader("client");
    const gate = Promise.withResolvers<void>();
    let open!: () => Promise<unknown>;
    const page = (version: string) =>
      esm([], hmr => {
        log("page " + version + " ran");
        hmr.exports = { page: version };
      });
    define({
      app: esm([], hmr => {
        hmr.accept();
        hmr.acceptSpecifiers("page", (next: any) => log("app v1 accepted " + next.page));
        hmr.dispose(() => log("app v1 disposed"));
        open = () => hmr.dynamicImport("page");
      }),
      page: page("v1"),
    });
    await load("app");
    await open();
    take();
    // The new code of `app` has no accept of `page`. Its body did not run yet: it waits for `slow`.
    const first = save({
      app: esm(["slow"], hmr => {
        hmr.accept();
        log("app v2 ran");
      }),
      slow: esm([], () => gate.promise, true),
    });
    await settleJobs();
    const second = save({ page: page("v2") });
    await settleJobs();
    const during = take();
    gate.resolve();
    await Promise.all([first, second]);
    expect([...during, ...take()]).toEqual(["app v1 disposed", "app v2 ran"]);
  });
});

describe("a load from outside the module graph", () => {
  test("server: a second request for a route that waits on top-level await on its first load waits too", async () => {
    const { define, load } = await loader("server");
    const { promise: gate, resolve: open } = Promise.withResolvers<void>();
    define({
      route: esm(
        [],
        async hmr => {
          await gate;
          hmr.exports = { render: () => "page" };
        },
        true,
      ),
    });
    const requests = [load("route"), load("route")].map(request => request.then(exports => exports.render()));
    open();
    expect(await Promise.all(requests)).toEqual(["page", "page"]);
  });

  // `route.page()` is a load with no importer that a module body makes. A wait here would be a wait for itself.
  test("client: the first load of a module that the page imports and that awaits route.page() after its first await completes", async () => {
    const { log, take, define, load } = await loader("client", { route: { page: "page", layouts: [] } });
    define({
      entry: esm(
        ["bun:bake/client"],
        async (hmr, [{ route }]) => log("entry got " + (await route.page()).default),
        true,
      ),
      page: esm(["router"], hmr => void (hmr.exports = { default: "Page" })),
      router: esm(
        ["bun:bake/client"],
        async (hmr, [{ route }]) => {
          await null;
          log("router got " + (await route.page()));
        },
        true,
      ),
    });
    void load("entry");
    await settleJobs();
    expect(take()).toEqual(["router got null", "entry got Page"]);
  });

  test("client: a hot update of the React Fast Refresh runtime reloads the page", async () => {
    const { take, define, load, save, useRefreshRuntime } = await loader("client");
    const runtime = () => cjs((hmr, module) => void (module.exports = { performReactRefresh() {} }));
    // A component file imports the runtime and accepts. A second copy of the runtime would not know the components.
    define({ app: esm(["runtime"], hmr => hmr.accept()), runtime: runtime() });
    await useRefreshRuntime("runtime");
    await load("app");
    await save({ runtime: runtime() });
    expect(take().map(line => line.split(" ")[0])).toEqual(["<warn>", "<message>", "<location.reload()>"]);
  });
});

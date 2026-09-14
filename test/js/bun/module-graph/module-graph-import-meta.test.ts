import { describe, expect, test } from "bun:test";
import { isWindows, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const { ModuleGraph } = Bun.unsafe as any;

// A graph whose modules can reach the graph itself as `holder.graph`.
function graphWithHolder() {
  const holder: any = {};
  holder.graph = new ModuleGraph({ globals: { holder } });
  return holder;
}

const rejection = (promise: Promise<unknown>) =>
  promise.then(
    () => "resolved",
    error => ({ name: error?.name, code: error?.code, specifier: error?.specifier, referrer: error?.referrer }),
  );

describe("import.meta in a graph", () => {
  const strings = `
    export const strings = () => ({
      url: import.meta.url,
      path: import.meta.path,
      dir: import.meta.dir,
      dirname: import.meta.dirname,
      file: import.meta.file,
      filename: import.meta.filename,
    });
  `;

  test("url, path, dir, dirname, file and filename are the host's strings", async () => {
    using dir = tempDir("module-graph-meta-strings", { "sub/strings.mjs": strings });
    const file = join(String(dir), "sub", "strings.mjs");

    using graph = new ModuleGraph();
    const inGraph = (await graph.import(file)).strings();
    expect(inGraph).toEqual({
      url: pathToFileURL(file).href,
      path: file,
      dir: join(String(dir), "sub"),
      dirname: join(String(dir), "sub"),
      file: "strings.mjs",
      filename: file,
    });
    expect(inGraph).toEqual((await import(file)).strings());
  });

  test("a path that needs percent-encoding has the host's url", async () => {
    using dir = tempDir("module-graph-meta-encoded", { "with space é.mjs": strings });
    const file = join(String(dir), "with space é.mjs");

    using graph = new ModuleGraph();
    const inGraph = (await graph.import(file)).strings();
    expect(inGraph).toEqual({
      url: pathToFileURL(file).href,
      path: file,
      dir: String(dir),
      dirname: String(dir),
      file: "with space é.mjs",
      filename: file,
    });
    expect(inGraph).toEqual((await import(file)).strings());
  });

  test("a TypeScript module has the host's strings", async () => {
    using dir = tempDir("module-graph-meta-typescript", {
      "typed.ts": `
        export const strings = (): Record<string, string> => ({
          url: import.meta.url,
          path: import.meta.path,
          file: import.meta.file,
        });
      `,
    });
    const file = join(String(dir), "typed.ts");

    using graph = new ModuleGraph();
    const inGraph = (await graph.import(file)).strings();
    expect(inGraph).toEqual({ url: pathToFileURL(file).href, path: file, file: "typed.ts" });
    expect(inGraph).toEqual((await import(file)).strings());
  });

  test("env, require, resolve and resolveSync have the host's types", async () => {
    using dir = tempDir("module-graph-meta-types", {
      "types.mjs": `
        export const types = () => ({
          env: typeof import.meta.env,
          require: typeof import.meta.require,
          requireResolve: typeof import.meta.require.resolve,
          resolve: typeof import.meta.resolve,
          resolveSync: typeof import.meta.resolveSync,
          main: typeof import.meta.main,
        });
      `,
    });
    const file = join(String(dir), "types.mjs");

    using graph = new ModuleGraph();
    const inGraph = (await graph.import(file)).types();
    expect(inGraph).toEqual({
      env: "object",
      require: "function",
      requireResolve: "function",
      resolve: "function",
      resolveSync: "function",
      main: "boolean",
    });
    expect(inGraph).toEqual((await import(file)).types());
  });

  test("is a distinct object per graph per module", async () => {
    using dir = tempDir("module-graph-meta-distinct", {
      "distinct-dep.mjs": `export const meta = import.meta;`,
      "distinct-main.mjs": `
        export { meta as depMeta } from "./distinct-dep.mjs";
        export const meta = import.meta;
      `,
    });
    const file = join(String(dir), "distinct-main.mjs");

    using a = new ModuleGraph();
    using b = new ModuleGraph();
    const namespaces = [await a.import(file), await b.import(file), await import(file)];
    const metas = namespaces.flatMap(ns => [ns.meta, ns.depMeta]);

    expect(new Set(metas).size).toBe(6);
    expect(metas.map(meta => meta.url)).toEqual([
      pathToFileURL(file).href,
      pathToFileURL(join(String(dir), "distinct-dep.mjs")).href,
      pathToFileURL(file).href,
      pathToFileURL(join(String(dir), "distinct-dep.mjs")).href,
      pathToFileURL(file).href,
      pathToFileURL(join(String(dir), "distinct-dep.mjs")).href,
    ]);
  });

  test("is the same object every time one module instance reads it", async () => {
    using dir = tempDir("module-graph-meta-stable", {
      "stable.mjs": `
        export const meta = import.meta;
        export const sameInOneExpression = import.meta === import.meta;
        export function read() { return import.meta; }
        export const readInCallback = () => [1].map(() => import.meta)[0];
      `,
    });
    const file = join(String(dir), "stable.mjs");

    using graph = new ModuleGraph();
    const inGraph = await graph.import(file);
    expect({
      sameInOneExpression: inGraph.sameInOneExpression,
      read: inGraph.read() === inGraph.meta,
      readAgain: inGraph.read() === inGraph.read(),
      readInCallback: inGraph.readInCallback() === inGraph.meta,
      reimported: (await graph.import(file)).meta === inGraph.meta,
    }).toEqual({ sameInOneExpression: true, read: true, readAgain: true, readInCallback: true, reimported: true });
  });

  test("properties assigned to it stay in that instance", async () => {
    using dir = tempDir("module-graph-meta-assign", {
      "assign.mjs": `
        export const tag = value => { import.meta.tag = value; };
        export const read = () => import.meta.tag;
        export const keys = () => Object.keys(import.meta);
      `,
    });
    const file = join(String(dir), "assign.mjs");

    using a = new ModuleGraph();
    using b = new ModuleGraph();
    const inA = await a.import(file);
    const inB = await b.import(file);
    const host = await import(file);

    inA.tag("a");
    expect([inA.read(), inB.read(), host.read()]).toEqual(["a", undefined, undefined]);
    inB.tag("b");
    host.tag("host");
    expect([inA.read(), inB.read(), host.read()]).toEqual(["a", "b", "host"]);
    expect([inA.keys(), inB.keys(), host.keys()]).toEqual([["tag"], ["tag"], ["tag"]]);
  });

  test("overwriting a builtin property affects that instance only", async () => {
    using dir = tempDir("module-graph-meta-overwrite", {
      "overwrite.mjs": `
        export const overwrite = () => { import.meta.url = "overwritten"; };
        export const read = () => import.meta.url;
      `,
    });
    const file = join(String(dir), "overwrite.mjs");

    using a = new ModuleGraph();
    using b = new ModuleGraph();
    const inA = await a.import(file);
    const inB = await b.import(file);
    const host = await import(file);

    host.overwrite();
    const hostBehaviour = host.read();
    inA.overwrite();
    expect([inA.read(), inB.read()]).toEqual([hostBehaviour, pathToFileURL(file).href]);
  });

  test("env is process.env", async () => {
    using dir = tempDir("module-graph-meta-env", {
      "env.mjs": `
        export const env = () => import.meta.env;
        export const read = key => import.meta.env[key];
        export const write = (key, value) => { import.meta.env[key] = value; };
      `,
    });
    const file = join(String(dir), "env.mjs");
    const key = "MODULE_GRAPH_IMPORT_META_ENV_TEST";

    using graph = new ModuleGraph();
    const inGraph = await graph.import(file);
    const host = await import(file);
    try {
      expect(inGraph.env()).toBe(process.env);
      expect(inGraph.env()).toBe(host.env());

      inGraph.write(key, "from the graph");
      expect([process.env[key], host.read(key)]).toEqual(["from the graph", "from the graph"]);
      process.env[key] = "from the host";
      expect(inGraph.read(key)).toBe("from the host");
    } finally {
      delete process.env[key];
    }
    expect(inGraph.read(key)).toBeUndefined();
  });

  test("of a module loaded by import() inside the graph belongs to the graph", async () => {
    using dir = tempDir("module-graph-meta-dynamic", {
      "dynamic-dep.mjs": `export const meta = import.meta;`,
      "dynamic-main.mjs": `
        export async function load() { return await import("./dynamic-dep.mjs"); }
      `,
    });
    const file = join(String(dir), "dynamic-main.mjs");
    const dep = join(String(dir), "dynamic-dep.mjs");

    using graph = new ModuleGraph();
    const loaded = await (await graph.import(file)).load();
    const hostLoaded = await (await import(file)).load();

    expect(loaded.meta).toBe((await graph.import(dep)).meta);
    expect(loaded.meta).not.toBe(hostLoaded.meta);
    expect({ url: loaded.meta.url, main: loaded.meta.main, hostUrl: hostLoaded.meta.url }).toEqual({
      url: pathToFileURL(dep).href,
      main: false,
      hostUrl: pathToFileURL(dep).href,
    });
  });

  test("of a module loaded by import.meta.require() belongs to the graph", async () => {
    using dir = tempDir("module-graph-meta-required", {
      "required-dep.mjs": `export const meta = import.meta;`,
      "required-main.mjs": `
        export function load() { return import.meta.require("./required-dep.mjs"); }
      `,
    });
    const file = join(String(dir), "required-main.mjs");
    const dep = join(String(dir), "required-dep.mjs");

    using graph = new ModuleGraph();
    const required = (await graph.import(file)).load();
    const host = await import(dep);

    expect(required.meta).toBe((await graph.import(dep)).meta);
    expect(required.meta).not.toBe(host.meta);
    expect([required.meta.url, required.meta.main]).toEqual([host.meta.url, false]);
  });

  test("is the graph's when first read by a function the host calls later", async () => {
    using dir = tempDir("module-graph-meta-late", {
      "late.mjs": `
        export function late() {
          return { meta: import.meta, url: import.meta.url, main: import.meta.main };
        }
      `,
      "late-other.mjs": `export {};`,
    });
    const file = join(String(dir), "late.mjs");

    const graph = new ModuleGraph();
    const inGraph = await graph.import(file);
    const host = await import(file);
    await graph.import(join(String(dir), "late-other.mjs"));
    graph.dispose();
    Bun.gc(true);

    const fromGraph = inGraph.late();
    const fromHost = host.late();
    expect(fromGraph.meta).not.toBe(fromHost.meta);
    expect(inGraph.late().meta).toBe(fromGraph.meta);
    expect({ url: fromGraph.url, main: fromGraph.main, hostUrl: fromHost.url, hostMain: fromHost.main }).toEqual({
      url: pathToFileURL(file).href,
      main: true,
      hostUrl: pathToFileURL(file).href,
      hostMain: false,
    });
  });

  test("a graph module's import.meta.require called by the host loads the graph's instance", async () => {
    using dir = tempDir("module-graph-meta-require-host-call", {
      "host-call-state.mjs": `
        export let count = 0;
        export const increment = () => ++count;
      `,
      "host-call-entry.mjs": `
        import { increment } from "./host-call-state.mjs";
        export { increment };
        export const require = import.meta.require;
      `,
    });
    const file = join(String(dir), "host-call-entry.mjs");

    using graph = new ModuleGraph();
    const inGraph = await graph.import(file);
    const host = await import(file);
    inGraph.increment();

    expect(inGraph.require).toBe(inGraph.require);
    expect({
      graph: inGraph.require("./host-call-state.mjs").count,
      graphIsImported: inGraph.require("./host-call-state.mjs").increment === inGraph.increment,
      host: host.require("./host-call-state.mjs").count,
    }).toEqual({ graph: 1, graphIsImported: true, host: 0 });
  });

  describe("resolution", () => {
    const files = {
      "package.json": `{ "name": "module-graph-meta-resolve-root" }`,
      "node_modules/conditional/package.json": JSON.stringify({
        name: "conditional",
        exports: { ".": { import: "./esm.mjs", require: "./cjs.cjs" }, "./feature": "./feature.mjs" },
      }),
      "node_modules/conditional/esm.mjs": `export const kind = "esm";`,
      "node_modules/conditional/cjs.cjs": `exports.kind = "cjs";`,
      "node_modules/conditional/feature.mjs": `export const kind = "feature";`,
      "other/sibling.mjs": `export {};`,
      "src/sibling.mjs": `export {};`,
      "src/resolver.mjs": `
        export function resolveAll(specifier) {
          return {
            resolve: import.meta.resolve(specifier),
            resolveSync: import.meta.resolveSync(specifier),
            bunResolveSync: Bun.resolveSync(specifier, import.meta.dir),
            requireResolve: import.meta.require.resolve(specifier),
          };
        }
        export function resolveFrom(specifier, parent) {
          return import.meta.resolveSync(specifier, parent);
        }
        export function failure(fn) {
          try {
            return fn();
          } catch (error) {
            return { name: error.name, code: error.code, message: error.message };
          }
        }
        export const failures = specifier => ({
          resolveSync: failure(() => import.meta.resolveSync(specifier)),
          bunResolveSync: failure(() => Bun.resolveSync(specifier, import.meta.dir)),
          requireResolve: failure(() => import.meta.require.resolve(specifier)),
        });
        export const meta = import.meta;
      `,
    };

    test("a relative specifier resolves against the graph module", async () => {
      using dir = tempDir("module-graph-meta-resolve-relative", files);
      const file = join(String(dir), "src", "resolver.mjs");
      const sibling = join(String(dir), "src", "sibling.mjs");

      using graph = new ModuleGraph();
      const inGraph = (await graph.import(file)).resolveAll("./sibling.mjs");
      expect(inGraph).toEqual({
        resolve: pathToFileURL(sibling).href,
        resolveSync: sibling,
        bunResolveSync: sibling,
        requireResolve: sibling,
      });
      expect(inGraph).toEqual((await import(file)).resolveAll("./sibling.mjs"));
    });

    test("a package resolves with the `import` condition, require.resolve with `require`", async () => {
      using dir = tempDir("module-graph-meta-resolve-package", files);
      const file = join(String(dir), "src", "resolver.mjs");
      const pkg = join(String(dir), "node_modules", "conditional");

      using graph = new ModuleGraph();
      const inGraph = (await graph.import(file)).resolveAll("conditional");
      expect(inGraph).toEqual({
        resolve: pathToFileURL(join(pkg, "esm.mjs")).href,
        resolveSync: join(pkg, "esm.mjs"),
        bunResolveSync: join(pkg, "esm.mjs"),
        requireResolve: join(pkg, "cjs.cjs"),
      });
      expect(inGraph).toEqual((await import(file)).resolveAll("conditional"));
    });

    test.each(["conditional/feature", "node:path", "fs", "bun:sqlite", "bun"])(
      "%s resolves as in the host",
      async specifier => {
        using dir = tempDir("module-graph-meta-resolve-each", files);
        const file = join(String(dir), "src", "resolver.mjs");

        using graph = new ModuleGraph();
        expect((await graph.import(file)).resolveAll(specifier)).toEqual((await import(file)).resolveAll(specifier));
      },
    );

    test("an absolute path and a file: URL resolve as in the host", async () => {
      using dir = tempDir("module-graph-meta-resolve-absolute", files);
      const file = join(String(dir), "src", "resolver.mjs");
      const other = join(String(dir), "other", "sibling.mjs");

      using graph = new ModuleGraph();
      const inGraph = await graph.import(file);
      const host = await import(file);
      expect(inGraph.resolveAll(other)).toEqual({
        resolve: pathToFileURL(other).href,
        resolveSync: other,
        bunResolveSync: other,
        requireResolve: other,
      });
      expect(inGraph.resolveAll(other)).toEqual(host.resolveAll(other));
      expect(inGraph.resolveAll(pathToFileURL(other).href)).toEqual(host.resolveAll(pathToFileURL(other).href));
    });

    test("resolveSync with an explicit parent resolves against that parent", async () => {
      using dir = tempDir("module-graph-meta-resolve-parent", files);
      const file = join(String(dir), "src", "resolver.mjs");
      const parent = join(String(dir), "other", "sibling.mjs");

      using graph = new ModuleGraph();
      const inGraph = (await graph.import(file)).resolveFrom("./sibling.mjs", parent);
      expect(inGraph).toBe(join(String(dir), "other", "sibling.mjs"));
      expect(inGraph).toBe((await import(file)).resolveFrom("./sibling.mjs", parent));
    });

    test("a specifier that does not resolve fails as in the host", async () => {
      using dir = tempDir("module-graph-meta-resolve-missing", files);
      const file = join(String(dir), "src", "resolver.mjs");

      using graph = new ModuleGraph();
      const inGraph = await graph.import(file);
      const host = await import(file);
      for (const specifier of ["./missing.mjs", "missing-package", "conditional/not-exported"]) {
        const failures = inGraph.failures(specifier);
        expect(failures).toEqual(host.failures(specifier));
        expect(failures.resolveSync).toMatchObject({ name: "ResolveMessage", code: "ERR_MODULE_NOT_FOUND" });
      }
      expect(inGraph.meta.resolve("./missing.mjs")).toBe(host.meta.resolve("./missing.mjs"));
    });

    test("the resolve functions called by the host resolve against the graph module", async () => {
      using dir = tempDir("module-graph-meta-resolve-host-call", files);
      const file = join(String(dir), "src", "resolver.mjs");
      const sibling = join(String(dir), "src", "sibling.mjs");

      using graph = new ModuleGraph();
      const { meta } = await graph.import(file);
      expect({
        resolve: meta.resolve("./sibling.mjs"),
        resolveSync: meta.resolveSync("./sibling.mjs"),
        requireResolve: meta.require.resolve("./sibling.mjs"),
      }).toEqual({ resolve: pathToFileURL(sibling).href, resolveSync: sibling, requireResolve: sibling });
    });
  });

  describe.skipIf(isWindows)("symlinks", () => {
    const files = {
      "real/target.mjs": `
        export const meta = import.meta;
        export const strings = { url: import.meta.url, path: import.meta.path, dir: import.meta.dir };
      `,
    };

    test("a symlinked file is the module at its real path", async () => {
      using dir = tempDir("module-graph-meta-symlink-file", files);
      const target = join(String(dir), "real", "target.mjs");
      const link = join(String(dir), "link.mjs");
      symlinkSync(target, link);

      using graph = new ModuleGraph();
      const viaLink = await graph.import(link);
      const hostViaLink = await import(link);

      expect(graph.mainModule).toBe(target);
      expect(await graph.import(target)).toBe(viaLink);
      expect(await import(target)).toBe(hostViaLink);
      expect(viaLink.meta).not.toBe(hostViaLink.meta);
      expect(viaLink.meta.main).toBe(true);
      expect(viaLink.strings).toEqual({
        url: pathToFileURL(target).href,
        path: target,
        dir: join(String(dir), "real"),
      });
      expect(viaLink.strings).toEqual(hostViaLink.strings);
    });

    test("a module under a symlinked directory is the module at its real path", async () => {
      using dir = tempDir("module-graph-meta-symlink-dir", files);
      const target = join(String(dir), "real", "target.mjs");
      symlinkSync(join(String(dir), "real"), join(String(dir), "linked"));
      const viaLinkedDir = join(String(dir), "linked", "target.mjs");

      using graph = new ModuleGraph();
      const inGraph = await graph.import(viaLinkedDir);
      const host = await import(viaLinkedDir);

      expect(graph.mainModule).toBe(target);
      expect(await graph.import(target)).toBe(inGraph);
      expect(await graph.import(pathToFileURL(viaLinkedDir).href)).toBe(inGraph);
      expect(await import(target)).toBe(host);
      expect(inGraph.strings).toEqual({
        url: pathToFileURL(target).href,
        path: target,
        dir: join(String(dir), "real"),
      });
      expect(inGraph.strings).toEqual(host.strings);
    });
  });
});

describe("import.meta.main and graph.mainModule", () => {
  test("mainModule is undefined until the first import", () => {
    using graph = new ModuleGraph();
    using withOptions = new ModuleGraph({ globals: { mainModule: "not this" }, onError() {} });
    expect([graph.mainModule, withOptions.mainModule]).toEqual([undefined, undefined]);
  });

  test("mainModule is the first import's resolved path and later imports do not change it", async () => {
    using dir = tempDir("module-graph-main-first", {
      "first.mjs": `export {};`,
      "second.mjs": `export {};`,
    });
    const first = join(String(dir), "first.mjs");
    const second = join(String(dir), "second.mjs");

    using graph = new ModuleGraph();
    await graph.import(first);
    expect(graph.mainModule).toBe(first);
    await graph.import(second);
    await graph.import(first);
    await graph.import("node:path");
    expect(graph.mainModule).toBe(first);
  });

  test("import.meta.main is true in the main module only", async () => {
    using dir = tempDir("module-graph-main-only", {
      "only-leaf.mjs": `export const leafMain = import.meta.main;`,
      "only-dep.mjs": `
        export * from "./only-leaf.mjs";
        export const depMain = import.meta.main;
      `,
      "only-main.mjs": `
        export * from "./only-dep.mjs";
        export const main = import.meta.main;
        export const lazyMain = () => import.meta.main;
        export async function dynamicMain() { return (await import("./only-dynamic.mjs")).dynamicMain; }
      `,
      "only-dynamic.mjs": `export const dynamicMain = import.meta.main;`,
      "only-later-root.mjs": `
        export { main as importedMain } from "./only-main.mjs";
        export const laterRootMain = import.meta.main;
      `,
    });
    const main = join(String(dir), "only-main.mjs");

    using graph = new ModuleGraph();
    const inGraph = await graph.import(main);
    const laterRoot = await graph.import(join(String(dir), "only-later-root.mjs"));

    expect({
      main: inGraph.main,
      lazyMain: inGraph.lazyMain(),
      depMain: inGraph.depMain,
      leafMain: inGraph.leafMain,
      dynamicMain: await inGraph.dynamicMain(),
      laterRootMain: laterRoot.laterRootMain,
      importedMain: laterRoot.importedMain,
    }).toEqual({
      main: true,
      lazyMain: true,
      depMain: false,
      leafMain: false,
      dynamicMain: false,
      laterRootMain: false,
      importedMain: true,
    });
  });

  test("a later root's dependency is not main even when it was a root of another graph", async () => {
    using dir = tempDir("module-graph-main-per-graph", {
      "per-graph-a.mjs": `export const main = import.meta.main;`,
      "per-graph-b.mjs": `
        export { main as aMain } from "./per-graph-a.mjs";
        export const main = import.meta.main;
      `,
    });
    const fileA = join(String(dir), "per-graph-a.mjs");
    const fileB = join(String(dir), "per-graph-b.mjs");

    using a = new ModuleGraph();
    using b = new ModuleGraph();
    const aInA = await a.import(fileA);
    const bInB = await b.import(fileB);
    const bInA = await a.import(fileB);

    expect({
      mainModules: [a.mainModule, b.mainModule],
      a: { a: aInA.main, b: bInA.main, aThroughB: bInA.aMain },
      b: { b: bInB.main, aThroughB: bInB.aMain },
    }).toEqual({
      mainModules: [fileA, fileB],
      a: { a: true, b: false, aThroughB: true },
      b: { b: true, aThroughB: false },
    });
  });

  test("mainModule is already set while the main module evaluates", async () => {
    using dir = tempDir("module-graph-main-during-evaluation", {
      "during.mjs": `
        export const seen = holder.graph.mainModule;
        await Promise.resolve();
        export const seenAfterAwait = holder.graph.mainModule;
      `,
    });
    const file = join(String(dir), "during.mjs");

    const holder = graphWithHolder();
    using graph = holder.graph;
    const promise = graph.import(file);
    expect(graph.mainModule).toBe(file);
    expect(await promise).toEqual(expect.objectContaining({ seen: file, seenAfterAwait: file }));
  });

  test("the first of two concurrent imports is the main module", async () => {
    using dir = tempDir("module-graph-main-concurrent", {
      "concurrent-first.mjs": `
        await Promise.resolve();
        export const main = import.meta.main;
      `,
      "concurrent-second.mjs": `export const main = import.meta.main;`,
    });
    const first = join(String(dir), "concurrent-first.mjs");
    const second = join(String(dir), "concurrent-second.mjs");

    using graph = new ModuleGraph();
    const [inFirst, inSecond] = await Promise.all([graph.import(first), graph.import(second)]);
    expect({ mainModule: graph.mainModule, first: inFirst.main, second: inSecond.main }).toEqual({
      mainModule: first,
      first: true,
      second: false,
    });
  });

  test("mainModule is set by a first import that fails to parse", async () => {
    using dir = tempDir("module-graph-main-syntax-error", {
      "syntax-error.mjs": `export const x = ;`,
      "after-syntax-error.mjs": `export const main = import.meta.main;`,
    });
    const broken = join(String(dir), "syntax-error.mjs");

    using graph = new ModuleGraph();
    expect(
      await graph.import(broken).then(
        () => "resolved",
        () => "rejected",
      ),
    ).toBe("rejected");
    expect(graph.mainModule).toBe(broken);

    const after = await graph.import(join(String(dir), "after-syntax-error.mjs"));
    expect([graph.mainModule, after.main]).toEqual([broken, false]);
  });

  test("mainModule is set by a first import that throws while evaluating", async () => {
    using dir = tempDir("module-graph-main-throws", {
      "throws.mjs": `
        holder.mainWhileEvaluating = import.meta.main;
        throw new Error("thrown by throws.mjs");
      `,
      "after-throws.mjs": `export const main = import.meta.main;`,
    });
    const throws = join(String(dir), "throws.mjs");

    const holder = graphWithHolder();
    using graph = holder.graph;
    expect(graph.import(throws)).rejects.toThrow("thrown by throws.mjs");
    await graph.import(throws).catch(() => {});
    expect([graph.mainModule, holder.mainWhileEvaluating]).toEqual([throws, true]);

    const after = await graph.import(join(String(dir), "after-throws.mjs"));
    expect([graph.mainModule, after.main]).toEqual([throws, false]);
  });

  test("mainModule is set by a first import whose dependency is missing", async () => {
    using dir = tempDir("module-graph-main-missing-dep", {
      "missing-dep.mjs": `import "./this-file-does-not-exist.mjs";`,
    });
    const file = join(String(dir), "missing-dep.mjs");

    using graph = new ModuleGraph();
    expect(await rejection(graph.import(file))).toMatchObject({ code: "ERR_MODULE_NOT_FOUND" });
    expect(graph.mainModule).toBe(file);
  });

  test("an import that does not resolve leaves mainModule for the next import", async () => {
    using dir = tempDir("module-graph-main-unresolved", {
      "resolves.mjs": `export const main = import.meta.main;`,
    });
    const file = join(String(dir), "resolves.mjs");

    using graph = new ModuleGraph();
    const unresolved = [
      join(String(dir), "unresolved.mjs"),
      "./unresolved-relative.mjs",
      "unresolved-package-for-module-graph",
      "",
      Symbol("not a specifier"),
      {
        toString() {
          throw new Error("toString");
        },
      },
    ];
    for (const specifier of unresolved) {
      expect(
        await graph.import(specifier).then(
          () => "resolved",
          () => "rejected",
        ),
      ).toBe("rejected");
      expect(graph.mainModule).toBeUndefined();
    }

    const inGraph = await graph.import(file);
    expect([graph.mainModule, inGraph.main]).toEqual([file, true]);
  });

  test("mainModule is a path when the first import is a file: URL", async () => {
    using dir = tempDir("module-graph-main-url", {
      "url-string.mjs": `export const main = import.meta.main;`,
      "url-object.mjs": `export const main = import.meta.main;`,
    });
    const urlString = join(String(dir), "url-string.mjs");
    const urlObject = join(String(dir), "url-object.mjs");

    using a = new ModuleGraph();
    using b = new ModuleGraph();
    const inA = await a.import(pathToFileURL(urlString).href);
    const inB = await b.import(pathToFileURL(urlObject));
    expect({ a: [a.mainModule, inA.main], b: [b.mainModule, inB.main] }).toEqual({
      a: [urlString, true],
      b: [urlObject, true],
    });
  });

  test("mainModule is the resolved specifier when the first import is a builtin", async () => {
    using dir = tempDir("module-graph-main-builtin", {
      "after-builtin.mjs": `export const main = import.meta.main;`,
    });

    using a = new ModuleGraph();
    using b = new ModuleGraph();
    await a.import("path");
    await b.import("bun:jsc");
    const after = await a.import(join(String(dir), "after-builtin.mjs"));
    expect({ a: a.mainModule, b: b.mainModule, afterMain: after.main }).toEqual({
      a: "node:path",
      b: "bun:jsc",
      afterMain: false,
    });
  });

  // The main module is the instance `graph.import()` created: its key, query included, is `mainModule`.
  test("the first import with a ?query is the main module", async () => {
    using dir = tempDir("module-graph-main-query", {
      "query-main.mjs": `export const main = import.meta.main;`,
    });
    const file = join(String(dir), "query-main.mjs");

    using graph = new ModuleGraph();
    const withQuery = await graph.import(file + "?tenant=1");
    const plain = await graph.import(file);
    expect({ mainModule: graph.mainModule, withQuery: withQuery.main, plain: plain.main }).toEqual({
      mainModule: file + "?tenant=1",
      withQuery: true,
      plain: false,
    });
  });

  test("mainModule is relative to the module that called import()", async () => {
    using dir = tempDir("module-graph-main-relative", {
      "nested/relative-main.mjs": `export const main = import.meta.main;`,
      "nested/relative-caller.mjs": `
        export async function importInto(graph, specifier) { return await graph.import(specifier); }
      `,
    });

    using outer = new ModuleGraph();
    using inner = new ModuleGraph();
    const caller = await outer.import(join(String(dir), "nested", "relative-caller.mjs"));
    const inInner = await caller.importInto(inner, "./relative-main.mjs");
    expect([inner.mainModule, inInner.main]).toEqual([join(String(dir), "nested", "relative-main.mjs"), true]);
  });

  test("dispose() does not change mainModule", async () => {
    using dir = tempDir("module-graph-main-dispose", {
      "disposed-main.mjs": `export const main = () => import.meta.main;`,
    });
    const file = join(String(dir), "disposed-main.mjs");

    const graph = new ModuleGraph();
    const inGraph = await graph.import(file);
    graph.dispose();
    expect([graph.mainModule, inGraph.main()]).toEqual([file, true]);

    const neverImported = new ModuleGraph();
    neverImported.dispose();
    expect(await rejection(neverImported.import(file))).toMatchObject({ code: "ERR_INVALID_STATE" });
    expect(neverImported.mainModule).toBeUndefined();
  });

  test("mainModule is a read-only accessor on the prototype", async () => {
    using dir = tempDir("module-graph-main-accessor", { "accessor.mjs": `export {};` });
    const file = join(String(dir), "accessor.mjs");

    using graph = new ModuleGraph();
    await graph.import(file);

    const descriptor = Object.getOwnPropertyDescriptor(ModuleGraph.prototype, "mainModule")!;
    expect(Object.hasOwn(graph, "mainModule")).toBe(false);
    expect(descriptor).toEqual({ get: expect.any(Function), set: undefined, enumerable: true, configurable: true });
    expect(() => {
      graph.mainModule = "assigned";
    }).toThrow(TypeError);
    expect(Reflect.set(graph, "mainModule", "assigned")).toBe(false);
    expect(graph.mainModule).toBe(file);
  });

  test("the mainModule getter throws a TypeError on another receiver", () => {
    const { get } = Object.getOwnPropertyDescriptor(ModuleGraph.prototype, "mainModule")!;
    for (const receiver of [undefined, null, {}, ModuleGraph.prototype, Object.create(new ModuleGraph())]) {
      expect(() => get!.call(receiver)).toThrow(TypeError);
    }
    expect(() => ModuleGraph.prototype.mainModule).toThrow(TypeError);
  });

  test("graphs never change the host's import.meta.main or Bun.main", async () => {
    using dir = tempDir("module-graph-main-host", {
      "host-main.mjs": `
        export const main = import.meta.main;
        export const bunMain = Bun.main;
        export const processArgv1 = process.argv[1];
      `,
    });
    const file = join(String(dir), "host-main.mjs");
    const before = { main: import.meta.main, bunMain: Bun.main, argv1: process.argv[1] };

    using graph = new ModuleGraph();
    const inGraph = await graph.import(file);
    const host = await import(file);

    expect({ main: import.meta.main, bunMain: Bun.main, argv1: process.argv[1] }).toEqual(before);
    expect({ main: inGraph.main, bunMain: inGraph.bunMain, argv1: inGraph.processArgv1 }).toEqual({
      main: true,
      bunMain: before.bunMain,
      argv1: before.argv1,
    });
    expect(host.main).toBe(false);
  });
});

describe("graph.import() specifiers", () => {
  test("an absolute path, a file: URL string, a URL and an object with toString() name the same module", async () => {
    using dir = tempDir("module-graph-specifier-forms", { "forms.mjs": `export const meta = import.meta;` });
    const file = join(String(dir), "forms.mjs");

    using graph = new ModuleGraph();
    const inGraph = await graph.import(file);
    const others = await Promise.all([
      graph.import(pathToFileURL(file).href),
      graph.import(pathToFileURL(file)),
      graph.import({ toString: () => file }),
      graph.import(new String(file)),
      graph.import(join(String(dir), ".", "nested", "..", "forms.mjs")),
    ]);
    expect(others.map(ns => ns === inGraph)).toEqual([true, true, true, true, true]);
    expect(inGraph).not.toBe(await import(file));
  });

  test("a file: URL with percent-encoding names the decoded path", async () => {
    using dir = tempDir("module-graph-specifier-encoded", {
      "encoded name é.mjs": `export const file = import.meta.file;`,
    });
    const file = join(String(dir), "encoded name é.mjs");

    using graph = new ModuleGraph();
    const inGraph = await graph.import(pathToFileURL(file).href);
    expect(pathToFileURL(file).href).toContain("encoded%20name%20%C3%A9.mjs");
    expect(inGraph.file).toBe("encoded name é.mjs");
    expect(await graph.import(file)).toBe(inGraph);
  });

  test("each ?query is its own module instance, as in the host", async () => {
    using dir = tempDir("module-graph-specifier-query", {
      "query.mjs": `
        export const meta = import.meta;
        export let count = 0;
        export const increment = () => ++count;
      `,
    });
    const file = join(String(dir), "query.mjs");

    using graph = new ModuleGraph();
    const [plain, a, b] = [await graph.import(file), await graph.import(file + "?a"), await graph.import(file + "?b")];
    const [hostPlain, hostA] = [await import(file), await import(file + "?a")];

    a.increment();
    expect(new Set([plain, a, b, hostPlain, hostA]).size).toBe(5);
    expect(await graph.import(file + "?a")).toBe(a);
    expect([plain.count, a.count, b.count, hostA.count]).toEqual([0, 1, 0, 0]);
    expect({ url: a.meta.url, path: a.meta.path, file: a.meta.file }).toEqual({
      url: hostA.meta.url,
      path: hostA.meta.path,
      file: hostA.meta.file,
    });
    expect(a.meta.url).toBe(pathToFileURL(file).href + "?a");
  });

  test("a relative specifier resolves against the module that called import()", async () => {
    using dir = tempDir("module-graph-specifier-relative", {
      "where.mjs": `export const where = "root";`,
      "nested/where.mjs": `export const where = "nested";`,
      "nested/deeper/relative-caller.mjs": `
        export async function importRelative(specifier) { return await holder.graph.import(specifier); }
      `,
    });

    const holder = graphWithHolder();
    using graph = holder.graph;
    const caller = await graph.import(join(String(dir), "nested", "deeper", "relative-caller.mjs"));
    const nested = await caller.importRelative("../where.mjs");
    const root = await caller.importRelative("../../where.mjs");

    expect([nested.where, root.where]).toEqual(["nested", "root"]);
    expect(nested).toBe(await graph.import(join(String(dir), "nested", "where.mjs")));
  });

  test("a relative specifier from a host module resolves against that host module", async () => {
    using graph = new ModuleGraph();
    expect(await rejection(graph.import("./module-graph-import-meta-missing-fixture.mjs"))).toEqual({
      name: "ResolveMessage",
      code: "ERR_MODULE_NOT_FOUND",
      specifier: "./module-graph-import-meta-missing-fixture.mjs",
      referrer: import.meta.path,
    });
  });

  test("a relative specifier from another graph's module resolves against that module", async () => {
    using dir = tempDir("module-graph-specifier-cross-graph", {
      "cross/target.mjs": `export const meta = import.meta;`,
      "cross/cross-caller.mjs": `
        export async function importInto(graph, specifier) { return await graph.import(specifier); }
        export async function importHere(specifier) { return await import(specifier); }
      `,
    });

    using outer = new ModuleGraph();
    using inner = new ModuleGraph();
    const caller = await outer.import(join(String(dir), "cross", "cross-caller.mjs"));
    const inInner = await caller.importInto(inner, "./target.mjs");
    const inOuter = await caller.importHere("./target.mjs");

    expect(inInner).not.toBe(inOuter);
    expect(inInner).toBe(await inner.import(join(String(dir), "cross", "target.mjs")));
    expect(inOuter).toBe(await outer.import(join(String(dir), "cross", "target.mjs")));
    expect(inInner.meta.url).toBe(inOuter.meta.url);
  });

  test("an extensionless path and a directory resolve as in the host", async () => {
    using dir = tempDir("module-graph-specifier-extensionless", {
      "extensionless.mjs": `export const which = "file";`,
      "directory/index.mjs": `export const which = "index";`,
    });

    using graph = new ModuleGraph();
    const file = await graph.import(join(String(dir), "extensionless"));
    const index = await graph.import(join(String(dir), "directory"));
    expect([file.which, index.which]).toEqual(["file", "index"]);
    expect(file).toBe(await graph.import(join(String(dir), "extensionless.mjs")));
    expect(index).toBe(await graph.import(join(String(dir), "directory", "index.mjs")));
    expect([
      (await import(join(String(dir), "extensionless"))).which,
      (await import(join(String(dir), "directory"))).which,
    ]).toEqual(["file", "index"]);
  });

  describe("packages", () => {
    const files = {
      "package.json": `{ "name": "module-graph-specifier-packages-root" }`,
      "node_modules/dual/package.json": JSON.stringify({
        name: "dual",
        exports: {
          ".": { import: "./dual-esm.mjs", require: "./dual-cjs.cjs" },
          "./state": "./dual-state.mjs",
        },
      }),
      "node_modules/dual/dual-esm.mjs": `
        export const kind = "esm";
        export const meta = import.meta;
      `,
      "node_modules/dual/dual-cjs.cjs": `exports.kind = "cjs";`,
      "node_modules/dual/dual-state.mjs": `
        export let count = 0;
        export const increment = () => ++count;
      `,
      "node_modules/typed-module/package.json": JSON.stringify({
        name: "typed-module",
        type: "module",
        main: "./main.js",
      }),
      "node_modules/typed-module/main.js": `
        export const isModule = typeof module === "undefined" && typeof import.meta.url === "string";
        export const meta = import.meta;
      `,
      "app/importer.mjs": `
        export async function viaGraph(specifier) { return await holder.graph.import(specifier); }
        export async function viaImport(specifier) { return await import(specifier); }
        export function viaRequire(specifier) { return import.meta.require(specifier); }
      `,
    };

    test("a bare specifier resolves from the calling module's node_modules", async () => {
      using dir = tempDir("module-graph-specifier-bare", files);
      const esm = join(String(dir), "node_modules", "dual", "dual-esm.mjs");

      const holder = graphWithHolder();
      using graph = holder.graph;
      const importer = await graph.import(join(String(dir), "app", "importer.mjs"));
      const viaGraph = await importer.viaGraph("dual");

      expect(viaGraph).toBe(await importer.viaImport("dual"));
      expect(viaGraph).toBe(await graph.import(esm));
      expect({ kind: viaGraph.kind, url: viaGraph.meta.url, main: viaGraph.meta.main }).toEqual({
        kind: "esm",
        url: pathToFileURL(esm).href,
        main: false,
      });

      // The test module has no such package above it.
      expect(await rejection(graph.import("dual"))).toEqual({
        name: "ResolveMessage",
        code: "ERR_MODULE_NOT_FOUND",
        specifier: "dual",
        referrer: import.meta.path,
      });
    });

    test("`exports` conditions: import() takes `import`, import.meta.require() takes `require`", async () => {
      using dir = tempDir("module-graph-specifier-conditions", files);

      const holder = graphWithHolder();
      using graph = holder.graph;
      const importer = await graph.import(join(String(dir), "app", "importer.mjs"));
      const host = await import(join(String(dir), "app", "importer.mjs"));

      expect({
        viaGraph: (await importer.viaGraph("dual")).kind,
        viaImport: (await importer.viaImport("dual")).kind,
        viaRequire: importer.viaRequire("dual").kind,
      }).toEqual({ viaGraph: "esm", viaImport: "esm", viaRequire: "cjs" });
      // The CommonJS build is the one shared instance.
      expect(importer.viaRequire("dual")).toBe(host.viaRequire("dual"));
    });

    test("a package subpath is a per-graph instance", async () => {
      using dir = tempDir("module-graph-specifier-subpath", files);

      const holder = graphWithHolder();
      using graph = holder.graph;
      const importer = await graph.import(join(String(dir), "app", "importer.mjs"));
      const host = await import(join(String(dir), "app", "importer.mjs"));

      const state = await importer.viaGraph("dual/state");
      const hostState = await host.viaImport("dual/state");
      state.increment();
      expect([state.count, hostState.count, importer.viaRequire("dual/state").count]).toEqual([1, 0, 1]);
      expect(await rejection(importer.viaGraph("dual/not-exported"))).toMatchObject({
        name: "ResolveMessage",
        specifier: "dual/not-exported",
        referrer: join(String(dir), "app", "importer.mjs"),
      });
    });

    test('a .js file of a `"type": "module"` package is an ES module of the graph', async () => {
      using dir = tempDir("module-graph-specifier-type-module", files);
      const main = join(String(dir), "node_modules", "typed-module", "main.js");

      const holder = graphWithHolder();
      using graph = holder.graph;
      const importer = await graph.import(join(String(dir), "app", "importer.mjs"));
      const inGraph = await importer.viaGraph("typed-module");
      const host = await (await import(join(String(dir), "app", "importer.mjs"))).viaImport("typed-module");

      expect(inGraph).not.toBe(host);
      expect(inGraph.meta).not.toBe(host.meta);
      expect({ isModule: inGraph.isModule, url: inGraph.meta.url, hostUrl: host.meta.url }).toEqual({
        isModule: true,
        url: pathToFileURL(main).href,
        hostUrl: pathToFileURL(main).href,
      });
    });
  });

  test('a .js file next to a `"type": "module"` package.json is an ES module of the graph', async () => {
    using dir = tempDir("module-graph-specifier-type-module-local", {
      "package.json": `{ "type": "module" }`,
      "local-dep.js": `export let count = 0; export const increment = () => ++count;`,
      "local-main.js": `
        export * from "./local-dep.js";
        export const main = import.meta.main;
        export const isModule = typeof module === "undefined";
      `,
    });
    const file = join(String(dir), "local-main.js");

    using graph = new ModuleGraph();
    const inGraph = await graph.import(file);
    const host = await import(file);
    inGraph.increment();
    expect({ main: inGraph.main, isModule: inGraph.isModule, count: inGraph.count, hostCount: host.count }).toEqual({
      main: true,
      isModule: true,
      count: 1,
      hostCount: 0,
    });
  });

  test.each(["node:path", "path", "bun:jsc", "bun", "node:fs/promises"])(
    "%s exposes the host's exports",
    async specifier => {
      using graph = new ModuleGraph();
      const inGraph = await graph.import(specifier);
      const host = await import(specifier);

      expect(Object.keys(inGraph)).toEqual(Object.keys(host));
      expect(inGraph.default).toBe(host.default);
      for (const key of Object.keys(host)) expect(inGraph[key]).toBe(host[key]);
      expect(await graph.import(specifier)).toBe(inGraph);
    },
  );

  test("`path` and `node:path` are one module of the graph", async () => {
    using graph = new ModuleGraph();
    expect(await graph.import("path")).toBe(await graph.import("node:path"));
    expect((await graph.import("node:path")).join).toBe(join);
  });

  test("a data: URL is a module of the graph", async () => {
    using graph = new ModuleGraph({ globals: { tenant: "a" } });
    const specifier = "data:text/javascript,export default typeof tenant;";
    const inGraph = await graph.import(specifier);
    expect(inGraph.default).toBe("string");
    expect(await graph.import(specifier)).toBe(inGraph);
  });

  describe("rejects and never throws", () => {
    test.each([
      ["a number", 42, "42"],
      ["a bigint", 10n, "10"],
      ["a boolean", true, "true"],
      ["null", null, "null"],
      ["undefined", undefined, "undefined"],
      ["an object with toString()", { toString: () => "module-graph-no-such-package" }, "module-graph-no-such-package"],
      ["an empty string", "", ""],
    ])("%s that does not resolve", async (_, value, specifier) => {
      using graph = new ModuleGraph();
      let promise!: Promise<unknown>;
      expect(() => {
        promise = graph.import(value);
      }).not.toThrow();
      expect(promise).toBeInstanceOf(Promise);
      expect(await rejection(promise)).toEqual({
        name: "ResolveMessage",
        code: "ERR_MODULE_NOT_FOUND",
        specifier,
        referrer: import.meta.path,
      });
    });

    test("no argument", async () => {
      using graph = new ModuleGraph();
      let promise!: Promise<unknown>;
      expect(() => {
        promise = graph.import();
      }).not.toThrow();
      expect(await rejection(promise)).toMatchObject({ name: "ResolveMessage", specifier: "undefined" });
    });

    test("a Symbol", async () => {
      using graph = new ModuleGraph();
      let promise!: Promise<unknown>;
      expect(() => {
        promise = graph.import(Symbol("specifier"));
      }).not.toThrow();
      expect(promise).toBeInstanceOf(Promise);
      expect(promise).rejects.toBeInstanceOf(TypeError);
    });

    test("an object whose toString() throws", async () => {
      using graph = new ModuleGraph();
      const thrown = new RangeError("thrown by toString");
      let promise!: Promise<unknown>;
      expect(() => {
        promise = graph.import({
          toString() {
            throw thrown;
          },
        });
      }).not.toThrow();
      expect(
        await promise.then(
          () => "resolved",
          error => error,
        ),
      ).toBe(thrown);
    });

    test("a missing file", async () => {
      using dir = tempDir("module-graph-specifier-missing", { "present.mjs": `export {};` });
      const missing = join(String(dir), "missing.mjs");

      using graph = new ModuleGraph();
      let promise!: Promise<unknown>;
      expect(() => {
        promise = graph.import(missing);
      }).not.toThrow();
      const error = await promise.then(
        () => "resolved",
        error => error,
      );
      expect({ name: error.name, code: error.code, specifier: error.specifier, referrer: error.referrer }).toEqual({
        name: "ResolveMessage",
        code: "ERR_MODULE_NOT_FOUND",
        specifier: missing,
        referrer: import.meta.path,
      });
      expect(error.message).toContain(missing);
      expect(await rejection(graph.import(pathToFileURL(missing).href))).toMatchObject({
        code: "ERR_MODULE_NOT_FOUND",
      });
      // The host reports the same failure.
      expect(await rejection(import(missing))).toEqual(await rejection(graph.import(missing)));
    });

    test("a path with a #fragment, as in the host", async () => {
      using dir = tempDir("module-graph-specifier-fragment", { "fragment.mjs": `export {};` });
      const specifier = join(String(dir), "fragment.mjs") + "#fragment";

      using graph = new ModuleGraph();
      expect(await rejection(graph.import(specifier))).toEqual(await rejection(import(specifier)));
    });
  });

  test("a rejected import does not poison the graph", async () => {
    using dir = tempDir("module-graph-specifier-recover", { "recover.mjs": `export const ok = true;` });

    using graph = new ModuleGraph();
    expect(await rejection(graph.import(join(String(dir), "recover-missing.mjs")))).toMatchObject({
      code: "ERR_MODULE_NOT_FOUND",
    });
    expect((await graph.import(join(String(dir), "recover.mjs"))).ok).toBe(true);
  });
});

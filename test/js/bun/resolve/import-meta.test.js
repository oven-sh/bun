import { spawnSync } from "bun";
import { isModuleResolveFilenameSlowPathEnabled } from "bun:internal-for-testing";
import { expect, it, mock, spyOn } from "bun:test";
import { bunEnv, bunExe, expectRssDeltaBelow, ospath, tempDir } from "harness";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import Module from "node:module";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import sync from "./require-json.json";

const { path, dir, dirname, filename } = import.meta;

const tmpbase = tmpdir() + sep;

it("import.meta.require is settable", () => {
  const old = import.meta.require;
  const fn = mock(() => "hello");
  import.meta.require = fn;
  expect(import.meta.require("hello")).toBe("hello");
  import.meta.require = old;
  expect(fn).toHaveBeenCalledTimes(1);
});

it("import.meta.main", () => {
  const { exitCode } = spawnSync({
    cmd: [bunExe(), "run", join(import.meta.dir, "./main-test-script.js")],
    env: bunEnv,
    stderr: "inherit",
    stdout: "inherit",
    stdin: null,
  });
  expect(exitCode).toBe(0);
});

it("import.meta.main follows a Bun.main override but not an own path property, is readable from a vm context, and is false in workers", async () => {
  using dir = tempDir("import-meta-main", {
    "entry.mjs": `
      import { runInNewContext } from "node:vm";
      import { Worker, isMainThread, parentPort } from "node:worker_threads";
      if (isMainThread) {
        const worker = new Worker(new URL(import.meta.url));
        const fromWorker = new Promise((resolve, reject) => {
          worker.once("message", resolve);
          worker.once("error", reject);
        });
        const other = await import("./other.mjs");
        const entryPath = import.meta.path;
        const before = [import.meta.main, other.main()];
        const vmContext = [import.meta, other.meta].map(meta => runInNewContext("meta.main", { meta }));
        Bun.main = other.path;
        const after = [import.meta.main, other.main()];
        // main is computed from the module's own path, so swapping the visible path properties changes nothing.
        Object.defineProperty(import.meta, "path", { value: other.path });
        Object.defineProperty(other.meta, "path", { value: entryPath });
        const ownPath = [import.meta.main, other.main()];
        console.log(JSON.stringify({ before, vmContext, after, ownPath, worker: await fromWorker }));
        await worker.terminate();
      } else {
        parentPort.postMessage(import.meta.main);
      }
    `,
    "other.mjs": `
      export const meta = import.meta;
      export const path = import.meta.path;
      export const main = () => import.meta.main;
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "entry.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(JSON.parse(stdout)).toEqual({
    before: [true, false],
    vmContext: [true, false],
    after: [false, true],
    ownPath: [false, true],
    worker: false,
  });
  expect(exitCode).toBe(0);
});

it("import.meta.resolveSync", () => {
  expect(import.meta.resolveSync("./" + import.meta.file, import.meta.path)).toBe(path);
});

it("a spy on import.meta.resolve wraps the function of the module, and mockRestore() brings it back", () => {
  const { resolve } = import.meta;
  const spy = spyOn(import.meta, "resolve");
  try {
    expect(import.meta.resolve("./made-up.mjs")).toBe(new URL("./made-up.mjs", import.meta.url).href);
    expect(spy.mock.calls).toEqual([["./made-up.mjs"]]);
    spy.mockReturnValue("mocked");
    expect(import.meta.resolve("./made-up.mjs")).toBe("mocked");
  } finally {
    spy.mockRestore();
  }
  expect(import.meta.resolve).toBe(resolve);
  delete import.meta.resolve;
  expect(import.meta.resolve).toBe(resolve);
});

// The folder and the file of an answer: they say which module it was resolved from.
const fromWhere = `answer => answer.replaceAll("\\\\", "/").split("/").slice(-2).join("/")`;

it.concurrent(
  "import.meta.resolve and import.meta.resolveSync resolve from the module they were read from",
  async () => {
    using dir = tempDir("import-meta-resolve-detached", {
      "app/main.mjs": `
      import { createRequire } from "node:module";
      import { runInNewContext } from "node:vm";
      import { locate, helperMeta } from "../lib/locate.mjs";
      import { besideAnExportedPath } from "../lib/exports-path.mjs";

      const from = ${fromWhere};
      const { resolve, resolveSync } = import.meta;

      // A variable named \`path\` that the calls below can see. Its value is computed: a string literal would be inlined.
      const path = [import.meta.dir, "..", "lib", "locate.mjs"].join("/");
      const inAClosure = name => [from(resolve(name)), from(resolveSync(name)), path.endsWith("locate.mjs")];

      const worker = new Worker(new URL("./worker.mjs", import.meta.url));
      const fromWorker = await new Promise((done, failed) => {
        worker.onmessage = event => done(event.data);
        worker.onerror = failed;
      });
      await worker.terminate();

      console.log(JSON.stringify({
        destructured: ["./logo.txt", "./style.txt"].map(name => from(resolve(name))),
        handedToAHelper: locate(import.meta.resolve, "./logo.txt"),
        asACallback: ["./logo.txt", "./style.txt"].map(import.meta.resolve).map(from),
        inAClosure: inAClosure("./logo.txt"),
        ofTheOtherModule: [
          from(helperMeta.resolve.call(import.meta, "./logo.txt")),
          from(helperMeta.resolveSync.call(import.meta, "./logo.txt")),
        ],
        onePerModule: [resolve !== helperMeta.resolve, resolveSync !== helperMeta.resolveSync],
        besideAnExportedPath: besideAnExportedPath(),
        throughOtherReceivers: [
          Object.create(import.meta).resolve("./logo.txt"),
          Object.create(Object.create(import.meta)).resolveSync("./logo.txt"),
          new Proxy(import.meta, {}).resolve("./logo.txt"),
          new Proxy(Object.create(import.meta), {}).resolveSync("./logo.txt"),
          Object.create(helperMeta).resolve("./logo.txt"),
        ].map(from),
        sameThroughOtherReceivers: [
          Object.create(import.meta).resolve === resolve,
          new Proxy(import.meta, {}).resolveSync === resolveSync,
        ],
        commonJS: createRequire(import.meta.url)("../lib/common.cjs"),
        calledInAnotherRealm: from(
          runInNewContext("const { resolve } = meta; resolve(name)", { meta: import.meta, name: "./logo.txt" }),
        ),
        worker: fromWorker,
      }));
    `,
      "app/worker.mjs": `
      const { resolve, resolveSync } = import.meta;
      postMessage([resolve("./logo.txt"), resolveSync("./logo.txt")].map(${fromWhere}));
    `,
      "app/logo.txt": "",
      "app/style.txt": "",
      "lib/locate.mjs": `
      export const helperMeta = import.meta;
      export function locate(resolve, name) {
        return (${fromWhere})(resolve(name));
      }
    `,
      // The calls find \`resolve\` and the exported \`path\` in one scope.
      "lib/exports-path.mjs": `
      export const path = "/exported/elsewhere.mjs";
      const { resolve, resolveSync } = import.meta;
      export const besideAnExportedPath = () => [resolve("./logo.txt"), resolveSync("./logo.txt")].map(${fromWhere});
    `,
      "lib/common.cjs": `
      const { resolve, resolveSync } = import.meta;
      module.exports = [resolve("./logo.txt"), resolveSync("./logo.txt")].map(${fromWhere});
    `,
      "lib/logo.txt": "",
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "app/main.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
      stdout: {
        destructured: ["app/logo.txt", "app/style.txt"],
        handedToAHelper: "app/logo.txt",
        asACallback: ["app/logo.txt", "app/style.txt"],
        inAClosure: ["app/logo.txt", "app/logo.txt", true],
        ofTheOtherModule: ["lib/logo.txt", "lib/logo.txt"],
        onePerModule: [true, true],
        besideAnExportedPath: ["lib/logo.txt", "lib/logo.txt"],
        throughOtherReceivers: ["app/logo.txt", "app/logo.txt", "app/logo.txt", "app/logo.txt", "lib/logo.txt"],
        sameThroughOtherReceivers: [true, true],
        commonJS: ["lib/logo.txt", "lib/logo.txt"],
        calledInAnotherRealm: "app/logo.txt",
        worker: ["app/logo.txt", "app/logo.txt"],
      },
      stderr: "",
      exitCode: 0,
    });
  },
);

it.concurrent("an onResolve plugin is given the module of a detached import.meta.resolve as the importer", async () => {
  using dir = tempDir("import-meta-resolve-importer", {
    "main.mjs": `
      const from = ${fromWhere};
      const importers = [];
      Bun.plugin({
        name: "importers",
        setup(build) {
          build.onResolve({ filter: /made-up/ }, ({ path, importer }) => {
            importers.push([path, from(importer)]);
            return { path: import.meta.dir + "/lib/found.mjs" };
          });
        },
      });
      const { resolve, resolveSync } = await import("./lib/asks.mjs");
      const answers = [resolve("./made-up.mjs"), resolve("made-up-package"), resolveSync("made-up-package")].map(from);
      console.log(JSON.stringify({ answers, importers }));
    `,
    "lib/asks.mjs": `export const { resolve, resolveSync } = import.meta;`,
    "lib/found.mjs": "",
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
    stdout: {
      answers: ["lib/found.mjs", "lib/found.mjs", "lib/found.mjs"],
      importers: [
        ["./made-up.mjs", "lib/asks.mjs"],
        ["made-up-package", "lib/asks.mjs"],
        ["made-up-package", "lib/asks.mjs"],
      ],
    },
    stderr: "",
    exitCode: 0,
  });
});

it.concurrent("import.meta.resolve is made for an import.meta that is frozen, sealed or not extensible", async () => {
  const modes = { freeze: "isFrozen", seal: "isSealed", preventExtensions: "isExtensible" };
  using dir = tempDir("import-meta-resolve-integrity", {
    "main.mjs": `
      const answers = {};
      for (const mode of ${JSON.stringify(Object.keys(modes))}) answers[mode] = (await import("./" + mode + ".mjs")).default;
      console.log(JSON.stringify(answers));
    `,
    ...Object.fromEntries(
      Object.entries(modes).map(([mode, test]) => [
        `${mode}.mjs`,
        `
          Object.${mode}(import.meta);
          const before = Object.${test}(import.meta);
          const { resolve, resolveSync } = import.meta;
          let stored = true;
          try {
            import.meta.resolve = null;
          } catch {
            stored = false;
          }
          export default {
            resolved: resolve("./made-up.mjs") === new URL("./made-up.mjs", import.meta.url).href,
            resolvedSync: resolveSync("./${mode}.mjs") === import.meta.path,
            sameAtEveryRead: import.meta.resolve === resolve && import.meta.resolveSync === resolveSync,
            stored,
            ownKeys: Reflect.ownKeys(import.meta),
            stillAsBefore: Object.${test}(import.meta) === before,
          };
        `,
      ]),
    ),
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const answer = {
    resolved: true,
    resolvedSync: true,
    sameAtEveryRead: true,
    stored: false,
    ownKeys: [],
    stillAsBefore: true,
  };
  expect({ stdout: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
    stdout: { freeze: answer, seal: answer, preventExtensions: answer },
    stderr: "",
    exitCode: 0,
  });
});

it.concurrent(
  "an import.meta makes resolve and resolveSync at the first read of each, and nothing when it is created",
  async () => {
    const modules = 25;
    using dir = tempDir("import-meta-resolve-first-read", {
      "main.mjs": `
      import { heapStats } from "bun:jsc";
      // A function made for an import.meta is a Function. An accessor stored on one is a CustomGetterSetter.
      const count = () => {
        Bun.gc(true);
        const { Function = 0, CustomGetterSetter = 0 } = heapStats().objectTypeCounts;
        return Function + CustomGetterSetter;
      };
      const load = async name => (await import("./meta.mjs?" + name)).default;
      // The first one makes what is made once.
      const first = await load("first");
      first.url, first.resolve, first.resolveSync;

      const atFirst = count();
      const metas = [];
      for (let i = 0; i < ${modules}; i++) metas.push(await load(i));
      const created = count();
      for (const meta of metas) meta.url, meta.dir, meta.main;
      const readOthers = count();
      for (const meta of metas) meta.resolve, meta.resolve;
      const readResolve = count();
      for (const meta of metas) meta.resolveSync, meta.resolveSync;
      const readResolveSync = count();
      console.log(JSON.stringify({
        whenCreated: created - atFirst,
        byOtherMembers: readOthers - created,
        byResolve: readResolve - readOthers,
        byResolveSync: readResolveSync - readResolve,
      }));
    `,
      "meta.mjs": `export default import.meta;`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const made = JSON.parse(stdout);
    // Bounds, not equalities: a release build keeps one function of the last turn of a loop. A function made for each
    // import.meta when it is created would show as `modules` or more in whenCreated.
    expect(made.whenCreated).toBeLessThan(modules / 2);
    expect(made.byOtherMembers).toBeLessThan(modules / 2);
    expect(made.byResolve).toBeWithin(modules, modules + modules / 2);
    expect(made.byResolveSync).toBeWithin(modules, modules + modules / 2);
  },
);

it.concurrent(
  "a read of import.meta.resolve or import.meta.resolveSync changes nothing that import.meta lists",
  async () => {
    using dir = tempDir("import-meta-resolve-lists", {
      "main.mjs": `
      const lists = () => {
        const inLoop = [];
        for (const key in import.meta) inLoop.push(key);
        return JSON.stringify([
          Reflect.ownKeys(import.meta),
          Object.keys(import.meta),
          Object.getOwnPropertyNames(import.meta),
          Object.getOwnPropertySymbols(import.meta).length,
          Object.keys({ ...import.meta }),
          Object.entries(import.meta),
          inLoop,
          JSON.stringify(import.meta),
          Bun.inspect(import.meta),
          Object.getOwnPropertyDescriptor(import.meta, "resolve") ?? null,
        ]);
      };
      const before = lists();
      const { resolve, resolveSync } = import.meta;
      resolve("./main.mjs"), resolveSync("./main.mjs");
      console.log(JSON.stringify({ before: JSON.parse(before), same: lists() === before }));
    `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
      stdout: { before: [[], [], [], 0, [], [], [], "{}", "ImportMeta {}", null], same: true },
      stderr: "",
      exitCode: 0,
    });
  },
);

it.concurrent("import.meta.resolve works after its import.meta was collected, and does not keep it alive", async () => {
  using dir = tempDir("import-meta-resolve-kept", {
    "main.mjs": `
      import { heapStats } from "bun:jsc";
      import { createRequire } from "node:module";

      const require = createRequire(import.meta.url);
      const file = require.resolve("./kept.mjs");
      const kept = [];
      for (let i = 0; i < 500; i++) {
        // Without its entry in the cache the next import() makes a new module, with an import.meta of its own.
        delete require.cache[file];
        kept.push(await import("./kept.mjs").then(({ resolve, resolveSync }) => [resolve, resolveSync]));
      }
      Bun.gc(true);
      const metas = heapStats().objectTypeCounts.ImportMeta ?? 0;

      const answers = new Set();
      for (const [resolve, resolveSync] of kept) answers.add(resolve("./made-up.mjs")).add(resolveSync("./kept.mjs"));
      console.log(JSON.stringify({
        functions: new Set(kept.flat()).size,
        answers: [...answers].map(answer => answer.split(/[\\\\/]/).at(-1)),
        metasAreCollected: metas < 100 || metas,
      }));
    `,
    "kept.mjs": `export const { resolve, resolveSync } = import.meta;`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
    stdout: { functions: 1000, answers: ["made-up.mjs", "kept.mjs"], metasAreCollected: true },
    stderr: "",
    exitCode: 0,
  });
});

it("Module.createRequire", () => {
  const require = Module.createRequire(import.meta.path);
  expect(require.resolve(import.meta.path)).toBe(path);
  expect(require.resolve("./" + import.meta.file)).toBe(path);
  const { resolve } = require;
  expect(resolve("./" + import.meta.file)).toBe(path);

  // check it works with URL objects
  expect(Module.createRequire(new URL(import.meta.url)).resolve(import.meta.path)).toBe(import.meta.path);
});

it("Module.createRequire works with a file url", () => {
  const require = Module.createRequire(import.meta.url);
  expect(require.resolve(import.meta.path)).toBe(path);
  expect(require.resolve("./" + import.meta.file)).toBe(path);
  const { resolve } = require;
  expect(resolve("./" + import.meta.file)).toBe(path);
});

it("Module.createRequire works with a file url with a space", () => {
  const path = join(import.meta.dir, "with space/hello.js");
  const require = Module.createRequire(new URL("./with space/nonexist.js", import.meta.url).toString());
  expect(require.resolve(import.meta.path)).toBe(import.meta.path);
  expect(require.resolve("./hello")).toBe(path);
  const { resolve } = require;
  expect(resolve("./hello")).toBe(path);
});

it("Module.createRequire does not use file url as the referrer (err message check)", () => {
  const require = Module.createRequire(import.meta.url);
  try {
    require("whaaat");
    expect.unreachable();
  } catch (e) {
    expect(e.name).not.toBe("UnreachableError");
    expect(e.message).not.toInclude("file:///");
    expect(e.message).toInclude(`'whaaat'`);
    expect(e.message).toInclude(import.meta.path);
  }
});

it("require with a query string works on dynamically created content", () => {
  rmSync(tmpbase + "bun-test-import-meta-dynamic-dir", {
    recursive: true,
    force: true,
  });
  try {
    const require = Module.createRequire(tmpbase + "bun-test-import-meta-dynamic-dir/foo.js");
    try {
      require("./bar.js?query=123.js");
    } catch (e) {
      expect(e.name).toBe("ResolveMessage");
    }

    mkdirSync(tmpbase + "bun-test-import-meta-dynamic-dir", { recursive: true });

    writeFileSync(tmpbase + "bun-test-import-meta-dynamic-dir/bar.js", "export default 'hello';", "utf8");

    expect(require("./bar.js?query=123.js").default).toBe("hello");
  } catch (e) {
    throw e;
  } finally {
    rmSync(tmpbase + "bun-test-import-meta-dynamic-dir", {
      recursive: true,
      force: true,
    });
  }
});

it("import.meta.require (json)", () => {
  expect(import.meta.require("./require-json.json").hello).toBe(sync.hello);
  const require = Module.createRequire(import.meta.path);
  expect(require("./require-json").hello).toBe(sync.hello);
});

it("const f = require;require(json)", () => {
  function capture(f) {
    return f.length;
  }
  const f = require;
  capture(f);
  expect(f("./require-json.json").hello).toBe(sync.hello);
});

it("Module.createRequire().resolve", () => {
  const expected = Bun.resolveSync("./require-json.json", import.meta.dir);

  const createdRequire = Module.createRequire(import.meta.path);
  const result = createdRequire.resolve("./require-json.json");

  expect(result).toBe(expected);
});

// this isn't used in bun but exists anyway
// we just want it to not be undefined
it("Module._cache", () => {
  const expected = typeof Module._cache === "object" && Module._cache;
  expect(!!expected).toBe(true);
});

it("Module._resolveFilename()", () => {
  expect(isModuleResolveFilenameSlowPathEnabled()).toBe(false);
  const original = Module._resolveFilename;
  Module._resolveFilename = () => {};
  expect(isModuleResolveFilenameSlowPathEnabled()).toBe(true);
  Module._resolveFilename = original;
  expect(isModuleResolveFilenameSlowPathEnabled()).toBe(false);
});

it("Module.createRequire(file://url).resolve(file://url)", () => {
  const expected = Bun.resolveSync("./require-json.json", import.meta.dir);

  const createdRequire = Module.createRequire(import.meta.url);
  const result1 = createdRequire.resolve("./require-json.json");
  const result2 = createdRequire.resolve(`file://${expected}`);
  expect(result1).toBe(expected);
  expect(result2).toBe(expected);
});

it("import.meta.require.resolve", () => {
  const expected = Bun.resolveSync("./require-json.json", import.meta.dir);
  var { resolve } = import.meta.require;
  const result = resolve("./require-json.json");
  expect(result).toBe(expected);
});

it("import.meta.require (javascript)", () => {
  expect(import.meta.require("./require-js.js").hello).toBe(sync.hello);
  const require = Module.createRequire(import.meta.path);
  expect(require("./require-js.js").hello).toBe(sync.hello);
});

it("import() require + TLA", async () => {
  expect((await import("./import-require-tla.js")).foo).toBe("bar");
});

it("import.meta.require (javascript, live bindings)", () => {
  var Source = import.meta.require("./import.live.decl.js");

  // require transpiles to import.meta.require
  var ReExport = require("./import.live.rexport.js");

  // dynamic require (string interpolation that way forces it to be dynamic)
  var ReExportDynamic = require(`./import.live.${"rexport".split("").join("")}.js`);

  expect(Source.foo).toBe(1);
  Source.setFoo(Source.foo + 1);

  expect(ReExport.foo).toBe(2);
  expect(Source.foo).toBe(2);
  expect(ReExportDynamic.foo).toBe(2);

  Source.setFoo(Source.foo + 1);

  var { Namespace } = require("./import.live.rexport-require.js");

  expect(Namespace).toBe(Source);
  expect(ReExport.foo).toBe(3);
  expect(Source.foo).toBe(3);
  expect(Namespace.foo).toBe(3);

  ReExport.setFoo(ReExport.foo + 1);

  expect(ReExport.foo).toBe(4);
  expect(Source.foo).toBe(4);
  expect(Namespace.foo).toBe(4);
});

it("import.meta.dir", () => {
  expect(dir).toEndWith(ospath("/test/js/bun/resolve"));
});

it("import.meta.dirname", () => {
  expect(dirname).toBe(dir);
});

it("import.meta.filename", () => {
  expect(filename).toBe(import.meta.path);
});

it("import.meta.path", () => {
  expect(path).toEndWith(ospath("/test/js/bun/resolve/import-meta.test.js"));
});

it('require("bun") works', () => {
  expect(require("bun")).toBe(Bun);
});

it('import("bun") works', async () => {
  expect(await import("bun")).toBe(Bun);
});

it("require.resolve with empty options object", () => {
  expect(require.resolve(import.meta.path + String(""), {})).toBe(import.meta.path);
});

it("dynamically import bun", async () => {
  expect((await import(eval("'bun'"))).default).toBe(Bun);
});

it("require.resolve error code", () => {
  try {
    require.resolve("node:missing");
    throw 1;
  } catch (e) {
    expect(e.code).toBe("MODULE_NOT_FOUND");
  }
});

it("import non exist error code", async () => {
  try {
    await import("node:missing");
    throw 1;
  } catch (e) {
    expect(e.code).toBe("ERR_UNKNOWN_BUILTIN_MODULE");
  }
});

it("import non exist error code", async () => {
  try {
    await import("./idontexist");
    throw 1;
  } catch (e) {
    expect(e.code).toBe("ERR_MODULE_NOT_FOUND");
  }
});

it("import.meta paths have the correct slash", () => {
  const correct_sep = sep;
  const wrong_sep = correct_sep === "/" ? "\\" : "/";

  expect(import.meta.path).toInclude(correct_sep);
  expect(import.meta.path).not.toInclude(wrong_sep);
  expect(import.meta.dir).toInclude(correct_sep);
  expect(import.meta.dir).not.toInclude(wrong_sep);

  expect(import.meta.file).not.toInclude(sep);
  expect(import.meta.file).not.toInclude(sep);

  expect(import.meta.url).toStartWith("file:///");
  expect(import.meta.url).not.toInclude("\\");
});

it("import.meta is correct in a module that was imported with a query param", async () => {
  const esm = (await import("./other.js?foo=bar")).default;

  expect(esm.url).toBe(new URL("./other.js?foo=bar", import.meta.url).toString());
  expect(esm.path).toBe(join(import.meta.dir, "./other.js"));
  expect(esm.dir).toBe(import.meta.dir);
  expect(esm.file).toBe("other.js");
});

it("import.meta is correct in a module that was required with a query param", async () => {
  const cjs = require("./other-cjs.js?foo=bar").meta;
  expect(cjs.url).toBe(new URL("./other-cjs.js?foo=bar", import.meta.url).toString());
  expect(cjs.path).toBe(join(import.meta.dir, "./other-cjs.js"));
  expect(cjs.dir).toBe(import.meta.dir);
  expect(cjs.file).toBe("other-cjs.js");
});

it("import.meta of a collected module does not leak its url", async () => {
  // 200 module records with a 512 KB url each: 100 MiB when every one leaks.
  await expectRssDeltaBelow(["--smol", join(import.meta.dir, "import-meta-url-leak-fixture.mjs"), "200"], {
    release: 40,
    debug: 55,
  });
}, 90_000);

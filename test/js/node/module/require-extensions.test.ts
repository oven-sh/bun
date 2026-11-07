import assert from "assert";
import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, bunRun, tempDir } from "harness";
import path from "path";

test("require.extensions shape makes sense", () => {
  const extensions = require.extensions;
  expect(extensions).toBeDefined();
  expect(typeof extensions).toBe("object");
  expect(extensions[".js"]).toBeFunction();
  expect(extensions[".json"]).toBeFunction();
  expect(extensions[".node"]).toBeFunction();
  // When --experimental-strip-types is passed, TypeScript files can be loaded.
  expect(extensions[".cts"]).toBeFunction();
  expect(extensions[".ts"]).toBeFunction();
  expect(extensions[".mjs"]).toBeFunction();
  expect(extensions[".mts"]).toBeFunction();
  expect(require("module")._extensions === require.extensions).toBe(true);
});
test("custom require extension 1", () => {
  const custom = (require.extensions[".custom"] = mock(function (module, filename) {
    expect(filename).toBe(path.join(import.meta.dir, "extensions-fixture", "c.custom"));
    (module as any)._compile(`module.exports = 'custom';`, filename);
  }));
  const mod = require("./extensions-fixture/c");
  expect(mod).toBe("custom");
  expect(custom.mock.calls.length).toBe(1);
  delete require.extensions[".custom"];
  expect(() => require("./extensions-fixture/c")).toThrow(/Cannot find module/);
  expect(require("./extensions-fixture/c.custom")).toBe("custom"); // already loaded
  delete require.cache[require.resolve("./extensions-fixture/c.custom")];
  expect(custom.mock.calls.length).toBe(1);
  expect(require("./extensions-fixture/c.custom")).toBe("c dot custom"); // use js loader
});
test("custom require extension overwrite default loader", () => {
  const original = require.extensions[".js"];
  try {
    const custom = (require.extensions[".js"] = mock(function (module, filename) {
      expect(filename).toBe(path.join(import.meta.dir, "extensions-fixture", "d.js"));
      (module as any)._compile(`module.exports = 'custom';`, filename);
    }));
    const mod = require("./extensions-fixture/d");
    expect(mod).toBe("custom");
    expect(custom.mock.calls.length).toBe(1);
    require.extensions[".js"] = original;
    expect(require("./extensions-fixture/d")).toBe("custom"); // already loaded
    delete require.cache[require.resolve("./extensions-fixture/d")];
    expect(custom.mock.calls.length).toBe(1);
    expect(require("./extensions-fixture/d")).toBe("d.js"); // use js loader
  } finally {
    require.extensions[".js"] = original;
  }
});
test("custom require extension overwrite default loader with other default loader", () => {
  const original = require.extensions[".js"];
  try {
    require.extensions[".js"] = require.extensions[".ts"]!;
    const mod = require("./extensions-fixture/e.js"); // should not enter JS
    expect(mod).toBe("hello world");
  } finally {
    require.extensions[".js"] = original;
  }
});
test("test that assigning properties weirdly wont do anything bad", () => {
  const original = require.extensions[".js"];
  try {
    function f1() {}
    function f2() {}
    require.extensions[".js"] = f1;
    require.extensions[".abc"] = f2;
    require.extensions[".js"] = f2;
    require.extensions[".js"] = undefined!;
    require.extensions[".abc"] = undefined!;
    require.extensions[".abc"] = f1;
    require.extensions[".js"] = f2;
  } finally {
    require.extensions[".js"] = original;
  }
});
test("wrapping an existing extension with no logic", () => {
  const original = require.extensions[".js"];
  try {
    delete require.cache[require.resolve("./extensions-fixture/d")];
    const mocked = (require.extensions[".js"] = mock(function (module, filename) {
      expect(module).toBeDefined();
      expect(filename).toBe(path.join(import.meta.dir, "extensions-fixture", "d.js"));
      original(module, filename);
    }));
    const mod = require("./extensions-fixture/d");
    expect(mod).toBe("d.js");
    expect(mocked).toBeCalled();
  } finally {
    require.extensions[".js"] = original;
  }
});
test("wrapping an existing extension with mutated compile function", () => {
  const original = require.extensions[".js"];
  try {
    delete require.cache[require.resolve("./extensions-fixture/d")];
    const mocked = (require.extensions[".js"] = mock(function (module, filename) {
      expect(module).toBeDefined();
      expect(filename).toBe(path.join(import.meta.dir, "extensions-fixture", "d.js"));
      const originalCompile = module._compile;
      module._compile = function (code, filename) {
        expect(code).toBe('\n  module.exports = \"d.js\";\n');
        expect(filename).toBe(path.join(import.meta.dir, "extensions-fixture", "d.js"));
        originalCompile.call(module, 'module.exports = "new";', filename);
      };
      original(module, filename);
    }));
    const mod = require("./extensions-fixture/d");
    expect(mod).toBe("new");
    expect(mocked).toBeCalled();
  } finally {
    require.extensions[".js"] = original;
  }
});
test("wrapping an existing extension with mutated compile function ts", () => {
  const original = require.extensions[".ts"];
  assert(original);
  try {
    delete require.cache[require.resolve("./extensions-fixture/e.js")];
    const mocked = (require.extensions[".js"] = mock(function (module, filename) {
      expect(module).toBeDefined();
      expect(filename).toBe(path.join(import.meta.dir, "extensions-fixture", "e.js"));
      const originalCompile = module._compile;
      module._compile = function (code, filename) {
        expect(code).toBe(
          '\n  var J;\n  ((J) => J.x = \"hello\")(J ||= {});\n  const hello = \" world\";\n  module.exports = \"hello world\";\n',
        );
        expect(filename).toBe(path.join(import.meta.dir, "extensions-fixture", "e.js"));
        originalCompile.call(module, 'module.exports = "new";', filename);
      };
      original(module, filename);
    }));
    const mod = require("./extensions-fixture/e");
    expect(mod).toBe("new");
    expect(mocked).toBeCalled();
  } finally {
    require.extensions[".js"] = original;
  }
});
test("wrapping an existing extension but it's secretly sync esm", () => {
  const original = require.extensions[".ts"];
  assert(original);
  try {
    delete require.cache[require.resolve("./extensions-fixture/secretly_esm.cjs")];
    let called = false;
    const mocked = (require.extensions[".cjs"] = mock(function (module, filename) {
      expect(module).toBeDefined();
      expect(filename).toBe(path.join(import.meta.dir, "extensions-fixture", "secretly_esm.cjs"));
      module._compile = function (code, filename) {
        called = true;
        throw new Error("should not be called");
      };
      original(module, filename);
    }));
    const mod = require("./extensions-fixture/secretly_esm");
    expect(mod).toEqual({ default: 1 });
    expect(mocked).toBeCalled();
  } finally {
    require.extensions[".cjs"] = original;
  }
});
test.concurrent("default loader throws when module._compile was replaced with a non-function", async () => {
  using dir = tempDir("extensions-bad-compile", {
    "plain.js": `module.exports = "plain";`,
    "run.cjs": `
      const Module = require("module");
      const file = require("path").join(__dirname, "plain.js");
      const original = Module._extensions[".js"];
      const messages = [undefined, null, 42, true, "not a function", {}].map(value => {
        Module._extensions[".js"] = function (module, filename) {
          module._compile = value;
          return original(module, filename);
        };
        try {
          require(file);
          return "did not throw";
        } catch (e) {
          return e.name + ": " + e.message;
        }
      });
      Module._extensions[".js"] = original;
      console.log(JSON.stringify({ messages: [...new Set(messages)], afterwards: require(file) }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.cjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    messages: ["TypeError: module._compile is not a function"],
    afterwards: "plain",
  });
  expect(exitCode).toBe(0);
});
test("mutating extensions is banned by some files", () => {
  // vercel is not allowed to mutate require.extensions
  const files = ["node_modules/next/dist/build/next-config-ts/index.js", "node_modules/@meteorjs/babel/index.js"];
  using fixture = tempDir(
    "extensions-fixture",
    Object.fromEntries(
      files.map(file => [
        file,
        `
      const assert = require('assert');
      const mock = function (module, filename) {
        throw new Error('should not be called');
      };
      require.extensions['.js'] = mock;
      assert(require.extensions['.js'] !== mock);
      globalThis.pass += 1;
    `,
      ]),
    ),
  );
  globalThis.pass = 0;

  let n = 0;
  for (const file of files) {
    require(path.join(fixture, file));
    n++;
    expect(globalThis.pass).toBe(n);
  }
});

// pirates, @babel/register, ts-node and nyc install handlers of this shape.
describe.concurrent("handler that calls the loader it replaced, for a module that fails to load", () => {
  const files = {
    "wrap-fixture.cjs": `
      const Module = require("module");
      const path = require("path");
      const [file, shape] = process.argv.slice(-2);
      const ext = path.extname(file);
      const original = Module._extensions[ext];
      let calls = 0;
      Module._extensions[ext] = function (module, filename) {
        calls++;
        if (shape !== "wrap") {
          const compile = module._compile;
          module._compile = function (code) {
            module._compile = compile;
            if (shape === "pirates-evict") delete require.cache[filename];
            return module._compile(code, filename);
          };
        }
        return original.call(this, module, filename);
      };
      const id = require.resolve("./" + file);
      try {
        require(id);
        console.log("no error");
      } catch (e) {
        const message = e.message.replaceAll(id, "<id>");
        const inGraph = Bun.ModuleGraph.current !== undefined;
        console.log(JSON.stringify({ name: e.name, message, cached: id in require.cache, calls, inGraph }));
      }
    `,
    "in-graph-fixture.mjs": `
      import path from "node:path";
      await new Bun.ModuleGraph().import(path.join(import.meta.dirname, "wrap-fixture.cjs"));
    `,
    "recover-fixture.cjs": `
      const Module = require("module");
      const original = Module._extensions[".js"];
      let calls = 0;
      Module._extensions[".js"] = function (module, filename) {
        calls++;
        try {
          return original.call(this, module, filename);
        } catch (e) {
          module.exports = { recovered: e.message };
        }
      };
      const id = require.resolve("./throws.js");
      const first = require(id);
      const cached = require.cache[id]?.exports === first;
      const second = require(id);
      console.log(JSON.stringify({ first, cached, sameExports: second === first, calls }));
    `,
    "throws.js": `export default 1;\nthrow new Error("boom");\n`,
    "throws.ts": `export default 1 as number;\nthrow new Error("boom");\n`,
    "throws.mjs": `export default 1;\nthrow new Error("boom");\n`,
    "type-module/package.json": `{ "type": "module" }`,
    "type-module/throws.js": `throw new Error("boom");\n`,
    "unresolvable-import.js": `import "./does-not-exist.js";\nexport default 1;\n`,
    // The transpiler classifies a file with neither CommonJS nor ES module syntax as an ES module.
    "no-module-syntax.js": `nope();\n`,
    "top-level-await.js": `export default 1;\nawait 0;\n`,
    "cjs-throws.js": `module.exports = 1;\nthrow new Error("boom");\n`,
  };

  async function run(fixture: string, ...args: string[]) {
    using dir = tempDir("require-extensions-load-error", files);
    return await bunRun([path.join(String(dir), fixture), ...args]);
  }

  test.each([
    ["throws.js", "wrap", { name: "Error", message: "boom" }],
    ["throws.js", "pirates", { name: "Error", message: "boom" }],
    ["throws.ts", "wrap", { name: "Error", message: "boom" }],
    ["throws.mjs", "wrap", { name: "Error", message: "boom" }],
    ["type-module/throws.js", "wrap", { name: "Error", message: "boom" }],
    [
      "unresolvable-import.js",
      "wrap",
      { name: "ResolveMessage", message: "Cannot find module './does-not-exist.js' imported from <id>" },
    ],
    ["no-module-syntax.js", "wrap", { name: "ReferenceError", message: "nope is not defined" }],
    [
      "top-level-await.js",
      "wrap",
      { name: "TypeError", message: 'require() async module "<id>" is unsupported. use "await import()" instead.' },
    ],
    // The module._compile wrapper deletes the require.cache entry before the CommonJS file runs.
    ["cjs-throws.js", "pirates-evict", { name: "Error", message: "boom" }],
  ])("%s (%s): require() throws and leaves nothing in require.cache", async (file, shape, error) => {
    expect(await run("wrap-fixture.cjs", file, shape)).toEqual({
      stdout: JSON.stringify({ ...error, cached: false, calls: 1, inGraph: false }),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // A Bun.ModuleGraph has its own require.cache.
  test("throws.js (wrap) inside a Bun.ModuleGraph: require() throws and leaves nothing in require.cache", async () => {
    expect(await run("in-graph-fixture.mjs", "throws.js", "wrap")).toEqual({
      stdout: JSON.stringify({ name: "Error", message: "boom", cached: false, calls: 1, inGraph: true }),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // Node's Module._load removes the cache entry only when the handler throws.
  test("a handler that catches the error keeps the module in require.cache", async () => {
    expect(await run("recover-fixture.cjs")).toEqual({
      stdout: JSON.stringify({ first: { recovered: "boom" }, cached: true, sameExports: true, calls: 1 }),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});

// coffeescript/register and hand-written handlers read the file themselves and give module._compile the text.
// Node compiles the text as CommonJS first, and loads it as an ES module when it only parses as one.
describe.concurrent("handler that gives module._compile the text of an ES module", () => {
  const files = {
    "lib.js": `export const value = "esm value";\n`,
    "mod.coffee": `export const value = "from a new extension";\nexport default function greet() { return "hi"; }\n`,
    "imports.js": `
      import { value } from "./lib.js";
      import commonjs from "./commonjs.cjs";
      export const out = [value, commonjs.kind, import.meta.url.endsWith("/imports.js")];
    `,
    "commonjs.cjs": `module.exports = { kind: "commonjs" };\n`,
    "plain.js": `module.exports = typeof require;\n`,
    "instrumented.js": `export const count = globalThis.instrumented;\n`,
    "throws.js": `export const a = 1;\nthrow new Error("boom");\n`,
    "commonjs-on-disk.js": `module.exports = "commonjs on disk";\n`,
    "via-module-require.js": `export const via = "module.require";\n`,
    "via-create-require.js": `export const via = "createRequire";\n`,
    "via-import-meta.js": `export const via = "import.meta.require";\n`,
    "handler.cjs": `
      const Module = require("node:module");
      const { readFileSync } = require("node:fs");
      const path = require("node:path");
      exports.seen = [];
      exports.transform = text => text;
      exports.readAndCompile = (module, filename) => {
        exports.seen.push(path.basename(filename));
        return module._compile(exports.transform(readFileSync(filename, "utf8")), filename);
      };
      exports.original = Module._extensions[".js"];
      Module._extensions[".js"] = exports.readAndCompile;
      Module._extensions[".coffee"] = exports.readAndCompile;
      exports.attempt = fn => {
        try {
          return fn();
        } catch (e) {
          return e.name + ": " + String(e.message).split("\\n")[0];
        }
      };
    `,
    "main-fixture.cjs": `
      const Module = require("node:module");
      const handler = require("./handler.cjs");
      const { attempt } = handler;

      const results = {};
      results.reported = attempt(() => require("./lib.js").value);
      results.cacheEntryHasTheExports = attempt(
        () => require.cache[require.resolve("./lib.js")].exports === require("./lib.js"),
      );
      results.newExtension = attempt(() => {
        const exports = require("./mod.coffee");
        return { value: exports.value, default: exports.default(), esModule: exports.__esModule };
      });
      results.importsOtherFiles = attempt(() => require("./imports.js").out);
      handler.transform = text => "globalThis.instrumented = (globalThis.instrumented ?? 0) + 1;\\n" + text;
      results.transformedTextIsWhatRuns = attempt(() => [require("./instrumented.js").count, globalThis.instrumented]);
      handler.transform = text => text;
      results.moduleRequire = attempt(() => module.require("./via-module-require.js").via);
      results.commonJSStaysCommonJS = attempt(() => require("./plain.js"));
      results.thrownByTheModule = attempt(() => require("./throws.js"));
      results.thrownLeavesNothingCached = require.resolve("./throws.js") in require.cache;

      // The pirates shape. The replaced module._compile gets CommonJS text and gives the original ES module text.
      Module._extensions[".js"] = function (module, filename) {
        const compile = module._compile;
        module._compile = function (text) {
          module._compile = compile;
          return module._compile("export const was = " + JSON.stringify(text.trim()) + ";", filename);
        };
        return handler.original(module, filename);
      };
      results.replacedCompileGivesESModuleText = attempt(() => require("./commonjs-on-disk.js").was);
      Module._extensions[".js"] = handler.readAndCompile;

      import("./lib.js").then(namespace => {
        results.importGivesTheSameNamespace = namespace === require("./lib.js");
        results.seen = handler.seen;
        console.log(JSON.stringify(results));
      });
    `,
    "esm-fixture.mjs": `
      import { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      require("./handler.cjs");
      console.log(
        JSON.stringify({
          createRequire: require("./via-create-require.js").via,
          importMetaRequire: import.meta.require("./via-import-meta.js").via,
        }),
      );
    `,
    // A Bun.ModuleGraph has its own loader. The ES module belongs to the graph of the module that _compile is called on.
    "graph-fixture.mjs": `
      import path from "node:path";
      const graph = new Bun.ModuleGraph();
      const inGraph = await graph.import(path.join(import.meta.dirname, "in-graph.cjs"));
      const ofHost = await import("./lib.js");
      console.log(JSON.stringify({ ...(await inGraph.result), hostHasItsOwn: ofHost !== inGraph.required }));
    `,
    "in-graph.cjs": `
      require("./handler.cjs");
      exports.required = require("./lib.js");
      exports.result = import("./lib.js").then(imported => ({
        value: exports.required.value,
        inGraph: Bun.ModuleGraph.current !== undefined,
        importInGraphGivesTheSameNamespace: imported === exports.required,
      }));
    `,
    "worker-fixture.cjs": `
      const { Worker } = require("node:worker_threads");
      const worker = new Worker(require.resolve("./in-worker.cjs"));
      worker.on("message", message => console.log(JSON.stringify(message)));
    `,
    // It sets no handler: a Worker never frees its table of handlers, which LeakSanitizer reports.
    "in-worker.cjs": `
      const Module = require("node:module");
      const path = require("node:path");
      const filename = path.join(__dirname, "virtual-in-worker.js");
      const compiled = new Module(filename);
      compiled._compile(require("node:fs").readFileSync(path.join(__dirname, "lib.js"), "utf8"), filename);
      require("node:worker_threads").parentPort.postMessage({ value: compiled.exports.value });
    `,
    // The graphs have a global that the host does not have. The text that the handler gives is not the text of the file.
    "graph-scope-fixture.mjs": `
      import { createRequire } from "node:module";
      import path from "node:path";
      const require = createRequire(import.meta.url);
      const load = path.join(import.meta.dirname, "loads-scoped.cjs");
      const out = { host: require(load) };
      const graphs = { one: { tenant: "one" }, sameNames: { tenant: "two" }, otherNames: { tenant: "three", more: 0 }, noGlobals: undefined };
      for (const [name, globals] of Object.entries(graphs)) out[name] = (await new Bun.ModuleGraph({ globals }).import(load)).default;
      console.log(JSON.stringify(out));
    `,
    "loads-scoped.cjs": `
      const handler = require("./handler.cjs");
      handler.transform = text => text + "export const transformed = read();\\n";
      const { read, atLoad, transformed } = require("./scoped.js");
      let hot;
      for (let i = 0; i < 2000; i++) hot = read();
      module.exports = { atLoad, transformed, hot };
    `,
    "scoped.js": `
      export const read = () => (typeof tenant === "undefined" ? "the host's" : tenant);
      export const atLoad = read();
    `,
    // mocha calls require() first and import() when that throws.
    "require-or-import-fixture.cjs": `
      const path = require("node:path");
      const handler = require("./handler.cjs");
      const instrumented = text => "globalThis.instrumented = (globalThis.instrumented ?? 0) + 1;\\n" + text + "\\nexport const fromHandler = true;\\n";
      const requireOrImport = async file => {
        try {
          return { via: "require", value: require(file) };
        } catch (requireError) {
          const thrownByRequire = requireError.name + ": " + requireError.message.replaceAll(__dirname, "<dir>").replaceAll("\\\\", "/");
          try {
            return { via: "import", thrownByRequire, value: await import(file) };
          } catch (importError) {
            return { via: "neither", thrownByRequire, sameError: importError === requireError };
          }
        }
      };
      (async () => {
        const results = {};
        for (const name of ["lib.js", "awaits.js", "throws.js", "on-disk.js", "mod.coffee", "missing.coffee"]) {
          globalThis.instrumented = 0;
          // For on-disk.js the text of the handler imports a file that does not exist. The file imports nothing.
          // missing.coffee imports such a file itself. Only the handler reads a .coffee file as a program.
          handler.transform = text => (name === "on-disk.js" ? 'import "./not-on-disk.mjs";\\n' : "") + instrumented(text);
          const { value, ...result } = await requireOrImport(path.join(__dirname, name));
          results[name] = {
            ...result,
            ...(value && { value: { ...value } }),
            instrumented: globalThis.instrumented,
            handlerCalls: handler.seen.filter(seen => seen === name).length,
          };
        }
        console.log(JSON.stringify(results));
      })();
    `,
    "awaits.js": `export const value = await new Promise(resolve => setImmediate(() => resolve("awaited")));\n`,
    "on-disk.js": `export const value = "on disk";\n`,
    "missing.coffee": `import "./not-here.mjs";\nexport const value = "never";\n`,
    "disposed-graph-fixture.mjs": `
      import path from "node:path";
      const graph = new Bun.ModuleGraph();
      const { compile } = await graph.import(path.join(import.meta.dirname, "in-disposed-graph.cjs"));
      graph.dispose();
      const virtual = name => path.join(import.meta.dirname, "virtual", name);
      console.log(
        JSON.stringify({
          typo: compile("module.exports = {;", virtual("typo.js")),
          esModule: compile("export const a = 1;", virtual("es-module.js")),
        }),
      );
    `,
    "in-disposed-graph.cjs": `
      const { attempt } = require("./handler.cjs");
      exports.compile = (text, filename) => attempt(() => module._compile(text, filename));
    `,
  };

  async function run(fixture: string) {
    using dir = tempDir("require-extensions-compile-esm", files);
    const { stdout, stderr, exitCode } = await bunRun([path.join(String(dir), fixture)]);
    return { stdout: stdout && JSON.parse(stdout), stderr, exitCode };
  }

  test("require() gets the namespace, and CommonJS text stays CommonJS", async () => {
    expect(await run("main-fixture.cjs")).toEqual({
      stdout: {
        reported: "esm value",
        cacheEntryHasTheExports: true,
        newExtension: { value: "from a new extension", default: "hi", esModule: true },
        importsOtherFiles: ["esm value", "commonjs", true],
        transformedTextIsWhatRuns: [1, 1],
        moduleRequire: "module.require",
        commonJSStaysCommonJS: "function",
        thrownByTheModule: "Error: boom",
        thrownLeavesNothingCached: false,
        replacedCompileGivesESModuleText: 'module.exports = "commonjs on disk";',
        importGivesTheSameNamespace: true,
        // Only the file that require() names goes to a handler. What imports.js imports is loaded by the loader.
        // (In Node.js an imported CommonJS file goes through Module._load, so a handler sees commonjs.cjs too.)
        seen: [
          "lib.js",
          "mod.coffee",
          "imports.js",
          "instrumented.js",
          "via-module-require.js",
          "plain.js",
          "throws.js",
        ],
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test("createRequire() and import.meta.require() in an ES module", async () => {
    expect(await run("esm-fixture.mjs")).toEqual({
      stdout: { createRequire: "createRequire", importMetaRequire: "import.meta.require" },
      stderr: "",
      exitCode: 0,
    });
  });

  test("inside a Bun.ModuleGraph", async () => {
    expect(await run("graph-fixture.mjs")).toEqual({
      stdout: { value: "esm value", inGraph: true, importInGraphGivesTheSameNamespace: true, hostHasItsOwn: true },
      stderr: "",
      exitCode: 0,
    });
  });

  test("in a Worker", async () => {
    expect(await run("worker-fixture.cjs")).toEqual({ stdout: { value: "esm value" }, stderr: "", exitCode: 0 });
  });

  test("the ES module runs in the scope of the Bun.ModuleGraph of its module", async () => {
    const all = (value: string) => ({ atLoad: value, transformed: value, hot: value });
    expect(await run("graph-scope-fixture.mjs")).toEqual({
      stdout: {
        host: all("the host's"),
        one: all("one"),
        sameNames: all("two"),
        otherNames: all("three"),
        noGlobals: all("the host's"),
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // import() gets the module that _compile made of the handler's text, and the error of a module that throws or that
  // does not load. The file is not loaded in its place: Bun's own loader reads a .coffee file as an asset, so an
  // import() of missing.coffee that loaded the file would count as a load, and the error would go unseen. import()
  // does not go to the handler: each file gets one call.
  test("require() first and import() when it throws, as mocha loads a file", async () => {
    expect(await run("require-or-import-fixture.cjs")).toEqual({
      stdout: {
        "lib.js": {
          via: "require",
          value: { value: "esm value", fromHandler: true },
          instrumented: 1,
          handlerCalls: 1,
        },
        "awaits.js": {
          via: "import",
          thrownByRequire:
            'TypeError: require() async module "<dir>/awaits.js" is unsupported. use "await import()" instead.',
          value: { value: "awaited", fromHandler: true },
          instrumented: 1,
          handlerCalls: 1,
        },
        "throws.js": {
          via: "neither",
          thrownByRequire: "Error: boom",
          sameError: true,
          instrumented: 1,
          handlerCalls: 1,
        },
        "on-disk.js": {
          via: "neither",
          thrownByRequire: "ResolveMessage: Cannot find module './not-on-disk.mjs' imported from <dir>/on-disk.js",
          sameError: true,
          instrumented: 0,
          handlerCalls: 1,
        },
        "mod.coffee": {
          via: "require",
          value: { value: "from a new extension", fromHandler: true },
          instrumented: 1,
          handlerCalls: 1,
        },
        "missing.coffee": {
          via: "neither",
          thrownByRequire: "ResolveMessage: Cannot find module './not-here.mjs' imported from <dir>/missing.coffee",
          sameError: true,
          instrumented: 0,
          handlerCalls: 1,
        },
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // Nothing loads in a disposed graph, so the error of the CommonJS parse is the answer there.
  test("in a disposed Bun.ModuleGraph", async () => {
    expect(await run("disposed-graph-fixture.mjs")).toEqual({
      stdout: {
        typo: "SyntaxError: Unexpected token ';'. Expected a property name.",
        esModule: "SyntaxError: Unexpected keyword 'export'",
      },
      stderr: "",
      exitCode: 0,
    });
  });
});

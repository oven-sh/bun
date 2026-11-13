import assert from "assert";
import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, bunRun, tempDir } from "harness";
import { writeFileSync } from "node:fs";
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

// Node's CommonJS loader hands a file to the function that `Module._extensions` holds for it: for require(), for the entry
// point (lib/internal/modules/run_main.js), and for a CommonJS file that `import` loads (lib/internal/modules/esm/translators.js).
// Each expected line is what Node v26.3.0 prints for the same files, where Node can run them. The rows with Bun.plugin,
// Bun.ModuleGraph, bun test, --hot or a file that Bun built are Bun's alone.
describe.concurrent("handler for the entry point and for a CommonJS file that import loads", () => {
  const files = {
    "hook.cjs": `
      // Calls the loader it replaced, as pirates, nyc and @babel/register do.
      const Module = require("node:module");
      const path = require("node:path");
      const original = Module._extensions[".js"];
      for (const extension of [".js", ".cjs", ".ts"]) {
        // Node has no ".cjs" and no ".ts" loader of its own: its ".js" loader takes those files.
        const replaced = Module._extensions[extension] ?? original;
        Module._extensions[extension] = function (module, filename) {
          console.log("handler called for", path.basename(filename));
          return replaced.call(this, module, filename);
        };
      }
    `,
    "compile-hook.cjs": `
      // Compiles its own text, as ts-node and coffeescript/register do.
      const Module = require("node:module");
      const fs = require("node:fs");
      Module._extensions[".js"] = function (module, filename) {
        module._compile(fs.readFileSync(filename, "utf8").replaceAll("REPLACE_ME", '"compiled by the handler"'), filename);
      };
    `,
    "pirates-hook.cjs": `
      // Replaces module._compile and calls the loader it replaced, as pirates does.
      const Module = require("node:module");
      const original = Module._extensions[".js"];
      Module._extensions[".js"] = function (module, filename) {
        const compile = module._compile;
        module._compile = function (code) {
          module._compile = compile;
          return module._compile(code.replaceAll("REPLACE_ME", '"compiled by the handler"'), filename);
        };
        return original.call(this, module, filename);
      };
    `,
    "exports-hook.cjs": `
      // Stores module.exports and compiles nothing, as a loader of data does.
      const Module = require("node:module");
      globalThis.calls = 0;
      Module._extensions[".cjs"] = function (module, filename) {
        module.exports = { fromHandler: ++globalThis.calls };
      };
    `,
    "coffee-hook.cjs": `
      const Module = require("node:module");
      const fs = require("node:fs");
      const path = require("node:path");
      Module._extensions[".coffee"] = function (module, filename) {
        console.log("handler called for", path.basename(filename));
        module._compile("console.log(" + JSON.stringify(fs.readFileSync(filename, "utf8").trim()) + ");", filename);
      };
    `,
    "throwing-hook.cjs": `
      const Module = require("node:module");
      const path = require("node:path");
      Module._extensions[".js"] = function (module, filename) {
        throw new Error("handler refused " + path.basename(filename));
      };
    `,
    "strip-hook.cjs": `
      // Takes out a type annotation that Bun's parser rejects, as a Flow preset does.
      const Module = require("node:module");
      const fs = require("node:fs");
      const path = require("node:path");
      Module._extensions[".js"] = function (module, filename) {
        console.log("handler called for", path.basename(filename));
        module._compile(fs.readFileSync(filename, "utf8").replaceAll("@@number@@", ""), filename);
      };
    `,
    "inspect-hook.cjs": `
      const Module = require("node:module");
      const original = Module._extensions[".js"];
      Module._extensions[".js"] = function (module, filename) {
        console.log(
          JSON.stringify({
            id: module.id,
            parent: module.parent,
            loaded: module.loaded,
            exports: module.exports,
            filename: module.filename === filename,
            cached: require.cache[filename] === module,
            mainModule: process.mainModule === module,
            children: module.children.length,
          }),
        );
        return original.call(this, module, filename);
      };
    `,
    "origin-hook.cjs": `
      const Module = require("node:module");
      const original = Module._extensions[".js"];
      Module._extensions[".js"] = function (module, filename) {
        return original.call(this, module, filename);
      };
      process.on("uncaughtException", (error, origin) => {
        console.log(origin + ": " + error.message);
      });
    `,
    "plugin-hook.cjs": `
      const Module = require("node:module");
      const path = require("node:path");
      const original = Module._extensions[".js"];
      Module._extensions[".js"] = function (module, filename) {
        console.log("handler called for", path.basename(filename));
        return original.call(this, module, filename);
      };
      Bun.plugin({
        name: "text of the plugin",
        setup(build) {
          build.onLoad({ filter: /from-plugin\\.js$/ }, () => ({
            contents: 'module.exports = "text of the plugin";',
            loader: "js",
          }));
        },
      });
    `,
    "test-hook.cjs": `
      // Compiles its own text, and so gives a file none of the names that Bun's transpiler adds.
      const Module = require("node:module");
      const fs = require("node:fs");
      const path = require("node:path");
      globalThis.handled = [];
      Module._extensions[".js"] = function (module, filename) {
        globalThis.handled.push(path.basename(filename));
        module._compile(fs.readFileSync(filename, "utf8"), filename);
      };
    `,

    // The files of the report: a package that says it is CommonJS.
    "commonjs/package.json": `{ "type": "commonjs" }`,
    "commonjs/main.js": `console.log("main.js runs"); require("./dep.js");`,
    "commonjs/dep.js": `console.log("dep.js runs");`,
    "commonjs/dep2.cjs": `console.log("dep2.cjs runs");`,
    "commonjs/import-js.mjs": `import "./dep.js"; console.log("main.mjs runs");`,
    "commonjs/import-cjs.mjs": `import "./dep2.cjs"; console.log("main.mjs runs");`,
    "commonjs/dynamic-import.mjs": `await import("./dep.js"); console.log("main.mjs runs");`,

    // No "type" field, as in most CommonJS packages: the text of the file decides.
    "typeless/package.json": `{ "name": "typeless" }`,
    "typeless/main.js": `console.log("main.js runs"); require("./dep.js");`,
    "typeless/dep.js": `console.log("dep.js runs"); module.exports = 1;`,
    "typeless/main.cjs": `console.log("main.cjs runs"); module.exports = 1;`,
    "typeless/main.ts": `const n: number = 1; console.log("main.ts runs", n); module.exports = n;`,
    "typeless/main.mjs": `console.log("main.mjs runs");`,
    "typeless/second.cjs": `console.log("second.cjs runs");`,
    "typeless/import-js.mjs": `import "./dep.js"; console.log("main.mjs runs");`,
    "typeless/esm-syntax.js": `
      import { value } from "./esm-dep.mjs";
      console.log("esm-syntax.js runs", await Promise.resolve(value));
    `,
    "typeless/esm-dep.mjs": `export const value = 1; console.log("esm-dep.mjs runs");`,
    "typeless/import-esm-syntax.mjs": `import "./esm-syntax.js"; console.log("main.mjs runs");`,
    "typeless/compiled-main.js": `console.log(JSON.stringify({ entry: REPLACE_ME, ...require("./compiled.js") }));`,
    "typeless/compiled-import.mjs": `import compiled from "./compiled.js"; console.log(JSON.stringify(compiled));`,
    "typeless/compiled.js": `module.exports = { value: REPLACE_ME, dep: require("./compiled-dep.js") };`,
    "typeless/compiled-dep.js": `module.exports = REPLACE_ME + "!";`,
    "typeless/data.cjs": `console.log("data.cjs runs"); module.exports = { onDisk: true };`,
    "typeless/import-then-require.mjs": `
      import { createRequire } from "node:module";
      import imported from "./data.cjs";
      const required = createRequire(import.meta.url)("./data.cjs");
      console.log(JSON.stringify({ imported, same: imported === required, calls: globalThis.calls }));
    `,
    "typeless/require-then-import.js": `
      const required = require("./data.cjs");
      import("./data.cjs").then(namespace => {
        console.log(JSON.stringify({ required, same: namespace.default === required, calls: globalThis.calls }));
      });
    `,
    "typeless/a.js": `module.exports = { fromB: require("./b.js").value };`,
    "typeless/b.js": `module.exports = { value: 42 };`,
    "typeless/siblings.mjs": `
      import a from "./a.js";
      import b from "./b.js";
      console.log(JSON.stringify({ a, b }));
    `,
    "typeless/catch-import.mjs": `
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          await import("./dep.js");
          console.log("no error");
        } catch (error) {
          console.log(attempt + ": " + error.message);
        }
      }
    `,
    "typeless/throws.js": `
      const path = require("node:path");
      throw new Error("thrown by " + path.basename(__filename));
    `,
    "typeless/line.js":
      "const a = 1;\nconst b = 2;\nconst c = 3;\nmodule.exports = function thrower() {\n  throw new Error('line 5');\n};\n",
    "typeless/line-import.mjs": `
      import thrower from "./line.js";
      try {
        thrower();
      } catch (error) {
        console.log(/line\\.js:(\\d+)/.exec(error.stack)[1]);
      }
    `,
    "typeless/require-graph.js": `require("./graph.mjs"); console.log("require-graph.js runs");`,
    "typeless/graph.mjs": `import "./register.cjs"; import "./registered.cjs";`,
    "typeless/register.cjs": `
      const Module = require("node:module");
      const path = require("node:path");
      const original = Module._extensions[".js"];
      Module._extensions[".cjs"] = function (module, filename) {
        console.log("handler called for", path.basename(filename));
        return original.call(this, module, filename);
      };
      console.log("register.cjs runs");
    `,
    "typeless/registered.cjs": `console.log("registered.cjs runs"); module.exports = 1;`,
    "typeless/from-plugin.js": `module.exports = "text of the file";`,
    "typeless/import-from-plugin.mjs": `import text from "./from-plugin.js"; console.log(text);`,
    "typeless/graph-import.mjs": `
      import path from "node:path";
      const namespace = await new Bun.ModuleGraph().import(path.join(import.meta.dirname, "dep.js"));
      console.log("the graph imported", namespace.default);
    `,
    "typeless/built.js":
      '// @bun @bun-cjs\n(function(exports, require, module, __filename, __dirname) {console.log("built.js runs"); module.exports = 1;\n})',
    "typeless/import-built.mjs": `import built from "./built.js"; console.log("main.mjs runs", built);`,
    "typeless/stored-module.mjs": `
      import Module, { createRequire } from "node:module";
      const require = createRequire(import.meta.url);
      const filename = require.resolve("./data.cjs");
      const stored = new Module(filename);
      stored.exports = { stored: true };
      require.cache[filename] = stored;
      const required = require("./data.cjs");
      const imported = (await import("./data.cjs")).default;
      console.log(JSON.stringify({ required, imported }));
    `,
    "typeless/handled.test.js": `
      const dep = require("./dep.js");
      test("the handler got what the test file requires", async () => {
        const helper = await import("./uses-expect.js");
        expect([dep, helper.default, globalThis.handled]).toEqual([1, "function", ["dep.js"]]);
      });
    `,
    "typeless/uses-expect.js": `module.exports = typeof expect;`,

    // A package of ES modules.
    "module/package.json": `{ "type": "module" }`,
    "module/main.js": `console.log("main.js runs");`,
    "module/import-js.mjs": `import "./main.js"; console.log("main.mjs runs");`,

    // An extension that only a handler knows.
    "coffee/main.coffee": `x = 1 # not JavaScript ->`,
    "coffee/setup.coffee": `setup = 1 # a preload`,
    "coffee/hot.coffee": `process.exit(1) // the first text`,

    // Text that Bun's parser rejects.
    "unparseable/package.json": `{}`,
    "unparseable/main.js": `const x @@number@@ = 1; console.log("main.js runs", x, JSON.stringify(require("./dep.js")));`,
    "unparseable/dep.js": `const x @@number@@ = 41; module.exports = { x: x + 1 };`,
    "unparseable/import.mjs": `import dep from "./dep.js"; console.log("main.mjs runs", JSON.stringify(dep));`,
  };

  // Runs `bun <args>` in a folder with the files.
  async function run(...args: string[]) {
    using dir = tempDir("require-extensions-entry", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args.map(arg => (arg in files ? "./" + arg : arg))],
      cwd: String(dir),
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  }
  const prints = (...lines: string[]) => ({ stdout: lines.join("\n"), stderr: "", exitCode: 0 });
  type Row = [hook: string, entry: string, lines: string[]];

  const compiled = `{"value":"compiled by the handler","dep":"compiled by the handler!"}`;
  const compiledEntry = `{"entry":"compiled by the handler","value":"compiled by the handler","dep":"compiled by the handler!"}`;
  const mainModule = `{"id":".","parent":null,"loaded":false,"exports":{},"filename":true,"cached":true,"mainModule":true,"children":0}`;

  describe("the entry point", () => {
    test.each<Row>([
      [
        "hook.cjs",
        "commonjs/main.js",
        ["handler called for main.js", "main.js runs", "handler called for dep.js", "dep.js runs"],
      ],
      [
        "hook.cjs",
        "typeless/main.js",
        ["handler called for main.js", "main.js runs", "handler called for dep.js", "dep.js runs"],
      ],
      ["hook.cjs", "typeless/main.cjs", ["handler called for main.cjs", "main.cjs runs"]],
      ["hook.cjs", "typeless/main.ts", ["handler called for main.ts", "main.ts runs 1"]],
      // Node asks the handler before it knows that the file is an ES module. Top-level await still works.
      [
        "hook.cjs",
        "typeless/esm-syntax.js",
        ["handler called for esm-syntax.js", "esm-dep.mjs runs", "esm-syntax.js runs 1"],
      ],
      ["coffee-hook.cjs", "coffee/main.coffee", ["handler called for main.coffee", "x = 1 # not JavaScript ->"]],
      ["compile-hook.cjs", "typeless/compiled-main.js", [compiledEntry]],
      ["pirates-hook.cjs", "typeless/compiled-main.js", [compiledEntry]],
      [
        "strip-hook.cjs",
        "unparseable/main.js",
        ["handler called for main.js", "handler called for dep.js", 'main.js runs 1 {"x":42}'],
      ],
      // The module is made before the handler runs: it is the main module, and nothing has run in it.
      ["inspect-hook.cjs", "typeless/dep.js", [mainModule, "dep.js runs"]],
      // What a CommonJS entry point throws is an uncaught exception, not a rejection.
      ["origin-hook.cjs", "typeless/throws.js", ["uncaughtException: thrown by throws.js"]],
    ])("-r %s %s", async (hook, entry, lines) => {
      expect(await run("-r", hook, entry)).toEqual(prints(...lines));
    });

    // Node's -r loads a preload as require() does, so the handler that an earlier preload stored gets it.
    test.each([
      [
        "typeless/second.cjs",
        "typeless/main.mjs",
        ["handler called for second.cjs", "second.cjs runs", "main.mjs runs"],
      ],
      [
        "coffee/setup.coffee",
        "coffee/main.coffee",
        [
          "handler called for setup.coffee",
          "setup = 1 # a preload",
          "handler called for main.coffee",
          "x = 1 # not JavaScript ->",
        ],
      ],
    ])("a preload after the one that stored the handler: -r %s", async (preload, entry, lines) => {
      const hook = preload.endsWith(".coffee") ? "coffee-hook.cjs" : "hook.cjs";
      expect(await run("-r", hook, "-r", preload, entry)).toEqual(prints(...lines));
    });

    test("a handler that throws ends the process with its error", async () => {
      const { stdout, stderr, exitCode } = await run("-r", "throwing-hook.cjs", "typeless/main.js");
      expect({ stdout, threw: stderr.includes("error: handler refused main.js"), exitCode }).toEqual({
        stdout: "",
        threw: true,
        exitCode: 1,
      });
    });

    // The handler reads the file, so the transpiler never opens it. A change still reloads it.
    // Without the handler Bun runs the text, and the process ends.
    test("--hot hands a changed entry point to the handler again", async () => {
      using dir = tempDir("require-extensions-hot", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--hot", "-r", "./coffee-hook.cjs", "./coffee/hot.coffee"],
        cwd: String(dir),
        env: bunEnv,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
      });
      let stdout = "";
      let changed = false;
      for await (const chunk of proc.stdout) {
        stdout += new TextDecoder().decode(chunk);
        if (!changed && stdout.includes("process.exit(1) // the first text")) {
          changed = true;
          writeFileSync(path.join(String(dir), "coffee", "hot.coffee"), "process.exit(1) // the changed text");
        }
        if (stdout.includes("process.exit(1) // the changed text")) break;
      }
      proc.kill();
      expect(stdout.split("\n").filter(line => line === "handler called for hot.coffee").length).toBeGreaterThanOrEqual(
        2,
      );
    });

    // bun test gives a file `test` and `expect` when it transpiles the file: the test file, and a file that it imports.
    // The handler gets what the file requires, as before.
    test("bun test keeps its own loader for a test file and for what it imports", async () => {
      const { stderr, exitCode } = await run("test", "--preload", "test-hook.cjs", "typeless/handled.test.js");
      expect({ passed: /\b1 pass\b/.test(stderr), failed: /\b0 fail\b/.test(stderr), exitCode }).toEqual({
        passed: true,
        failed: true,
        exitCode: 0,
      });
    });
  });

  describe("a CommonJS file that import loads", () => {
    test.each<Row>([
      ["hook.cjs", "commonjs/import-js.mjs", ["handler called for dep.js", "dep.js runs", "main.mjs runs"]],
      ["hook.cjs", "commonjs/import-cjs.mjs", ["handler called for dep2.cjs", "dep2.cjs runs", "main.mjs runs"]],
      ["hook.cjs", "commonjs/dynamic-import.mjs", ["handler called for dep.js", "dep.js runs", "main.mjs runs"]],
      ["hook.cjs", "typeless/import-js.mjs", ["handler called for dep.js", "dep.js runs", "main.mjs runs"]],
      ["compile-hook.cjs", "typeless/compiled-import.mjs", [compiled]],
      ["pirates-hook.cjs", "typeless/compiled-import.mjs", [compiled]],
      // The handler compiles nothing: the file never runs, and there is one module for import and require().
      [
        "exports-hook.cjs",
        "typeless/import-then-require.mjs",
        ['{"imported":{"fromHandler":1},"same":true,"calls":1}'],
      ],
      ["exports-hook.cjs", "typeless/require-then-import.js", ['{"required":{"fromHandler":1},"same":true,"calls":1}']],
      // A handler that throws rejects the import. The next import of the file rejects with the same error.
      ["throwing-hook.cjs", "typeless/catch-import.mjs", ["1: handler refused dep.js", "2: handler refused dep.js"]],
      ["strip-hook.cjs", "unparseable/import.mjs", ["handler called for dep.js", 'main.mjs runs {"x":42}']],
      // The line of a stack frame is the line in the text that the handler compiled, as it is for require().
      ["compile-hook.cjs", "typeless/line-import.mjs", ["5"]],
      ["hook.cjs", "typeless/graph-import.mjs", ["handler called for dep.js", "dep.js runs", "the graph imported 1"]],
    ])("-r %s %s", async (hook, entry, lines) => {
      expect(await run("-r", hook, entry)).toEqual(prints(...lines));
    });

    // a.js requires b.js. Whichever of the two the loader runs first, each goes to the handler once.
    test("two files of one import graph, where one requires the other", async () => {
      const { stdout, ...rest } = await run("-r", "hook.cjs", "typeless/siblings.mjs");
      expect({ stdout: stdout.split("\n").sort(), ...rest }).toEqual({
        stdout: ["handler called for a.js", "handler called for b.js", '{"a":{"fromB":42},"b":{"value":42}}'],
        stderr: "",
        exitCode: 0,
      });
    });

    // Import and require() run a CommonJS module in one step, with or without a handler. A module that the program
    // stored in require.cache is loaded already.
    test("a module that the program stored in require.cache", async () => {
      expect(await run("typeless/stored-module.mjs")).toEqual(
        prints('{"required":{"stored":true},"imported":{"stored":true}}'),
      );
    });

    // The handler is read when the file is about to run, so the one that an earlier file of the graph stored is called.
    test("a handler that an earlier CommonJS file of the graph stored", async () => {
      expect(await run("typeless/require-graph.js")).toEqual(
        prints(
          "register.cjs runs",
          "handler called for registered.cjs",
          "registered.cjs runs",
          "require-graph.js runs",
        ),
      );
    });
  });

  describe("no handler is called", () => {
    test.each<Row>([
      // ES modules by their name.
      ["hook.cjs", "typeless/main.mjs", ["main.mjs runs"]],
      ["hook.cjs", "module/main.js", ["main.js runs"]],
      ["hook.cjs", "module/import-js.mjs", ["main.js runs", "main.mjs runs"]],
      // An ES module by its text, which import reads before it picks a loader.
      ["hook.cjs", "typeless/import-esm-syntax.mjs", ["esm-dep.mjs runs", "esm-syntax.js runs 1", "main.mjs runs"]],
      // A handler for another extension.
      ["coffee-hook.cjs", "commonjs/main.js", ["main.js runs", "dep.js runs"]],
      // The text of a plugin is not the text of the file.
      ["plugin-hook.cjs", "typeless/from-plugin.js", []],
      ["plugin-hook.cjs", "typeless/import-from-plugin.mjs", ["text of the plugin"]],
      // The text of a file that Bun built is a module wrapper. module._compile would wrap it again, and it would not run.
      ["compile-hook.cjs", "typeless/built.js", ["built.js runs"]],
      ["compile-hook.cjs", "typeless/import-built.mjs", ["built.js runs", "main.mjs runs 1"]],
    ])("-r %s %s", async (hook, entry, lines) => {
      expect(await run("-r", hook, entry)).toEqual(prints(...lines));
    });

    test("for the script of -e", async () => {
      expect(await run("-r", "hook.cjs", "-e", `console.log("the script runs", typeof require)`)).toEqual(
        prints("the script runs function"),
      );
    });
  });
});

import assert from "assert";
import { describe, expect, mock, test } from "bun:test";
import { bunRun, tempDir } from "harness";
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
      const [, , file, shape] = process.argv;
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
        console.log(JSON.stringify({ name: e.name, message, cached: id in require.cache, calls }));
      }
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
      stdout: JSON.stringify({ ...error, cached: false, calls: 1 }),
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

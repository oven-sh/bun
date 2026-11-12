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

// A default handler stores what require() returns for an ES module on the
// module object that it is handed. ".js" and ".mjs" are one native loader,
// and ".ts", ".cts" and ".mts" are the other.
describe.concurrent("default handler, for an ES module", () => {
  const tag = `v => (v?.custom === true ? "custom" : Object.prototype.toString.call(v))`;
  // The file calls the default handler of its own extension on itself while it
  // evaluates: "module.exports" is initialized then, and `__esModule` is in TDZ.
  const callsOwnHandler = (ext: string) => `
    import Module from "node:module";
    const custom = { custom: true };
    export { custom as "module.exports" };
    const m = new Module(import.meta.path);
    Module._extensions[${JSON.stringify(ext)}](m, import.meta.path);
    console.log(JSON.stringify({ handler: (${tag})(m.exports) }));
    export let __esModule = true;
  `;
  const extensions = [".mjs", ".js", ".ts", ".cts", ".mts"];
  const files = {
    ...Object.fromEntries(extensions.map(ext => ["direct" + ext, callsOwnHandler(ext)])),
    "plain.mjs": `export const v = 1;\n`,
    "store-fixture.cjs": `
      const Module = require("module");
      const file = require("path").join(__dirname, "plain.mjs");
      const withSetter = new Module(file);
      let stored;
      Object.defineProperty(withSetter, "exports", { get: () => "getter", set: value => { stored = value; } });
      Module._extensions[".mjs"](withSetter, file);
      let frozen = "no error";
      try {
        Module._extensions[".mjs"](Object.freeze(new Module(file)), file);
      } catch (e) {
        frozen = e.constructor.name + ": " + e.message;
      }
      console.log(JSON.stringify({ stored: Object.prototype.toString.call(stored), read: withSetter.exports, frozen }));
    `,
    "delegate-fixture.cjs": `
      const Module = require("module");
      const original = Module._extensions[".mjs"];
      let calls = 0;
      Module._extensions[".mjs"] = function (module, filename) {
        calls++;
        return original.call(this, module, filename);
      };
      const ns = require("./plain.mjs");
      const cached = require.cache[require.resolve("./plain.mjs")].exports === ns;
      console.log(JSON.stringify({ calls, kind: Object.prototype.toString.call(ns), esModule: ns.__esModule, v: ns.v, cached }));
    `,
    // a.mjs has finished when require() returns. Its `__esModule` is the binding of late.mjs, which is still running.
    "a.mjs": `
      const custom = { custom: true };
      export { custom as "module.exports" };
      export { __esModule } from "./late.mjs";
    `,
    "late.mjs": `
      globalThis.inner = globalThis.requireA();
      export let __esModule = true;
    `,
    "delegate-tdz-fixture.cjs": `
      const Module = require("module");
      const original = Module._extensions[".mjs"];
      let calls = 0;
      Module._extensions[".mjs"] = function (module, filename) {
        calls++;
        return original.call(this, module, filename);
      };
      globalThis.requireA = () => require("./a.mjs");
      require("./late.mjs");
      const tag = ${tag};
      console.log(JSON.stringify({ calls, inner: tag(globalThis.inner), later: tag(require("./a.mjs")) }));
    `,
  };

  async function run(fixture: string) {
    using dir = tempDir("require-extensions-es-module", files);
    return await bunRun([path.join(String(dir), fixture)]);
  }
  const printed = (value: object) => ({ stdout: JSON.stringify(value), stderr: "", exitCode: 0, signalCode: null });

  test.each(extensions)(
    'called by a %s file on itself: a TDZ `__esModule` export does not hide "module.exports"',
    async ext => {
      expect(await run("direct" + ext)).toEqual(printed({ handler: "custom" }));
    },
  );

  test('a handler that calls the loader it replaced: a TDZ `__esModule` export does not hide "module.exports"', async () => {
    expect(await run("delegate-tdz-fixture.cjs")).toEqual(printed({ calls: 2, inner: "custom", later: "custom" }));
  });

  test("a handler that calls the loader it replaced gets the namespace with the `__esModule` mark", async () => {
    expect(await run("delegate-fixture.cjs")).toEqual(
      printed({ calls: 1, kind: "[object Module]", esModule: true, v: 1, cached: true }),
    );
  });

  test("the store on the module object is an assignment: a setter runs, and a frozen module throws", async () => {
    expect(await run("store-fixture.cjs")).toEqual(
      printed({
        stored: "[object Module]",
        read: "getter",
        frozen: "TypeError: Attempted to assign to readonly property.",
      }),
    );
  });

  // The namespace of a vi.mock()ed module throws when a name is read that the
  // factory left out. A default handler that is handed such a module reads
  // "module.exports" off that namespace.
  test("called for a vi.mock()ed module that an import has loaded", async () => {
    using dir = tempDir("require-extensions-es-module-mock", {
      "no-key.mjs": `export const x = "real";\n`,
      "marked-false.mjs": `export const x = "real";\n`,
      "getter.mjs": `export const x = "real";\n`,
      "handler.test.mjs": `
        import { expect, test, vi } from "bun:test";
        import Module from "node:module";
        import path from "node:path";

        let getterRan = 0;
        vi.mock("./no-key.mjs", () => ({ x: 1 }));
        vi.mock("./marked-false.mjs", () => ({ x: 2, __esModule: false }));
        vi.mock("./getter.mjs", () => ({ x: 3, get "module.exports"() { getterRan++; return "from the getter"; } }));

        function callHandler(name) {
          const file = path.join(import.meta.dir, name);
          const m = new Module(file);
          Module._extensions[".mjs"](m, file);
          return m.exports;
        }

        test("the factory has no such key: the handler stores the namespace and marks it", async () => {
          const ns = await import("./no-key.mjs");
          expect(() => ns["module.exports"]).toThrow('No "module.exports" export is defined on the mock of "./no-key.mjs"');
          expect(ns.__esModule).toBe(undefined);
          expect(callHandler("no-key.mjs")).toBe(ns);
          expect(ns.__esModule).toBe(true);
        });

        test("the factory sets __esModule to false: it stays false", async () => {
          const ns = await import("./marked-false.mjs");
          expect(callHandler("marked-false.mjs")).toBe(ns);
          expect(ns.__esModule).toBe(false);
        });

        test("the factory has a getter for the key: the handler stores its value and reads it once", async () => {
          await import("./getter.mjs");
          expect(callHandler("getter.mjs")).toBe("from the getter");
          expect(getterRan).toBe(1);
        });
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "./handler.test.mjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(" 3 pass");
    expect(stderr).toContain(" 0 fail");
    expect(exitCode).toBe(0);
  });
});

import assert from "assert";
import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isWindows, tempDir } from "harness";
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
// Node's `.js` handler picks the format from the file name, so assigning it to
// a TypeScript extension still strips types. @playwright/test 1.64 does this.
test.concurrent("the .js handler assigned to TypeScript extensions still strips types", async () => {
  const jsx = `
      /** @jsxRuntime classic */
      /** @jsx h */
      const h = (tag, props, ...children) => ({ tag, children });`;
  using dir = tempDir("extensions-js-handler-by-name", {
    "types.ts": `export type Foo = { value: number };`,
    "spec.ts": `
      import type { Foo } from "./types";
      const value: number = (1 as number)!;
      const typed: Foo = { value };
      module.exports = typed;
    `,
    "spec.cts": `
      const value: number = (2 as number)!;
      module.exports = { value };
    `,
    "comp.tsx": `${jsx}
      const value: number = (<div>3</div>).children[0] as any;
      module.exports = { value: Number(value) };
    `,
    "comp.jsx": `${jsx}
      module.exports = { value: Number((<div>4</div>).children[0]) };
    `,
    "a.spec.ts": `
      const value: number = (5 as number)!;
      module.exports = { value };
    `,
    "plain.foo": `module.exports = { foo: true };`,
    "ts-handler.tsx": `${jsx}
      const value: number = (<div>6</div>).children[0] as any;
      module.exports = { value: Number(value) };
    `,
    "run.cjs": `
      const Module = require("module");
      const path = require("path");
      const origJS = Module._extensions[".js"];
      const origTS = Module._extensions[".ts"];
      // Compound keys win the longest-extension match; the loader is still the one for ".ts".
      for (const ext of [".ts", ".tsx", ".jsx", ".spec.ts", ".foo"]) {
        Module._extensions[ext] = origJS;
      }
      // A hook that wraps the .js handler, as pirates, ts-node and Playwright do.
      Module._extensions[".cts"] = (m, f) => origJS(m, f);
      const files = ["./spec.ts", "./spec.cts", "./comp.tsx", "./comp.jsx", "./a.spec.ts", "./plain.foo"];
      const required = files.map(f => require(f));
      // Calling the handlers directly. The TS handler takes JSX from the file name too.
      const direct = new Module("direct");
      origJS(direct, path.join(__dirname, "spec.ts"));
      const directTS = new Module("directTS");
      origTS(directTS, path.join(__dirname, "ts-handler.tsx"));
      Module._extensions[".tsx"] = origTS;
      delete require.cache[require.resolve("./comp.tsx")];
      const tsxWithTS = require("./comp.tsx");
      console.log(JSON.stringify({ required, direct: direct.exports, directTS: directTS.exports, tsxWithTS }));
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
    required: [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }, { value: 5 }, { foo: true }],
    direct: { value: 1 },
    directTS: { value: 6 },
    tsxWithTS: { value: 3 },
  });
  expect(exitCode).toBe(0);
});
// The .js handler gives a .js file the same loader as a plain require(), so a
// hook that wraps and restores it does not turn JSX in .js files into a parse error.
test.concurrent("the .js handler keeps the default loader for .js files", async () => {
  using dir = tempDir("extensions-js-handler-js-file", {
    "jsx-in-js.js": `
      /** @jsxRuntime classic */
      /** @jsx h */
      const h = (tag, props, ...children) => ({ tag, children });
      module.exports = (<div>hello</div>).children[0];
    `,
    "ts-in-js.js": `const value: string = "typescript"; module.exports = value;`,
    "run.cjs": `
      const Module = require("module");
      const origJS = Module._extensions[".js"];
      const load = f => { try { return require(f); } catch (e) { return "threw " + e.name; } };
      const results = {};
      Module._extensions[".js"] = (m, f) => origJS(m, f);
      results.wrapped = [load("./jsx-in-js.js"), load("./ts-in-js.js")];
      Module._extensions[".js"] = origJS;
      for (const f of ["./jsx-in-js.js", "./ts-in-js.js"]) delete require.cache[require.resolve(f)];
      results.restored = [load("./jsx-in-js.js"), load("./ts-in-js.js")];
      console.log(JSON.stringify(results));
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
    wrapped: ["hello", "threw AggregateError"],
    restored: ["hello", "threw AggregateError"],
  });
  expect(exitCode).toBe(0);
});
// A compound key is the only handler here. It still decides the files it matches.
test.concurrent("a compound key alone shadows the default loader of the files it matches", async () => {
  using dir = tempDir("extensions-compound-key", {
    "a.spec.ts": `module.exports = "default";`,
    "b.ts": `module.exports = "default";`,
    "run.cjs": `
      const Module = require("module");
      Module._extensions[".spec.ts"] = (m, f) => { m.exports = "custom:" + require("path").basename(f); };
      console.log(JSON.stringify([require("./a.spec.ts"), require("./b.ts")]));
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
  expect(JSON.parse(stdout)).toEqual(["custom:a.spec.ts", "default"]);
  expect(exitCode).toBe(0);
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
      const ext = path.extname(file.split("?")[0]);
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
    // A `?query` is part of the key. The handler of the file's extension still loads it.
    ["throws.js?query", "wrap", { name: "Error", message: "boom" }],
    ["throws.ts?query", "wrap", { name: "Error", message: "boom" }],
    ["cjs-throws.js?query", "pirates-evict", { name: "Error", message: "boom" }],
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

// Which handler a require() gets depends on the file name and on what the importer asked for. It does
// not depend on which other extensions have a handler. One fresh process for each set of other handlers.
//
// A `?query` belongs to the module key, not to the file name. The handler gets the key, as Node's
// handlers do when `Module._resolveFilename` returns a name with a `?`.
describe.concurrent("the handler that a require() selects", () => {
  const jsx = `
      /** @jsxRuntime classic */
      /** @jsx h */
      const h = (tag, props, ...children) => ({ tag, children });`;
  const files = {
    "x.foo": `module.exports = "plain x.foo";`,
    "p.js": `module.exports = "plain p.js";`,
    "p": `module.exports = "plain p";`,
    "j.js": `${jsx}
      module.exports = (<div>jsx in j.js</div>).children[0];`,
    "y.bar": `module.exports = "plain y.bar";`,
    "s.sh": `module.exports = "plain s.sh";`,
    "a.spec.js": `module.exports = "plain a.spec.js";`,
    "n.lit.md": `# plain n.lit.md`,
    "d.alias": `{ "a": 1 }`,
    "d.data.js": `{ "a": 1 }`,
    "select-fixture.cjs": `
      const Module = require("module");
      const path = require("path");
      const others = process.argv.at(-1);
      let calls = [];
      const handler = key =>
        function (module, filename) {
          calls.push(key + " got " + path.basename(filename));
          module.exports = key + " handler";
        };
      const original = Module._extensions[".js"];
      function wrapper(module, filename) {
        calls.push(".js got " + path.basename(filename));
        return original(module, filename);
      }
      if (others === "a wrapped .js" || others === "a restored .js") Module._extensions[".js"] = wrapper;
      if (others === "a restored .js") Module._extensions[".js"] = original;
      if (others === ".css") Module._extensions[".css"] = handler(".css");
      for (const key of [".foo", ".sh", ".spec.js", ".lit.md"]) Module._extensions[key] = handler(key);
      for (const key of [".alias", ".data.js"]) Module._extensions[key] = Module._extensions[".json"];

      const rows = {};
      for (const [specifier, options] of [
        ["./x.foo"],
        ["./x.foo?query"],
        ["./x?query"],
        ["./x.foo?raw"],
        ["./x.foo", { type: "text" }],
        ["./x.foo", { type: "bogus" }],
        ["./x.foo?raw", { type: "bogus" }],
        ["./x.foo?raw", { type: "js" }],
        ["./p.js"],
        ["./p.js?query"],
        ["./p.js?raw"],
        ["./p.js", { type: "text" }],
        ["./p.js", { type: "bogus" }],
        ["./j.js?query"],
        ["./p?x.js"],
        ["./p?x.foo"],
        ["./y.bar?v=1.js"],
        ["./y.bar?v=1.foo"],
        ['data:text/javascript,module.exports = "data"; //a.spec.js'],
        ["./s.sh"],
        ["./a.spec.js"],
        ["./n.lit.md"],
        ["./d.alias"],
        ["./d.alias?query"],
        ["./d.data.js"],
      ]) {
        calls = [];
        const exports = options ? require(specifier, options) : require(specifier);
        rows[options ? specifier + " with type " + options.type : specifier] = { exports, calls };
        for (const key of Object.keys(require.cache)) if (key !== __filename) delete require.cache[key];
      }
      console.log(JSON.stringify(rows));
    `,
  };
  const text = (file: keyof typeof files) => ({ default: files[file] });

  test.each(["no other handler", "a wrapped .js", "a restored .js", ".css", "--loader .foo:text"])(
    "with %s",
    async others => {
      using dir = tempDir("require-extensions-select", files);
      const flags = others.startsWith("--") ? others.split(" ") : [];
      const { stdout, stderr, exitCode } = await bunRun([
        ...flags,
        path.join(String(dir), "select-fixture.cjs"),
        others,
      ]);
      // The wrapper is the handler of the .js files in one state.
      const wrapped = (name: string) => (others === "a wrapped .js" ? [".js got " + name] : []);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        "./x.foo": { exports: ".foo handler", calls: [".foo got x.foo"] },
        "./x.foo?query": { exports: ".foo handler", calls: [".foo got x.foo?query"] },
        "./x?query": { exports: ".foo handler", calls: [".foo got x.foo?query"] },
        // The importer chose the loader. A `type` that names no loader is not a choice.
        "./x.foo?raw": { exports: text("x.foo"), calls: [] },
        "./x.foo with type text": { exports: text("x.foo"), calls: [] },
        "./x.foo with type bogus": { exports: ".foo handler", calls: [".foo got x.foo"] },
        "./x.foo?raw with type bogus": { exports: text("x.foo"), calls: [] },
        "./x.foo?raw with type js": { exports: "plain x.foo", calls: [] },
        "./p.js": { exports: "plain p.js", calls: wrapped("p.js") },
        "./p.js?query": { exports: "plain p.js", calls: wrapped("p.js?query") },
        "./p.js?raw": { exports: text("p.js"), calls: [] },
        "./p.js with type text": { exports: text("p.js"), calls: [] },
        "./p.js with type bogus": { exports: "plain p.js", calls: wrapped("p.js") },
        // The built-in handler that the wrapper calls reads the extension from the path too.
        "./j.js?query": { exports: "jsx in j.js", calls: wrapped("j.js?query") },
        // The text of a query and the payload of a data: URL are not a file name.
        "./p?x.js": { exports: "plain p", calls: [] },
        "./p?x.foo": { exports: "plain p", calls: [] },
        "./y.bar?v=1.js": { exports: "plain y.bar", calls: [] },
        "./y.bar?v=1.foo": { exports: "plain y.bar", calls: [] },
        'data:text/javascript,module.exports = "data"; //a.spec.js': { exports: "data", calls: [] },
        // An extension that names a loader, and keys with two dots.
        "./s.sh": { exports: ".sh handler", calls: [".sh got s.sh"] },
        "./a.spec.js": { exports: ".spec.js handler", calls: [".spec.js got a.spec.js"] },
        "./n.lit.md": { exports: ".lit.md handler", calls: [".lit.md got n.lit.md"] },
        // The built-in .json handler under other keys.
        "./d.alias": { exports: { a: 1 }, calls: [] },
        "./d.alias?query": { exports: { a: 1 }, calls: [] },
        "./d.data.js": { exports: { a: 1 }, calls: [] },
      });
      expect(exitCode).toBe(0);
    },
  );

  // The built-in .js handler under .ts: assigned, and then called from a wrapper.
  test("a query on a .ts file that the .js handler loads", async () => {
    using dir = tempDir("require-extensions-select-ts", {
      "x.ts": `const value: number = 1; module.exports = { value };`,
      "run.cjs": `
        const Module = require("module");
        const original = Module._extensions[".js"];
        let calls = 0;
        Module._extensions[".ts"] = original;
        const assigned = [require("./x.ts"), require("./x.ts?assigned")];
        Module._extensions[".ts"] = (module, filename) => (calls++, original(module, filename));
        delete require.cache[require.resolve("./x.ts")];
        const wrapped = [require("./x.ts"), require("./x.ts?wrapped")];
        console.log(JSON.stringify({ assigned, wrapped, calls }));
      `,
    });
    const loaded = [{ value: 1 }, { value: 1 }];
    expect(await bunRun(path.join(String(dir), "run.cjs"))).toEqual({
      stdout: JSON.stringify({ assigned: loaded, wrapped: loaded, calls: 2 }),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // The first handler answers by itself. The second one compiles the text of the file.
  const script = `
    const fs = require("fs");
    const path = require("path");
    const Module = require("module");
    Module._extensions[".foo"] = (module, filename) => {
      module.exports = "handler got " + path.basename(filename);
    };
    Module._extensions[".compiles"] = (module, filename) => module._compile(fs.readFileSync(filename, "utf8"), filename);
    const file = path.join(process.cwd(), "x.foo");
    let compiled;
    try {
      compiled = require(path.join(process.cwd(), "x.compiles"));
    } catch (e) {
      compiled = e.name;
    }
    console.log(JSON.stringify([require(file), require(file + "?query"), compiled]));
  `;
  const onDisk = { "x.foo": files["x.foo"], "x.compiles": `module.exports = "compiled by the handler";` };
  const handled = ["handler got x.foo", "handler got x.foo?query"];

  // The REPL has no main module.
  test("in bun repl", async () => {
    using dir = tempDir("require-extensions-select-repl", onDisk);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl", "-e", script],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([...handled, "compiled by the handler"]);
    expect(exitCode).toBe(0);
  });

  // Nor has a compiled executable. The files are on disk, and their paths are not known at build time.
  test("in a bun build --compile executable", async () => {
    using dir = tempDir("require-extensions-select-compile", { ...onDisk, "app.cjs": script });
    const executable = path.join(String(dir), isWindows ? "app.exe" : "app");
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "app.cjs", "--outfile", executable],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).not.toContain("error:");
    expect(buildExitCode).toBe(0);

    async function run(env: Record<string, string>) {
      await using proc = Bun.spawn({
        cmd: [executable],
        cwd: String(dir),
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr, exitCode };
    }
    // With =strict the executable runs no text from the disk. A handler is code of the executable.
    const [plain, strict] = await Promise.all([
      run({}),
      run({ BUN_OPTIONS: "--disallow-code-generation-from-strings=strict" }),
    ]);
    expect(plain).toEqual({
      stdout: JSON.stringify([...handled, "compiled by the handler"]),
      stderr: "",
      exitCode: 0,
    });
    expect(strict).toEqual({
      stdout: JSON.stringify([...handled, "EvalError"]),
      stderr: "",
      exitCode: 0,
    });
  });
});

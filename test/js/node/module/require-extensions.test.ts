import assert from "assert";
import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, bunRun, isWindows, nodeExe, tempDir } from "harness";
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
            if (shape === "pirates-evict") delete require.cache[module.id];
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

// Which handler a require() gets depends on the file name, and on the loader that the importer or the
// configuration asked for. It does not depend on which other extensions have a handler. One fresh process
// for each set of handlers.
//
// A `?query` belongs to the module key, not to the file name. The handler gets the file name, as
// `process.dlopen` does for a native addon. `module.filename` is the key.
describe.concurrent("the handler that a require() selects", () => {
  const jsx = `
      /** @jsxRuntime classic */
      /** @jsx h */
      const h = (tag, props, ...children) => ({ tag, children });`;
  const files = {
    "x.foo": `module.exports = "plain x.foo";`,
    "ß.foo": `module.exports = "plain ß.foo";`,
    "日本п.foo": `module.exports = "plain 日本п.foo";`,
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
      if (others.includes("a wrapped .js") || others === "a restored .js") Module._extensions[".js"] = wrapper;
      if (others === "a restored .js") Module._extensions[".js"] = original;
      if (others === ".css") Module._extensions[".css"] = handler(".css");
      Module._extensions[".foo"] = handler(".foo");
      const requests = [
        ["./x.foo"],
        ["./x.foo?query"],
        ["./x?query"],
        ["./x.foo?a?b"],
        ["./x.foo?dir=a/b.js"],
        ["./ß.foo?v=1"],
        ["./日本п.foo?v=1"],
        ["./x.foo?raw"],
        ["./x.foo", { type: "text" }],
        ["./x.foo", { type: "bogus" }],
        ["./x.foo?raw", { type: "bogus" }],
        ["./x.foo?raw", { type: "js" }],
        ["./p.js"],
        ["./p.js?query"],
        ["./p.js?v=日本"],
        ["./p.js?dir=a/b.foo"],
        ["./p.js?raw"],
        ["./p.js", { type: "text" }],
        ["./p.js", { type: "bogus" }],
        ["./p.js", { type: "js" }],
        ["./j.js?query"],
        ["./j.js?dir=a/b.ts"],
        ["./y.bar"],
        ["./p?x.js"],
        ["./p?x.foo"],
        ["./y.bar?v=1.js"],
        ["./y.bar?v=1.foo"],
        ['data:text/javascript,module.exports = "data"; //a.spec.js'],
      ];
      if (others === "handlers on more keys") {
        for (const key of [".sh", ".spec.js", ".lit.md"]) Module._extensions[key] = handler(key);
        for (const key of [".alias", ".data.js"]) Module._extensions[key] = Module._extensions[".json"];
        requests.push(["./s.sh"], ["./a.spec.js"], ["./n.lit.md"], ["./d.alias"], ["./d.alias?query"], ["./d.data.js"]);
      }

      const rows = {};
      for (const [specifier, options] of requests) {
        calls = [];
        const row = options ? specifier + " with type " + options.type : specifier;
        try {
          rows[row] = { exports: options ? require(specifier, options) : require(specifier), calls };
        } catch (error) {
          rows[row] = { error: error.name, calls };
        }
        for (const key of Object.keys(require.cache)) if (key !== __filename) delete require.cache[key];
      }
      console.log(JSON.stringify(rows));
    `,
  };
  const text = (file: keyof typeof files) => ({ default: files[file] });

  test.each([
    "no other handler",
    "a wrapped .js",
    "a restored .js",
    ".css",
    "handlers on more keys",
    "--loader .foo:text",
    "--loader .foo:text and a wrapped .js",
    "--loader .js:jsx and a wrapped .js",
  ])("with %s", async others => {
    using dir = tempDir("require-extensions-select", files);
    const flags = others.startsWith("--") ? others.split(" ").slice(0, 2) : [];
    const { stdout, stderr, exitCode } = await bunRun([...flags, path.join(String(dir), "select-fixture.cjs"), others]);
    // The wrapper is the handler of the .js files.
    const wrapped = (name: string) => (others.includes("a wrapped .js") ? [".js got " + name] : []);
    // The configuration names the loader of an extension that has no loader by default. That is a choice too.
    const foo = (file: keyof typeof files) =>
      flags.includes(".foo:text")
        ? { exports: text(file), calls: [] }
        : { exports: ".foo handler", calls: [".foo got " + file] };
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      "./x.foo": foo("x.foo"),
      "./x.foo?query": foo("x.foo"),
      "./x?query": foo("x.foo"),
      // The query starts at the first "?". What follows is not a file name, with a separator or not.
      "./x.foo?a?b": foo("x.foo"),
      "./x.foo?dir=a/b.js": foo("x.foo"),
      "./ß.foo?v=1": foo("ß.foo"),
      "./日本п.foo?v=1": foo("日本п.foo"),
      // The importer chose the loader. A `type` that names no loader is not a choice.
      "./x.foo?raw": { exports: text("x.foo"), calls: [] },
      "./x.foo with type text": { exports: text("x.foo"), calls: [] },
      "./x.foo with type bogus": foo("x.foo"),
      "./x.foo?raw with type bogus": { exports: text("x.foo"), calls: [] },
      "./x.foo?raw with type js": { exports: "plain x.foo", calls: [] },
      "./p.js": { exports: "plain p.js", calls: wrapped("p.js") },
      "./p.js?query": { exports: "plain p.js", calls: wrapped("p.js") },
      "./p.js?v=日本": { exports: "plain p.js", calls: wrapped("p.js") },
      "./p.js?dir=a/b.foo": { exports: "plain p.js", calls: wrapped("p.js") },
      "./p.js?raw": { exports: text("p.js"), calls: [] },
      "./p.js with type text": { exports: text("p.js"), calls: [] },
      "./p.js with type bogus": { exports: "plain p.js", calls: wrapped("p.js") },
      // Node.js has no such option and calls the wrapper.
      "./p.js with type js": { exports: "plain p.js", calls: [] },
      // The built-in handler that the wrapper calls loads the key. It reads the extension from the path too.
      "./j.js?query": { exports: "jsx in j.js", calls: wrapped("j.js") },
      "./j.js?dir=a/b.ts": { exports: "jsx in j.js", calls: wrapped("j.js") },
      // Node.js hands a file with no handler to the .js handler. Bun loads it without one.
      "./y.bar": { exports: "plain y.bar", calls: [] },
      // The text of a query and the payload of a data: URL are not a file name.
      "./p?x.js": { exports: "plain p", calls: [] },
      "./p?x.foo": { exports: "plain p", calls: [] },
      "./y.bar?v=1.js": { exports: "plain y.bar", calls: [] },
      "./y.bar?v=1.foo": { exports: "plain y.bar", calls: [] },
      'data:text/javascript,module.exports = "data"; //a.spec.js': { exports: "data", calls: [] },
      ...(others === "handlers on more keys" && {
        // An extension that names a loader, and keys with two dots.
        "./s.sh": { exports: ".sh handler", calls: [".sh got s.sh"] },
        "./a.spec.js": { exports: ".spec.js handler", calls: [".spec.js got a.spec.js"] },
        "./n.lit.md": { exports: ".lit.md handler", calls: [".lit.md got n.lit.md"] },
        // The built-in .json handler under other keys.
        "./d.alias": { exports: { a: 1 }, calls: [] },
        "./d.alias?query": { exports: { a: 1 }, calls: [] },
        "./d.data.js": { exports: { a: 1 }, calls: [] },
      }),
    });
    expect(exitCode).toBe(0);
  });

  // These requests mean the same to Node.js. The fixture runs there unchanged.
  const sameAsNode = {
    files: {
      "s.sh": `module.exports = "plain s.sh";`,
      "b.base64": `module.exports = "plain b.base64";`,
      "f.file": `module.exports = "plain f.file";`,
      "x.foo": `module.exports = "plain x.foo";`,
      "a.spec.js": `module.exports = "plain a.spec.js";`,
      "n.lit.md": `module.exports = "plain n.lit.md";`,
      ".hidden.foo": `module.exports = "plain .hidden.foo";`,
      ".foo": `module.exports = "plain .foo";`,
      "p.js": `module.exports = "plain p.js";`,
      "node-fixture.cjs": `
        const Module = require("module");
        const path = require("path");
        const [keys, shape, requests] = process.argv.slice(-3);
        const calls = [];
        const original = Module._extensions[".js"];
        const answers = key => (module, filename) => {
          calls.push(key + " got " + path.basename(filename));
          module.exports = key + " handler";
        };
        const callsTheJsHandler = key => (module, filename) => {
          calls.push(key + " got " + path.basename(filename));
          return original(module, filename);
        };
        for (const key of keys.split(" ")) {
          if (key === ".js" || shape === "calls the .js handler") Module._extensions[key] = callsTheJsHandler(key);
          else Module._extensions[key] = shape === "is the .js handler" ? original : answers(key);
        }
        const loaded = requests.split(" ").map(request => require("./" + request));
        console.log(JSON.stringify({ loaded, calls }));
      `,
    },
    cases: [
      // A handler alone, on an extension that names a loader of Bun.
      [".sh", "answers", "s.sh", [".sh handler"], [".sh got s.sh"]],
      [".base64", "answers", "b.base64", [".base64 handler"], [".base64 got b.base64"]],
      [".file", "answers", "f.file", [".file handler"], [".file got f.file"]],
      [".base64", "is the .js handler", "b.base64", ["plain b.base64"], []],
      [".file", "calls the .js handler", "f.file", ["plain f.file"], [".file got f.file"]],
      // A made-up extension, keys with two dots, and names that begin with a dot.
      [
        ".foo .spec.js .lit.md",
        "answers",
        "x.foo a.spec.js n.lit.md .hidden.foo .foo",
        [".foo handler", ".spec.js handler", ".lit.md handler", ".foo handler", "plain .foo"],
        [".foo got x.foo", ".spec.js got a.spec.js", ".lit.md got n.lit.md", ".foo got .hidden.foo"],
      ],
      [
        ".foo .spec.js .lit.md .js",
        "answers",
        "x.foo a.spec.js n.lit.md .hidden.foo p.js",
        [".foo handler", ".spec.js handler", ".lit.md handler", ".foo handler", "plain p.js"],
        [".foo got x.foo", ".spec.js got a.spec.js", ".lit.md got n.lit.md", ".foo got .hidden.foo", ".js got p.js"],
      ],
    ] as const,
    async run(exe: string, dir: string, args: readonly string[]) {
      await using proc = Bun.spawn({
        cmd: [exe, path.join(dir, "node-fixture.cjs"), ...args],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr, exitCode };
    },
  };

  test.each(sameAsNode.cases)("%s %s, as in Node.js", async (keys, shape, requests, loaded, calls) => {
    using dir = tempDir("require-extensions-select-node", sameAsNode.files);
    const expected = { stdout: JSON.stringify({ loaded, calls }), stderr: "", exitCode: 0 };
    expect(await sameAsNode.run(bunExe(), String(dir), [keys, shape, requests])).toEqual(expected);
    const node = nodeExe();
    if (node) expect(await sameAsNode.run(node, String(dir), [keys, shape, requests])).toEqual(expected);
  });

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

  // handlebars, coffeescript and node-hook install handlers of this shape.
  test.each([".foo", ".foo and .js"])(
    "a handler on %s that reads the file itself loads a key with a query",
    async keys => {
      const names = `module.exports = [__filename, module.filename, module.id].map(name => require("path").basename(name));`;
      using dir = tempDir("require-extensions-select-read", {
        "x.foo": names,
        "q.js": names,
        "esm.js": `export default "an ES module";`,
        "run.cjs": `
          const Module = require("module");
          const fs = require("fs");
          const path = require("path");
          const got = [];
          const read = (module, filename) => {
            got.push(path.basename(filename));
            module._compile(fs.readFileSync(filename, "utf8"), filename);
          };
          for (const key of process.argv.at(-1).split(" and ")) Module._extensions[key] = read;
          const loaded = [require("./x.foo?v=1"), require("./q.js?v=2")];
          // module._compile takes the text of a CommonJS module. The query makes no difference to that.
          const esm = ["./esm.js", "./esm.js?v=1"].map(id => {
            try {
              return require(id).default;
            } catch (error) {
              return error.name;
            }
          });
          const cached = Object.keys(require.cache).map(key => path.basename(key)).sort();
          console.log(JSON.stringify({ loaded, esm, got, cached }));
        `,
      });
      // `__filename` is the name that the handler gives to module._compile.
      const hooked = (file: string, query: string) => [file, file + query, file + query];
      const js = keys === ".foo" ? ["q.js?v=2", "q.js?v=2", "q.js?v=2"] : hooked("q.js", "?v=2");
      expect(await bunRun([path.join(String(dir), "run.cjs"), keys])).toEqual({
        stdout: JSON.stringify({
          loaded: [hooked("x.foo", "?v=1"), js],
          esm: keys === ".foo" ? ["an ES module", "an ES module"] : ["SyntaxError", "SyntaxError"],
          got: keys === ".foo" ? ["x.foo"] : ["x.foo", "q.js", "esm.js", "esm.js"],
          cached:
            keys === ".foo"
              ? ["esm.js", "esm.js?v=1", "q.js?v=2", "run.cjs", "x.foo?v=1"]
              : ["q.js?v=2", "run.cjs", "x.foo?v=1"],
        }),
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
  );

  // A wrapper hands the file name back to the built-in handler. That handler then loads the key of the module.
  test.each(["no wrapper", "a wrapper", "a wrapper that replaces module._compile"])(
    "each query is its own module with %s of the .js handler",
    async shape => {
      using dir = tempDir("require-extensions-select-instances", {
        "esm.js": `
          globalThis.esmRuns = (globalThis.esmRuns ?? 0) + 1;
          export const run = globalThis.esmRuns;
          export const url = import.meta.url.split("/").pop();
        `,
        "cjs.js": `
          globalThis.cjsRuns = (globalThis.cjsRuns ?? 0) + 1;
          module.exports = { run: globalThis.cjsRuns, filename: require("path").basename(__filename) };
        `,
        // It removes itself from the cache under the name that it has.
        "self.js": `
          globalThis.selfRuns = (globalThis.selfRuns ?? 0) + 1;
          delete require.cache[__filename];
          module.exports = { run: globalThis.selfRuns, isTheKey: __filename === module.filename };
        `,
        "where.ts": `
          interface Shape {
            a: number;
          }
          module.exports = (shape: Shape) => new Error("line 5").stack!.split("\\n")[1].trim();
        `,
        "run.cjs": `
          const Module = require("module");
          const path = require("path");
          const shape = process.argv.at(-1);
          const got = [];
          for (const key of shape === "no wrapper" ? [] : [".js", ".ts"]) {
            const original = Module._extensions[key];
            Module._extensions[key] = (module, filename) => {
              got.push(path.basename(filename));
              if (shape !== "a wrapper") {
                const compile = module._compile;
                module._compile = function (code, name) {
                  module._compile = compile;
                  got.push("compile " + path.basename(name));
                  return module._compile(code, name);
                };
              }
              return original(module, filename);
            };
          }
          const esm = ["./esm.js?v=1", "./esm.js?v=2", "./esm.js?v=2?w", "./esm.js"].map(id => require(id)).map(({ run, url }) => ({ run, url }));
          const cjs = ["./cjs.js?v=1", "./cjs.js?v=2", "./cjs.js?v=2?w", "./cjs.js"].map(id => require(id));
          const self = [require("./self.js?v=1"), require("./self.js?v=1")];
          const frame = require("./where.ts?v=1")({ a: 1 }).replace(/^at .*[\\\\/](where\\.ts[^:]*:\\d+):\\d+\\)?$/, "$1");
          // A call that is not for the module that require() loads takes the name as it is.
          const direct = new Module(path.join(__dirname, "esm.js?direct"));
          direct.filename = direct.id;
          direct.paths = [];
          Module._extensions[".js"](direct, path.join(__dirname, "esm.js"));
          console.log(JSON.stringify({ esm, cjs, self, frame, direct: { run: direct.exports.run, url: direct.exports.url }, got }));
        `,
      });
      const compiles = shape === "a wrapper that replaces module._compile";
      // module._compile gets the file name from the wrapper. That name is `__filename`.
      const filename = (key: string) => (compiles ? "cjs.js" : key);
      const names = (name: string, count: number) =>
        Array.from({ length: count }, () => (compiles ? [name, "compile " + name] : [name])).flat();
      expect(await bunRun([path.join(String(dir), "run.cjs"), shape])).toEqual({
        stdout: JSON.stringify({
          esm: [
            { run: 1, url: "esm.js?v=1" },
            { run: 2, url: "esm.js?v=2" },
            { run: 3, url: "esm.js?v=2?w" },
            { run: 4, url: "esm.js" },
          ],
          cjs: [
            { run: 1, filename: filename("cjs.js?v=1") },
            { run: 2, filename: filename("cjs.js?v=2") },
            { run: 3, filename: filename("cjs.js?v=2?w") },
            { run: 4, filename: filename("cjs.js") },
          ],
          // `delete require.cache[__filename]` removes the module only where `__filename` is the key.
          self: compiles
            ? [
                { run: 1, isTheKey: false },
                { run: 1, isTheKey: false },
              ]
            : [
                { run: 1, isTheKey: true },
                { run: 2, isTheKey: true },
              ],
          frame: "where.ts:5",
          direct: { run: 4, url: "esm.js" },
          got:
            shape === "no wrapper"
              ? []
              : [
                  ...["esm.js", "esm.js", "esm.js", "esm.js"],
                  ...names("cjs.js", 4),
                  ...names("self.js", compiles ? 1 : 2),
                  ...names("where.ts", 1),
                  "esm.js",
                ],
        }),
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
  );

  // A handler can hand another file to the built-in handler. That file has one ES module, whatever the query of the key.
  test("the built-in handler loads the file that a handler names", async () => {
    using dir = tempDir("require-extensions-select-other-file", {
      "c.jsx": `module.exports = "c.jsx";`,
      "c.js": `module.exports = "c.js";`,
      "x.foo": `module.exports = "x.foo";`,
      "target.js": `
        globalThis.targetRuns = (globalThis.targetRuns ?? 0) + 1;
        export const run = globalThis.targetRuns;
        export const url = import.meta.url.split("/").pop();
      `,
      "run.cjs": `
        const Module = require("module");
        const path = require("path");
        const original = Module._extensions[".js"];
        // The name of the other file is a prefix of the key.
        Module._extensions[".jsx"] = (module, filename) => original(module, filename.slice(0, -1));
        Module._extensions[".foo"] = (module, filename) => original(module, path.join(path.dirname(filename), "target.js"));
        const twin = ["./c.jsx", "./c.jsx?v=1"].map(id => require(id));
        const target = ["./x.foo?v=1", "./x.foo?v=2", "./x.foo"].map(id => require(id)).map(({ run, url }) => ({ run, url }));
        console.log(JSON.stringify({ twin, target }));
      `,
    });
    const one = { run: 1, url: "target.js" };
    expect(await bunRun(path.join(String(dir), "run.cjs"))).toEqual({
      stdout: JSON.stringify({ twin: ["c.js", "c.js"], target: [one, one, one] }),
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });

  // tsx gives a key its query in Module._resolveFilename, and its handler reads the query from the file name.
  // The handler gets no query here, so it hands the file to the handler that it replaced.
  test.each(["a scoped handler", "a global and a scoped handler"])(
    "a key that Module._resolveFilename gives a query, with %s",
    async handlers => {
      using dir = tempDir("require-extensions-select-resolve-filename", {
        "entry.js": `module.exports = { entry: "plain entry", child: require("./child.js") };`,
        "child.js": `
          globalThis.childRuns = (globalThis.childRuns ?? 0) + 1;
          module.exports = ["plain child", ...[__filename, module.filename].map(name => require("path").basename(name))];
        `,
        "run.cjs": `
          const Module = require("module");
          const fs = require("fs");
          const path = require("path");
          const calls = [];
          const namespaceOf = name => new URLSearchParams(String(name).split("?")[1]).get("namespace") ?? undefined;
          const resolveFilename = Module._resolveFilename;
          Module._resolveFilename = function (request, parent, ...rest) {
            const [id, query] = request.split("?");
            const namespace = namespaceOf("?" + (query ?? "")) ?? namespaceOf(parent?.filename);
            const resolved = resolveFilename.call(this, id, parent, ...rest);
            return namespace && path.isAbsolute(resolved) ? resolved + "?namespace=" + namespace : resolved;
          };
          const transformer = (label, namespace, original) => (module, filename) => {
            if (namespaceOf(filename) !== namespace) {
              calls.push(label + " declines " + path.basename(filename));
              return original(module, filename);
            }
            calls.push(label + " transforms " + path.basename(filename));
            const file = filename.split("?")[0];
            module._compile(fs.readFileSync(file, "utf8").replace("plain", "transformed by " + label), file);
          };
          if (process.argv.at(-1) === "a global and a scoped handler")
            Module._extensions[".js"] = transformer("global", undefined, Module._extensions[".js"]);
          const scoped = transformer("scoped", "1", Module._extensions[".js"]);
          Module._extensions[".js"] = scoped;
          const loaded = require("./entry.js?namespace=1");
          const cached = Object.keys(require.cache).map(key => path.basename(key)).sort();
          console.log(JSON.stringify({ loaded, calls, cached, childRuns: globalThis.childRuns }));
        `,
      });
      const both = handlers === "a global and a scoped handler";
      const by = both ? "transformed by global" : "plain";
      const calls = (file: string) => ["scoped declines " + file, ...(both ? ["global transforms " + file] : [])];
      expect(await bunRun([path.join(String(dir), "run.cjs"), handlers])).toEqual({
        stdout: JSON.stringify({
          loaded: {
            entry: by + " entry",
            child: [by + " child", both ? "child.js" : "child.js?namespace=1", "child.js?namespace=1"],
          },
          calls: [...calls("entry.js"), ...calls("child.js")],
          cached: ["child.js?namespace=1", "entry.js?namespace=1", "run.cjs"],
          childRuns: 1,
        }),
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    },
  );

  // The first handler answers by itself. The second one compiles the text of the file.
  const script = `
    const fs = require("fs");
    const path = require("path");
    const Module = require("module");
    const calls = [];
    Module._extensions[".foo"] = (module, filename) => {
      calls.push(path.basename(filename));
      module.exports = "handler got " + path.basename(filename) + " for " + path.basename(module.id);
    };
    Module._extensions[".compiles"] = (module, filename) => module._compile(fs.readFileSync(filename, "utf8"), filename);
    const file = path.join(process.cwd(), "x.foo");
    let compiled;
    try {
      compiled = require(path.join(process.cwd(), "x.compiles"));
    } catch (e) {
      compiled = e.name;
    }
    const loaded = [require(file), require(file + "?query"), compiled];
    // A file that the executable holds is not a file for a handler, with a query or without one.
    const embedded = path.join(path.dirname(Bun.main), "embedded.foo");
    const isEmbedded = fs.existsSync(embedded);
    if (isEmbedded)
      for (const id of [embedded, embedded + "?query"]) {
        try {
          require(id);
        } catch {}
      }
    console.log(JSON.stringify([...loaded, calls, { isEmbedded }]));
  `;
  const onDisk = { "x.foo": files["x.foo"], "x.compiles": `module.exports = "compiled by the handler";` };
  const handled = ["handler got x.foo for x.foo", "handler got x.foo for x.foo?query"];
  const calls = ["x.foo", "x.foo"];

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
    expect(JSON.parse(stdout)).toEqual([...handled, "compiled by the handler", calls, { isEmbedded: false }]);
    expect(exitCode).toBe(0);
  });

  // Nor has a compiled executable. The files are on disk, and the build does not know their paths.
  test("in a bun build --compile executable", async () => {
    using dir = tempDir("require-extensions-select-compile", {
      ...onDisk,
      "embedded.foo": `module.exports = "embedded";`,
      "app.cjs": script,
    });
    const executable = path.join(String(dir), isWindows ? "app.exe" : "app");
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "app.cjs", "--asset", "embedded.foo", "--outfile", executable],
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
      stdout: JSON.stringify([...handled, "compiled by the handler", calls, { isEmbedded: true }]),
      stderr: "",
      exitCode: 0,
    });
    expect(strict).toEqual({
      stdout: JSON.stringify([...handled, "EvalError", calls, { isEmbedded: true }]),
      stderr: "",
      exitCode: 0,
    });
    // A debug build copies itself into the executable, and that is more than a gigabyte.
  }, 30_000);
});

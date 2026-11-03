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

// Bun keeps a source map for each text it transpiles. Text that a program hands to module._compile() is not
// transpiled. It runs under a file name the program chooses, and that name can be the name of a file Bun has transpiled.
describe.concurrent("positions in text that module._compile() was given", () => {
  // The transpiler removes the comment, so every line that the source map of the fixture itself can answer with is
  // below it, and a position in `text` that went through that map cannot be taken for the right one.
  const padding = ["/*", ...Array.from({ length: 18 }, () => " *"), " */"].join("\n") + "\n";
  const typescript = [
    "type A = { a: number };",
    "type B = { b: number };",
    "type C = { c: number };",
    'export function make(): Error { try { throw new Error("x"); } catch (e) { return e as Error; } }',
    "",
  ].join("\n");
  const prelude = String.raw`
    const Module = require("module");
    const path = require("path");
    const vm = require("vm");
    const dirname = __dirname + path.sep;
    const at = e => e.stack.split("\n")[1].trim().replaceAll(dirname, "");
    const position = e => ({ at: at(e), line: e.line, column: e.column });
    const callSite = make => {
      const prepare = Error.prepareStackTrace;
      Error.prepareStackTrace = (_, sites) => sites;
      try {
        const site = make().stack[0];
        return { file: path.basename(site.getFileName()), line: site.getLineNumber(), column: site.getColumnNumber() };
      } finally {
        Error.prepareStackTrace = prepare;
      }
    };
    // What Bun.inspect() prints down to the first frame: the code frame, the message and where it was thrown.
    const inspect = e => {
      const lines = Bun.inspect(e).replaceAll(dirname, "").split("\n");
      return lines.slice(0, lines.findIndex(line => line.trim().startsWith("at ")) + 1).join("\n");
    };
    const compile = (text, filename) => {
      const module_ = new Module(filename, module);
      module_.filename = filename;
      module_.paths = module.paths;
      module_._compile(text, filename);
      return module_.exports;
    };
  `;
  const files = {
    "mod.ts": typescript,
    "lib.ts": typescript,
    "positions.js":
      padding +
      prelude +
      String.raw`
        // Line 7 throws. Line 9 asks where it is.
        const text = [
          "// one", "// two", "// three", "// four", "// five", "// six",
          "exports.make = function make() { try { throw new Error('y'); } catch (e) { return e; } };",
          "// eight",
          "exports.where = function where() { return require('util').getCallSites()[0]; };",
          "",
        ].join("\n");
        const describe = exports => ({
          ...position(exports.make()),
          callSite: callSite(exports.make),
          getCallSites: (site => ({ file: path.basename(site.scriptName), line: site.lineNumber }))(exports.where()),
          inspect: inspect(exports.make()),
        });
        const out = {};

        // A file that Bun loads, then a handler that compiles its own text under the name of that file.
        const mod = require.resolve("./mod.ts");
        const loaded = require(mod);
        out.loaded = at(loaded.make());
        require.extensions[".ts"] = (module, filename) => module._compile(text, filename);
        delete require.cache[mod];
        out.handler = describe(require(mod));
        out.loadedAfterTheHandler = at(loaded.make());

        // The other order: the handler's text first, and the file itself after it.
        const lib = require.resolve("./lib.ts");
        const fromHandler = require(lib);
        delete require.extensions[".ts"];
        delete require.cache[lib];
        out.loadedSecond = at(require(lib).make());
        out.handlerFirst = describe(fromHandler);

        // No handler: text under the name of the file that calls module._compile().
        out.direct = describe(compile(text, __filename));

        // The same text under a name that no file has.
        out.control = describe(compile(text, path.join(__dirname, "control.js")));

        console.log(JSON.stringify(out));
      `,
    "syntax-error.js":
      padding +
      prelude +
      String.raw`
        // Bun's parser accepts a regular expression that JavaScriptCore rejects.
        const text = '\n\n\n"".test(/[a-0]/);';
        const thrown = fn => {
          try {
            fn();
          } catch (e) {
            const parse = String(e.stack).split("\n").find(line => line.includes("<parse>")) ?? "";
            return { name: e.name, line: e.line, parse: parse.trim().replaceAll(dirname, "") };
          }
        };
        console.log(
          JSON.stringify({
            own: thrown(() => compile(text, __filename)),
            control: thrown(() => compile(text, path.join(__dirname, "control.js"))),
          }),
        );
      `,
    // pirates, @babel/register, ts-node and nyc: a handler replaces module._compile and calls the loader it replaced.
    // Bun's loader transpiles the file and hands the result to that module._compile, so what the hook compiles for
    // that module is mapped back to the file.
    "hook.cjs":
      prelude +
      String.raw`
        const [, , hook, fixture] = process.argv;
        const original = Module._extensions[".ts"];
        const hooks = {
          native: (module, code, filename) => module._compile(code, filename),
          // A hook that compiles a second time after what it made first did not parse.
          nativeAgain: (module, code, filename) => {
            try {
              module._compile("}", filename);
            } catch {}
            return module._compile(code, filename);
          },
          // A hook that loads another hooked file before it compiles this one.
          requiresFirst: (module, code, filename) => {
            if (path.basename(filename) !== "helper.ts") require("./helper.ts");
            return module._compile(code, filename);
          },
          // A hook that compiles a text of its own for the module, under another name, before the file.
          compilesHelper: (module, code, filename) => {
            const text = "\n\n\nexports.ofTheHook = function ofTheHook() { try { throw new Error('h'); } catch (e) { return e; } };";
            module._compile(text, filename + ".of-the-hook.js");
            return module._compile(code, filename);
          },
        };
        if (hook !== "none") {
          Module._extensions[".ts"] = function (module, filename) {
            const compile = module._compile;
            module._compile = function (code) {
              module._compile = compile;
              return hooks[hook](module, code, filename);
            };
            return original.call(this, module, filename);
          };
        }
        const file = require.resolve(fixture);
        const describe = ({ make, helper, inner, innerVm, ofTheHook }) => ({
          make: { ...position(make()), callSite: callSite(make).line },
          helper: helper && at(helper()),
          inner: inner && at(inner()),
          innerVm: innerVm && at(innerVm()),
          ofTheHook: ofTheHook && at(ofTheHook()),
        });
        const first = require(file);
        // The file again, through the hook again. The first load is still there.
        delete require.cache[file];
        const second = require(file);
        console.log(JSON.stringify({ first: describe(first), second: describe(second), firstAfterSecond: describe(first) }));
      `,
    "hooked.ts": typescript.replace("export function make", "exports.make = function make"),
    "helper.ts": typescript.replace("export function make", "exports.make = function make"),
    // A hooked file that loads a hooked file while it is loaded.
    "requires-helper.ts": [
      "type A = { a: number };",
      'const helper = require("./helper.ts");',
      "type B = { b: number };",
      "exports.helper = helper.make;",
      'exports.make = function make(): Error { try { throw new Error("x"); } catch (e) { return e as Error; } };',
      "",
    ].join("\n"),
    // Each inner text has make() on its line 9.
    "compiles.ts": [
      "type A = { a: number };",
      `const text = "\\n\\n\\n\\n\\n\\n\\n\\nexports.make = function make() { try { throw new Error('inner'); } catch (e) { return e; } };";`,
      'const inner = new (require("module"))(__filename, module);',
      "inner._compile(text, __filename);",
      "exports.inner = inner.exports.make;",
      "const innerVm = { exports: {} as any };",
      'require("vm").runInThisContext("(function (exports) {" + text + "\\n})", { filename: __filename })(innerVm.exports);',
      "exports.innerVm = innerVm.exports.make;",
      'exports.make = function make(): Error { try { throw new Error("x"); } catch (e) { return e as Error; } };',
      "",
    ].join("\n"),
  };

  async function run(fixture: string, ...args: string[]) {
    using dir = tempDir("module-compile-positions", files);
    const { stdout, stderr, exitCode } = await bunRun([path.join(String(dir), fixture), ...args]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return JSON.parse(stdout);
  }

  test("are positions in that text, whatever file it is named after", async () => {
    const out = await run("positions.js");
    const control = JSON.stringify(out.control);
    const named = (name: string) => JSON.parse(control.replaceAll("control.js", name));

    expect(out.control.at).toMatch(/^at make \(control\.js:7:\d+\)$/);
    expect(out.control).toMatchObject({
      line: 7,
      callSite: { file: "control.js", line: 7 },
      getCallSites: { file: "control.js", line: 9 },
    });
    expect(out.control.inspect).toContain("7 | exports.make = function make() { try { throw new Error('y'); }");
    expect({
      handler: out.handler,
      handlerFirst: out.handlerFirst,
      direct: out.direct,
    }).toEqual({
      handler: named("mod.ts"),
      handlerFirst: named("lib.ts"),
      direct: named("positions.js"),
    });
    // What Bun transpiled keeps its map when other text is compiled under its name, before or after.
    expect({
      loaded: out.loaded,
      loadedAfterTheHandler: out.loadedAfterTheHandler,
      loadedSecond: out.loadedSecond,
    }).toEqual({
      loaded: "at make (mod.ts:4:49)",
      loadedAfterTheHandler: "at make (mod.ts:4:49)",
      loadedSecond: "at make (lib.ts:4:49)",
    });
  });

  test("a SyntaxError is at its line of that text", async () => {
    expect(await run("syntax-error.js")).toEqual({
      own: { name: "SyntaxError", line: 4, parse: "at <parse> (syntax-error.js:4)" },
      control: { name: "SyntaxError", line: 4, parse: "at <parse> (control.js:4)" },
    });
  });

  // Each hook in a process of its own: a handler that is assigned again does not replace the first one.
  const hooks = ["none", "native", "nativeAgain", "requiresFirst"];
  const hooked = async (fixture: string) => {
    const out = await Promise.all(hooks.map(hook => run("hook.cjs", hook, fixture)));
    return Object.fromEntries(hooks.map((hook, i) => [hook, out[i]]));
  };
  const everyHook = (load: object) =>
    Object.fromEntries(hooks.map(hook => [hook, { first: load, second: load, firstAfterSecond: load }]));

  test("what a hook compiles of the file that Bun's loader hands to it is mapped back to the file", async () => {
    expect(await hooked("./hooked.ts")).toEqual(
      everyHook({ make: { at: "at make (hooked.ts:4:57)", line: 4, column: 57, callSite: 4 } }),
    );
  });

  test("what a hook compiles for the module under another name is a text of its own", async () => {
    const load = {
      make: { at: "at make (hooked.ts:4:57)", line: 4, column: 57, callSite: 4 },
      ofTheHook: expect.stringMatching(/^at ofTheHook \(hooked\.ts\.of-the-hook\.js:4:\d+\)$/),
    };
    expect(await run("hook.cjs", "compilesHelper", "./hooked.ts")).toEqual({
      first: load,
      second: load,
      firstAfterSecond: load,
    });
  });

  test("a hooked file that loads a hooked file keeps the positions of both", async () => {
    expect(await hooked("./requires-helper.ts")).toEqual(
      everyHook({
        make: { at: "at make (requires-helper.ts:5:57)", line: 5, column: 57, callSite: 5 },
        helper: "at make (helper.ts:4:57)",
      }),
    );
  });

  test("what a file compiles under its own name while a hook loads it is not mapped back to the file", async () => {
    expect(await hooked("./compiles.ts")).toEqual(
      everyHook({
        make: expect.objectContaining({ line: 9, callSite: 9 }),
        inner: expect.stringMatching(/^at make \(compiles\.ts:9:\d+\)$/),
        innerVm: expect.stringMatching(/^at make \(compiles\.ts:9:\d+\)$/),
      }),
    );
  });
});

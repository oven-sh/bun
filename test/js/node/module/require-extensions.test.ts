import assert from "assert";
import { expect, mock, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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
test("a replaced module._compile gets the file from disk when bun cannot parse it", async () => {
  // Spawned because the other tests in this file leave ".js" mapped to the TypeScript loader.
  const flow = `// @flow\nconst x: number = 1;\nmodule.exports = { kind: "flow", x };\n`;
  using dir = tempDir("extensions-unparseable", {
    "flow.js": flow,
    "flow2.js": flow,
    "flow3.js": flow,
    // Parses as TSX, not as JavaScript.
    "generic.tsx": `type Props = { name: string };\nconst greet = <T extends Props>(p: T): string => "hello " + p.name;\nexport const out = greet({ name: "bun" });\n`,
    "broken.json": `{ not json`,
    "main.cjs": `
      const path = require("path");
      const fs = require("fs");
      const originalJS = require.extensions[".js"];
      const originalJSON = require.extensions[".json"];
      const seen = [];
      // What pirates.addHook() does. @babel/register, sucrase/register, esbuild-register and ts-node share it.
      const addHook = old =>
        function (module, filename) {
          const compile = module._compile;
          module._compile = function (code) {
            module._compile = compile;
            seen.push([path.basename(filename), code]);
            return module._compile("module.exports = 'transformed " + path.basename(filename) + "';", filename);
          };
          old(module, filename);
        };
      const caught = fn => {
        try {
          return fn();
        } catch (e) {
          return "threw " + e.name + ": " + String(e.message).split("\\n")[0].replaceAll(__dirname + path.sep, "");
        }
      };

      require.extensions[".js"] = addHook(originalJS);
      // Bun has no ".tsx" entry, so those packages wrap the ".js" loader for it, as they do in Node.
      require.extensions[".tsx"] = addHook(originalJS);
      require.extensions[".json"] = addHook(originalJSON);
      const flow = caught(() => require("./flow.js"));
      const tsx = caught(() => require("./generic.tsx"));
      const sawFileFromDisk = seen.map(([name, code]) => [name, code === fs.readFileSync(path.join(__dirname, name), "utf8")]);
      // The JSON loader does not use module._compile, in Node too.
      const json = caught(() => require("./broken.json"));

      // A file that cannot be read keeps the error from the loader.
      require.extensions[".js"] = function (module, filename) {
        module._compile = () => {
          throw new Error("should not be called");
        };
        originalJS(module, path.join(__dirname, "missing.js"));
      };
      const unreadable = caught(() => require("./flow2.js"));

      // Without a replaced module._compile nothing changes.
      require.extensions[".js"] = function (module, filename) {
        originalJS(module, filename);
      };
      const noReplacement = caught(() => require("./flow3.js"));

      console.log(JSON.stringify({ flow, tsx, sawFileFromDisk, json, unreadable, noReplacement, calls: seen.length }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.cjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    flow: "transformed flow.js",
    tsx: "transformed generic.tsx",
    sawFileFromDisk: [
      ["flow.js", true],
      ["generic.tsx", true],
    ],
    json: "threw SyntaxError: JSON Parse error: Expected '}'",
    unreadable: 'threw BuildMessage: ENOENT reading "missing.js"',
    noReplacement: 'threw AggregateError: 2 errors building "flow3.js"',
    calls: 2,
  });
  expect(exitCode).toBe(0);
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

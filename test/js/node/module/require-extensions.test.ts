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
test("a store refused by a non-writable entry does not reach the loader", () => {
  using dir = tempDir("extensions-non-writable", {
    "mod.locked": `module.exports = "loaded as javascript";`,
  });
  const file = require.resolve(path.join(String(dir), "mod.locked"));
  const load = () => {
    delete require.cache[file];
    return require(file);
  };
  const held = mock(module => {
    module.exports = "held";
  });
  const refused = mock(module => {
    module.exports = "refused";
  });

  require.extensions[".locked"] = held;
  try {
    // Only the attributes change here, so the entry has to stay registered.
    Object.defineProperty(require.extensions, ".locked", { writable: false });
    expect(load()).toBe("held");

    // This file is a module, so the refused store throws rather than failing silently.
    expect(() => {
      require.extensions[".locked"] = refused;
    }).toThrow(TypeError);
    expect(Reflect.set(require.extensions, ".locked", refused)).toBe(false);
    expect(require.extensions[".locked"]).toBe(held);
    expect(load()).toBe("held");
    expect(refused).not.toHaveBeenCalled();
    expect(held).toHaveBeenCalledTimes(2);
  } finally {
    // The entry is still configurable, so it can be removed.
    delete require.extensions[".locked"];
  }
  expect(".locked" in require.extensions).toBe(false);
  expect(load()).toBe("loaded as javascript");
  delete require.cache[file];
});
test.concurrent("stores refused by a frozen require.extensions do not reach the loader", async () => {
  using dir = tempDir("extensions-frozen", {
    "index.cjs": `
      const assert = require("assert");
      const calls = [];
      require.extensions[".hooked"] = m => { calls.push("kept"); m.exports = "kept"; };
      const originalJs = require.extensions[".js"];
      Object.freeze(require.extensions);

      // This file is sloppy mode, so the frozen object refuses these silently.
      require.extensions[".js"] = m => { calls.push(".js"); m.exports = "refused .js hook"; };
      require.extensions[".hooked"] = m => { calls.push(".hooked"); m.exports = "refused .hooked hook"; };
      require.extensions[".added"] = m => { calls.push(".added"); m.exports = "refused .added hook"; };
      assert.strictEqual(require.extensions[".js"], originalJs);
      assert.strictEqual(Object.hasOwn(require.extensions, ".added"), false);

      console.log(JSON.stringify({
        js: require("./plain.js"),
        jsx: require("./classic-jsx.js"),
        hooked: require("./mod.hooked"),
        added: require("./mod.added"),
        calls,
      }));
    `,
    "plain.js": `module.exports = "plain";`,
    // Object.freeze redefines the attributes of every builtin entry. The builtin ".js" entry
    // must stay builtin afterwards: the default loader for .js files accepts JSX, while an
    // explicitly registered require.extensions[".js"] handler does not.
    "classic-jsx.js": `
      /* @jsxRuntime classic */
      /* @jsx h */
      function h(tag) { return "jsx:" + tag; }
      module.exports = <div />;
    `,
    "mod.hooked": `module.exports = "loaded as javascript";`,
    "mod.added": `module.exports = "loaded as javascript";`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.cjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    js: "plain",
    jsx: "jsx:div",
    hooked: "kept",
    added: "loaded as javascript",
    calls: ["kept"],
  });
  expect(exitCode).toBe(0);
});
test.concurrent(
  "stores refused by a non-configurable entry or a non-extensible require.extensions do not reach the loader",
  async () => {
    using dir = tempDir("extensions-non-configurable", {
      "index.cjs": `
        const assert = require("assert");
        const calls = [];
        const refused = how => m => { calls.push(how); m.exports = "refused " + how; };

        require.extensions[".pinned"] = m => { calls.push("held"); m.exports = "held"; };
        Object.defineProperty(require.extensions, ".pinned", { configurable: false, writable: false });
        assert.throws(() => Object.defineProperty(require.extensions, ".pinned", { value: refused("defineProperty") }), TypeError);
        assert.strictEqual(Reflect.defineProperty(require.extensions, ".pinned", { value: refused("Reflect.defineProperty") }), false);
        require.extensions[".pinned"] = refused("assignment");
        assert.strictEqual(delete require.extensions[".pinned"], false);

        Object.preventExtensions(require.extensions);
        require.extensions[".fresh"] = refused("assignment of a new entry");
        assert.throws(() => Object.defineProperty(require.extensions, ".defined", { value: refused("defineProperty of a new entry") }), TypeError);
        assert.strictEqual(Object.hasOwn(require.extensions, ".fresh"), false);
        assert.strictEqual(Object.hasOwn(require.extensions, ".defined"), false);

        console.log(JSON.stringify({
          pinned: require("./mod.pinned"),
          fresh: require("./mod.fresh"),
          defined: require("./mod.defined"),
          calls,
        }));
      `,
      "mod.pinned": `module.exports = "loaded as javascript";`,
      "mod.fresh": `module.exports = "loaded as javascript";`,
      "mod.defined": `module.exports = "loaded as javascript";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      pinned: "held",
      fresh: "loaded as javascript",
      defined: "loaded as javascript",
      calls: ["held"],
    });
    expect(exitCode).toBe(0);
  },
);

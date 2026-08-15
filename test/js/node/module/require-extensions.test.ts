import assert from "assert";
import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import Module from "node:module";
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
// Every assignment in these tests is executed more than once from the same
// statement (a loop body or a helper function). The assignment used to reach
// the loader only the first time a statement ran; afterwards a property inline
// cache stored straight into the object. With a literal key (`[".js"] =`) the
// interpreter caches the second execution already; with a variable key (the
// `extensions[ext] =` loop in pirates, @babel/register and ts-node) the cache
// appears once the helper is JIT compiled, which the last test forces.
describe("assigning require.extensions repeatedly from one statement", () => {
  test("a builtin extension can be overridden again after it was restored", () => {
    using dir = tempDir("require-extensions-reoverride", {
      "a.js": `module.exports = "a";`,
      "b.js": `module.exports = "b";`,
      "c.js": `module.exports = "c";`,
    });
    const original = require.extensions[".js"]!;
    const rounds: { file: string; invoked: boolean; exports: unknown }[] = [];
    try {
      for (const file of ["a.js", "b.js", "c.js"]) {
        let invoked = false;
        require.extensions[".js"] = function (module, filename) {
          invoked = true;
          original(module, filename);
        };
        const exports = require(path.join(String(dir), file));
        rounds.push({ file, invoked, exports });
        require.extensions[".js"] = original;
      }
    } finally {
      require.extensions[".js"] = original;
    }
    expect(rounds).toEqual([
      { file: "a.js", invoked: true, exports: "a" },
      { file: "b.js", invoked: true, exports: "b" },
      { file: "c.js", invoked: true, exports: "c" },
    ]);
  });

  test("an override that throws is invoked again by the next require of the same file", () => {
    using dir = tempDir("require-extensions-throwing-override", {
      "mod.js": `exports.foo = 1;`,
    });
    const file = path.join(String(dir), "mod.js");
    const original = require.extensions[".js"]!;
    const rounds: { invoked: boolean; outcome: string; cached: boolean }[] = [];
    try {
      for (let i = 0; i < 3; i++) {
        let invoked = false;
        require.extensions[".js"] = function () {
          invoked = true;
          throw new Error("rejected by override");
        };
        let outcome: string;
        try {
          require(file);
          outcome = "loaded";
        } catch (e) {
          outcome = (e as Error).message;
        }
        rounds.push({ invoked, outcome, cached: file in require.cache });
        require.extensions[".js"] = original;
      }
    } finally {
      require.extensions[".js"] = original;
      delete require.cache[file];
    }
    const expected = { invoked: true, outcome: "rejected by override", cached: false };
    expect(rounds).toEqual([expected, expected, expected]);
  });

  test("restoring the builtin loader through a helper unregisters the current override", () => {
    using dir = tempDir("require-extensions-restore-helper", {
      "a.js": `module.exports = "a";`,
    });
    const original = require.extensions[".js"]!;
    const calls: string[] = [];
    function restore() {
      require.extensions[".js"] = original;
    }
    try {
      require.extensions[".js"] = function (module, filename) {
        calls.push("first");
        original(module, filename);
      };
      restore();
      require.extensions[".js"] = function (module, filename) {
        calls.push("second");
        original(module, filename);
      };
      restore();

      expect(require.extensions[".js"]).toBe(original);
      expect(require(path.join(String(dir), "a.js"))).toBe("a");
      expect(calls).toEqual([]);
    } finally {
      restore();
    }
  });

  test("re-registering a custom extension through a helper dispatches to the latest handler", () => {
    using dir = tempDir("require-extensions-reregister", {
      "one.reregistered": "",
      "two.reregistered": "",
      "three.reregistered": "",
    });
    function register(tag: string) {
      Module._extensions[".reregistered"] = function (module) {
        module.exports = tag;
      };
    }
    const loaded: string[] = [];
    try {
      for (const tag of ["one", "two", "three"]) {
        register(tag);
        loaded.push(require(path.join(String(dir), `${tag}.reregistered`)));
      }
    } finally {
      delete Module._extensions[".reregistered"];
    }
    expect(loaded).toEqual(["one", "two", "three"]);
  });

  test("variable-key install/restore helpers keep working after they are JIT compiled", async () => {
    const files: Record<string, string> = {
      "index.js": `
        const Module = require("node:module");
        const path = require("node:path");
        const originalJs = Module._extensions[".js"];
        const dispatched = [];

        function install(extension, tag) {
          Module._extensions[extension] = function (module) {
            dispatched.push(tag);
            module.exports = tag;
          };
        }
        function restore(extension, previous) {
          Module._extensions[extension] = previous;
        }

        // No require() in here: this only gets both helpers compiled by every JIT tier.
        for (let i = 0; i < 200; i++) {
          install(".js", "warm-js-" + i);
          restore(".js", originalJs);
          install(".hooked", "warm-hooked-" + i);
        }

        const rounds = [];
        for (let i = 0; i < 3; i++) {
          install(".js", "js-" + i);
          const jsExports = require(path.join(__dirname, "js-" + i + ".js"));
          restore(".js", originalJs);
          const afterRestore = require(path.join(__dirname, "restored-" + i + ".js"));
          install(".hooked", "hooked-" + i);
          const hookedExports = require(path.join(__dirname, "file-" + i + ".hooked"));
          rounds.push({ jsExports, afterRestore, hookedExports });
        }

        console.log(JSON.stringify({ rounds, dispatched, restored: Module._extensions[".js"] === originalJs }));
      `,
    };
    for (let i = 0; i < 3; i++) {
      files[`js-${i}.js`] = `module.exports = "builtin js-${i}";`;
      files[`restored-${i}.js`] = `module.exports = "builtin restored-${i}";`;
      files[`file-${i}.hooked`] = "only loadable through the .hooked handler";
    }
    using dir = tempDir("require-extensions-jit", files);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      cwd: String(dir),
      // Compile on the main thread, so after the warm-up loop the helpers are
      // guaranteed to run as JIT code (baseline and DFG) when the rounds start.
      env: { ...bunEnv, BUN_JSC_useConcurrentJIT: "0" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      rounds: [
        { jsExports: "js-0", afterRestore: "builtin restored-0", hookedExports: "hooked-0" },
        { jsExports: "js-1", afterRestore: "builtin restored-1", hookedExports: "hooked-1" },
        { jsExports: "js-2", afterRestore: "builtin restored-2", hookedExports: "hooked-2" },
      ],
      dispatched: ["js-0", "hooked-0", "js-1", "hooked-1", "js-2", "hooked-2"],
      restored: true,
    });
    expect(exitCode).toBe(0);
  });
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

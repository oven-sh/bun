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
test("default loader throws when module._compile was replaced with a non-function", async () => {
  // Spawned because the unfixed behavior for primitives is a segfault, not an exception.
  using dir = tempDir("extensions-bad-compile", {
    "plain.js": `module.exports = "plain";`,
    "plain.ts": `const value: string = "plain ts"; module.exports = value;`,
    "run.cjs": `
      const Module = require("module");
      const path = require("path");
      const file = path.join(__dirname, "plain.js");
      const original = Module._extensions[".js"];
      const values = [
        ["undefined", undefined],
        ["null", null],
        ["number", 42],
        ["boolean", true],
        ["string", "not a function"],
        ["object", {}],
        ["symbol", Symbol("compile")],
        ["bigint", 1n],
      ];
      const caught = fn => {
        try {
          fn();
          return { threw: false };
        } catch (e) {
          return { isTypeError: e instanceof TypeError, message: e.message };
        }
      };

      const viaRequire = values.map(([kind, value]) => {
        Module._extensions[".js"] = function (module, filename) {
          module._compile = value;
          return original(module, filename);
        };
        return { kind, ...caught(() => require(file)), cached: file in require.cache };
      });
      Module._extensions[".js"] = original;
      const afterwards = require(file);

      const viaDirectCall = values.map(([kind, value]) => {
        const m = new Module(file, module);
        m.filename = file;
        m._compile = value;
        return { kind, ...caught(() => original(m, file)) };
      });

      const tsFile = path.join(__dirname, "plain.ts");
      const tsModule = new Module(tsFile, module);
      tsModule.filename = tsFile;
      tsModule._compile = undefined;
      const viaTsLoader = caught(() => Module._extensions[".ts"](tsModule, tsFile));

      console.log(JSON.stringify({ viaRequire, afterwards, viaDirectCall, viaTsLoader }));
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

  const kinds = ["undefined", "null", "number", "boolean", "string", "object", "symbol", "bigint"];
  const typeError = { isTypeError: true, message: "module._compile is not a function" };
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    viaRequire: kinds.map(kind => ({ kind, ...typeError, cached: false })),
    afterwards: "plain",
    viaDirectCall: kinds.map(kind => ({ kind, ...typeError })),
    viaTsLoader: typeError,
  });
  expect(exitCode).toBe(0);
});
test("custom require extension still applies when the entry is a transpiler cache hit", async () => {
  // A main module restored from the runtime transpiler cache used to leave the
  // VM in its pre-load state, so require() of an unknown extension skipped
  // require.extensions and fell back to the JS loader on warm-cache runs.
  const padding = "// " + Buffer.alloc(4096, "x").toString() + "\n";
  using dir = tempDir("extensions-transpiler-cache", {
    "transpiler-cache/.keep": "",
    "c.custom": `module.exports = 'c dot custom';`,
    // Padded past the cache's minimum source size so the entry is cached.
    "main.cjs": `require("module")._extensions[".custom"] = function (module, filename) {
  module._compile("module.exports = 'custom';", filename);
};
console.log(require("./c.custom"));
${padding}`,
  });
  const env = {
    ...bunEnv,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: path.join(String(dir), "transpiler-cache"),
    // Debug builds save cache entries but ignore them on load unless this is set.
    BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
  };
  // Run twice: the first run populates the cache, the second must still
  // dispatch to the custom extension.
  for (let run = 0; run < 2; run++) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      cwd: String(dir),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("custom\n");
    expect(exitCode).toBe(0);
  }
});
test("custom require extension still applies when the entry is a prebundled module", async () => {
  // An already-bundled main module (the `// @bun` pragma emitted by
  // `bun build --target=bun`) takes the same early return as a transpiler
  // cache hit and used to leave the VM in its pre-load state.
  using dir = tempDir("extensions-already-bundled", {
    "c.custom": `module.exports = 'c dot custom';`,
    "entry.js": `const Module = require("module");
Module._extensions[".custom"] = function (module, filename) {
  module._compile("module.exports = 'custom';", filename);
};
console.log(require("./c.custom"));
`,
  });
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--target=bun", "--format=cjs", "--external=*.custom", "--outfile=out.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [buildStdout, buildStderr, buildExit] = await Promise.all([
    build.stdout.text(),
    build.stderr.text(),
    build.exited,
  ]);
  expect(buildStderr).toBe("");
  expect(buildExit).toBe(0);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "out.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("custom\n");
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

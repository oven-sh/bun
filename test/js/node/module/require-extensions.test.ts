import assert from "assert";
import { describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, tempDir, tempDirWithFiles } from "harness";
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
  const fixture = tempDirWithFiles(
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

// Node.js routes every CJS-loader load (the entrypoint, a CJS module reached
// from ESM import, and nested require()) through Module._extensions, so a
// `-r` preload hook like babel-register or pirates sees all of them.
describe.concurrent("Module._extensions fires for the CJS entrypoint and CJS reached via ESM import", () => {
  const hook = `
const M = require("module"), path = require("path"), oe = M._extensions[".js"];
globalThis.__hits = [];
M._extensions[".js"] = function (m, f) { globalThis.__hits.push(path.basename(f)); return oe(m, f); };
`;

  test("CJS entrypoint and nested require hit the overridden .js handler", async () => {
    using dir = tempDir("ext-entry", {
      "package.json": '{"type":"commonjs"}',
      "hook.cjs": hook,
      "dep.js": "module.exports = 1;",
      "dep2.cjs": "module.exports = 2;",
      "main.js": 'require("./dep.js"); require("./dep2.cjs"); console.log(JSON.stringify(globalThis.__hits));',
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-r", "./hook.cjs", "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // Node's findLongestRegisteredExtension falls back to ".js" for .cjs.
    expect(stdout.trim()).toBe('["main.js","dep.js","dep2.cjs"]');
    expect(exitCode).toBe(0);
  });

  test(".cjs entrypoint falls back to the overridden .js handler", async () => {
    using dir = tempDir("ext-entry-cjs", {
      "package.json": '{"type":"commonjs"}',
      "hook.cjs": hook,
      "dep.js": "module.exports = 1;",
      "main.cjs": 'require("./dep.js"); console.log(JSON.stringify(globalThis.__hits));',
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-r", "./hook.cjs", "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe('["main.cjs","dep.js"]');
    expect(exitCode).toBe(0);
  });

  test("ESM import of a CJS module hits the overridden .js handler", async () => {
    using dir = tempDir("ext-esm-import", {
      "package.json": '{"type":"commonjs"}',
      "hook.cjs": hook,
      "dep.js": "module.exports = 1;",
      "dep2.cjs": "module.exports = 2;",
      "main.mjs":
        'await import("./dep.js"); await import("./dep2.cjs"); console.log(JSON.stringify(globalThis.__hits));',
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-r", "./hook.cjs", "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe('["dep.js","dep2.cjs"]');
    expect(exitCode).toBe(0);
  });

  test("ESM import of an ESM .js module does NOT hit the overridden .js handler", async () => {
    using dir = tempDir("ext-esm-esm", {
      "package.json": '{"type":"module"}',
      "hook.cjs": hook,
      "dep.js": "export const x = 1;",
      "main.js": 'import "./dep.js"; console.log(JSON.stringify(globalThis.__hits));',
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-r", "./hook.cjs", "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("[]");
    expect(exitCode).toBe(0);
  });

  test("a preload hook that transforms source applies to the CJS entrypoint and CJS via ESM import", async () => {
    using dir = tempDir("ext-transform", {
      "package.json": '{"type":"commonjs"}',
      "hook.cjs": `
const M = require("module"), fs = require("fs");
M._extensions[".js"] = function (m, f) {
  m._compile(fs.readFileSync(f, "utf8").replace(/REPLACE_ME/g, '"xform"'), f);
};
`,
      "dep.js": 'module.exports = { value: REPLACE_ME, nested: require("./dep2.js") };',
      "dep2.js": 'module.exports = REPLACE_ME + "2";',
      "main.js": 'console.log(JSON.stringify({ entry: REPLACE_ME, nested: require("./dep2.js") }));',
      "main.mjs": 'import dep from "./dep.js"; console.log(JSON.stringify(dep));',
    });
    await using p1 = Bun.spawn({
      cmd: [bunExe(), "-r", "./hook.cjs", "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [out1, err1, code1] = await Promise.all([p1.stdout.text(), p1.stderr.text(), p1.exited]);
    expect(err1).toBe("");
    expect(out1.trim()).toBe('{"entry":"xform","nested":"xform2"}');
    expect(code1).toBe(0);

    await using p2 = Bun.spawn({
      cmd: [bunExe(), "-r", "./hook.cjs", "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [out2, err2, code2] = await Promise.all([p2.stdout.text(), p2.stderr.text(), p2.exited]);
    expect(err2).toBe("");
    expect(out2.trim()).toBe('{"value":"xform","nested":"xform2"}');
    expect(code2).toBe(0);
  });
});

import assert from "assert";
import { describe, expect, mock, test } from "bun:test";
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

describe("module._compile override receives the module body", () => {
  // The pirates / nyc / ts-node pattern: wrap the default loader, record what it passes to
  // module._compile, and compile that text with the original implementation. `code` stays
  // undefined when the default loader evaluated the module without calling _compile.
  function requireThroughCompileHook(extension: string, file: string) {
    const original = require.extensions[extension];
    const defaultLoader = require.extensions[".js"];
    let code: string | undefined;
    require.extensions[extension] = function (module: any, filename: string) {
      const originalCompile = module._compile;
      module._compile = function (content: string, compiledFilename: string) {
        code = content;
        return originalCompile.call(this, content, compiledFilename);
      };
      return defaultLoader(module, filename);
    };
    try {
      const exports = require(file);
      return { code, exports };
    } finally {
      if (original) require.extensions[extension] = original;
      else delete require.extensions[extension];
    }
  }

  const wrapper = "(function(exports, require, module, __filename, __dirname) {";

  test("files with the // @bun @bun-cjs pragma, in every shape bun build --target=bun --format=cjs emits", () => {
    using dir = tempDir("compile-hook-pragma", {
      "pragma.js": `// @bun @bun-cjs\n${wrapper}// entry.cjs\nmodule.exports = { shape: "pragma" };\n})\n`,
      "bytecode.js": `// @bun @bytecode @bun-cjs\n${wrapper}// entry.cjs\nmodule.exports = { shape: "bytecode" };\n})\n`,
      "hashbang.js": `#!/usr/bin/env bun\n// @bun @bun-cjs\n${wrapper}\n// entry.cjs\nmodule.exports = { shape: "hashbang" };\n})\n`,
      "minified.js": `// @bun @bun-cjs\n${wrapper}module.exports={shape:"minified"};})\n`,
      "sourcemap.js": `// @bun @bun-cjs\n${wrapper}\nmodule.exports = { shape: "sourcemap" };\n})\n\n//# debugId=0123456789ABCDEF\n//# sourceMappingURL=data:application/json;base64,e30=\n`,
      "crlf.js": `// @bun @bun-cjs\r\n${wrapper}\r\nmodule.exports = { shape: "crlf" };\r\n})\r\n`,
      // Code after the wrapper is not something the body extraction understands, so the file
      // is evaluated as-is instead of being handed to _compile.
      "footer.js": `// @bun @bun-cjs\n${wrapper}\nmodule.exports = { shape: "footer" };\n})\n\nvar afterTheWrapper = 1;\n`,
    });
    const results: Record<string, unknown> = {};
    for (const name of ["pragma", "bytecode", "hashbang", "minified", "sourcemap", "crlf", "footer"]) {
      results[name] = requireThroughCompileHook(".js", path.join(String(dir), `${name}.js`));
    }
    // Every line in front of the wrapper is replaced by an empty line, so the body keeps the line
    // numbers it has in the file; the comment lines after the wrapper are kept.
    expect(results).toEqual({
      pragma: { code: '\n// entry.cjs\nmodule.exports = { shape: "pragma" };\n', exports: { shape: "pragma" } },
      bytecode: { code: '\n// entry.cjs\nmodule.exports = { shape: "bytecode" };\n', exports: { shape: "bytecode" } },
      hashbang: {
        code: '\n\n\n// entry.cjs\nmodule.exports = { shape: "hashbang" };\n',
        exports: { shape: "hashbang" },
      },
      minified: { code: '\nmodule.exports={shape:"minified"};', exports: { shape: "minified" } },
      sourcemap: {
        code: '\n\nmodule.exports = { shape: "sourcemap" };\n\n\n//# debugId=0123456789ABCDEF\n//# sourceMappingURL=data:application/json;base64,e30=\n',
        exports: { shape: "sourcemap" },
      },
      crlf: { code: '\n\r\nmodule.exports = { shape: "crlf" };\r\n', exports: { shape: "crlf" } },
      footer: { code: undefined, exports: { shape: "footer" } },
    });
  });

  test("errors thrown by a pragma file compiled through the override keep their line numbers", () => {
    using dir = tempDir("compile-hook-pragma-lines", {
      "lines.js": `// @bun @bun-cjs\n${wrapper}\nmodule.exports = new Error("line 3").stack;\n})\n`,
    });
    expect(requireThroughCompileHook(".js", path.join(String(dir), "lines.js"))).toEqual({
      code: '\n\nmodule.exports = new Error("line 3").stack;\n',
      exports: expect.stringMatching(/lines\.js:3:\d+/),
    });
  });

  test("real bun build --target=bun --format=cjs output", async () => {
    using dir = tempDir("compile-hook-bun-build", {
      "entry.cjs": `module.exports = { built: true };\n`,
      "hashbang.cjs": `#!/usr/bin/env bun\nmodule.exports = { built: true };\n`,
    });
    const variants: Record<string, Partial<Parameters<typeof Bun.build>[0]>> = {
      plain: {},
      bytecode: { bytecode: true },
      minify: { minify: true },
      sourcemap: { sourcemap: "inline" },
      hashbang: { entrypoints: [path.join(String(dir), "hashbang.cjs")] },
      commentFooter: { footer: "// license" },
    };
    const results: Record<string, unknown> = {};
    for (const [name, options] of Object.entries(variants)) {
      const outdir = path.join(String(dir), "out", name);
      const { success, logs, outputs } = await Bun.build({
        entrypoints: [path.join(String(dir), "entry.cjs")],
        target: "bun",
        format: "cjs",
        outdir,
        ...options,
      });
      if (!success) throw new AggregateError(logs);
      const outfile = outputs.find(output => output.kind === "entry-point")!.path;
      const text = await Bun.file(outfile).text();
      results[name] = {
        // What the file looks like around the wrapper, so the hand-written fixtures above
        // can be checked against the real output.
        header: text.slice(0, text.indexOf("{") + 1),
        closeOnOwnLine: text.includes("\n})"),
        trailer: text.slice(text.lastIndexOf("})")),
        ...requireThroughCompileHook(".js", outfile),
      };
    }
    const loaded = { code: expect.stringContaining("module.exports"), exports: { built: true } };
    const plainShape = { header: `// @bun @bun-cjs\n${wrapper}`, closeOnOwnLine: true, trailer: "})\n" };
    expect(results).toEqual({
      plain: { ...plainShape, ...loaded },
      bytecode: { ...plainShape, header: `// @bun @bytecode @bun-cjs\n${wrapper}`, ...loaded },
      minify: { ...plainShape, closeOnOwnLine: false, ...loaded },
      sourcemap: {
        ...plainShape,
        trailer: expect.stringContaining("\n//# sourceMappingURL=data:"),
        ...loaded,
        code: expect.stringMatching(/module\.exports[^]*\n\/\/# sourceMappingURL=data:/),
      },
      hashbang: { ...plainShape, header: `#!/usr/bin/env bun\n// @bun @bun-cjs\n${wrapper}`, ...loaded },
      commentFooter: {
        ...plainShape,
        trailer: expect.stringMatching(/^\}\)\n+\/\/ license\n$/),
        ...loaded,
        code: expect.stringMatching(/module\.exports[^]*\n\/\/ license\n$/),
      },
    });
  });

  test("an empty .cjs file, which the loader turns into a synthetic wrapper", () => {
    using dir = tempDir("compile-hook-empty", { "empty.cjs": "" });
    expect(requireThroughCompileHook(".cjs", path.join(String(dir), "empty.cjs"))).toEqual({ code: "", exports: {} });
  });

  test("transpiled files while the inspector appends source map comments after the wrapper", async () => {
    using dir = tempDir("compile-hook-inspector", {
      "plain.js": `module.exports = 42;\n`,
      "run.js": `
        const Module = require("module");
        const defaultLoader = Module._extensions[".js"];
        Module._extensions[".js"] = function (module, filename) {
          module._compile = function (code, filename) {
            globalThis.code = code;
            return Module.prototype._compile.call(this, code, filename);
          };
          return defaultLoader(module, filename);
        };
        const loaded = require("./plain.js");
        console.log(JSON.stringify({ code: globalThis.code, exports: loaded }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--inspect=127.0.0.1:0", "run.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // stderr carries the inspector banner, so it is only shown on failure.
    expect(stdout, stderr).toStartWith("{");
    expect(JSON.parse(stdout)).toEqual({
      code: expect.stringMatching(/^\n  module\.exports = 42;\n\s*\/\/# sourceMappingURL=data:/),
      exports: 42,
    });
    expect(exitCode).toBe(0);
  });
});

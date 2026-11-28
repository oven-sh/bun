import { describe, expect, test } from "bun:test";
import { mkdirSync } from "fs";
import { bunEnv, bunExe, tempDir, tmpdirSync } from "harness";
import { join } from "path";

describe.concurrent("run-cjs", () => {
  test("running a commonjs module works", async () => {
    const dir = tmpdirSync();
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, "index1.js"), "module.exports = 1; console.log('hello world');");
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "index1.js")],
      cwd: dir,
      env: bunEnv,
      stdout: "pipe",
    });
    const stdout = await proc.stdout.text();
    expect(stdout).toEqual("hello world\n");
  });

  test("a pre-bundled entry point still consults require.extensions", async () => {
    // `bun build --target=bun --format=cjs` emits this header, and the `// @bun`
    // pragma makes the parser hand the source straight to JSC without printing
    // it. That must not change how the modules this entry loads are resolved.
    using dir = tempDir("run-cjs-bundled-entry", {
      "entry.cjs": `// @bun @bun-cjs
(function(exports, require, module, __filename, __dirname) {
  require.extensions[".data"] = (module, filename) => {
    module.exports = "custom-loader";
  };
  console.log(require("./asset.data"));
})`,
      // If the custom loader is skipped, this is transpiled as JS/TS instead.
      "asset.data": `module.exports = "default-loader";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.cjs"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toMatchObject({ stdout: "custom-loader\n", exitCode: 0 });
  });

  // A CommonJS module is sloppy unless a directive says otherwise, so these
  // run as `.cjs` files: in an ES module every function is strict already.
  describe.concurrent("directive prologue", () => {
    async function run(files: Record<string, string>, entry: string) {
      using dir = tempDir("run-cjs-directive", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), entry],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    test("a function-level 'use strict' makes the function strict", async () => {
      const result = await run(
        {
          "entry.cjs": `
            function f() { "use strict"; try { undeclared123 = 1; return "sloppy" } catch { return "strict" } }
            function g() { "use strict"; return this === undefined }
            const arrow = () => { "use strict"; try { undeclared456 = 1; return "sloppy" } catch { return "strict" } };
            const obj = { method() { "use strict"; return this === undefined } };
            console.log(f(), g(), arrow(), obj.method.call(undefined));
          `,
        },
        "entry.cjs",
      );
      expect(result).toEqual({ stdout: "strict true strict true\n", stderr: "", exitCode: 0 });
    });

    test("a module-level 'use strict' makes the module strict", async () => {
      const result = await run(
        {
          "entry.cjs": `
            "use strict";
            function f() { return typeof this }
            console.log(f(), require("./lib.cjs"));
          `,
          "lib.cjs": `
            "use client";
            "use strict";
            module.exports = (function () { return typeof this })();
          `,
        },
        "entry.cjs",
      );
      expect(result).toEqual({ stdout: "undefined undefined\n", stderr: "", exitCode: 0 });
    });

    test("a string statement outside of a prologue is not a directive", async () => {
      const result = await run(
        {
          "entry.cjs": `
            { 'use strict'; var eval = 1 }
            if (1) { 'use strict'; var yield = 2 }
            try { 'use strict'; var implements = 3 } finally { 'use strict'; var interface = 4 }
            function tpl() { \`use strict\`; return typeof this }
            function late() { var x = 1; "use strict"; return typeof this }
            console.log(eval, yield, implements, interface, tpl(), late());
          `,
        },
        "entry.cjs",
      );
      expect(result).toEqual({ stdout: "1 2 3 4 object object\n", stderr: "", exitCode: 0 });
    });

    test("an escaped or parenthesized 'use strict' is not a Use Strict Directive", async () => {
      const result = await run(
        {
          "entry.cjs": `
            function escaped(a = 1) { "use\\x20strict"; return typeof this }
            function unicode() { '\\u0075se strict'; return typeof this }
            function paren(a = 1) { ("use strict"); return typeof this }
            function after(a = 1) { ("first"); "use strict"; return typeof this }
            ("use strict");
            console.log(escaped(), unicode(), paren(), after(), typeof this);
          `,
        },
        "entry.cjs",
      );
      expect(result).toEqual({ stdout: "object object object object object\n", stderr: "", exitCode: 0 });
    });

    // tsc keeps the directive in the IIFE it lowers a namespace body to.
    test("a 'use strict' at the start of a TypeScript namespace body makes the namespace strict", async () => {
      const result = await run(
        {
          "entry.cts": `
            namespace N {
              "use strict";
              export const strict = (function () { return this === undefined })();
            }
            namespace M {
              export const strict = (function () { return this === undefined })();
            }
            console.log(N.strict, M.strict);
          `,
        },
        "entry.cts",
      );
      expect(result).toEqual({ stdout: "true false\n", stderr: "", exitCode: 0 });
    });

    // https://github.com/oven-sh/bun/issues/14251
    test("a sloppy function cannot read a caller that its directive makes strict", async () => {
      const result = await run(
        {
          "entry.cjs": `
            function strictCaller() { "use strict"; return "caller: " + sloppy() }
            function sloppyCaller() { return "caller: " + sloppy() }
            function sloppy() { return sloppy.caller === null ? "null" : sloppy.caller.name }
            console.log(strictCaller(), sloppyCaller());
          `,
        },
        "entry.cjs",
      );
      expect(result).toEqual({ stdout: "caller: null caller: sloppyCaller\n", stderr: "", exitCode: 0 });
    });

    // https://github.com/oven-sh/bun/issues/4424
    // https://github.com/oven-sh/bun/issues/29533
    // Bluebird tests for ES5 with this expression. When it is false, promisifyAll
    // walks a prototype with for-in and calls accessors that throw.
    test("the strict mode probe of Bluebird is true", async () => {
      const result = await run(
        {
          "entry.cjs": `
            var isES5 = (function(){
                "use strict";
                return this === undefined;
            })();
            console.log(isES5);
          `,
        },
        "entry.cjs",
      );
      expect(result).toEqual({ stdout: "true\n", stderr: "", exitCode: 0 });
    });

    // JavaScriptCore makes proper tail calls in strict code. A function that its
    // directive makes strict gets them too, as strict code does in an ES module.
    test("a function-level 'use strict' function makes tail calls", async () => {
      const result = await run(
        {
          "entry.cjs": `
            function frames() { return new Error().stack.split("\\n").filter(line => /at (strict|sloppy)[AB] /.test(line)).length }
            function strictA() { "use strict"; return strictB() }
            function strictB() { "use strict"; return frames() }
            function sloppyA() { return sloppyB() }
            function sloppyB() { return frames() }
            console.log(strictA(), sloppyA());
          `,
        },
        "entry.cjs",
      );
      expect(result).toEqual({ stdout: "0 2\n", stderr: "", exitCode: 0 });
    });

    // https://github.com/oven-sh/bun/issues/18333
    test("'use strict' in a function with a non-simple parameter list is a SyntaxError", async () => {
      const result = await run({ "entry.cjs": `function f(a = 1) { "use strict"; return a }` }, "entry.cjs");
      expect(result.stderr).toContain(
        'Cannot use a "use strict" directive in a function with a non-simple parameter list',
      );
      expect(result.exitCode).toBe(1);
    });
  });

  async function run(files: Record<string, string | Buffer>, env: Record<string, string> = {}) {
    using dir = tempDir("run-cjs-kind", files);
    const once = async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.mjs"],
        cwd: String(dir),
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { lines: stdout.trim().split("\n"), stderr, exitCode };
    };
    return env.BUN_RUNTIME_TRANSPILER_CACHE_PATH ? [await once(), await once()] : await once();
  }
  const prints = (...lines: string[]) => ({ lines, stderr: "", exitCode: 0 });

  /** What loads `request`, a specifier with its attributes, and hands its namespace to `show()`. Below a require() no thread reads the file. */
  const imports = {
    "an import statement": (request: string, id: number) => ({
      head: `import * as ns${id} from ${request};`,
      body: `show(ns${id});`,
    }),
    "an import statement below a require()": (request: string, id: number) => ({
      body: `show(require("./imports-${id}.mjs").ns);`,
      files: { [`imports-${id}.mjs`]: `export * as ns from ${request};` },
    }),
    "import()": (request: string) => ({
      body: `show(await import(${request.replace(/ with (.*)/, ", { with: $1 }")}));`,
    }),
  };
  type Load = (request: string, id: number) => { head?: string; body: string; files?: Record<string, string> };
  function programThatLoads(requests: string[], load: Load, show: string) {
    const loads = requests.map(load);
    return {
      ...Object.assign({}, ...loads.map(it => it.files)),
      "main.mjs": [
        ...loads.map(it => it.head ?? ""),
        `const show = ${show};`,
        ...loads.map(it => it.body),
        "export {};",
      ].join("\n"),
    };
  }
  const loads = { ...imports, "require()": (request: string) => ({ body: `show(require(${request}));` }) };

  describe.each([
    ["commonjs", "sloppy"],
    ["module", "strict"],
  ])('a file that says nothing of its kind, in a package of "type": %j', (type, byPackage) => {
    const mode = `console.log((function () { return this ? "sloppy" : "strict"; })());`;
    const filesNamed = (extension: string, index: number) => [
      [`plain-${index}${extension}`, mode],
      [`requires-${index}${extension}`, `require("node:fs"); ${mode}`],
    ];
    const project = { "package.json": JSON.stringify({ type }), "bunfig.toml": `[loader]\n".es6" = "js"\n` };

    test.each(Object.entries(loads))("is what its name or its package says to %s", async (_, load) => {
      const modes: Record<string, string> = {};
      for (const extension of [".cjs", ".cts", ".CJS", ".CTS"]) modes[extension] = "sloppy";
      for (const extension of [".mjs", ".mts", ".MJS", ".MTS"]) modes[extension] = "strict";
      for (const extension of [".js", ".jsx", ".ts", ".tsx", ".es6", ".JS"]) modes[extension] = byPackage;
      const files = Object.keys(modes).flatMap(filesNamed);
      const requests = files.map(([file]) => `"./${file}"`);
      expect(
        await run({ ...project, ...Object.fromEntries(files), ...programThatLoads(requests, load, "() => {}") }),
      ).toEqual(prints(...Object.values(modes).flatMap(mode => [mode, mode])));
    });

    test.each(Object.entries(imports))("is what its package says where a type makes it code to %s", async (_, load) => {
      const typed = [
        [".txt", "js"],
        [".txt", "ts"],
        [".json", "jsx"],
        [".unknown", "js"],
        [".unknown", "ts"],
        ["", "js"],
        ["", "tsx"],
      ];
      const files = typed.map(([extension], index) => filesNamed(extension, index));
      const requests = files.flatMap((pair, index) =>
        pair.map(([file]) => `"./${file}" with { type: "${typed[index][1]}" }`),
      );
      expect(
        await run({ ...project, ...Object.fromEntries(files.flat()), ...programThatLoads(requests, load, "() => {}") }),
      ).toEqual(prints(...requests.map(() => byPackage)));
    });

    test("is what its text says where nothing names a loader", async () => {
      const files = ["", ".unknown"].flatMap(filesNamed);
      const requests = files.map(([file]) => `"./${file}"`);
      expect(
        await run({
          ...project,
          ...Object.fromEntries(files),
          ...programThatLoads(requests, loads["require()"], "() => {}"),
        }),
      ).toEqual(prints("strict", "sloppy", "strict", "sloppy"));
    });
  });

  describe("a CommonJS file without code", () => {
    const names = ["a.cjs", "a.cts", "commonjs/a.js", "commonjs/a.ts", "module/a.cjs"];
    const files = (text: string) => ({
      ...Object.fromEntries(names.map(name => [name, text])),
      "commonjs/package.json": `{ "type": "commonjs" }`,
      "module/package.json": `{ "type": "module" }`,
    });
    const requests = names.map(name => `"./${name}"`);

    describe.each(["", "\n \n", "// nothing\n"])("%j", text => {
      test.each(Object.entries(imports))("exports an empty object to %s", async (_, load) => {
        expect(
          await run({
            ...files(text),
            ...programThatLoads(requests, load, "ns => console.log(JSON.stringify(ns.default))"),
          }),
        ).toEqual(prints(...names.map(() => "{}")));
      });

      test("is run in the wrapper that the program has set", async () => {
        const program = programThatLoads(requests, loads["require()"], "it => console.log(JSON.stringify(it))");
        program["main.mjs"] =
          `require("node:module").wrapper[0] = "(function (exports) { exports.wrapped = true;";\n` +
          program["main.mjs"];
        expect(await run({ ...files(text), ...program })).toEqual(prints(...names.map(() => `{"wrapped":true}`)));
      });
    });
  });

  describe("the default export of a CommonJS file that sets __esModule goes by the type of its package", () => {
    const flag = `exports.__esModule = true; exports.default = 1;`;
    const bundled = `// @bun @bun-cjs\n(function(exports, require, module, __filename, __dirname) {${flag}\n})\n`;
    const padding = "\n//" + Buffer.alloc(64 * 1024, "-").toString();
    const files = {
      "untyped/package.json": `{}`,
      "untyped/a.cjs": flag + padding,
      "untyped/a.mjs": flag + padding,
      "untyped/bundled.cjs": bundled,
      "module/package.json": `{ "type": "module" }`,
      "module/a.cjs": flag + padding,
      "module/a.mjs": flag + padding,
      "module/bundled.cjs": bundled,
    };
    const requests = Object.keys(files)
      .filter(name => !name.endsWith(".json"))
      .map(name => `"./${name}"`);
    const expected = ["number", "number", "number", "object", "object", "object"];
    const show = "ns => console.log(typeof ns.default)";

    test.each(Object.entries(imports))("%s, with the transpiler's cache cold and warm", async (_, load) => {
      using cache = tempDir("run-cjs-kind-cache", {});
      expect(
        await run(
          { ...files, ...programThatLoads(requests, load, show) },
          { BUN_RUNTIME_TRANSPILER_CACHE_PATH: String(cache), BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1" },
        ),
      ).toEqual([prints(...expected), prints(...expected)]);
    });

    test.each(Object.entries(imports))("%s, under --hot", async (_, load) => {
      using dir = tempDir("run-cjs-kind-hot", { ...files, ...programThatLoads(requests, load, show) });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--hot", "--no-clear-screen", "main.mjs"],
        cwd: String(dir),
        env: bunEnv,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "inherit",
      });
      let stdout = "";
      for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
        stdout += chunk;
        if (stdout.split("\n").length > expected.length) break;
      }
      expect(stdout.trim().split("\n")).toEqual(expected);
    });
  });

  test.each(Object.entries(imports))("WebAssembly under the name of a script is WebAssembly to %s", async (_, load) => {
    const wasm = Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]);
    const show = `it => console.log(require("node:path").basename(it.default))`;
    expect(
      await run({ "a.wasm": wasm, "a.js": wasm, ...programThatLoads([`"./a.wasm"`, `"./a.js"`], load, show) }),
    ).toEqual(prints("a.wasm", "a.js"));
  });
});

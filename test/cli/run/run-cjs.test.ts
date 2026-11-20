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

  // `await` at the top level of a script is a name. A module, an async function and a class static
  // block reserve it. Bun reads a file as a module first, where that `await` is the operator. If that
  // is an error in a `.cjs` file, Bun reads the file again as a script.
  describe.concurrent("await as a name at the top level of a .cjs file", () => {
    async function run(files: Record<string, string>, ...args: string[]) {
      using dir = tempDir("run-cjs-await-name", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    }

    // Loads each module with `load`, and prints what each one exports or, by default, the messages of its error.
    const collect = (specifiers: string[], load: string, error = "(e.errors ?? [e]).map(error => error.message)") => `
      const out = [];
      for (const specifier of ${JSON.stringify(specifiers)}) {
        try { out.push(${load}); } catch (e) { out.push(${error}); }
      }
      console.log(JSON.stringify(out));
    `;
    // What `collect` printed. If the process did not get that far, the text as it is, beside `stderr` and `exitCode`.
    const collected = (result: Awaited<ReturnType<typeof run>>) => {
      try {
        return { ...result, stdout: JSON.parse(result.stdout) };
      } catch {
        return result;
      }
    };

    // Node.js v26.3.0 prints the same for each file.
    test.each([
      ["var await", "var await = 1;\nconsole.log(await);\n", "1\n"],
      ["class await", "class await {}\nconsole.log(typeof await);\n", "function\n"],
      ["{ await }", "var await = 2;\nvar o = { await };\nconsole.log(o.await);\n", "2\n"],
      ["var await after a hashbang", "#!/usr/bin/env node\nvar await = 3;\nconsole.log(await);\n", "3\n"],
    ])("%s in a .cjs entry point", async (_, source, stdout) => {
      expect(await run({ "entry.cjs": source }, "entry.cjs")).toEqual({ stdout, stderr: "", exitCode: 0 });
    });

    // Node.js v26.3.0 exports the same from each file. It has no decorators, so it does not read the last one.
    test("every way to write the name", async () => {
      const forms: [source: string, exported: unknown][] = [
        ["var await = 1; module.exports = await;", 1],
        ["let await = 1; module.exports = await;", 1],
        ["const await = 1; module.exports = await;", 1],
        ["class await {} module.exports = typeof await;", "function"],
        ["function await() { return 5 } module.exports = await();", 5],
        ["async function await() {} module.exports = typeof await;", "function"],
        ["var await = 2; var o = { await }; module.exports = o.await;", 2],
        ["var { await } = { await: 1 }; module.exports = await;", 1],
        ["var [await] = [1]; module.exports = await;", 1],
        ["var await = 1; await = 2; await++; module.exports = await;", 3],
        ["var await = { x: [4] }; module.exports = await.x[0] + await?.x.length;", 5],
        ["var await = (x) => x; module.exports = await(3);", 3],
        ["module.exports = String(await + 1);\nvar await = 1;", "NaN"],
        ["var await = (s) => s[0]; module.exports = await`x`;", "x"],
        ["var await = [7]; module.exports = await[0];", 7],
        [
          "var await = 1; module.exports = [await + 1, await - 1, await * 2, await / 2, await ** 2];",
          [2, 0, 2, 0.5, 1],
        ],
        ["var await = 10; var g = 5; module.exports = await /2/g;", 1],
        ["var await = 1; var x = await\nmodule.exports = x;", 1],
        ["var await = 1; var x = await\n+ 1; module.exports = x;", 2],
        [
          "var await = 1; module.exports = [await in { 1: 1 }, await instanceof Object, await ? 1 : 2, await === 1, await ?? 2, await || 0, await < 2];",
          [true, false, 1, true, 1, 1, true],
        ],
        [
          "var await = 1; module.exports = [typeof await, delete await, !await, -await, +await, ~await];",
          ["number", false, false, -1, 1, -2],
        ],
        ["var await = 1; module.exports = [[await], { a: await }, `${await}`, (await)];", [[1], { a: 1 }, "1", 1]],
        ["var await = 1; for (await of [1, 2]); module.exports = await;", 2],
        ["var await = 1; for (await in { a: 1 }); module.exports = await;", "a"],
        ["for (var await of [1, 2]); module.exports = await;", 2],
        ["await: for (;;) { break await; } module.exports = 'ok';", "ok"],
        ["try { throw 1 } catch (await) { module.exports = await; }", 1],
        ["var f = (await) => await; module.exports = f(4);", 4],
        ["var f = await => await; module.exports = f(4);", 4],
        ["var await = 1; var f = (a = await) => a; module.exports = f();", 1],
        ["var await = 1; var f = () => await; module.exports = f();", 1],
        ["var await = 1; class A { x = await; } module.exports = new A().x;", 1],
        ["var await = 1; if (await) { module.exports = await; }", 1],
        ["var await = 1; switch (await) { case 1: module.exports = 'one'; }", "one"],
        ["var \\u0061wait = 1; module.exports = \\u0061wait + await;", 2],
        ["var \\u0061wait = 5; module.exports = \\u0061wait;", 5],
        ["'use strict'; var await = 1; module.exports = await;", 1],
        ["var await = 1; var f = async () => await 2; module.exports = f().constructor.name + await;", "Promise1"],
        ["var await = 1; return void (module.exports = await);", 1],
        ["#!/usr/bin/env node\nvar await = 1; module.exports = await;", 1],
        // The file does not have to declare the name.
        ["module.exports = typeof await;", "undefined"],
        ["globalThis.await = 3; var o = { await }; module.exports = o.await; delete globalThis.await;", 3],
        ["\\u0061wait = 2; module.exports = globalThis.await; delete globalThis.await;", 2],
        // Each of these has the name in one place only.
        ["var await; module.exports = 'declared';", "declared"],
        ["class await {} module.exports = 'declared';", "declared"],
        ["module.exports = (class await {}).name;", "await"],
        ["function dec(c) { return c } module.exports = (@dec class await {}).name;", "await"],
      ];
      const specifiers = forms.map((_, i) => `./form-${i}.cjs`);
      const result = await run(
        {
          ...Object.fromEntries(forms.map(([source], i) => [specifiers[i], source])),
          "entry.cjs": collect(specifiers, "require(specifier)"),
        },
        "entry.cjs",
      );
      expect(collected(result)).toEqual({ stdout: forms.map(([, exported]) => exported), stderr: "", exitCode: 0 });
    });

    // Bun folds `1 + 2` in a file that it transpiles for the runtime. The parser turns that on before the
    // first reading, and has to do so again before the second.
    test("the second reading transpiles the file as the first does", async () => {
      const source = (name: string) => `var ${name} = 1; module.exports = (() => 1 + 2).toString();`;
      const result = await run(
        {
          "named.cjs": source("await"),
          "control.cjs": source("other"),
          "entry.cjs": collect(["./named.cjs", "./control.cjs"], "require(specifier)"),
        },
        "entry.cjs",
      );
      expect(collected(result)).toEqual({ stdout: ["() => 3", "() => 3"], stderr: "", exitCode: 0 });
    });

    // Node.js v26.3.0 prints the same.
    test("a module loads the script with import, import() and require()", async () => {
      const lib = (how: string) => `var await = 7;\nmodule.exports = { how: "${how}", sum: await + 1 };\n`;
      const result = await run(
        {
          "package.json": JSON.stringify({ type: "module" }),
          "static.cjs": lib("import"),
          "dynamic.cjs": lib("import()"),
          "required.cjs": lib("require()"),
          // Nothing but the name says that this file is CommonJS.
          "bare.cjs": "var await = 7;\nglobalThis.fromBare = await + 2;\n",
          "entry.js": `
            import fromImport from "./static.cjs";
            import "./bare.cjs";
            import { createRequire } from "node:module";
            const fromDynamicImport = (await import("./dynamic.cjs")).default;
            const fromRequire = createRequire(import.meta.url)("./required.cjs");
            console.log(JSON.stringify([fromImport, fromDynamicImport, fromRequire, fromBare]));
          `,
        },
        "entry.js",
      );
      expect(collected(result)).toEqual({
        stdout: [{ how: "import", sum: 8 }, { how: "import()", sum: 8 }, { how: "require()", sum: 8 }, 9],
        stderr: "",
        exitCode: 0,
      });
    });

    test("the name is an error in every other file", async () => {
      const name = 'Cannot use "yield" or "await" here.';
      const modules: [specifier: string, source: string | undefined, error: string][] = [
        // A `.cjs` file that has an `import` or an `export` is a module.
        ["./export.cjs", "var await = 1; export {};", name],
        ["./export-first.cjs", "export {}; var await = 1;", name],
        ["./import.cjs", "import 'node:fs'; var await = 1;", name],
        ["./import-meta.cjs", "var await = 1; import.meta.url;", name],
        // The reading as a module stops at `await)`, before it sees the `import` or the `export`.
        ["./export-last.cjs", "var await = 1; console.log(await); export {};", name],
        ["./import-last.cjs", "var await = 1; console.log(await); import 'node:fs';", name],
        // These are errors in a script too.
        ["./operator.cjs", "var await = 1; await 1;", name],
        ["./for-await.cjs", "var await = 1; for await (const x of []);", name],
        ["./async-function.cjs", "var await = 1; async function f() { var await; }", name],
        ["./static-block.cjs", "var await = 1; class A { static { await; } }", name],
        // JavaScriptCore reports these two when the file loads.
        [
          "./async-arrow.cjs",
          "var await = 1; module.exports = async (await) => 1;",
          "Cannot use 'await' as a parameter name in an async function.",
        ],
        [
          "./async-arrow-default.cjs",
          "var await = 1; module.exports = async (a = await) => 1;",
          "Cannot use 'await' within a parameter default expression.",
        ],
        // A module by its name, by its package, or because it is a `data:` URL.
        ["./module.mjs", "var await = 1;", name],
        ["./module/typed.js", "var await = 1;", name],
        ["data:text/javascript,var await = 1;//x.cjs", undefined, name],

        // Node.js runs the files from here on. Bun reads only a `.cjs` file again, as `bun --aot` does.
        ["./script.cts", "var await = 1;", name],
        ["./commonjs/typed.js", "var await = 1;", name],
        ["./plain.js", "var await = 1;", name],
        ["./undeclared.js", "console.log(typeof await);", "Unexpected )"],
        // The reading of these as a module has no error, so Bun does not read them again.
        // `await(3)` and `await + 1` are then uses of the operator, and the file is a module.
        [
          "./function.cjs",
          "module.exports = await(3);\nfunction await(x) { return x * 2 }",
          "Cannot declare function named 'await' in a module.",
        ],
        [
          "./pattern.cjs",
          "var { await = 7 } = {}; module.exports = await + 1;",
          "Cannot use 'await' as a variable name in a module.",
        ],
      ];
      const result = await run(
        {
          "module/package.json": JSON.stringify({ type: "module" }),
          "commonjs/package.json": JSON.stringify({ type: "commonjs" }),
          ...Object.fromEntries(modules.flatMap(([specifier, source]) => (source ? [[specifier, source]] : []))),
          "entry.mjs": collect(
            modules.map(([specifier]) => specifier),
            "await import(specifier)",
            "(e.errors?.[0] ?? e).message",
          ),
        },
        "entry.mjs",
      );
      expect(collected(result)).toEqual({ stdout: modules.map(([, , error]) => error), stderr: "", exitCode: 0 });
    });

    test("a file that is not a script either keeps the errors of the first reading", async () => {
      const result = await run(
        {
          // The only error of the reading as a script is the missing `)`.
          "broken.cjs": "var await = 1;\nconsole.log(await;\n",
          "entry.mjs": collect(["./broken.cjs"], "await import(specifier)"),
        },
        "entry.mjs",
      );
      expect(collected(result)).toEqual({
        stdout: [['Cannot use "yield" or "await" here.', "Unexpected ;"]],
        stderr: "",
        exitCode: 0,
      });
    });

    test("a stack overflow is reported where the first reading ran out of stack", async () => {
      const nesting = (parenthesis: string) => Buffer.alloc(100_000, parenthesis).toString();
      const result = await run(
        // The reading as a script stops in line 1, at `.source`.
        { "deep.cjs": `await /x/.source;\n\nvar x = ${nesting("(")}1${nesting(")")};\n` },
        "deep.cjs",
      );
      expect(result.stderr).toMatch(/error: Maximum call stack size exceeded\n\s+at .*deep\.cjs:3:\d+/);
      expect({ stdout: result.stdout, exitCode: result.exitCode }).toEqual({ stdout: "", exitCode: 1 });
    });

    // Only the module loader of the runtime reads a file again. An ES module cannot hold the name.
    test.each([["--no-bundle"], ["--format=esm"]])("bun build %s does not read the script", async flag => {
      const result = await run({ "entry.cjs": "var await = 1;\nconsole.log(await);\n" }, "build", flag, "entry.cjs");
      expect(result.stderr).toContain('error: Cannot use "yield" or "await" here.');
      expect({ stdout: result.stdout, exitCode: result.exitCode }).toEqual({ stdout: "", exitCode: 1 });
    });

    test("bun test runs a .cjs test file that has the name", async () => {
      const result = await run(
        { "name.test.cjs": "var await = 1;\ntest('the name', () => expect(await).toBe(1));\n" },
        "test",
        "./name.test.cjs",
      );
      expect(result.stderr).toContain(" 1 pass\n 0 fail\n");
      expect(result.exitCode).toBe(0);
    });

    // Node.js reports a SyntaxError for this file. Bun has top-level await in every file.
    test("the operator still works at the top level of a .cjs file", async () => {
      const result = await run(
        {
          "entry.cjs": `
            console.log(await 1);
            for await (const x of [2]) console.log(x);
            console.log(await (3), typeof module);
          `,
        },
        "entry.cjs",
      );
      expect(result).toEqual({ stdout: "1\n2\n3 undefined\n", stderr: "", exitCode: 0 });
    });
  });
});

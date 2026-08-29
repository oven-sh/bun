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
            if (1) { 'use strict'; eval = 2 }
            function tpl() { \`use strict\`; return typeof this }
            function late() { var x = 1; "use strict"; return typeof this }
            function sloppy() { arguments = 3; return arguments }
            console.log(eval, tpl(), late(), sloppy(), 010);
          `,
        },
        "entry.cjs",
      );
      expect(result).toEqual({ stdout: "2 object object 3 8\n", stderr: "", exitCode: 0 });
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
            console.log(escaped(), unicode(), paren(), after(), typeof this, 010);
          `,
        },
        "entry.cjs",
      );
      expect(result).toEqual({ stdout: "object object object object object 8\n", stderr: "", exitCode: 0 });
    });

    test("'use strict' in a function with a non-simple parameter list is a SyntaxError", async () => {
      const result = await run({ "entry.cjs": `function f(a = 1) { "use strict"; return a }` }, "entry.cjs");
      expect(result.stderr).toContain(
        'Cannot use a "use strict" directive in a function with a non-simple parameter list',
      );
      expect(result.exitCode).toBe(1);
    });

    test("a legacy octal literal in a strict function is a SyntaxError", async () => {
      const result = await run({ "entry.cjs": `function h() { "use strict"; return 010 }` }, "entry.cjs");
      expect(result.stderr).toContain("Legacy octal literals cannot be used in strict mode");
      expect(result.stderr).toContain('Strict mode is triggered by the "use strict" directive here');
      expect(result.exitCode).toBe(1);
    });
  });
});

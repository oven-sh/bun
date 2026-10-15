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

  // Node calls the module wrapper with `module.exports` as the receiver
  // (`Module.prototype._compile` in lib/internal/modules/cjs/loader.js), so
  // `this` is the exports object the module started with, whatever the module
  // assigns to `exports` or `module.exports` later.
  describe("top-level this is the exports object the module started with", () => {
    async function run(files: Record<string, string>, args: string[]) {
      using dir = tempDir("run-cjs-this", files);
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

    // Names each value: "exports" is what `module.exports` held at the start.
    const probe = `
      const start = module.exports;
      const name = value =>
        value === start ? "exports" : value === module ? "module" : value === globalThis ? "globalThis" : typeof value;
      const seen = {
        literal: name(this),
        eval: name(eval("this")),
        arrow: name((() => this)()),
        arrowEval: name((() => eval("this"))()),
      };
      exports = { other: true };
      seen.afterExportsAssignment = name(this);
      module.exports = { replaced: true };
      seen.afterModuleExportsAssignment = name(this);
      seen.evalAfterModuleExportsAssignment = name(eval("this"));
      console.log(JSON.stringify(seen));
    `;
    const files = {
      "probe.cjs": probe,
      "strict.cjs": `"use strict";\n${probe}`,
      "require.cjs": `require("./probe.cjs");`,
      "import.mjs": `import "./probe.cjs";`,
      "dynamic-import.mjs": `await import("./probe.cjs");`,
      "worker.mjs": `new Worker(new URL("./probe.cjs", import.meta.url));`,
      "empty.js": ``,
    };

    test.each([
      ["as an entry point", ["probe.cjs"]],
      ["as a strict mode entry point", ["strict.cjs"]],
      ["by require()", ["require.cjs"]],
      ["by an import statement", ["import.mjs"]],
      ["by import()", ["dynamic-import.mjs"]],
      ["by --preload", ["--preload", "./probe.cjs", "empty.js"]],
      ["as a Worker entry point", ["worker.mjs"]],
    ])("in a module loaded %s", async (_, args) => {
      const { stdout, stderr, exitCode } = await run(files, args);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        literal: "exports",
        eval: "exports",
        arrow: "exports",
        arrowEval: "exports",
        afterExportsAssignment: "exports",
        afterModuleExportsAssignment: "exports",
        evalAfterModuleExportsAssignment: "exports",
      });
      expect(exitCode).toBe(0);
    });

    test("in a module evaluated again after a require.cache delete", async () => {
      const { stdout, stderr, exitCode } = await run(
        {
          "counted.cjs": `
            exports.literal = this === module.exports;
            exports.eval = eval("this") === module.exports;
          `,
          "main.cjs": `
            const path = require.resolve("./counted.cjs");
            const first = require(path);
            delete require.cache[path];
            const second = require(path);
            console.log(JSON.stringify({ first, second, distinct: first !== second }));
          `,
        },
        ["main.cjs"],
      );
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({
        first: { literal: true, eval: true },
        second: { literal: true, eval: true },
        distinct: true,
      });
      expect(exitCode).toBe(0);
    });

    test("in a file that already has the wrapper (// @bun @bun-cjs)", async () => {
      // The parser does not see this body, so only the receiver can provide `this`.
      const { stdout, stderr, exitCode } = await run(
        {
          "entry.cjs": `// @bun @bun-cjs
(function(exports, require, module, __filename, __dirname) {
  console.log(this === module.exports, this === exports, eval("this") === exports);
})`,
        },
        ["entry.cjs"],
      );
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "true true true\n", stderr: "", exitCode: 0 });
    });

    // `typeof arguments` is "object" inside the CommonJS wrapper function and
    // "undefined" in an ES module.
    test("and a use of it makes a file with no other module syntax CommonJS", async () => {
      const { stdout, stderr, exitCode } = await run(
        {
          "exporter.js": `this.answer = 42; this.wrapped = typeof arguments;`,
          "main.cjs": `console.log(JSON.stringify(require("./exporter.js")));`,
        },
        ["main.cjs"],
      );
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ answer: 42, wrapped: "object" });
      expect(exitCode).toBe(0);
    });

    test("but a this that is dead or unused does not", async () => {
      const { stdout, stderr, exitCode } = await run(
        {
          "entry.js": `
            this;
            typeof this;
            if (false) this.x = 1;
            console.log(typeof arguments);
          `,
        },
        ["entry.js"],
      );
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: "undefined\n", stderr: "", exitCode: 0 });
    });
  });
});

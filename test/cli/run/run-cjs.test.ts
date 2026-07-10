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

  // The .cjs/.mjs/.cts/.mts extension is an unconditional format declaration;
  // a .cjs with no `module`/`exports`/`require` must still load as CommonJS
  // (default export = module.exports = {}), and .mjs never gains a CJS default.
  describe.each(["// x\n", "", ";\n", "void 0;\n", "(function(){})();\n"])(
    ".cjs/.mjs extension forces module format (content=%j)",
    content => {
      test(".cjs imported from .mjs has a default export of {}", async () => {
        using dir = tempDir("cjs-ext-import", {
          "b.cjs": content,
          "t.mjs": `
            import D from "./b.cjs";
            import * as N from "./b.cjs";
            const dyn = await import("./b.cjs");
            console.log(JSON.stringify({
              default: D,
              nsKeys: Object.keys(N).sort(),
              nsDefault: N.default,
              dynKeys: Object.keys(dyn).sort(),
              dynDefault: dyn.default,
            }));
          `,
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "t.mjs"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          proc.stdout.text(),
          proc.stderr.text(),
          proc.exited,
        ]);
        const out = stdout.trim() ? JSON.parse(stdout.trim()) : { stderr };
        expect({ out, exitCode }).toEqual({
          out: {
            default: {},
            nsKeys: ["default"],
            nsDefault: {},
            dynKeys: ["default"],
            dynDefault: {},
          },
          exitCode: 0,
        });
      });

      test(".cts imported from .mts has a default export of {}", async () => {
        using dir = tempDir("cts-ext-import", {
          "b.cts": content,
          "t.mts": `
            import D from "./b.cts";
            import * as N from "./b.cts";
            console.log(JSON.stringify({ default: D, nsKeys: Object.keys(N).sort() }));
          `,
        });
        await using proc = Bun.spawn({
          cmd: [bunExe(), "t.mts"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          proc.stdout.text(),
          proc.stderr.text(),
          proc.exited,
        ]);
        const out = stdout.trim() ? JSON.parse(stdout.trim()) : { stderr };
        expect({ out, exitCode }).toEqual({
          out: { default: {}, nsKeys: ["default"] },
          exitCode: 0,
        });
      });
    },
  );

  test.each(["// x\n", ""])(
    ".js under 'type':'commonjs' with no CJS markers has a default export of {} (content=%j)",
    async content => {
      using dir = tempDir("js-type-cjs-import", {
        "package.json": `{"type":"commonjs"}`,
        "b.js": content,
        "t.mjs": `
          import D from "./b.js";
          import * as N from "./b.js";
          console.log(JSON.stringify({ default: D, nsKeys: Object.keys(N).sort() }));
        `,
      });
      // Exercise both the async transpiler store and the sync fallback.
      for (const disableAsync of ["0", "1"]) {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "t.mjs"],
          env: { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: disableAsync },
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([
          proc.stdout.text(),
          proc.stderr.text(),
          proc.exited,
        ]);
        const out = stdout.trim() ? JSON.parse(stdout.trim()) : { stderr };
        expect({ disableAsync, out, exitCode }).toEqual({
          disableAsync,
          out: { default: {}, nsKeys: ["default"] },
          exitCode: 0,
        });
      }
    },
  );

  test("'use strict' in .mjs does not cause it to be treated as CommonJS", async () => {
    using dir = tempDir("mjs-ext-import", {
      "m.mjs": `"use strict";\n`,
      "t.mjs": `
        import * as N from "./m.mjs";
        console.log(JSON.stringify({ keys: Object.keys(N), hasDefault: "default" in N }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "t.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);
    const out = stdout.trim() ? JSON.parse(stdout.trim()) : { stderr };
    expect({ out, exitCode }).toEqual({
      out: { keys: [], hasDefault: false },
      exitCode: 0,
    });
  });
});

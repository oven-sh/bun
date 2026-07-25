// https://github.com/oven-sh/bun/issues/8058
//
// The printer used to unconditionally rewrite `require("bun")` / `import("bun")`
// to the literal `globalThis.Bun` / `Promise.resolve(globalThis.Bun)`. A local
// `let globalThis` (or `let Promise`) in scope would shadow that literal and
// change the value of the import.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { itBundled } from "../../bundler/expectBundled";

describe("runtime transpiler", () => {
  async function run(src: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test("require('bun') with a local `globalThis` returns the real Bun object", async () => {
    const { stdout, stderr, exitCode } = await run(
      `{ let globalThis = { Bun: "intercepted" }; console.log(typeof require("bun").serve); }`,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("function\n");
    expect(exitCode).toBe(0);
  });

  test("dynamic import('bun') with local `globalThis` / `Promise` returns the real Bun object", async () => {
    const { stdout, stderr, exitCode } = await run(
      `{ let globalThis = { Bun: "intercepted" }; let Promise = null;` +
        ` import("bun").then(b => console.log(typeof b.serve)); }`,
    );
    expect(stderr).toBe("");
    expect(stdout).toBe("function\n");
    expect(exitCode).toBe(0);
  });

  test("static `import * as B from 'bun'` with module-level `let globalThis`", async () => {
    using dir = tempDir("issue-08058-static", {
      "index.ts": `
        let globalThis = { Bun: "intercepted" };
        import * as B from "bun";
        console.log(typeof B.serve);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("function\n");
    expect(exitCode).toBe(0);
  });

  test("require('bun') in a .cjs file with a local `globalThis`", async () => {
    using dir = tempDir("issue-08058-cjs", {
      "index.cjs": `
        module.exports = 1;
        { let globalThis = { Bun: "intercepted" }; console.log(typeof require("bun").serve); }
      `,
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
    expect(stdout).toBe("function\n");
    expect(exitCode).toBe(0);
  });
});

describe("bundler", () => {
  itBundled("bun/require-bun-shadowed-globalThis", {
    target: "bun",
    files: {
      "/entry.ts": /* js */ `
        {
          let globalThis = { Bun: "intercepted" };
          const b = require("bun");
          if (typeof b.serve !== "function") throw new Error("require('bun') was shadowed: " + b);
          const d = await import("bun");
          if (typeof d.serve !== "function") throw new Error("import('bun') was shadowed: " + d);
          console.log("pass");
        }
      `,
    },
    run: { stdout: "pass" },
    onAfterBundle(api) {
      // The user's local binding should have been renamed away.
      expect(api.readFile("out.js")).not.toContain(`let globalThis =`);
    },
  });

  itBundled("bun/require-bun-shadowed-globalThis-cjs", {
    target: "bun",
    format: "cjs",
    files: {
      "/entry.ts": /* js */ `
        {
          let globalThis = { Bun: "intercepted" };
          const b = require("bun");
          if (typeof b.serve !== "function") throw new Error("require('bun') was shadowed: " + b);
          console.log("pass");
        }
      `,
    },
    run: { stdout: "pass" },
  });
});

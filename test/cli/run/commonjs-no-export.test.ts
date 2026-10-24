import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe.concurrent("commonjs-no-export", () => {
  test("CommonJS entry point with no exports", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--bun", join(import.meta.dir, "commonjs-no-exports-fixture.js")],
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout.trim().endsWith("--pass--")).toBe(true);
    expect(exitCode).toBe(0);
  });

  // `require`, `__dirname` and `__filename` are parameters of Node's module wrapper.
  // A module-level `var` of one of those names is that parameter, and reading it
  // is a CommonJS feature. Each case prints what Node prints.
  test.each([
    {
      name: "var require is the only CommonJS feature of a .js file",
      args: ["entry.js"],
      files: { "entry.js": `var require; console.log(typeof require, typeof require("node:path").join);` },
      stdout: "function function\n",
    },
    {
      name: "var __dirname and var __filename are the only CommonJS features of a .js file",
      args: ["entry.js"],
      files: {
        "entry.js": `var __dirname = __dirname, __filename = __filename; console.log(typeof __dirname, typeof __filename);`,
      },
      stdout: "string string\n",
    },
    {
      name: "var require in -e",
      args: ["-e", `var require; console.log(typeof require);`],
      files: {},
      stdout: "function\n",
    },
    {
      name: "var require in -p",
      args: ["-p", `var require; typeof require`],
      files: {},
      stdout: "function\n",
    },
    {
      name: "var require in an ES module is a new variable",
      args: ["entry.mjs"],
      files: {
        "entry.mjs": `var require, __dirname; console.log(typeof require, typeof __dirname);`,
      },
      stdout: "undefined undefined\n",
    },
    {
      name: "var require in a file with an export is a new variable",
      args: ["entry.js"],
      files: { "entry.js": `var require; console.log(typeof require); export {};` },
      stdout: "undefined\n",
    },
    {
      name: "a function named require keeps its value",
      args: ["entry.js"],
      files: {
        "entry.js": `function require() { return "own"; } var require; module.exports = require(); console.log(module.exports);`,
      },
      stdout: "own\n",
    },
    // The transpiler adds an `import` statement to the next two files. The runtime
    // cannot run such a file as CommonJS, so the `var` does not make it CommonJS.
    {
      name: "var require in a file with JSX is a new variable",
      args: ["entry.jsx"],
      files: {
        "entry.jsx": `var require, __dirname; console.log(typeof require, typeof __dirname, typeof (<div />));`,
        "node_modules/react/package.json": JSON.stringify({ name: "react", version: "0.0.0" }),
        "node_modules/react/jsx-dev-runtime.js": `export function jsxDEV(type) { return { type }; }`,
        "node_modules/react/jsx-runtime.js": `export function jsx(type) { return { type }; }`,
      },
      stdout: "undefined undefined object\n",
    },
    {
      name: "var require in a file with a decorator is a new variable",
      args: ["entry.ts"],
      files: {
        "entry.ts": `var require; function tag(target: any) { target.tagged = typeof require; }\n@tag class A {}\nconsole.log((A as any).tagged);`,
      },
      stdout: "undefined\n",
    },
  ])("$name", async ({ args, files, stdout }) => {
    using dir = tempDir("commonjs-var-of-wrapper-parameter", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [out, err, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout: out, stderr: err, exitCode }).toEqual({ stdout, stderr: "", exitCode: 0 });
  });
});

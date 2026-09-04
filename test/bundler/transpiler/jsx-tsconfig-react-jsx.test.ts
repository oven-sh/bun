import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// tsconfig "jsx": "react-jsx" selects the production automatic runtime (jsx/jsxs),
// "react-jsxdev" selects the development runtime (jsxDEV), matching TypeScript/esbuild.
// https://github.com/oven-sh/bun/issues/4227

const shimFiles = {
  "node_modules/shim/package.json": JSON.stringify({
    name: "shim",
    version: "1.0.0",
    type: "module",
    exports: {
      ".": "./rt.js",
      "./jsx-runtime": "./rt.js",
      "./jsx-dev-runtime": "./dev.js",
    },
  }),
  "node_modules/shim/rt.js": `
    export const Fragment = Symbol.for("F");
    export const jsx = () => (console.log("prod jsx"), {});
    export const jsxs = jsx;
  `,
  "node_modules/shim/dev.js": `
    export const Fragment = Symbol.for("F");
    export const jsxDEV = () => (console.log("dev jsxDEV"), {});
  `,
  "m.jsx": `const a = <div p="1">x</div>;\nglobalThis.s = a;\n`,
};

// `NODE_ENV` in the environment overrides tsconfig dev/prod for `bun run` in
// both directions; `--define process.env.NODE_ENV` overrides both.
describe.each(["NODE_ENV", "BUN_ENV"])("bun run: env %s overrides tsconfig jsx dev/prod", envVar => {
  test.concurrent.each([
    // [tsconfig jsx,   env value,      expected runtime]
    ["react-jsx", "development", "dev jsxDEV"], // env wins
    ["react-jsx", "production", "prod jsx"], // both agree
    ["react-jsxdev", "development", "dev jsxDEV"], // both agree
    ["react-jsxdev", "production", "prod jsx"], // env wins
  ] as const)(`tsconfig "%s" + ${envVar}=%s -> %s`, async (jsx, envValue, expected) => {
    using dir = tempDir("jsx-tsconfig-env", {
      ...shimFiles,
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx, jsxImportSource: "shim" } }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "m.jsx"],
      env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined, [envVar]: envValue },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, stdout: stdout.trim(), exitCode }).toEqual({ stderr: "", stdout: expected, exitCode: 0 });
  });
});

describe("bun run: --define process.env.NODE_ENV overrides env NODE_ENV for jsx dev/prod", () => {
  test.concurrent.each([
    // [env NODE_ENV,   --define value,   tsconfig jsx,     expected]
    ["development", '"production"', "react-jsxdev", "prod jsx"], // --define > env > tsconfig
    ["production", '"development"', "react-jsx", "dev jsxDEV"], // --define > env > tsconfig
  ] as const)(
    "env NODE_ENV=%s + --define process.env.NODE_ENV=%s (tsconfig %s) -> %s",
    async (envValue, defineValue, jsx, expected) => {
      using dir = tempDir("jsx-tsconfig-define", {
        ...shimFiles,
        "tsconfig.json": JSON.stringify({ compilerOptions: { jsx, jsxImportSource: "shim" } }),
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "--define", `process.env.NODE_ENV=${defineValue}`, "m.jsx"],
        env: { ...bunEnv, NODE_ENV: envValue, BUN_ENV: undefined },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stderr, stdout: stdout.trim(), exitCode }).toEqual({ stderr: "", stdout: expected, exitCode: 0 });
    },
  );
});

describe("tsconfig compilerOptions.jsx", () => {
  test.each([
    ["react-jsx", "prod jsx", "shim/jsx-runtime"],
    ["react-jsxdev", "dev jsxDEV", "shim/jsx-dev-runtime"],
  ] as const)('"%s" selects the matching automatic runtime', async (jsx, runStdout, importSource) => {
    using dir = tempDir("jsx-tsconfig", {
      ...shimFiles,
      "tsconfig.json": JSON.stringify({
        compilerOptions: { jsx, jsxImportSource: "shim" },
      }),
    });

    // bun run
    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "m.jsx"],
        env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: runStdout, exitCode: 0 });
    }

    // bun build
    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "m.jsx", "--external", "shim*"],
        env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toContain(`"${importSource}"`);
      expect(stdout).not.toContain(importSource === "shim/jsx-runtime" ? "jsx-dev-runtime" : '"shim/jsx-runtime"');
      expect(exitCode).toBe(0);
    }
  });
});

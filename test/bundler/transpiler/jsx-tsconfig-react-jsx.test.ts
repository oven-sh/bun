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

// An explicit NODE_ENV (environment or --define) and --production outrank the
// tsconfig's dev/prod choice. `bun build --no-bundle` transpiles each entry
// point from the resolver's per-file (tsconfig-merged) jsx settings, so it has
// to apply that override the same way the bundled path does.
describe("bun build: NODE_ENV / --production outrank tsconfig jsx in --no-bundle and bundled mode alike", () => {
  const DEV = "react/jsx-dev-runtime";
  const PROD = "react/jsx-runtime";
  const tsconfig = (jsx: string) => JSON.stringify({ compilerOptions: { jsx } });
  const entry = `export const el = <div>hi</div>;\n`;

  type Case = {
    files: Record<string, string>;
    entry?: string;
    env?: Record<string, string>;
    args?: string[];
    expected: string;
  };

  const cases: [name: string, c: Case][] = [
    // Controls: tsconfig decides when nothing outranks it.
    ['"react-jsx", NODE_ENV unset', { files: { "tsconfig.json": tsconfig("react-jsx") }, expected: PROD }],
    ['"react-jsxdev", NODE_ENV unset', { files: { "tsconfig.json": tsconfig("react-jsxdev") }, expected: DEV }],
    [
      '"react-jsx" + NODE_ENV=development',
      { files: { "tsconfig.json": tsconfig("react-jsx") }, env: { NODE_ENV: "development" }, expected: DEV },
    ],
    [
      '"react-jsx" + BUN_ENV=development',
      { files: { "tsconfig.json": tsconfig("react-jsx") }, env: { BUN_ENV: "development" }, expected: DEV },
    ],
    [
      '"react-jsx" + --define process.env.NODE_ENV=\'"development"\'',
      {
        files: { "tsconfig.json": tsconfig("react-jsx") },
        args: ["--define", 'process.env.NODE_ENV="development"'],
        expected: DEV,
      },
    ],
    [
      'nested "react-jsx" tsconfig next to the entry point + NODE_ENV=development',
      {
        files: { "src/tsconfig.json": tsconfig("react-jsx") },
        entry: "src/m.tsx",
        env: { NODE_ENV: "development" },
        expected: DEV,
      },
    ],
    [
      '"react-jsxdev" + --production',
      { files: { "tsconfig.json": tsconfig("react-jsxdev") }, args: ["--production"], expected: PROD },
    ],
    [
      '"react-jsx" + --production with NODE_ENV=development in the environment',
      {
        files: { "tsconfig.json": tsconfig("react-jsx") },
        env: { NODE_ENV: "development" },
        args: ["--production"],
        expected: PROD,
      },
    ],
  ];

  async function build(cwd: string, args: string[], env: Record<string, string> | undefined) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", ...args],
      env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined, ...env },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return {
      stderr,
      exitCode,
      runtimes: [...new Set(stdout.match(/react\/jsx(?:-dev)?-runtime/g))].sort(),
    };
  }

  test.concurrent.each(cases)("%s", async (_name, { files, entry: entryPath = "m.tsx", env, args = [], expected }) => {
    using dir = tempDir("jsx-tsconfig-node-env", { ...files, [entryPath]: entry });

    const noBundle = await build(String(dir), ["--no-bundle", ...args, entryPath], env);
    const bundled = await build(String(dir), ["--external", "react*", ...args, entryPath], env);

    const want = { stderr: "", exitCode: 0, runtimes: [expected] };
    expect({ noBundle, bundled }).toEqual({ noBundle: want, bundled: want });
  });
});

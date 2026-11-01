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

  // "preserve" is selected with --jsx-runtime, Bun.build or bunfig, never from
  // tsconfig: `bun run` executes the output, and tsconfigs written for other
  // toolchains (Next.js) ask for it.
  test.concurrent.each([
    [undefined, "dev jsxDEV", "shim/jsx-dev-runtime"],
    ["production", "prod jsx", "shim/jsx-runtime"],
  ] as const)('"preserve" in tsconfig is ignored with NODE_ENV=%s', async (NODE_ENV, runStdout, importSource) => {
    using dir = tempDir("jsx-tsconfig-preserve", {
      ...shimFiles,
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "preserve", jsxImportSource: "shim" } }),
    });
    const env = { ...bunEnv, NODE_ENV, BUN_ENV: undefined };

    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "m.jsx"],
        env,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: runStdout, stderr: "", exitCode: 0 });
    }

    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "m.jsx", "--external", "shim*"],
        env,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toContain(JSON.stringify(importSource));
      expect(stdout).not.toContain("<div");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    }
  });

  describe.each([
    ["react-jsx", "shim/jsx-runtime"],
    ["react-jsxdev", "shim/jsx-dev-runtime"],
  ])("CLI runtime %s", (runtime, importSource) => {
    test.concurrent("selects the matching automatic runtime", async () => {
      using dir = tempDir("jsx-cli-runtime", shimFiles);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "m.jsx", `--jsx-runtime=${runtime}`, "--jsx-import-source=shim", "--external=shim*"],
        env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toContain(`"${importSource}"`);
      expect(stdout).not.toContain(importSource === "shim/jsx-runtime" ? "jsx-dev-runtime" : '"shim/jsx-runtime"');
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  });

  // The Solid.js JSX transform was removed in 88538b7c2c.
  // jsxImportSource "solid-js" must not select a framework-specific runtime.
  test.concurrent('jsxImportSource "solid-js" uses the automatic runtime', async () => {
    using dir = tempDir("jsx-tsconfig-solid", {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { jsx: "react-jsx", jsxImportSource: "solid-js" },
      }),
      "m.jsx": `export const a = <div p="1">x</div>;\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "m.jsx", "--external", "solid-js*"],
      env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toContain('"solid-js/jsx-runtime"');
    expect(stdout).not.toContain("React.createElement");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/3528
  test('Bun.Transpiler with jsx "react-jsx" and jsxImportSource "solid-js" uses the automatic runtime', () => {
    const transpiler = new Bun.Transpiler({
      loader: "tsx",
      autoImportJSX: true,
      tsconfig: { compilerOptions: { jsx: "react-jsx", jsxImportSource: "solid-js" } },
    });
    const out = transpiler.transformSync(`export default <div>hi</div>;`);
    expect(out).toMatch(/^import \{ jsx(DEV)? as \w+ \} from "solid-js\/jsx(-dev)?-runtime";\n/);
    expect(out).toMatch(/\nexport default jsx(DEV)?_\w+\("div"/);
    expect(out).not.toContain("React.createElement");
  });

  test('Bun.Transpiler ignores tsconfig jsx "preserve" and keeps JSX for the pragma', () => {
    const transpiler = new Bun.Transpiler({
      loader: "tsx",
      autoImportJSX: true,
      tsconfig: { compilerOptions: { jsx: "preserve", jsxImportSource: "solid-js" } },
    });
    const out = transpiler.transformSync(`export default <div>hi</div>;`);
    expect(out).toMatch(/^import \{ jsx(DEV)? as \w+ \} from "solid-js\/jsx(-dev)?-runtime";\n/);

    const preserved = transpiler.transformSync(`/* @jsxRuntime preserve */\nexport default <div>hi</div>;`);
    expect(preserved).toContain(`export default <div>hi</div>;`);
    expect(preserved).not.toContain("jsx-runtime");
    expect(transpiler.scanImports(`/* @jsxRuntime preserve */\nexport default <div>hi</div>;`)).toEqual([]);
    const afterPragma = transpiler.transformSync(`export default <div>hi</div>;`);
    expect(afterPragma).toMatch(/^import \{ jsx(DEV)? as \w+ \} from "solid-js\/jsx(-dev)?-runtime";\n/);
  });
});

describe("removed solid jsx runtime", () => {
  test.concurrent('bunfig.toml jsx = "solid" is an error', async () => {
    using dir = tempDir("jsx-bunfig-solid", {
      "bunfig.toml": `jsx = "solid"\n`,
      "m.jsx": `export const a = <div />;\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "m.jsx"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain(
      "Invalid jsx runtime, expected one of: 'automatic', 'classic', 'preserve', 'react', 'react-jsx', or 'react-jsxdev'",
    );
    expect(exitCode).toBe(1);
  });

  test.concurrent("--jsx-runtime=solid is an error", async () => {
    using dir = tempDir("jsx-flag-solid", {
      "m.jsx": `export const a = <div />;\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "--jsx-runtime=solid", "m.jsx"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain(
      `Invalid --jsx-runtime: "solid", expected one of: 'automatic', 'classic', 'preserve', 'react', 'react-jsx', or 'react-jsxdev'`,
    );
    expect(exitCode).toBe(1);
  });
});

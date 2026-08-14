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

  test("the tsconfig nearest to the file applies, not the cwd's", async () => {
    using dir = tempDir("jsx-tsconfig-nearest", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react", jsxFactory: "rootFactory" } }),
      "app/tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react", jsxFactory: "appFactory" } }),
      "app/m.tsx": `
        const rootFactory = (tag: string) => "root:" + tag;
        const appFactory = (tag: string) => "app:" + tag;
        console.log(<div />);
      `,
    });

    // bun run
    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "app/m.tsx"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "app:div", exitCode: 0 });
    }

    // bun build, which already picked the file's own tsconfig
    {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "app/m.tsx"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toContain('appFactory("div"');
      expect(exitCode).toBe(0);
    }
  });

  // The file's own tsconfig picks dev vs. production too, except that an
  // explicit NODE_ENV still outranks every tsconfig (react's production
  // jsx-dev-runtime exports no jsxDEV, so NODE_ENV=production must never emit it).
  test.each([
    [{}, "dev jsxDEV"],
    [{ NODE_ENV: "production" }, "prod jsx"],
  ])('nested "react-jsxdev" under a "react-jsx" cwd with env %o', async (env, runStdout) => {
    using dir = tempDir("jsx-tsconfig-nearest-dev", {
      ...shimFiles,
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "shim" } }),
      "app/tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsxdev", jsxImportSource: "shim" } }),
      "app/m.jsx": shimFiles["m.jsx"],
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "app/m.jsx"],
      env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined, ...env },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: runStdout, exitCode: 0 });
  });
});

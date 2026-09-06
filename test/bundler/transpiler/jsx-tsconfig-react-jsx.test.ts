import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

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

  // https://github.com/oven-sh/bun/issues/28605: a workspace root with no
  // tsconfig at all used to make every file fall back to importing from "react".
  test("jsxImportSource of a package's tsconfig applies when run from a workspace root without one", async () => {
    using dir = tempDir("jsx-tsconfig-workspace-root", {
      ...shimFiles,
      "package.json": JSON.stringify({ private: true, workspaces: ["services/connect"] }),
      "services/connect/tsconfig.json": JSON.stringify({
        compilerOptions: { jsx: "react-jsx", jsxImportSource: "shim" },
      }),
      "services/connect/src/app.ts": `import "./lib/prompt.tsx";`,
      "services/connect/src/lib/prompt.tsx": `export const prompt = <div>hello</div>;`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "./services/connect/src/app.ts"],
      env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "prod jsx", exitCode: 0 });
  });

  // A jsx field the nearest tsconfig leaves unset is filled from the same base
  // pragma `bun build` seeds its per-file settings from (today: the cwd's
  // tsconfig folded into the process-wide options). Only agreement between the
  // two is asserted, so the base itself can change without touching this test.
  test("a jsx field the nearest tsconfig leaves unset resolves like bun build", async () => {
    const jsxRuntimePackage = (name: string) => ({
      [`node_modules/${name}/package.json`]: JSON.stringify({
        name,
        version: "1.0.0",
        type: "module",
        exports: { "./jsx-runtime": "./rt.js", "./jsx-dev-runtime": "./rt.js" },
      }),
      [`node_modules/${name}/rt.js`]: `
        export const Fragment = Symbol.for("F");
        export const jsx = () => (console.log(${JSON.stringify(name)}), {});
        export const jsxs = jsx;
        export const jsxDEV = jsx;
      `,
    });
    using dir = tempDir("jsx-tsconfig-merge-base", {
      ...jsxRuntimePackage("react"),
      ...jsxRuntimePackage("root-runtime"),
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "root-runtime" } }),
      // Sets jsx but not jsxImportSource, and does not extend the root.
      "app/tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
      "app/m.jsx": `export const el = <div />;`,
    });

    await using run = Bun.spawn({
      cmd: [bunExe(), "run", "app/m.jsx"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "app/m.jsx", "--external", "react/*", "--external", "root-runtime/*"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "inherit",
    });
    const [runStdout, runExitCode, buildStdout, buildExitCode] = await Promise.all([
      run.stdout.text(),
      run.exited,
      build.stdout.text(),
      build.exited,
    ]);
    const buildImportSource = buildStdout.match(/from "([^"]+)\/jsx(?:-dev)?-runtime"/)?.[1];
    expect(["react", "root-runtime"]).toContain(buildImportSource);
    expect({ runtimeImportSource: runStdout.trim(), runExitCode, buildExitCode }).toEqual({
      runtimeImportSource: buildImportSource!,
      runExitCode: 0,
      buildExitCode: 0,
    });
  });

  // Two packages with their own tsconfig, each with a `paths` alias and a
  // jsxImportSource, one importing the other. `paths` was already resolved per
  // file; jsxImportSource has to be too, so both markers agree with `bun build`
  // from any cwd, including one that has no tsconfig of its own but whose
  // parent does (packages/a/src).
  describe("cross-package matrix", () => {
    const runtime = (name: string) => ({
      [`node_modules/${name}/package.json`]: JSON.stringify({
        name,
        version: "1.0.0",
        type: "module",
        exports: { "./jsx-runtime": "./rt.js", "./jsx-dev-runtime": "./rt.js" },
      }),
      [`node_modules/${name}/rt.js`]: `
        export const Fragment = Symbol.for("F");
        export const jsx = () => ${JSON.stringify(name)};
        export const jsxs = jsx;
        export const jsxDEV = jsx;
      `,
    });
    const tsconfig = (jsxImportSource: string, pathsDir: string) =>
      JSON.stringify({
        compilerOptions: { jsx: "react-jsx", jsxImportSource, baseUrl: ".", paths: { "@m/*": [`${pathsDir}/*`] } },
      });
    const files = {
      ...runtime("react"),
      ...runtime("jsxA"),
      ...runtime("jsxB"),
      "tsconfig.json": tsconfig("react", "rootm"),
      "rootm/x.ts": `export default "rootm";`,
      "packages/a/tsconfig.json": tsconfig("jsxA", "am"),
      "packages/a/am/x.ts": `export default "am";`,
      "packages/a/src/x.tsx": `
        import m from "@m/x";
        import { y } from "../../b/src/y.tsx";
        console.log(JSON.stringify({ a: { paths: m, jsx: <i /> }, b: y }));
      `,
      "packages/b/tsconfig.json": tsconfig("jsxB", "bm"),
      "packages/b/bm/x.ts": `export default "bm";`,
      "packages/b/src/y.tsx": `
        import m from "@m/x";
        export const y = { paths: m, jsx: <i /> };
      `,
    };
    const expected = { a: { paths: "am", jsx: "jsxA" }, b: { paths: "bm", jsx: "jsxB" } };

    test.concurrent.each([".", "packages/a", "packages/b", "packages/a/src"])("bun run from %s", async cwd => {
      using dir = tempDir("jsx-tsconfig-matrix", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", path.join(String(dir), "packages/a/src/x.tsx")],
        env: bunEnv,
        cwd: path.join(String(dir), cwd),
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect({ out: JSON.parse(stdout), exitCode }).toEqual({ out: expected, exitCode: 0 });
    });

    test.concurrent("bun build agrees", async () => {
      using dir = tempDir("jsx-tsconfig-matrix-build", files);
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "build",
          "packages/a/src/x.tsx",
          "--external",
          "react/*",
          "--external",
          "jsxA/*",
          "--external",
          "jsxB/*",
        ],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect({
        importSources: [...stdout.matchAll(/from "(\w+)\/jsx-runtime"/g)].map(m => m[1]).sort(),
        pathsMarkers: [...stdout.matchAll(/"(rootm|am|bm)"/g)].map(m => m[1]).sort(),
        exitCode,
      }).toEqual({ importSources: ["jsxA", "jsxB"], pathsMarkers: ["am", "bm"], exitCode: 0 });
    });
  });
});

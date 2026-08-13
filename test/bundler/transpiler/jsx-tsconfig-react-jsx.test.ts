import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

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
    export const createElement = () => (console.log("shim createElement"), {});
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

const noNodeEnv = { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined };

// Nothing is installed in these directories: bundled mode marks every import external, so both
// modes leave the JSX runtime imports in the output, where the test reads them back.
const buildModes = [
  ["bun build", ["--external", "*"]],
  ["bun build --no-bundle", ["--no-bundle"]],
] as const;

/** The module specifiers some transpiled or bundled output imports, sorted. */
function importsOf(code: string): string[] {
  return [...code.matchAll(/ from "([^"]+)"/g)].map(m => m[1]).sort();
}

async function buildImports(
  cwd: string,
  args: readonly string[],
  env: Record<string, string | undefined> = noNodeEnv,
): Promise<{ imports: string[]; exitCode: number }> {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", ...args],
    env,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  // stderr is drained but not asserted: the key-after-spread fixture logs a deprecation warning there.
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { imports: importsOf(stdout), exitCode };
}

// A tsconfig.json that does not choose between "react-jsx" and "react-jsxdev" must leave the
// dev/prod choice to NODE_ENV, exactly like having no tsconfig.json (and like `bun run`, which
// already behaved that way). `bun build` used to switch to the development runtime as soon as any
// tsconfig.json existed.
describe("bun build: NODE_ENV=production with a tsconfig.json that does not choose dev/prod", () => {
  const productionEnv = { ...noNodeEnv, NODE_ENV: "production" };

  const layouts = [
    ["no tsconfig.json", {}, "react/jsx-runtime"],
    ["empty compilerOptions", { "tsconfig.json": JSON.stringify({ compilerOptions: {} }) }, "react/jsx-runtime"],
    [
      '"jsx": "preserve"',
      { "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "preserve" } }) },
      "react/jsx-runtime",
    ],
    [
      "only jsxImportSource",
      { "tsconfig.json": JSON.stringify({ compilerOptions: { jsxImportSource: "shim" } }) },
      "shim/jsx-runtime",
    ],
  ] as const;

  for (const [mode, modeArgs] of buildModes) {
    test.concurrent.each(layouts)(`${mode}, %s`, async (_, files, runtime) => {
      using dir = tempDir("jsx-tsconfig-node-env", { "m.jsx": shimFiles["m.jsx"], ...files });
      expect(await buildImports(String(dir), [...modeArgs, "m.jsx"], productionEnv)).toEqual({
        imports: [runtime],
        exitCode: 0,
      });
    });

    test.concurrent(`${mode}, empty compilerOptions, --define process.env.NODE_ENV`, async () => {
      using dir = tempDir("jsx-tsconfig-define", {
        "m.jsx": shimFiles["m.jsx"],
        "tsconfig.json": JSON.stringify({ compilerOptions: {} }),
      });
      const args = [...modeArgs, "--define", 'process.env.NODE_ENV="production"', "m.jsx"];
      expect(await buildImports(String(dir), args)).toEqual({ imports: ["react/jsx-runtime"], exitCode: 0 });
    });
  }
});

// A key after a {...spread} makes the automatic runtime fall back to `createElement`, imported from
// the jsxImportSource package itself rather than from its /jsx-runtime entry. Both imports have to
// follow jsxImportSource. Merging a tsconfig into the JSX settings used to carry only the runtime
// import, and every entry point merges: Bun.build() and Bun.Transpiler always, the CLI as soon as a
// bunfig.toml or --jsx-* flag is present, "extends" chains, and (at build time) a tsconfig.json in
// the entry point's own directory. The plain CLI case only worked because the root tsconfig.json was
// copied over the JSX settings wholesale, which is what broke NODE_ENV above; now it merges too.
describe("tsconfig jsxImportSource selects the createElement fallback import too", () => {
  const keyAfterSpread = `const p = {};\nglobalThis.a = <div {...p} key="k" />;\nglobalThis.b = <span />;\n`;
  const tsconfig = JSON.stringify({ compilerOptions: { jsxImportSource: "shim" } });
  const shimImports = ["shim", "shim/jsx-dev-runtime"];
  // The in-process cases below share this test process's env loader, where NODE_ENV/BUN_ENV pick
  // the runtime entry; the load-bearing import here is the "shim" createElement fallback.
  const shimImportsAnyEnv = ["shim", expect.stringMatching(/^shim\/jsx(-dev)?-runtime$/)];

  // [name, entry point, files]. `bun run` only applies the project root's tsconfig.json, so the
  // layout whose tsconfig.json lives next to the entry point is exercised by the build paths only.
  const layouts = [
    ["tsconfig.json", "k.jsx", { "k.jsx": keyAfterSpread, "tsconfig.json": tsconfig }],
    [
      "tsconfig.json extending a base config",
      "k.jsx",
      {
        "k.jsx": keyAfterSpread,
        "tsconfig.json": JSON.stringify({ extends: "./base.json", compilerOptions: { jsxImportSource: "shim" } }),
        "base.json": JSON.stringify({ compilerOptions: {} }),
      },
    ],
    [
      "tsconfig.json next to a bunfig.toml",
      "k.jsx",
      { "k.jsx": keyAfterSpread, "tsconfig.json": tsconfig, "bunfig.toml": "# any bunfig.toml, jsx keys or not\n" },
    ],
    [
      "tsconfig.json in the entry point's directory",
      "sub/k.jsx",
      { "sub/k.jsx": keyAfterSpread, "sub/tsconfig.json": tsconfig },
    ],
  ] as const;
  const rootLayouts = layouts.filter(([, entry]) => entry === "k.jsx");

  for (const [mode, modeArgs] of buildModes) {
    test.concurrent.each(layouts)(`${mode}, %s`, async (_, entry, files) => {
      using dir = tempDir("jsx-import-source", files);
      expect(await buildImports(String(dir), [...modeArgs, entry])).toEqual({ imports: shimImports, exitCode: 0 });
    });
  }

  test.concurrent.each(layouts)("Bun.build(), %s", async (_, entry, files) => {
    using dir = tempDir("jsx-import-source-api", files);
    const result = await Bun.build({ entrypoints: [join(String(dir), entry)], external: ["*"] });
    expect(importsOf(await result.outputs[0].text())).toEqual(shimImportsAnyEnv);
  });

  test.concurrent.each(rootLayouts)("bun run, %s", async (_, entry, files) => {
    using dir = tempDir("jsx-import-source-run", { ...shimFiles, ...files });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", entry],
      env: noNodeEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "shim createElement\ndev jsxDEV", exitCode: 0 });
  });

  test("Bun.Transpiler({ tsconfig })", async () => {
    const transpiler = new Bun.Transpiler({
      loader: "jsx",
      autoImportJSX: true,
      // Otherwise the key-after-spread warning is thrown.
      logLevel: "error",
      tsconfig: { compilerOptions: { jsxImportSource: "shim" } },
    });
    expect(importsOf(transpiler.transformSync(keyAfterSpread))).toEqual(shimImportsAnyEnv);
    expect(importsOf(await transpiler.transform(keyAfterSpread))).toEqual(shimImportsAnyEnv);
  });
});

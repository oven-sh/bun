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

  // The Solid.js JSX transform was removed in 88538b7c2c. The parser only knows
  // the classic and automatic runtimes, so "solid-js" must not select anything else.
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
  test.each(["react-jsx", "preserve"])(
    'Bun.Transpiler with jsx "%s" and jsxImportSource "solid-js" uses the automatic runtime',
    jsx => {
      const transpiler = new Bun.Transpiler({
        loader: "tsx",
        autoImportJSX: true,
        tsconfig: { compilerOptions: { jsx, jsxImportSource: "solid-js" } },
      });
      const out = transpiler.transformSync(`export default <div>hi</div>;`);
      expect(out).toMatch(/^import \{ jsx(DEV)? as \w+ \} from "solid-js\/jsx(-dev)?-runtime";\n/);
      expect(out).toMatch(/\nexport default jsx(DEV)?_\w+\("div"/);
      expect(out).not.toContain("React.createElement");
    },
  );
});

// https://github.com/oven-sh/bun/issues/38050
describe("a tsconfig.json that states no development or production runtime", () => {
  test.concurrent.each([
    ["no compilerOptions.jsx", {}],
    ['"jsx": "preserve"', { jsx: "preserve" }],
    ["jsxImportSource alone", { jsxImportSource: "react" }],
  ] as const)("%s leaves the runtime to NODE_ENV=production", async (_, compilerOptions) => {
    using dir = tempDir("jsx-tsconfig-node-env", {
      "tsconfig.json": JSON.stringify({ compilerOptions }),
      "m.jsx": `export const a = <div p="1">x</div>;\n`,
    });
    const build = async (...flags: string[]) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", ...flags, "m.jsx"],
        env: { ...bunEnv, NODE_ENV: "production", BUN_ENV: undefined },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { runtime: stdout.match(/"react\/jsx(-dev)?-runtime"/)?.[0], exitCode };
    };
    const [bundled, transpiled] = await Promise.all([build("--external", "react*"), build("--no-bundle")]);
    const production = { runtime: '"react/jsx-runtime"', exitCode: 0 };
    expect({ bundled, transpiled }).toEqual({ bundled: production, transpiled: production });
  });
});

// A "key" after a spread is compiled to createElement, imported from the package that jsxImportSource names.
describe("jsxImportSource and the createElement fallback", () => {
  const source = `const p = {};\nexport const a = <div {...p} key="k" />;\nexport const b = <span>x</span>;\n`;
  const tsconfig = (compilerOptions: object, rest: object = {}) => JSON.stringify({ ...rest, compilerOptions });
  const tsrc = tsconfig({ jsx: "react-jsx", jsxImportSource: "tsrc" });

  // [name, the files beside index.tsx, the flags, the runtime module and the package of createElement]
  test.concurrent.each([
    ["tsconfig.json alone", { "tsconfig.json": tsrc }, [], ["tsrc/jsx-runtime", "tsrc"]],
    [
      "tsconfig.json beside a bunfig.toml without a JSX key",
      { "tsconfig.json": tsrc, "bunfig.toml": `[install]\nsaveTextLockfile = true\n` },
      [],
      ["tsrc/jsx-runtime", "tsrc"],
    ],
    [
      "tsconfig.json beside --jsx-runtime",
      { "tsconfig.json": tsrc },
      ["--jsx-runtime=automatic"],
      ["tsrc/jsx-runtime", "tsrc"],
    ],
    [
      "a tsconfig.json that extends one with another package",
      {
        "base.json": tsconfig({ jsx: "react-jsx", jsxImportSource: "base" }),
        "tsconfig.json": tsconfig({ jsxImportSource: "leaf" }, { extends: "./base.json" }),
      },
      [],
      ["leaf/jsx-runtime", "leaf"],
    ],
    ["bunfig.toml alone", { "bunfig.toml": `jsxImportSource = "bsrc"\n` }, [], ["bsrc/jsx-dev-runtime", "bsrc"]],
  ] as const)("%s", async (_, files, flags, imports) => {
    using dir = tempDir("jsx-import-source-package", { ...files, "index.tsx": source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", ...flags, "index.tsx"],
      env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ imports: [...stdout.matchAll(/ from "([^"]+)";/g)].map(m => m[1]), exitCode }).toEqual({
      imports: [...imports],
      exitCode: 0,
    });
  });

  test("Bun.Transpiler takes both from the tsconfig it is given", () => {
    const transpiler = new Bun.Transpiler({
      loader: "tsx",
      autoImportJSX: true,
      // A "key" after a spread logs a warning, and a warning fails a transform.
      logLevel: "error",
      tsconfig: { compilerOptions: { jsx: "react-jsx", jsxImportSource: "tsrc" } },
    });
    expect(transpiler.transformSync(`export default <div {...props} key="k" />;`)).toMatch(
      /^import \{ createElement as \w+ \} from "tsrc";\n/,
    );
    expect(transpiler.scanImports(`export default <div>hello</div>;`)).toEqual([
      { kind: "require-call", path: "tsrc/jsx-runtime" },
      { kind: "require-call", path: "tsrc" },
    ]);
  });
});

describe("--jsx-* flags beside a bunfig.toml", () => {
  test.concurrent.each([
    ["bun", []],
    ["bun run", ["run"]],
  ] as const)("a flag wins over bunfig.toml in `%s <file>`", async (_, run) => {
    using dir = tempDir("jsx-flag-over-bunfig", {
      "bunfig.toml": `jsx = "react"\njsxFactory = "fromBunfig"\n`,
      "m.jsx": `
        globalThis.fromBunfig = () => "bunfig.toml";
        globalThis.fromFlag = () => "flag";
        console.log(<div />);
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...run, "--jsx-factory=fromFlag", "m.jsx"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({ stdout: "flag\n", exitCode: 0 });
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
    expect(stderr).toContain("Invalid jsx runtime, only 'react', 'react-jsx', and 'react-jsxDEV' are supported");
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
    expect(stderr).toContain('Invalid --jsx-runtime: "solid", expected "automatic" or "classic"');
    expect(exitCode).toBe(1);
  });
});

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

// `BUN_ENV`, else `NODE_ENV`, names the mode. An empty value names no mode, and
// an empty `BUN_ENV` does not hide `NODE_ENV`.
describe("NODE_ENV and BUN_ENV", () => {
  type Mode = { NODE_ENV?: string; BUN_ENV?: string };

  const prod = "shim/jsx-runtime";
  const dev = "shim/jsx-dev-runtime";
  const both = (value: string) => `["${value}", "${value}"]`;

  const reactJsx = {
    ...shimFiles,
    "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "shim" } }),
    "mode.jsx": `export const element = <div />;\nexport const mode = [process.env.NODE_ENV, process.env.BUN_ENV];\n`,
  };
  // With no "jsx" in tsconfig.json, the mode selects the runtime.
  const noJsx = {
    ...shimFiles,
    "tsconfig.json": JSON.stringify({ compilerOptions: { jsxImportSource: "shim" } }),
    ".env.development": "FROM=development\n",
    ".env.production": "FROM=production\n",
    ".env.test": "FROM=test\n",
    "run.jsx": `globalThis.s = <div />;\nconsole.log(process.env.FROM);\n`,
    "mode.test.jsx": `import { test } from "bun:test";
test("mode", () => {
  globalThis.s = <div />;
  console.log(JSON.stringify(process.env.NODE_ENV));
});
`,
  };

  async function bun(cwd: string, mode: Mode, argv: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...argv],
      env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined, ...mode },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  /** The runtime that a bundle of mode.jsx imports, and what replaced `mode`. */
  const bundled = (stdout: string) => ({
    runtime: stdout.match(/from "(shim\/[^"]+)"/)?.[1],
    mode: stdout.match(/^var mode = (.+);$/m)?.[1],
  });

  const rows: [mode: Mode, args: string[], runtime: string, inlined: string][] = [
    [{}, [], prod, both("development")],
    [{ NODE_ENV: "" }, [], prod, both("development")],
    [{ BUN_ENV: "" }, [], prod, both("development")],
    [{ NODE_ENV: "", BUN_ENV: "" }, [], prod, both("development")],
    [{ NODE_ENV: "" }, ["--env=inline"], prod, `["", "development"]`],
    [{ BUN_ENV: "", NODE_ENV: "production" }, [], prod, both("production")],
    [{ BUN_ENV: "", NODE_ENV: "test" }, [], prod, both("test")],
    [{ BUN_ENV: "", NODE_ENV: "development" }, [], dev, both("development")],
    [{ BUN_ENV: "development", NODE_ENV: "" }, [], dev, both("development")],
    [{ NODE_ENV: "development" }, [], dev, both("development")],
    [{}, ["--define", `process.env.NODE_ENV="development"`], dev, both("development")],
  ];
  const named = rows.map(row => [[JSON.stringify(row[0]), ...row[1]].join(" "), ...row] as const);

  test.concurrent.each(named)('bun build beside "react-jsx" with %s', async (_name, mode, args, runtime, inlined) => {
    using dir = tempDir("jsx-mode", reactJsx);
    const { stdout, stderr, exitCode } = await bun(String(dir), mode, [
      "build",
      "mode.jsx",
      "--external",
      "shim*",
      ...args,
    ]);
    expect({ ...bundled(stdout), stderr, exitCode }).toEqual({ runtime, mode: inlined, stderr: "", exitCode: 0 });
  });

  test.concurrent("bun build --env=PUBLIC_* with an empty BUN_ENV in .env takes the mode from NODE_ENV", async () => {
    using dir = tempDir("jsx-mode-dotenv", { ...reactJsx, ".env": "BUN_ENV=\n" });
    const { stdout, stderr, exitCode } = await bun(String(dir), { NODE_ENV: "production" }, [
      "build",
      "mode.jsx",
      "--external",
      "shim*",
      "--env=PUBLIC_*",
    ]);
    expect({ ...bundled(stdout), stderr, exitCode }).toEqual({
      runtime: prod,
      mode: both("production"),
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("bun build with an empty NODE_ENV bundles an import source that has only ./jsx-runtime", async () => {
    using dir = tempDir("jsx-mode-only", {
      "node_modules/only/package.json": JSON.stringify({
        name: "only",
        version: "1.0.0",
        type: "module",
        exports: { "./jsx-runtime": "./rt.js" },
      }),
      "node_modules/only/rt.js": `export const jsx = () => "the only runtime";\n`,
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "only" } }),
      "m.jsx": `console.log(<div />);\n`,
    });
    const { stdout, stderr, exitCode } = await bun(String(dir), { NODE_ENV: "" }, ["build", "m.jsx"]);
    expect(stderr).toBe("");
    expect(stdout).toContain(`"the only runtime"`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("Bun.build with an empty NODE_ENV keeps jsx.development: false", async () => {
    using dir = tempDir("jsx-mode-api", reactJsx);
    const { stdout, stderr, exitCode } = await bun(String(dir), { NODE_ENV: "" }, [
      "-e",
      `const result = await Bun.build({
        entrypoints: ["./mode.jsx"],
        external: ["shim*"],
        jsx: { runtime: "automatic", importSource: "shim", development: false },
      });
      process.stdout.write(await result.outputs[0].text());`,
    ]);
    expect({ ...bundled(stdout), stderr, exitCode }).toEqual({
      runtime: prod,
      mode: both("development"),
      stderr: "",
      exitCode: 0,
    });
  });

  // `bun run` also reads `.env.<mode>`.
  test.concurrent.each([
    [{ BUN_ENV: "", NODE_ENV: "production" }, "prod jsx", "production"],
    [{ BUN_ENV: "", NODE_ENV: "test" }, "dev jsxDEV", "test"],
    [{ BUN_ENV: "", NODE_ENV: "development" }, "dev jsxDEV", "development"],
    [{ BUN_ENV: "production", NODE_ENV: "" }, "prod jsx", "production"],
    [{ BUN_ENV: "" }, "dev jsxDEV", "development"],
    [{ NODE_ENV: "" }, "dev jsxDEV", "development"],
  ] as [Mode, string, string][])("bun run with %j", async (mode, runtime, dotenv) => {
    using dir = tempDir("jsx-mode-run", noJsx);
    const { stdout, stderr, exitCode } = await bun(String(dir), mode, ["run", "run.jsx"]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: `${runtime}\n${dotenv}\n`, stderr: "", exitCode: 0 });
  });

  // `.env` is read after `.env.<mode>` is chosen, so its NODE_ENV selects the runtime only.
  test.concurrent("bun run with an empty BUN_ENV takes the mode from NODE_ENV in .env", async () => {
    using dir = tempDir("jsx-mode-run-dotenv", { ...noJsx, ".env": "NODE_ENV=production\n" });
    const { stdout, stderr, exitCode } = await bun(String(dir), { BUN_ENV: "" }, ["run", "run.jsx"]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "prod jsx\ndevelopment\n", stderr: "", exitCode: 0 });
  });

  // `bun test` writes NODE_ENV=test only when NODE_ENV is absent: an empty one stays empty.
  test.concurrent.each([
    [{ BUN_ENV: "", NODE_ENV: "production" }, "prod jsx", "production"],
    [{ BUN_ENV: "" }, "dev jsxDEV", "test"],
    [{ NODE_ENV: "" }, "dev jsxDEV", ""],
  ] as [Mode, string, string][])("bun test with %j", async (mode, runtime, nodeEnv) => {
    using dir = tempDir("jsx-mode-test", noJsx);
    const { stdout, exitCode } = await bun(String(dir), mode, ["test", "mode.test.jsx"]);
    // The first line of stdout names the version of `bun test`.
    expect({ stdout: stdout.slice(stdout.indexOf("\n") + 1), exitCode }).toEqual({
      stdout: `${runtime}\n${JSON.stringify(nodeEnv)}\n`,
      exitCode: 0,
    });
  });
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

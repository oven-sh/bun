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

// A --jsx-* flag names a factory, a fragment, an import source or a runtime. A bunfig.toml can have no `jsx` key, or
// `jsx = "react"`. None of these says development or production. What says it: NODE_ENV, --production,
// "jsx": "react-jsx" or "react-jsxdev" in tsconfig.json, and `jsx = "react-jsx"` or "react-jsxDEV" in bunfig.toml.
describe.concurrent("a --jsx-* flag or a bunfig.toml without jsx does not choose dev or prod", () => {
  type Files = Record<string, string>;
  type Env = Record<string, string>;
  const importSource = "--jsx-import-source=shim";
  const tsconfig = (jsx: string) => ({ "tsconfig.json": JSON.stringify({ compilerOptions: { jsx } }) });
  const bunfig = (jsx: string) => ({ "bunfig.toml": `jsx = "${jsx}"\n` });
  const bunfigWithoutJsx = { "bunfig.toml": `telemetry = false\n` };
  const production = { NODE_ENV: "production" };

  async function spawned(cmd: string[], files: Files, env: Env) {
    using dir = tempDir("jsx-flags", { ...shimFiles, ...files });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd],
      env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined, ...env },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  const runtimesImportedBy = (output: string) =>
    Array.from(output.matchAll(/"([^"]+\/jsx(?:-dev)?-runtime)"/g), match => match[1]);

  test.each<[string, string[], string, Files?, Env?]>([
    ["no tsconfig.json", [importSource], "shim/jsx-dev-runtime"],
    ["no tsconfig.json", ["--jsx-import-source="], "react/jsx-dev-runtime"],
    ["no tsconfig.json", ["--jsx-runtime=automatic"], "react/jsx-dev-runtime"],
    ["no tsconfig.json", ["--jsx-factory=h"], "react/jsx-dev-runtime"],
    ["no tsconfig.json", ["--jsx-fragment=F"], "react/jsx-dev-runtime"],
    ["no tsconfig.json", ["--no-bundle", importSource], "shim/jsx-dev-runtime"],
    ["no tsconfig.json", [importSource, "--production"], "shim/jsx-runtime"],
    ['tsconfig.json "react-jsxdev"', [importSource], "shim/jsx-dev-runtime", tsconfig("react-jsxdev")],
    ['tsconfig.json "react-jsx"', [importSource], "shim/jsx-runtime", tsconfig("react-jsx")],
    ['tsconfig.json "react-jsx"', ["--no-bundle", importSource], "shim/jsx-runtime", tsconfig("react-jsx")],
    // Only "production" and "development" are a choice.
    ["NODE_ENV=test", [importSource], "shim/jsx-dev-runtime", {}, { NODE_ENV: "test" }],
    ["NODE_ENV=production", [importSource], "shim/jsx-runtime", {}, production],
    [
      'NODE_ENV=production, tsconfig.json "react-jsxdev"',
      [importSource],
      "shim/jsx-runtime",
      tsconfig("react-jsxdev"),
      production,
    ],
    [
      'NODE_ENV=production, bunfig.toml without jsx, tsconfig.json "react-jsxdev"',
      [],
      "react/jsx-runtime",
      { ...bunfigWithoutJsx, ...tsconfig("react-jsxdev") },
      production,
    ],
    // The file has a tsconfig.json of its own that does not choose, so --no-bundle reads what NODE_ENV chose.
    [
      'NODE_ENV=development, tsconfig.json "react-jsx", sub/tsconfig.json without jsx',
      ["--no-bundle", importSource],
      "shim/jsx-dev-runtime",
      { ...tsconfig("react-jsx"), "sub/tsconfig.json": "{}", "sub/m.jsx": shimFiles["m.jsx"] },
      { NODE_ENV: "development" },
    ],
    ['bunfig.toml jsx = "react-jsxDEV"', [importSource], "shim/jsx-dev-runtime", bunfig("react-jsxDEV")],
    ['bunfig.toml jsx = "react-jsx"', [importSource], "shim/jsx-runtime", bunfig("react-jsx")],
    [
      'bunfig.toml jsx = "react-jsxDEV", tsconfig.json "react-jsx"',
      [],
      "react/jsx-dev-runtime",
      { ...bunfig("react-jsxDEV"), ...tsconfig("react-jsx") },
    ],
    [
      'bunfig.toml jsx = "react-jsx", tsconfig.json "react-jsxdev"',
      [],
      "react/jsx-runtime",
      { ...bunfig("react-jsx"), ...tsconfig("react-jsxdev") },
    ],
    ["bunfig.toml without jsx", [importSource], "shim/jsx-dev-runtime", bunfigWithoutJsx],
    [
      'bunfig.toml without jsx, tsconfig.json "react-jsx"',
      [importSource],
      "shim/jsx-runtime",
      { ...bunfigWithoutJsx, ...tsconfig("react-jsx") },
    ],
    [
      'bunfig.toml without jsx, tsconfig.json "react-jsx"',
      [],
      "react/jsx-runtime",
      { ...bunfigWithoutJsx, ...tsconfig("react-jsx") },
    ],
    [
      'bunfig.toml jsx = "react", tsconfig.json "react-jsx"',
      [],
      "react/jsx-runtime",
      { ...bunfig("react"), ...tsconfig("react-jsx") },
    ],
  ])("%s: bun build %j imports %s", async (_, flags, expected, files = {}, env = {}) => {
    const entry = "sub/m.jsx" in files ? "sub/m.jsx" : "m.jsx";
    const { stdout, stderr, exitCode } = await spawned(["build", "--external", "*", ...flags, entry], files, env);
    expect({ imported: runtimesImportedBy(stdout), stderr, exitCode }).toEqual({
      imported: [expected],
      stderr: "",
      exitCode: 0,
    });
  });

  test('tsconfig.json "react-jsx": Bun.build() with jsx.development imports react/jsx-dev-runtime', async () => {
    const build = `const { outputs } = await Bun.build({ entrypoints: ["./m.jsx"], external: ["*"], jsx: { development: true } });\nconsole.log(await outputs[0].text());`;
    const { stdout, stderr, exitCode } = await spawned(["-e", build], tsconfig("react-jsx"), {});
    expect({ imported: runtimesImportedBy(stdout), stderr, exitCode }).toEqual({
      imported: ["react/jsx-dev-runtime"],
      stderr: "",
      exitCode: 0,
    });
  });

  const worker = {
    "worker.jsx": `const a = <div p="1">x</div>;\npostMessage("done");\n`,
    "main.js": `const worker = new Worker(new URL("./worker.jsx", import.meta.url).href);\nworker.onmessage = () => worker.terminate();\n`,
  };
  test.each<[string, string[], string, Files?, Env?]>([
    ["no tsconfig.json", [importSource, "m.jsx"], "dev jsxDEV"],
    ["no tsconfig.json", ["run", importSource, "m.jsx"], "dev jsxDEV"],
    ["no tsconfig.json", [importSource, "-e", `const a = <div p="1">x</div>;`], "dev jsxDEV"],
    ["a Worker", [importSource, "main.js"], "dev jsxDEV", worker],
    // `bun <file>` reads bunfig.toml before the flags, `bun run <file>` after them.
    ["bunfig.toml without jsx", [importSource, "m.jsx"], "dev jsxDEV", bunfigWithoutJsx],
    ["bunfig.toml without jsx", ["run", importSource, "m.jsx"], "dev jsxDEV", bunfigWithoutJsx],
    ['tsconfig.json "react-jsx"', [importSource, "m.jsx"], "prod jsx", tsconfig("react-jsx")],
    ["NODE_ENV=production", [importSource, "m.jsx"], "prod jsx", {}, production],
  ])("%s: bun %j prints %j", async (_, cmd, expected, files = {}, env = {}) => {
    const { stdout, stderr, exitCode } = await spawned(cmd, files, env);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: expected + "\n", stderr: "", exitCode: 0 });
  });

  const testFile = `import { test } from "bun:test";\ntest("jsx", () => {\n  globalThis.s = <div p="1">x</div>;\n});\n`;
  const testFiles = {
    "a.test.jsx": testFile,
    "b.test.jsx": testFile,
    "tsconfig.json": JSON.stringify({ compilerOptions: { jsxImportSource: "shim" } }),
  };
  // With a bunfig.toml, --parallel starts each worker with --jsx-* flags that nobody typed.
  test.each<[string, string[], string, Files]>([
    ["no bunfig.toml", [importSource], "dev jsxDEV", {}],
    ["bunfig.toml without jsx", [], "dev jsxDEV", bunfigWithoutJsx],
    ["bunfig.toml without jsx", ["--parallel=2"], "dev jsxDEV", bunfigWithoutJsx],
    ['bunfig.toml jsx = "react-jsxDEV"', [], "dev jsxDEV", bunfig("react-jsxDEV")],
    ['bunfig.toml jsx = "react-jsxDEV"', ["--parallel=2"], "dev jsxDEV", bunfig("react-jsxDEV")],
    ['bunfig.toml jsx = "react-jsx"', [], "prod jsx", bunfig("react-jsx")],
    ['bunfig.toml jsx = "react-jsx"', ["--parallel=2"], "prod jsx", bunfig("react-jsx")],
  ])("%s: each test file of bun test %j prints %j", async (_, flags, expected, files) => {
    const { stdout, stderr, exitCode } = await spawned(["test", ...flags], { ...testFiles, ...files }, {});
    expect({
      printed: (stdout + stderr).match(/dev jsxDEV|prod jsx/g),
      inWorkers: stdout.includes("PARALLEL"),
      exitCode,
    }).toEqual({ printed: [expected, expected], inWorkers: flags.includes("--parallel=2"), exitCode: 0 });
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

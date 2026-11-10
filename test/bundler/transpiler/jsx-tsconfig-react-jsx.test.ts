import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

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

// A bunfig.toml can have no `jsx` key, or `jsx = "react"`. `Bun.build()` can have no `jsx.development`. A --jsx-* flag
// of `bun build` names a factory, a fragment, an import source or a runtime. None of these says development or
// production. In a build, what says it is NODE_ENV, `define`, --production, "jsx": "react-jsx" or "react-jsxdev" in
// the tsconfig.json of the working directory, `jsx = "react-jsx"` or "react-jsxDEV" in bunfig.toml, and
// `jsx.development` or the runtime "react-jsx" or "react-jsxdev" of `Bun.build()`.
describe.concurrent("a bunfig.toml without jsx and Bun.build() without jsx.development leave dev or prod open", () => {
  type Files = Record<string, string>;
  type Env = Record<string, string>;
  type Build = { flags?: string[]; options?: string; cwd?: string; entry?: string };
  const importSource = "--jsx-import-source=shim";
  const tsconfig = (jsx: string, name = "tsconfig.json") => ({ [name]: JSON.stringify({ compilerOptions: { jsx } }) });
  const bunfig = (jsx: string) => ({ "bunfig.toml": `jsx = "${jsx}"\n` });
  const bunfigWithoutJsx = { "bunfig.toml": `telemetry = false\n` };
  const bunfigBesideReactJsx = { ...bunfigWithoutJsx, ...tsconfig("react-jsx") };
  const nodeEnv = (value: string) => `{ define: { "process.env.NODE_ENV": '"${value}"' } }`;
  const production = { NODE_ENV: "production" };
  const development = { NODE_ENV: "development" };
  const dev = "react/jsx-dev-runtime";
  const prod = "react/jsx-runtime";

  async function spawnedIn(cwd: string, cmd: string[], env: Env) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd],
      env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined, ...env },
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  async function spawned(cmd: string[], files: Files, env: Env) {
    using dir = tempDir("jsx-flags", { ...shimFiles, ...files });
    return await spawnedIn(String(dir), cmd, env);
  }
  const runtimesImportedBy = (output: string) =>
    Array.from(output.matchAll(/"([^"]+\/jsx(?:-dev)?-runtime)"/g), match => match[1]);
  const imports = (...runtimes: string[]) => ({ imported: runtimes, stderr: "", exitCode: 0 });
  const apiBuild = (options: string, entry = "m.jsx") =>
    `const { outputs } = await Bun.build({ entrypoints: ["./${entry}"], external: ["*"], ...${options} });\nconsole.log(await outputs[0].text());`;

  // `bun build` and `Bun.build()` in one directory.
  async function bothIn(files: Files, env: Env, { flags = [], options = "{}", cwd = ".", entry = "m.jsx" }: Build) {
    using dir = tempDir("jsx-both", { ...shimFiles, ...files });
    const imported = async (cmd: string[]) => {
      const { stdout, stderr, exitCode } = await spawnedIn(join(String(dir), cwd), cmd, env);
      return { imported: runtimesImportedBy(stdout), stderr, exitCode };
    };
    const [cli, api] = await Promise.all([
      imported(["build", "--external", "*", ...flags, entry]),
      imported(["-e", apiBuild(options, entry)]),
    ]);
    return { cli, api };
  }
  const inSub = { "sub/m.jsx": shimFiles["m.jsx"] };

  test.each<[string, string, Files?, Env?, Build?]>([
    ['tsconfig.json "react-jsx"', prod, tsconfig("react-jsx")],
    ['tsconfig.json "react-jsxdev"', dev, tsconfig("react-jsxdev")],
    ['tsconfig.json "preserve"', dev, tsconfig("preserve")],
    ["tsconfig.json without jsx", dev, { "tsconfig.json": "{}" }],
    ["no tsconfig.json", dev],
    ['NODE_ENV=test, tsconfig.json "react-jsx"', prod, tsconfig("react-jsx"), { NODE_ENV: "test" }],
    ['NODE_ENV=development, tsconfig.json "react-jsx"', dev, tsconfig("react-jsx"), development],
    ['NODE_ENV=production, tsconfig.json "react-jsx"', prod, tsconfig("react-jsx"), production],
    ["bunfig.toml without jsx", dev, bunfigWithoutJsx],
    ['bunfig.toml without jsx, tsconfig.json "react-jsx"', prod, bunfigBesideReactJsx],
    [
      'NODE_ENV=test, bunfig.toml without jsx, tsconfig.json "react-jsx"',
      prod,
      bunfigBesideReactJsx,
      { NODE_ENV: "test" },
    ],
    [
      'NODE_ENV=development, bunfig.toml without jsx, tsconfig.json "react-jsx"',
      dev,
      bunfigBesideReactJsx,
      development,
    ],
    [
      'NODE_ENV=development and a `define` of "test", bunfig.toml without jsx, tsconfig.json "react-jsx"',
      prod,
      bunfigBesideReactJsx,
      development,
      { flags: ["--define", 'process.env.NODE_ENV="test"'], options: nodeEnv("test") },
    ],
    // --jsx-side-effects is not one of the flags that say production.
    [
      'bunfig.toml without jsx, tsconfig.json "react-jsx", --jsx-side-effects and `sideEffects` with no other JSX setting',
      prod,
      bunfigBesideReactJsx,
      {},
      { flags: ["--jsx-side-effects"], options: "{ jsx: { sideEffects: true } }" },
    ],
    [
      'bunfig.toml without jsx, tsconfig.json "react-jsxdev", --jsx-side-effects and `sideEffects` with no other JSX setting',
      dev,
      { ...bunfigWithoutJsx, ...tsconfig("react-jsxdev") },
      {},
      { flags: ["--jsx-side-effects"], options: "{ jsx: { sideEffects: true } }" },
    ],
    [
      'bunfig.toml without jsx, tsconfig.json "react-jsxdev"',
      dev,
      { ...bunfigWithoutJsx, ...tsconfig("react-jsxdev") },
    ],
    ['bunfig.toml jsx = "react", tsconfig.json "react-jsx"', prod, { ...bunfig("react"), ...tsconfig("react-jsx") }],
    [
      'NODE_ENV=production, bunfig.toml without jsx, tsconfig.json "react-jsxdev"',
      prod,
      { ...bunfigWithoutJsx, ...tsconfig("react-jsxdev") },
      production,
    ],
    [
      'tsconfig.json extends a file with "react-jsx"',
      prod,
      { "tsconfig.json": `{ "extends": "./base.json" }`, ...tsconfig("react-jsx", "base.json") },
    ],
    // One value for the bundle, from the tsconfig.json of the working directory.
    [
      'tsconfig.json "react-jsx", the entry point under sub/tsconfig.json "react-jsxdev"',
      prod,
      { ...tsconfig("react-jsx"), ...tsconfig("react-jsxdev", "sub/tsconfig.json"), ...inSub },
      {},
      { entry: "sub/m.jsx" },
    ],
    [
      'bunfig.toml without jsx, tsconfig.json "react-jsx", the entry point under sub/tsconfig.json "react-jsxdev"',
      prod,
      { ...bunfigBesideReactJsx, ...tsconfig("react-jsxdev", "sub/tsconfig.json"), ...inSub },
      {},
      { entry: "sub/m.jsx" },
    ],
    [
      'tsconfig.json "react-jsx" in the directory above',
      dev,
      { ...tsconfig("react-jsx"), ...inSub },
      {},
      { cwd: "sub" },
    ],
    [
      'tsconfig.json "react-jsx" in the directory above a bunfig.toml without jsx',
      dev,
      { ...tsconfig("react-jsx"), ...inSub, "sub/bunfig.toml": bunfigWithoutJsx["bunfig.toml"] },
      {},
      { cwd: "sub" },
    ],
    [
      'tsconfig.json "react-jsx" in the directory above, named by --tsconfig-override and by `tsconfig`',
      prod,
      { ...tsconfig("react-jsx"), ...inSub },
      {},
      { flags: ["--tsconfig-override=../tsconfig.json"], options: `{ tsconfig: "../tsconfig.json" }`, cwd: "sub" },
    ],
    [
      'tsconfig.json "react-jsxdev", and --tsconfig-override and `tsconfig` name a file with "react-jsx"',
      prod,
      { ...tsconfig("react-jsxdev"), ...tsconfig("react-jsx", "build.json") },
      {},
      { flags: ["--tsconfig-override=build.json"], options: `{ tsconfig: "./build.json" }` },
    ],
    [
      'bunfig.toml without jsx, tsconfig.json "react-jsxdev", and --tsconfig-override and `tsconfig` name a file with "react-jsx"',
      prod,
      { ...bunfigWithoutJsx, ...tsconfig("react-jsxdev"), ...tsconfig("react-jsx", "build.json") },
      {},
      { flags: ["--tsconfig-override=build.json"], options: `{ tsconfig: "./build.json" }` },
    ],
  ])("%s: bun build and Bun.build() import %s", async (_, expected, files = {}, env = {}, build = {}) => {
    expect(await bothIn(files, env, build)).toEqual({ cli: imports(expected), api: imports(expected) });
  });

  // --no-bundle takes the value of each file from the tsconfig.json above that file. When that tsconfig.json does not
  // say, the working directory says.
  test.each<[string, string, Files]>([
    ["sub/tsconfig.json without jsx", prod, { "sub/tsconfig.json": "{}" }],
    ['sub/tsconfig.json "react-jsxdev"', dev, tsconfig("react-jsxdev", "sub/tsconfig.json")],
  ])(
    'bunfig.toml without jsx, tsconfig.json "react-jsx", %s: bun build --no-bundle sub/m.jsx imports %s',
    async (_, expected, files) => {
      const cmd = ["build", "--no-bundle", "sub/m.jsx"];
      const { stdout, stderr, exitCode } = await spawned(cmd, { ...bunfigBesideReactJsx, ...inSub, ...files }, {});
      expect({ imported: runtimesImportedBy(stdout), stderr, exitCode }).toEqual(imports(expected));
    },
  );

  // Where the two do not agree. `bun build` lets a tsconfig.json that does not choose go before NODE_ENV=production
  // (#38050). `Bun.build()` does not read the `jsx` and `define` keys of bunfig.toml (#19556).
  test.each<[string, string, string, Files, Env?]>([
    ["NODE_ENV=production, tsconfig.json without jsx", dev, prod, { "tsconfig.json": "{}" }, production],
    ['NODE_ENV=production, tsconfig.json "preserve"', dev, prod, tsconfig("preserve"), production],
    ['NODE_ENV=production, tsconfig.json "react-jsxdev"', dev, prod, tsconfig("react-jsxdev"), production],
    ['bunfig.toml jsx = "react-jsx"', prod, dev, bunfig("react-jsx")],
    [
      'bunfig.toml jsx = "react-jsxDEV", tsconfig.json "react-jsx"',
      dev,
      prod,
      { ...bunfig("react-jsxDEV"), ...tsconfig("react-jsx") },
    ],
    [
      'bunfig.toml jsx = "react-jsx", tsconfig.json "react-jsxdev"',
      prod,
      dev,
      { ...bunfig("react-jsx"), ...tsconfig("react-jsxdev") },
    ],
    [
      'bunfig.toml defines NODE_ENV "development", tsconfig.json "react-jsx"',
      dev,
      prod,
      { "bunfig.toml": `[define]\n"process.env.NODE_ENV" = "\\"development\\""\n`, ...tsconfig("react-jsx") },
    ],
  ])("%s: bun build imports %s, Bun.build() imports %s", async (_, cli, api, files, env = {}) => {
    expect(await bothIn(files, env, {})).toEqual({ cli: imports(cli), api: imports(api) });
  });

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
    ["bunfig.toml without jsx", [importSource], "shim/jsx-dev-runtime", bunfigWithoutJsx],
    [
      'bunfig.toml without jsx, tsconfig.json "react-jsx"',
      [importSource],
      "shim/jsx-runtime",
      { ...bunfigWithoutJsx, ...tsconfig("react-jsx") },
    ],
  ])("%s: bun build %j imports %s", async (_, flags, expected, files = {}, env = {}) => {
    const entry = "sub/m.jsx" in files ? "sub/m.jsx" : "m.jsx";
    const { stdout, stderr, exitCode } = await spawned(["build", "--external", "*", ...flags, entry], files, env);
    expect({ imported: runtimesImportedBy(stdout), stderr, exitCode }).toEqual(imports(expected));
  });

  test.each<[string, string, string, Files?]>([
    ["no tsconfig.json", "dev jsxDEV", "shim/jsx-dev-runtime"],
    ['tsconfig.json "react-jsx"', "prod jsx", "shim/jsx-runtime", tsconfig("react-jsx")],
  ])(
    "%s: bun build --jsx-import-source runs JSX in a macro with %j, as the bundle",
    async (_, ofMacro, expected, files = {}) => {
      const macro = {
        "macro.jsx": `export function made() {\n  globalThis.b = <b />;\n  return 1;\n}\n`,
        "entry.jsx": `import { made } from "./macro.jsx" with { type: "macro" };\nglobalThis.s = [made(), <a />];\n`,
      };
      const cmd = ["build", "--external", "shim/*", importSource, "entry.jsx"];
      const { stdout, stderr, exitCode } = await spawned(cmd, { ...macro, ...files }, {});
      expect({ ofMacro: stdout.split("\n")[0], imported: runtimesImportedBy(stdout), stderr, exitCode }).toEqual({
        ofMacro,
        ...imports(expected),
      });
    },
  );

  const stated = "{ jsx: { development: true } }";
  test.each<[string, string, string, Files?, Env?]>([
    ['tsconfig.json "react-jsx"', "{ jsx: {} }", prod, tsconfig("react-jsx")],
    ['tsconfig.json "react-jsx"', `{ jsx: { importSource: "shim" } }`, "shim/jsx-runtime", tsconfig("react-jsx")],
    ['tsconfig.json "react-jsx"', `{ jsx: { runtime: "automatic" } }`, prod, tsconfig("react-jsx")],
    ['tsconfig.json "react-jsx"', "{ jsx: { sideEffects: true } }", prod, tsconfig("react-jsx")],
    ['tsconfig.json "react-jsx"', `{ jsx: { fragment: "F" } }`, prod, tsconfig("react-jsx")],
    ['tsconfig.json "react-jsx"', `{ target: "bun" }`, prod, tsconfig("react-jsx")],
    // What the call says goes before the tsconfig.json.
    ['tsconfig.json "react-jsx"', stated, dev, tsconfig("react-jsx")],
    ['tsconfig.json "react-jsx"', `{ jsx: { runtime: "react-jsxdev" } }`, dev, tsconfig("react-jsx")],
    ['tsconfig.json "react-jsxdev"', "{ jsx: { development: false } }", prod, tsconfig("react-jsxdev")],
    ['tsconfig.json "react-jsxdev"', `{ jsx: { runtime: "react-jsx" } }`, prod, tsconfig("react-jsxdev")],
    // NODE_ENV goes before both.
    ['tsconfig.json "react-jsx"', nodeEnv("development"), dev, tsconfig("react-jsx")],
    ['tsconfig.json "react-jsx"', nodeEnv("test"), prod, tsconfig("react-jsx")],
    ['tsconfig.json "react-jsxdev"', nodeEnv("production"), prod, tsconfig("react-jsxdev")],
    ['NODE_ENV=production, tsconfig.json "react-jsx"', stated, prod, tsconfig("react-jsx"), production],
    // A `define` hides NODE_ENV=development of the environment.
    ['NODE_ENV=development, tsconfig.json "react-jsx"', nodeEnv("test"), prod, tsconfig("react-jsx"), development],
    ['tsconfig.json "react-jsx"', `{ env: "inline" }`, prod, tsconfig("react-jsx")],
    ['tsconfig.json "react-jsx"', `{ env: "disable" }`, prod, tsconfig("react-jsx")],
    // `env: "disable"` does not read the tsconfig.json a second time, so what the call says stays.
    ['tsconfig.json "react-jsx"', `{ env: "disable", jsx: { development: true } }`, dev, tsconfig("react-jsx")],
  ])("%s: Bun.build(%s) imports %s", async (_, options, expected, files = {}, env = {}) => {
    const { stdout, stderr, exitCode } = await spawned(["-e", apiBuild(options)], files, env);
    expect({ imported: runtimesImportedBy(stdout), stderr, exitCode }).toEqual(imports(expected));
  });

  // One import for the module of a plugin, one for the file on disk and one for the module in `files`.
  test.each<[string, string, string, Files, Env?]>([
    ['tsconfig.json "react-jsx"', "{}", prod, tsconfig("react-jsx")],
    [
      'NODE_ENV=development, tsconfig.json "react-jsx"',
      "{ jsx: { development: false } }",
      dev,
      tsconfig("react-jsx"),
      development,
    ],
  ])("%s: each module of Bun.build(%s) imports %s", async (_, options, expected, files, env = {}) => {
    const build = `
      const { outputs } = await Bun.build({
        entrypoints: ["./entry.jsx"],
        files: { "./entry.jsx": 'import "of-plugin";\\nimport "./m.jsx";\\nglobalThis.a = <a />;' },
        external: ["react/*"],
        plugins: [
          {
            name: "of-plugin",
            setup(build) {
              build.onResolve({ filter: /^of-plugin$/ }, () => ({ path: "b", namespace: "of-plugin" }));
              build.onLoad({ filter: /.*/, namespace: "of-plugin" }, () => ({ contents: "globalThis.b = <b />;", loader: "jsx" }));
            },
          },
        ],
        ...${options},
      });
      console.log(await outputs[0].text());`;
    const { stdout, stderr, exitCode } = await spawned(["-e", build], files, env);
    expect({ imported: runtimesImportedBy(stdout), stderr, exitCode }).toEqual(imports(expected, expected, expected));
  });

  // A server that imports an HTML file builds the page with a second transpiler.
  test('tsconfig.json "react-jsx": the server and the page of Bun.build() hold the production runtime', async () => {
    const files = {
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "shim" } }),
      "server.jsx": `import page from "./index.html";\nglobalThis.s = [page, <a />];\n`,
      "index.html": `<!doctype html><html><body><script type="module" src="./m.jsx"></script></body></html>`,
    };
    const build = `
      const { outputs } = await Bun.build({ entrypoints: ["./server.jsx"], target: "bun" });
      for (const output of outputs) {
        if (output.path.endsWith(".js")) console.log((await output.text()).match(/prod jsx|dev jsxDEV/)?.[0]);
      }`;
    const { stdout, stderr, exitCode } = await spawned(["-e", build], files, {});
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "prod jsx\nprod jsx\n", stderr: "", exitCode: 0 });
  });

  const only = (runtime: "rt" | "dev") => ({
    "node_modules/only/package.json": JSON.stringify({
      name: "only",
      exports: { [runtime === "rt" ? "./jsx-runtime" : "./jsx-dev-runtime"]: "./index.js" },
    }),
    "node_modules/only/index.js": shimFiles[`node_modules/shim/${runtime}.js`],
    "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "only" } }),
  });
  const buildAndRun = (options: string) => `
    const { success, logs, outputs } = await Bun.build({ entrypoints: ["./m.jsx"], throw: false, ...${options} });
    if (success) await import(URL.createObjectURL(outputs[0]));
    else console.log(logs.map(log => log.message).join("\\n"));`;

  // https://github.com/oven-sh/bun/issues/4227
  test('tsconfig.json "react-jsx": Bun.build() bundles an import source that has only ./jsx-runtime', async () => {
    const { stdout, stderr, exitCode } = await spawned(["-e", buildAndRun("{}")], only("rt"), {});
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "prod jsx\n", stderr: "", exitCode: 0 });
  });

  // An import source that has only ./jsx-dev-runtime needs one of these beside tsconfig.json "react-jsx".
  test.each([
    ["{}", `Could not resolve: "only/jsx-runtime". Maybe you need to "bun install"?`],
    [stated, "dev jsxDEV"],
    [`{ jsx: { runtime: "react-jsxdev" } }`, "dev jsxDEV"],
    [nodeEnv("development"), "dev jsxDEV"],
  ])('tsconfig.json "react-jsx", only ./jsx-dev-runtime: Bun.build(%s) says %j', async (options, expected) => {
    const { stdout, stderr, exitCode } = await spawned(["-e", buildAndRun(options)], only("dev"), {});
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: expected + "\n", stderr: "", exitCode: 0 });
  });

  // The same two import sources in `bun build` beside a bunfig.toml. NODE_ENV=development and `jsx = "react-jsxDEV"`
  // are the ways back for the one that has only ./jsx-dev-runtime.
  test.each<["jsx-runtime" | "jsx-dev-runtime", string, string, Files, Env?]>([
    ["jsx-runtime", "a bunfig.toml without jsx", "prod jsx", bunfigWithoutJsx],
    ["jsx-dev-runtime", "a bunfig.toml without jsx", `Could not resolve: "only/jsx-runtime"`, bunfigWithoutJsx],
    ["jsx-dev-runtime", "a bunfig.toml without jsx, NODE_ENV=development", "dev jsxDEV", bunfigWithoutJsx, development],
    ["jsx-dev-runtime", 'bunfig.toml jsx = "react-jsxDEV"', "dev jsxDEV", bunfig("react-jsxDEV")],
  ])('tsconfig.json "react-jsx", only ./%s, %s: bun build says %j', async (has, _, expected, files, env = {}) => {
    const source = only(has === "jsx-runtime" ? "rt" : "dev");
    const { stdout, stderr, exitCode } = await spawned(["build", "m.jsx"], { ...source, ...files }, env);
    const said = (stdout + stderr).match(/prod jsx|dev jsxDEV|Could not resolve: "[^"]+"/)?.[0];
    expect({ said, exitCode }).toEqual({ said: expected, exitCode: expected.startsWith("Could not resolve") ? 1 : 0 });
  });

  // A plugin that answers for react/jsx-dev-runtime only does not see the import of the production runtime.
  test.each<[string, string[]]>([
    ["{}", [prod]],
    [stated, []],
  ])(
    'tsconfig.json "react-jsx", a plugin for react/jsx-dev-runtime: Bun.build(%s) leaves %j',
    async (options, left) => {
      const build = `
      const { outputs } = await Bun.build({
        entrypoints: ["./m.jsx"],
        external: ["react", "react/*"],
        plugins: [
          {
            name: "own-runtime",
            setup(build) {
              build.onResolve({ filter: /^react\\/jsx-dev-runtime$/ }, () => ({ path: "dev", namespace: "own-runtime" }));
              build.onLoad({ filter: /.*/, namespace: "own-runtime" }, () => ({ contents: "export const jsxDEV = () => ({});", loader: "js" }));
            },
          },
        ],
        ...${options},
      });
      console.log(await outputs[0].text());`;
      const { stdout, stderr, exitCode } = await spawned(["-e", build], tsconfig("react-jsx"), {});
      expect({ imported: runtimesImportedBy(stdout), stderr, exitCode }).toEqual(imports(...left));
    },
  );

  const testFile = `import { test } from "bun:test";\ntest("jsx", () => {\n  globalThis.s = <div p="1">x</div>;\n});\n`;
  // Outside `bun build`, --jsx-import-source selects the production runtime, as it has since 1.2.3. So do
  // --jsx-runtime, --jsx-factory and --jsx-fragment. `bun run <file>` reads bunfig.toml after the flags, and the
  // bunfig.toml then decides.
  test.each<[string, string[], string, Files?]>([
    ["no bunfig.toml", [importSource, "m.jsx"], "prod jsx\n"],
    ["no bunfig.toml", ["run", importSource, "m.jsx"], "prod jsx\n"],
    ["bunfig.toml without jsx", [importSource, "m.jsx"], "prod jsx\n", bunfigWithoutJsx],
    ["bunfig.toml without jsx", ["run", importSource, "m.jsx"], "dev jsxDEV\n", bunfigWithoutJsx],
    ["a test file", ["test", importSource], "prod jsx\n", { "a.test.jsx": testFile }],
  ])("%s: bun %j prints %j", async (_, cmd, expected, files = {}) => {
    const { stdout, exitCode } = await spawned(cmd, files, {});
    expect({ stdout, exitCode }).toEqual({ stdout: expect.stringContaining(expected), exitCode: 0 });
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

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { symlinkSync } from "node:fs";
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

// https://github.com/oven-sh/bun/issues/15844
describe("an option that bunfig.toml or a --jsx-* flag states is not taken from tsconfig.json", () => {
  const runtimeOf = (name: string) => ({
    [`node_modules/${name}/jsx-runtime.js`]: `export const jsx = () => "${name} jsx", jsxs = jsx, Fragment = "";`,
    [`node_modules/${name}/jsx-dev-runtime.js`]: `export const jsxDEV = () => "${name} jsxDEV", Fragment = "";`,
  });
  const files = {
    ...runtimeOf("from-tsconfig"),
    ...runtimeOf("stated"),
    "m.jsx": `
      Object.assign(globalThis, {
        React: { createElement: () => "React.createElement" },
        stated: () => "stated",
        fromTsconfig: () => "fromTsconfig",
      });
      console.log(<div />);
    `,
  };
  const automatic = { jsx: "react-jsx", jsxImportSource: "from-tsconfig" };
  const automaticDev = { jsx: "react-jsxdev", jsxImportSource: "from-tsconfig" };

  // [name, compilerOptions, bunfig.toml, flags, what the element prints, what the compiled element names]
  const cases = [
    [
      "bunfig.toml: jsx and jsxFactory",
      automatic,
      `jsx = "react"\njsxFactory = "stated"\n`,
      [],
      "stated",
      `stated("div"`,
    ],
    [
      "bunfig.toml: jsxImportSource",
      automaticDev,
      `jsxImportSource = "stated"\n`,
      [],
      "stated jsxDEV",
      `from "stated/jsx-dev-runtime"`,
    ],
    [
      'bunfig.toml: jsx = "react-jsxDEV"',
      automatic,
      `jsx = "react-jsxDEV"\n`,
      [],
      "from-tsconfig jsxDEV",
      `from "from-tsconfig/jsx-dev-runtime"`,
    ],
    [
      "flags: --jsx-runtime and --jsx-factory",
      automatic,
      "",
      ["--jsx-runtime=classic", "--jsx-factory=stated"],
      "stated",
      `stated("div"`,
    ],
    [
      "flags: --jsx-import-source",
      automatic,
      "",
      ["--jsx-import-source=stated"],
      "stated jsx",
      `from "stated/jsx-runtime"`,
    ],
    // A flag with a value means the production runtime, and bunfig.toml states the same.
    [
      'bunfig.toml: jsx = "react-jsx" beside a flag',
      automaticDev,
      `jsx = "react-jsx"\n`,
      ["--jsx-import-source=stated"],
      "stated jsx",
      `from "stated/jsx-runtime"`,
    ],
    // tsconfig.json still decides what no other source states.
    [
      "bunfig.toml: only jsxImportSource beside a classic tsconfig.json",
      { jsx: "react", jsxFactory: "fromTsconfig" },
      `jsxImportSource = "stated"\n`,
      [],
      "fromTsconfig",
      `fromTsconfig("div"`,
    ],
    [
      "flags: an empty --jsx-import-source",
      automatic,
      "",
      ["--jsx-import-source="],
      "from-tsconfig jsx",
      `from "from-tsconfig/jsx-runtime"`,
    ],
  ] as const;

  test.concurrent.each(cases)("%s", async (_, compilerOptions, bunfig, flags, printed, compiled) => {
    using dir = tempDir("jsx-stated-over-tsconfig", {
      ...files,
      "tsconfig.json": JSON.stringify({ compilerOptions }),
      ...(bunfig && { "bunfig.toml": bunfig }),
    });
    const run = async (...cmd: string[]) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...cmd],
        env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, exitCode };
    };
    // The runtime, a bundle, and a file transpiled alone.
    const [ran, bundled, transpiled] = await Promise.all([
      run(...flags, "m.jsx"),
      run("build", ...flags, "m.jsx", "--external", "*"),
      run("build", ...flags, "--no-bundle", "m.jsx"),
    ]);
    const names = ({ stdout, exitCode }: { stdout: string; exitCode: number }) => ({
      compiled: stdout.includes(compiled),
      exitCode,
    });
    expect({ ran, bundled: names(bundled), transpiled: names(transpiled) }).toEqual({
      ran: { stdout: printed + "\n", exitCode: 0 },
      bundled: { compiled: true, exitCode: 0 },
      transpiled: { compiled: true, exitCode: 0 },
    });
  });

  test("only what the tsconfig.json of the project states gives way", async () => {
    const classic = (jsxFactory: string) => JSON.stringify({ compilerOptions: { jsx: "react", jsxFactory } });
    using dir = tempDir("jsx-stated-over-project-tsconfig", {
      // The tsconfig.json of the project, and the file that it extends.
      "tsconfig.json": JSON.stringify({ extends: "./base.json" }),
      "base.json": JSON.stringify({ compilerOptions: automatic }),
      "bunfig.toml": `jsx = "react"\njsxFactory = "stated"\n`,
      "m.jsx": `export const m = <div />;`,
      "nested/tsconfig.json": classic("fromNested"),
      "nested/n.jsx": `export const n = <div />;`,
      "extending/tsconfig.json": JSON.stringify({
        extends: "../base.json",
        compilerOptions: { jsxFragmentFactory: "own" },
      }),
      "extending/e.jsx": `export const e = [<div />, <></>];`,
      "named.json": classic("fromNamed"),
    });
    // The calls that the elements of a file compile to.
    const calls = async (...args: string[]) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--no-bundle", ...args],
        env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { calls: stdout.match(/\w+\(("div"|\w+)/g), exitCode };
    };
    const [project, nested, extending, named] = await Promise.all([
      calls("m.jsx"),
      calls("nested/n.jsx"),
      calls("extending/e.jsx"),
      calls("--tsconfig-override", "named.json", "m.jsx"),
    ]);
    expect({ project, nested, extending, named }).toEqual({
      project: { calls: ['stated("div"'], exitCode: 0 },
      // A tsconfig.json in a directory below keeps what it states itself, and so does the file of --tsconfig-override.
      nested: { calls: ['fromNested("div"'], exitCode: 0 },
      // What it takes with "extends" from a file of the project gives way: here the automatic runtime.
      extending: { calls: ['stated("div"', "stated(own"], exitCode: 0 },
      named: { calls: ['fromNamed("div"'], exitCode: 0 },
    });
  });

  test("a file of the project is the same file through a link to a directory", async () => {
    using dir = tempDir("jsx-stated-over-linked-tsconfig", {
      "real/tsconfig.json": JSON.stringify({ extends: "./base.json" }),
      // bunfig.toml states no fragment, so the one of this file shows that the file was read.
      "real/base.json": JSON.stringify({ compilerOptions: { ...automatic, jsxFragmentFactory: "fromBase" } }),
      "real/bunfig.toml": `jsx = "react"\njsxFactory = "stated"\n`,
      "real/m.jsx": `export const m = [<div />, <></>];`,
      // Through the link "real/app", "../tsconfig.json" is the tsconfig.json of the project.
      "real/packages/app/tsconfig.json": JSON.stringify({ extends: "../tsconfig.json" }),
      "real/packages/app/p.jsx": `export const p = [<div />, <></>];`,
    });
    const real = join(String(dir), "real");
    const link = join(String(dir), "link");
    symlinkSync(real, link, "junction");
    symlinkSync(join(real, "packages", "app"), join(real, "app"), "junction");
    const calls = async (file: string) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "--no-bundle", file],
        env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined },
        cwd: real,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { calls: stdout.match(/\w+\(("div"|\w+)/g), exitCode };
    };
    const [linkToProject, linkInProject] = await Promise.all([calls(join(link, "m.jsx")), calls(join("app", "p.jsx"))]);
    const ofProject = { calls: ['stated("div"', "stated(fromBase"], exitCode: 0 };
    expect({ linkToProject, linkInProject }).toEqual({ linkToProject: ofProject, linkInProject: ofProject });
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

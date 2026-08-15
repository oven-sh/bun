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

// A file's JSX settings are the tsconfig.json nearest to it merged over the settings given on the
// command line / in bunfig.toml / to Bun.build({ jsx }). The tsconfig.json of the directory the build
// is started from is not part of that base: it only applies to the files it governs, like in tsc.
// `bun build` (and Bun.build() / `bun build` with an --env option) used to merge each file's tsconfig
// over the cwd's tsconfig instead, so the cwd's jsxImportSource / jsxFactory / "jsx" filled in
// whatever a nested tsconfig.json left unset, and the same file built differently depending on the
// cwd and on whether it was built through the CLI or through Bun.build().
describe("the cwd tsconfig.json is not the base for files governed by another tsconfig.json", () => {
  const noNodeEnv = { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined };
  const element = `globalThis.a = <><div /></>;\n`;
  const tsconfig = (compilerOptions: Record<string, unknown>) => JSON.stringify({ compilerOptions });

  /**
   * What the output's JSX is wired to: the packages it imports its runtime from (the dev and prod
   * entries of a package are folded together: which one a file gets is decided by the cwd tsconfig
   * or NODE_ENV for the CLI and by the jsx option for Bun.build(), and is not what is under test
   * here) plus, for the classic runtime, which factory/fragment identifiers it calls. The fixtures'
   * cwd tsconfigs always name theirs cwdFactory/cwdFragment.
   */
  function runtimeRefsOf(code: string): string[] {
    const imports = [...code.matchAll(/ from "([^"]+)"/g)].map(m => m[1].replace(/\/jsx-dev-runtime$/, "/jsx-runtime"));
    const classic = [...code.matchAll(/\b(cwdFactory|cwdFragment|React\.createElement|React\.Fragment)\b/g)].map(
      m => m[1],
    );
    return [...new Set([...imports, ...classic])].sort();
  }

  interface Case {
    files: Record<string, string>;
    /** Directory inside the fixture to build from. */
    cwd?: string;
    entry: string;
    /** Passed as --jsx-import-source / jsx.importSource, i.e. part of the base the tsconfigs merge over. */
    jsxImportSource?: string;
    refs: string[];
  }

  const cases: [name: string, c: Case][] = [
    [
      'nested tsconfig sets "jsx": jsxImportSource is the default, not the cwd tsconfig\'s',
      {
        files: {
          "tsconfig.json": tsconfig({ jsx: "react-jsx", jsxImportSource: "cwd-src" }),
          "app/tsconfig.json": tsconfig({ jsx: "react-jsx" }),
          "app/m.jsx": element,
        },
        entry: "app/m.jsx",
        refs: ["react/jsx-runtime"],
      },
    ],
    [
      'nested tsconfig sets jsxImportSource: the runtime is the default automatic one, not the cwd tsconfig\'s "react"',
      {
        files: {
          "tsconfig.json": tsconfig({ jsx: "react", jsxFactory: "cwdFactory", jsxFragmentFactory: "cwdFragment" }),
          "app/tsconfig.json": tsconfig({ jsxImportSource: "nested-src" }),
          "app/m.jsx": element,
        },
        entry: "app/m.jsx",
        refs: ["nested-src/jsx-runtime"],
      },
    ],
    [
      'nested tsconfig sets "jsx": "react": the factories are the defaults, not the cwd tsconfig\'s',
      {
        files: {
          "tsconfig.json": tsconfig({ jsx: "react", jsxFactory: "cwdFactory", jsxFragmentFactory: "cwdFragment" }),
          "app/tsconfig.json": tsconfig({ jsx: "react" }),
          "app/m.jsx": element,
        },
        entry: "app/m.jsx",
        refs: ["React.Fragment", "React.createElement"],
      },
    ],
    [
      "file outside of every tsconfig gets the defaults",
      {
        files: {
          "proj/tsconfig.json": tsconfig({ jsx: "react-jsx", jsxImportSource: "cwd-src" }),
          "lib/m.jsx": element,
        },
        cwd: "proj",
        entry: "../lib/m.jsx",
        refs: ["react/jsx-runtime"],
      },
    ],
    [
      "the command line / Bun.build() jsxImportSource stays the base a nested tsconfig merges over",
      {
        files: {
          "tsconfig.json": tsconfig({ jsx: "react-jsx", jsxImportSource: "cwd-src" }),
          "app/tsconfig.json": tsconfig({ jsx: "react-jsx" }),
          "app/m.jsx": element,
        },
        entry: "app/m.jsx",
        jsxImportSource: "flag-src",
        refs: ["flag-src/jsx-runtime"],
      },
    ],
    [
      // A key after a {...spread} makes the automatic runtime fall back to createElement, imported
      // from the jsxImportSource package itself. Merging a tsconfig used to carry only the
      // /jsx-runtime import over; the CLI got this right only because the cwd tsconfig was copied
      // over the base wholesale, which is the copy that leaked it into every other file above.
      "the createElement fallback import follows the governing tsconfig's jsxImportSource as well",
      {
        files: {
          "tsconfig.json": tsconfig({ jsxImportSource: "shim" }),
          "k.jsx": `const p = {};\nglobalThis.a = <div {...p} key="k" />;\nglobalThis.b = <span />;\n`,
        },
        entry: "k.jsx",
        refs: ["shim", "shim/jsx-runtime"],
      },
    ],
  ];

  async function buildOutput(cmd: string[], cwd: string, env: Record<string, string | undefined> = noNodeEnv) {
    await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
    // stderr is drained but not asserted: the key-after-spread fixture prints a deprecation warning.
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, exitCode };
  }

  async function build(cmd: string[], cwd: string) {
    const { stdout, exitCode } = await buildOutput(cmd, cwd);
    return { refs: runtimeRefsOf(stdout), exitCode };
  }

  function cli(args: string[]) {
    return (cwd: string, c: Case) =>
      build(
        [
          bunExe(),
          "build",
          ...args,
          ...(c.jsxImportSource ? [`--jsx-import-source=${c.jsxImportSource}`] : []),
          c.entry,
        ],
        cwd,
      );
  }

  function api(options: Record<string, unknown>) {
    return (cwd: string, c: Case) => {
      const config = {
        entrypoints: [c.entry],
        ...(c.jsxImportSource ? { jsx: { importSource: c.jsxImportSource } } : {}),
        ...options,
      };
      const script = `const result = await Bun.build(${JSON.stringify(config)});\nconsole.write(await result.outputs[0].text());`;
      return build([bunExe(), "-e", script], cwd);
    };
  }

  type Mode = [name: string, run: (cwd: string, c: Case) => Promise<{ refs: string[]; exitCode: number }>];

  // Bundling modes mark everything external so the runtime imports stay visible in the output.
  // --env / env: "inline" reach the cwd tsconfig through a second code path (the env loader), so
  // they are covered separately.
  const modes: Mode[] = [
    ["bun build", cli(["--external", "*"])],
    ["bun build --no-bundle", cli(["--no-bundle"])],
    ["bun build --env=inline", cli(["--env=inline", "--external", "*"])],
    ["Bun.build()", api({ external: ["*"] })],
    ['Bun.build({ env: "inline" })', api({ external: ["*"], env: "inline" })],
  ];

  for (const [mode, run] of modes) {
    test.concurrent.each(cases)(`${mode}: %s`, async (_, c) => {
      using dir = tempDir("jsx-tsconfig-base", c.files);
      expect(await run(join(String(dir), c.cwd ?? ""), c)).toEqual({ refs: c.refs, exitCode: 0 });
    });
  }

  // With packages: "external", an import that matches a tsconfig "paths" alias is resolved by a
  // separate early return in the resolver (#29590). Files found that way are files on disk like any
  // other and get their own tsconfig: lib/ is governed by the cwd tsconfig, app/ by its own. (The
  // runtime packages themselves are bare imports, so packages: "external" keeps them visible.)
  const aliased: Case = {
    files: {
      "tsconfig.json": tsconfig({
        jsxImportSource: "cwd-src",
        paths: { "@lib/*": ["./lib/*"], "@app/*": ["./app/*"] },
      }),
      "app/tsconfig.json": tsconfig({ jsxImportSource: "nested-src" }),
      "lib/a.jsx": element,
      "app/b.jsx": element,
      "main.js": `import "@lib/a";\nimport "@app/b";\n`,
    },
    entry: "main.js",
    refs: ["cwd-src/jsx-runtime", "nested-src/jsx-runtime"],
  };
  const packagesExternalModes: Mode[] = [
    ["bun build --packages=external", cli(["--packages=external"])],
    ['Bun.build({ packages: "external" })', api({ packages: "external" })],
  ];
  test.concurrent.each(packagesExternalModes)(
    "%s: files reached through tsconfig paths aliases get their own tsconfig",
    async (_, run) => {
      using dir = tempDir("jsx-tsconfig-base-paths", aliased.files);
      expect(await run(String(dir), aliased)).toEqual({ refs: aliased.refs, exitCode: 0 });
    },
  );

  // The dev/prod bit is part of the base as well. Bundled builds then choose dev/prod per build from
  // the cwd tsconfig / NODE_ENV / --production (the force_node_env arms in bundle_v2), so the per-file
  // value only shows in --no-bundle, which emits it as is.
  describe("bun build --no-bundle", () => {
    const importsOf = (code: string) => [...code.matchAll(/ from "([^"]+)"/g)].map(m => m[1]);

    test.concurrent('a nested tsconfig without "jsx" does not inherit the cwd tsconfig\'s "react-jsx"', async () => {
      using dir = tempDir("jsx-tsconfig-base-dev", {
        "tsconfig.json": tsconfig({ jsx: "react-jsx" }),
        "app/tsconfig.json": tsconfig({ jsxImportSource: "nested-src" }),
        "app/m.jsx": element,
      });
      const { stdout, exitCode } = await buildOutput([bunExe(), "build", "--no-bundle", "app/m.jsx"], String(dir));
      expect({ imports: importsOf(stdout), exitCode }).toEqual({
        imports: ["nested-src/jsx-dev-runtime"],
        exitCode: 0,
      });
    });

    // NODE_ENV is applied to the base before the cwd tsconfig is read; copying the cwd tsconfig's
    // settings (development: true unless it sets "jsx") over the base used to discard it.
    test.concurrent('NODE_ENV=production survives a cwd tsconfig that does not set "jsx"', async () => {
      using dir = tempDir("jsx-tsconfig-base-node-env", {
        "tsconfig.json": tsconfig({ jsxImportSource: "shim" }),
        "m.jsx": element,
      });
      const { stdout, exitCode } = await buildOutput([bunExe(), "build", "--no-bundle", "m.jsx"], String(dir), {
        ...noNodeEnv,
        NODE_ENV: "production",
      });
      expect({ imports: importsOf(stdout), exitCode }).toEqual({ imports: ["shim/jsx-runtime"], exitCode: 0 });
    });
  });

  // A browser-side HTML entry point inside a server-side build is resolved by a second transpiler
  // derived from the main one, so its base has to be carried over without the cwd tsconfig too.
  // Nothing is external here, so the test reads back which runtime package got bundled in.
  test.concurrent("bun build --target=bun index.html", async () => {
    const runtimePackage = (name: string) => ({
      [`node_modules/${name}/package.json`]: JSON.stringify({
        name,
        exports: { "./jsx-runtime": "./runtime.js", "./jsx-dev-runtime": "./runtime.js" },
      }),
      [`node_modules/${name}/runtime.js`]: `
        export const Fragment = "RUNTIME_PACKAGE:${name}";
        export const jsx = () => Fragment;
        export const jsxs = jsx;
        export const jsxDEV = jsx;
      `,
    });
    using dir = tempDir("jsx-tsconfig-base-html", {
      ...runtimePackage("react"),
      ...runtimePackage("cwd-src"),
      "tsconfig.json": tsconfig({ jsx: "react-jsx", jsxImportSource: "cwd-src" }),
      "app/tsconfig.json": tsconfig({ jsx: "react-jsx" }),
      "app/m.jsx": element,
      "index.html": `<!doctype html><script type="module" src="./app/m.jsx"></script>`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--target=bun", "--outdir=out", "index.html"],
      cwd: String(dir),
      env: noNodeEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(stdout).toContain("index.html");

    const outputs = await Array.fromAsync(new Bun.Glob("*.js").scan(join(String(dir), "out")));
    expect(outputs).toHaveLength(1);
    const code = await Bun.file(join(String(dir), "out", outputs[0])).text();
    expect([...code.matchAll(/RUNTIME_PACKAGE:([\w-]+)/g)].map(m => m[1])).toEqual(["react"]);
  });
});

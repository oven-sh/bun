import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";
import { itBundled } from "./expectBundled";

for (let backend of ["api", "cli"] as const) {
  describe(`bundler/${backend}`, () => {
    // TODO: make this work as expected with process.env isntead of relying on the initial env vars.
    if (backend === "cli")
      itBundled("env/inline", {
        env: {
          FOO: "bar",
          BAZ: "123",
        },
        backend: backend,
        dotenv: "inline",
        files: {
          "/a.js": `
        console.log(process.env.FOO);
        console.log(process.env.BAZ);
      `,
        },
        run: {
          env: {
            FOO: "barz",
            BAZ: "123z",
          },
          stdout: "bar\n123\n",
        },
      });

    // A variable from the process environment (not a .env file) is inlined at build time. It has to be one this
    // process started with (the api backend builds in-process), spelled as the environment spells it (on Windows the
    // inlined name is case-sensitive even though process.env is not: `Path`, not `PATH`).
    const systemKey = ["HOME", "OS", "NUMBER_OF_PROCESSORS", "COMPUTERNAME", "USER", "LANG"].find(
      key => process.env[key] && /^[\x20-\x7e]+$/.test(process.env[key]!) && !/["`$\\]/.test(process.env[key]!),
    )!;
    const systemValue = process.env[systemKey]!;
    itBundled("env/inline system", {
      env: {
        [systemKey]: systemValue,
      },
      backend: backend,
      dotenv: "inline",
      files: {
        "/a.js": `
        console.log(process.env.${systemKey});
      `,
      },
      run: {
        env: {
          [systemKey]: "the run-time value, which inlining should have replaced",
        },
        stdout: systemValue + "\n",
      },
    });

    // Test disable mode - no env vars are inlined
    itBundled("env/disable", {
      env: {
        FOO: "bar",
        BAZ: "123",
      },
      backend: backend,
      dotenv: "disable",
      files: {
        "/a.js": `
        console.log(process.env.FOO);
        console.log(process.env.BAZ);
      `,
      },
      run: {
        stdout: "undefined\nundefined\n",
      },
    });

    // Disable mode also leaves the mode of the build out of a bundle for bun or node: it reads NODE_ENV when it runs.
    itBundled("env/disable-node-env", {
      backend: backend,
      dotenv: "disable",
      target: "node",
      files: {
        "/a.js": `
        console.log(JSON.stringify({ dot: process.env.NODE_ENV, bracket: process.env["NODE_ENV"] }));
      `,
      },
      onAfterBundle(api) {
        expect(api.readFile("out.js")).toContain("dot: process.env.NODE_ENV");
      },
      run: {
        env: { NODE_ENV: "production" },
        stdout: JSON.stringify({ dot: "production", bracket: "production" }) + "\n",
      },
    });

    if (backend === "api")
      itBundled("env/disable-node-env-compile", {
        backend: backend,
        dotenv: "disable",
        compile: true,
        files: {
          "/a.js": `
        console.log(JSON.stringify({ dot: process.env.NODE_ENV, bracket: process.env["NODE_ENV"] }));
      `,
        },
        run: {
          env: { NODE_ENV: "production" },
          stdout: JSON.stringify({ dot: "production", bracket: "production" }) + "\n",
        },
      });

    // TODO: make this work as expected with process.env isntead of relying on the initial env vars.
    // Test pattern matching - only vars with prefix are inlined
    if (backend === "cli")
      itBundled("env/pattern-matching", {
        env: {
          PUBLIC_FOO: "public_value",
          PUBLIC_BAR: "another_public",
          PRIVATE_SECRET: "secret_value",
        },
        dotenv: "PUBLIC_*",
        backend: backend,
        files: {
          "/a.js": `
        console.log(process.env.PUBLIC_FOO);
        console.log(process.env.PUBLIC_BAR);
        console.log(process.env.PRIVATE_SECRET);
      `,
        },
        run: {
          env: {
            PUBLIC_FOO: "BAD_FOO",
            PUBLIC_BAR: "BAD_BAR",
          },
          stdout: "public_value\nanother_public\nundefined\n",
        },
      });

    if (backend === "cli")
      // Test nested environment variable references
      itBundled("nested-refs", {
        env: {
          BASE_URL: "https://api.example.com",
          SHOULD_PRINT_BASE_URL: "process.env.BASE_URL",
          SHOULD_PRINT_$BASE_URL: "$BASE_URL",
        },
        dotenv: "inline",
        backend: backend,
        files: {
          "/a.js": `
      // Test nested references
      console.log(process.env.SHOULD_PRINT_BASE_URL);
      console.log(process.env.SHOULD_PRINT_$BASE_URL);
    `,
        },
        run: {
          env: {
            "BASE_URL": "https://api.example.com",
          },
          stdout: "process.env.BASE_URL\n$BASE_URL",
        },
      });
  });
}

// Assigning to a proxy variable in process.env updates the native env map and frees the old value.
test("Bun.build inlines the env values from when it was called", async () => {
  const atCall = "http://proxy-when-the-build-was-scheduled.example:1111/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const duringBuild = "http://proxy-assigned-while-bundling.example:2222/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  using dir = tempDir("bun-build-env-copy", {
    "entry.ts": "export {};",
    "build-fixture.ts": /* ts */ `
      process.env.HTTPS_PROXY = ${JSON.stringify(atCall)};
      const result = await Bun.build({
        entrypoints: ["./entry.ts"],
        env: "inline",
        plugins: [
          {
            name: "assign-proxy-env-while-bundling",
            setup(build) {
              build.onLoad({ filter: /entry\\.ts$/ }, () => {
                process.env.HTTPS_PROXY = ${JSON.stringify(duringBuild)};
                return { loader: "ts", contents: "console.log(process.env.HTTPS_PROXY);" };
              });
            },
          },
        ],
      });
      process.stdout.write(await result.outputs[0].text());
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build-fixture.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain(`console.log(${JSON.stringify(atCall)})`);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// The tests below build in a child process: a build takes its mode from the NODE_ENV its process started with,
// and `bun test` starts with NODE_ENV=test.
async function runBuildScript(cwd: string, env: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build-fixture.ts"],
    cwd,
    env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  let printed: unknown = stdout;
  try {
    printed = JSON.parse(stdout);
  } catch {}
  return { printed, stderr, exitCode };
}

// For the build-fixture.ts of a test: one Bun.build per named set of options, then `pick` reads each result.
const buildEachVariant = /* ts */ `
  const firstLog = text => text.split("\\n").find(line => line.startsWith("console.log("));
  async function buildEach(base, variants, pick = async result => firstLog(await result.outputs[0].text())) {
    const out = {};
    for (const [name, options] of Object.entries(variants)) out[name] = await pick(await Bun.build({ ...base, ...options }));
    return out;
  }
`;

describe("Bun.build env", () => {
  const source = `console.log(process.env.NODE_ENV, process.env.BUN_ENV, process.browser, process.env.PUBLIC_FOO, process.env.PRIVATE_BAR);`;
  // What "disable" makes of `source` in a bundle for bun or node: the process that runs it has NODE_ENV and BUN_ENV.
  const leftToTheRun = `console.log(process.env.NODE_ENV, process.env.BUN_ENV, false, process.env.PUBLIC_FOO, process.env.PRIVATE_BAR);`;

  for (const [name, env, mode] of [
    ["NODE_ENV unset", {}, "development"],
    ["NODE_ENV=development", { NODE_ENV: "development" }, "development"],
    ["NODE_ENV=production", { NODE_ENV: "production" }, "production"],
    ["BUN_ENV=staging", { BUN_ENV: "staging" }, "staging"],
  ] as const) {
    // A browser has no `process`, so a bundle for it keeps the mode of the build, as does every build that does not
    // pass the option: no `env` at all is not "disable".
    test.concurrent(`each value of the option, built with ${name}`, async () => {
      using dir = tempDir("bun-build-env-values", {
        "a.js": source,
        "build-fixture.ts": /* ts */ `
          ${buildEachVariant}
          const out = {};
          for (const target of [undefined, "browser", "bun", "node"]) {
            out[target ?? "no target"] = await buildEach({ entrypoints: ["./a.js"], target }, {
              "absent": {},
              "undefined": { env: undefined },
              '"disable"': { env: "disable" },
              "false": { env: false },
              "null": { env: null },
              "0": { env: 0 },
              '"inline"': { env: "inline" },
              "true": { env: true },
              "1": { env: 1 },
              '"PUBLIC_*"': { env: "PUBLIC_*" },
            });
          }
          console.log(JSON.stringify(out));
        `,
      });

      const outputs = (target: "browser" | "bun" | "node") => {
        const own = `${JSON.stringify(mode)}, ${JSON.stringify(mode)}, ${target === "browser"}`;
        const ownOnly = `console.log(${own}, process.env.PUBLIC_FOO, process.env.PRIVATE_BAR);`;
        const everything = `console.log(${own}, "public_value", "private_value");`;
        const disabled = target === "browser" ? ownOnly : leftToTheRun;
        return {
          "absent": ownOnly,
          "undefined": ownOnly,
          '"disable"': disabled,
          "false": disabled,
          "null": disabled,
          "0": disabled,
          '"inline"': everything,
          "true": everything,
          "1": everything,
          '"PUBLIC_*"': `console.log(${own}, "public_value", process.env.PRIVATE_BAR);`,
        };
      };
      expect(
        await runBuildScript(String(dir), { ...env, PUBLIC_FOO: "public_value", PRIVATE_BAR: "private_value" }),
      ).toEqual({
        printed: {
          "no target": outputs("browser"),
          browser: outputs("browser"),
          bun: outputs("bun"),
          node: outputs("node"),
        },
        stderr: "",
        exitCode: 0,
      });
    });
  }

  test.concurrent('"disable" next to plugins, define and minify', async () => {
    using dir = tempDir("bun-build-env-disable-options", {
      "a.js": source,
      "brackets.js": `console.log(process.env["NODE_ENV"], process.env["BUN_ENV"], process["browser"]);`,
      "build-fixture.ts": /* ts */ `
        ${buildEachVariant}
        const edit = change => ({ name: "edit-env", setup: build => change(build.config) });
        const out = await buildEach({ entrypoints: ["./a.js"], target: "node" }, {
          // The option is read after the plugins ran, so theirs is the value that counts.
          'a plugin assigns "disable"': { plugins: [edit(config => { config.env = "disable"; })] },
          'an async plugin assigns "disable"': { plugins: [edit(async config => { await Bun.file("a.js").exists(); config.env = "disable"; })] },
          '"disable", then a plugin assigns "inline"': { env: "disable", plugins: [edit(config => { config.env = "inline"; })] },
          '"disable", then a plugin deletes env': { env: "disable", plugins: [edit(config => { delete config.env; })] },
          // A define still replaces what it names, and only that.
          '"disable" and a define of process.env.NODE_ENV': { env: "disable", define: { "process.env.NODE_ENV": '"from_define"' } },
          '"disable" and a define of process.env.BUN_ENV': { env: "disable", define: { "process.env.BUN_ENV": '"from_define"' } },
          '"disable" and a define of process.browser': { env: "disable", define: { "process.browser": "true" } },
          // Minifying turns the bracket forms into the dotted ones that a define would match.
          '"disable" and minify.syntax': { env: "disable", minify: { syntax: true }, entrypoints: ["./brackets.js"] },
          // For a browser, a define of the key to itself is the way to keep the read as written.
          'no env, for a browser, NODE_ENV defined as itself': { target: "browser", define: { "process.env.NODE_ENV": "process.env.NODE_ENV" } },
        });
        console.log(JSON.stringify(out));
      `,
    });

    expect(await runBuildScript(String(dir), { PUBLIC_FOO: "public_value", PRIVATE_BAR: "private_value" })).toEqual({
      printed: {
        'a plugin assigns "disable"': leftToTheRun,
        'an async plugin assigns "disable"': leftToTheRun,
        '"disable", then a plugin assigns "inline"': `console.log("development", "development", false, "public_value", "private_value");`,
        '"disable", then a plugin deletes env': `console.log("development", "development", false, process.env.PUBLIC_FOO, process.env.PRIVATE_BAR);`,
        '"disable" and a define of process.env.NODE_ENV': `console.log("from_define", process.env.BUN_ENV, false, process.env.PUBLIC_FOO, process.env.PRIVATE_BAR);`,
        '"disable" and a define of process.env.BUN_ENV': `console.log(process.env.NODE_ENV, "from_define", false, process.env.PUBLIC_FOO, process.env.PRIVATE_BAR);`,
        '"disable" and a define of process.browser': `console.log(process.env.NODE_ENV, process.env.BUN_ENV, true, process.env.PUBLIC_FOO, process.env.PRIVATE_BAR);`,
        '"disable" and minify.syntax': `console.log(process.env.NODE_ENV, process.env.BUN_ENV, !1);`,
        "no env, for a browser, NODE_ENV defined as itself": `console.log(process.env.NODE_ENV, "development", true, process.env.PUBLIC_FOO, process.env.PRIVATE_BAR);`,
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // React picks its development or production build when the bundle runs, and only the development build has
  // jsxDEV. This stand-in does the same.
  const react = {
    "app.jsx": `const element = <div />;\nconsole.log(element.via, element.mode);`,
    "node_modules/react/package.json": JSON.stringify({ name: "react", version: "0.0.0" }),
    "node_modules/react/jsx-runtime.js": `exports.jsx = exports.jsxs = () => ({ via: "jsx", mode: process.env.NODE_ENV });`,
    "node_modules/react/jsx-dev-runtime.js": `
      if (process.env.NODE_ENV !== "production") {
        exports.jsxDEV = () => ({ via: "jsxDEV", mode: process.env.NODE_ENV });
      }
    `,
  };
  const jsxBuildScript = /* ts */ `
    import { readFileSync } from "node:fs";
    import { join } from "node:path";
    import { runInNewContext } from "node:vm";
    ${buildEachVariant}
    const calls = text => (text.includes("jsxDEV(") ? "jsxDEV" : text.includes("jsx(") ? "jsx" : "neither");
    const build = (variants, base = {}) =>
      buildEach({ entrypoints: ["./app.jsx"], target: "bun", ...base }, variants, async result => calls(await result.outputs[0].text()));
    // \`bun build\`, which is a different front end of the same bundler.
    const cli = (outdir, ...flags) => {
      const { stderr, exitCode } = Bun.spawnSync({ cmd: [process.execPath, "build", ...flags, "--target=bun", "./app.jsx", "--outdir=" + outdir], env: process.env });
      if (exitCode !== 0) throw new Error("bun build exited with " + exitCode + ": " + stderr);
      return calls(readFileSync(outdir + "/app.js", "utf8"));
    };
    // What the bundle prints, but only for a run that also exits with 0 and writes nothing to stderr.
    const run = (file, NODE_ENV) => {
      const { stdout, stderr, exitCode } = Bun.spawnSync({ cmd: [process.execPath, file], env: { ...process.env, NODE_ENV } });
      if (exitCode === 0 && stderr.length === 0) return stdout.toString().trim();
      return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode };
    };
    // What the bundle prints where there is no \`process\`, as in a browser.
    const runWithoutProcess = file => {
      const printed = [];
      runInNewContext(readFileSync(file, "utf8"), { console: { log: (...args) => printed.push(args.join(" ")) } });
      return printed.join("\\n");
    };
  `;

  // A bundle for bun or node that reads NODE_ENV when it runs emits `jsx`, which both builds of React have.
  test.concurrent('"disable" for bun emits JSX that runs in either mode', async () => {
    const files = {
      ...react,
      "component.jsx": `export const element = <div />;`,
      "via-plugin.js": `import { element } from "alias:component.jsx";\nconsole.log(element.via, element.mode);`,
      "via-import.js": `import { element } from "./component.jsx";\nconsole.log(element.via, element.mode);`,
      "build-fixture.ts": /* ts */ `
        ${jsxBuildScript}
        const alias = { name: "alias", setup(build) { build.onResolve({ filter: /^alias:/ }, args => ({ path: join(import.meta.dir, args.path.slice("alias:".length)) })); } };
        const passThrough = { name: "pass-through", setup(build) { build.onResolve({ filter: /.*/ }, () => undefined); } };
        const out = await build({
          "absent": {},
          '"disable"': { env: "disable", outdir: "./out" },
          // Files that reach the bundle through a plugin follow the same rule.
          '"disable", a file that a plugin resolves': { env: "disable", entrypoints: ["./via-plugin.js"], plugins: [alias], outdir: "./out-alias" },
          '"disable", a file that a plugin passes on': { env: "disable", entrypoints: ["./via-import.js"], plugins: [passThrough] },
          // The jsx option still decides when it asks for the development transform.
          '"disable", jsx.development: true': { env: "disable", jsx: { development: true } },
          '"disable", jsx.runtime: "react-jsxdev"': { env: "disable", jsx: { runtime: "react-jsxdev" } },
          '"disable", jsx.development: false': { env: "disable", jsx: { development: false } },
          // A define that gives NODE_ENV a string is the mode of the build again.
          '"disable", NODE_ENV defined as "development"': { env: "disable", define: { "process.env.NODE_ENV": '"development"' } },
          '"disable", NODE_ENV defined as "staging"': { env: "disable", define: { "process.env.NODE_ENV": '"staging"' } },
          // A define that only moves the read is not, and neither is a define of some other NODE_ENV.
          '"disable", NODE_ENV defined as itself': { env: "disable", define: { "process.env.NODE_ENV": "process.env.NODE_ENV" } },
          '"disable", NODE_ENV defined as a read of globalThis': { env: "disable", define: { "process.env.NODE_ENV": "globalThis.process.env.NODE_ENV" } },
          '"disable", import.meta.env.NODE_ENV defined': { env: "disable", define: { "import.meta.env.NODE_ENV": '"development"' } },
        });
        for (const NODE_ENV of ["production", "development"]) {
          out['the "disable" bundle run with NODE_ENV=' + NODE_ENV] = run("./out/app.js", NODE_ENV);
          out["the bundle with a file from a plugin run with NODE_ENV=" + NODE_ENV] = run("./out-alias/via-plugin.js", NODE_ENV);
        }
        // A bundle for a browser keeps the mode of the build and its transform, and runs where there is no \`process\`.
        Object.assign(out, await build({ '"disable" for a browser': { env: "disable", outdir: "./out-browser" } }, { target: "browser" }));
        out['the "disable" bundle for a browser run without process'] = runWithoutProcess("./out-browser/app.js");
        console.log(JSON.stringify(out));
      `,
    };
    // One copy of the files for each mode of the build: every run writes its bundles beside them.
    const modes = { "unset": {}, "development": { NODE_ENV: "development" }, "production": { NODE_ENV: "production" } };
    using dir = tempDir(
      "bun-build-env-disable-jsx",
      Object.fromEntries(
        Object.keys(modes).flatMap(mode => Object.entries(files).map(([name, text]) => [`${mode}/${name}`, text])),
      ),
    );

    // `whenNotProduction` is what a build gives when its mode does not turn the development transform off.
    const printed = (mode: keyof typeof modes) => {
      const whenNotProduction = mode === "production" ? "jsx" : "jsxDEV";
      return {
        "absent": whenNotProduction,
        '"disable"': "jsx",
        '"disable", a file that a plugin resolves': "jsx",
        '"disable", a file that a plugin passes on': "jsx",
        '"disable", jsx.development: true': whenNotProduction,
        '"disable", jsx.runtime: "react-jsxdev"': whenNotProduction,
        '"disable", jsx.development: false': "jsx",
        '"disable", NODE_ENV defined as "development"': "jsxDEV",
        '"disable", NODE_ENV defined as "staging"': whenNotProduction,
        '"disable", NODE_ENV defined as itself': "jsx",
        '"disable", NODE_ENV defined as a read of globalThis': "jsx",
        '"disable", import.meta.env.NODE_ENV defined': "jsx",
        'the "disable" bundle run with NODE_ENV=production': "jsx production",
        "the bundle with a file from a plugin run with NODE_ENV=production": "jsx production",
        'the "disable" bundle run with NODE_ENV=development': "jsx development",
        "the bundle with a file from a plugin run with NODE_ENV=development": "jsx development",
        '"disable" for a browser': whenNotProduction,
        'the "disable" bundle for a browser run without process':
          mode === "production" ? "jsx production" : "jsxDEV development",
      };
    };
    expect(
      await Promise.all(Object.entries(modes).map(([mode, env]) => runBuildScript(path.join(String(dir), mode), env))),
    ).toEqual([
      { printed: printed("unset"), stderr: "", exitCode: 0 },
      { printed: printed("development"), stderr: "", exitCode: 0 },
      { printed: printed("production"), stderr: "", exitCode: 0 },
    ]);
  });

  // The bundle reads NODE_ENV when it runs, so Bun keeps both branches of a test on it and resolves their imports.
  test.concurrent('"disable" for bun keeps a branch that the mode of the build would remove', async () => {
    using dir = tempDir("bun-build-env-disable-branch", {
      "a.js": `if (process.env.NODE_ENV !== "production") require("./dev-only.js");\nconsole.log("built");`,
      "build-fixture.ts": /* ts */ `
        const out = {};
        for (const [name, options] of Object.entries({ "absent": {}, '"disable"': { env: "disable" } })) {
          out[name] = await Bun.build({ entrypoints: ["./a.js"], target: "bun", ...options }).then(
            result => "builds, " + (result.outputs[0].size > 0),
            error => String(error.errors?.[0]?.message ?? error.message),
          );
        }
        console.log(JSON.stringify(out));
      `,
    });

    expect(await runBuildScript(String(dir), { NODE_ENV: "production" })).toEqual({
      printed: { "absent": "builds, true", '"disable"': `Could not resolve: "./dev-only.js"` },
      stderr: "",
      exitCode: 0,
    });
  });

  // With NODE_ENV left to the run, another define that ends in ".NODE_ENV" does not state the mode of the build.
  test.concurrent(
    '"disable" with NODE_ENV=development and a define of another NODE_ENV is not a production build',
    async () => {
      using dir = tempDir("bun-build-env-disable-other-node-env", {
        "a.js": `import mode from "conditional";\nconsole.log(mode, import.meta.env.NODE_ENV);`,
        "node_modules/conditional/package.json": JSON.stringify({
          name: "conditional",
          exports: { development: "./development.js", default: "./default.js" },
        }),
        "node_modules/conditional/development.js": `export default "development file";`,
        "node_modules/conditional/default.js": `export default "default file";`,
        "build-fixture.ts": /* ts */ `
        const result = await Bun.build({
          entrypoints: ["./a.js"],
          target: "bun",
          env: "disable",
          define: { "import.meta.env.NODE_ENV": '"production"' },
          outdir: "./out",
        });
        const { stdout } = Bun.spawnSync({ cmd: [process.execPath, "./out/a.js"], env: process.env });
        console.log(JSON.stringify(stdout.toString().trim()));
      `,
      });

      expect(await runBuildScript(String(dir), { NODE_ENV: "development" })).toEqual({
        printed: "development file production",
        stderr: "",
        exitCode: 0,
      });
    },
  );

  // The jsx option of the build decides over the tsconfig.json of the working directory, in both directions. The
  // tsconfig.json alone does not bring jsxDEV back: Bun.build does not take the transform of a file from it.
  test.concurrent('"disable" beside a tsconfig.json that names a JSX transform', async () => {
    const tsconfig = (jsx: string) => ({ "tsconfig.json": JSON.stringify({ compilerOptions: { jsx } }) });
    using dir = tempDir("bun-build-env-disable-jsx-tsconfig", {
      ...Object.fromEntries(
        Object.entries({ ...react, ...tsconfig("react-jsx") }).map(([k, v]) => ["react-jsx/" + k, v]),
      ),
      ...Object.fromEntries(
        Object.entries({ ...react, ...tsconfig("react-jsxdev") }).map(([k, v]) => ["react-jsxdev/" + k, v]),
      ),
      ...Object.fromEntries(
        Object.entries({ ...react, "bunfig.toml": `jsx = "react-jsxDEV"` }).map(([k, v]) => ["bunfig/" + k, v]),
      ),
      "react-jsx/build-fixture.ts": /* ts */ `
        ${jsxBuildScript}
        console.log(JSON.stringify(await build({
          '"disable"': { env: "disable" },
          '"disable", jsx.development: true': { env: "disable", jsx: { development: true } },
        })));
      `,
      "react-jsxdev/build-fixture.ts": /* ts */ `
        ${jsxBuildScript}
        const out = await build({
          '"disable"': { env: "disable" },
          '"disable", jsx.development: false': { env: "disable", jsx: { development: false } },
        });
        // \`bun build\` does take it from there, and this change leaves that alone.
        out["bun build --env=disable"] = cli("./cli-out", "--env=disable");
        console.log(JSON.stringify(out));
      `,
      "bunfig/build-fixture.ts": /* ts */ `
        ${jsxBuildScript}
        console.log(JSON.stringify({ "bun build --env=disable": cli("./cli-out", "--env=disable") }));
      `,
    });

    expect(
      await Promise.all([
        runBuildScript(path.join(String(dir), "react-jsx")),
        runBuildScript(path.join(String(dir), "react-jsxdev")),
        runBuildScript(path.join(String(dir), "bunfig")),
      ]),
    ).toEqual([
      { printed: { '"disable"': "jsx", '"disable", jsx.development: true': "jsxDEV" }, stderr: "", exitCode: 0 },
      {
        printed: {
          '"disable"': "jsx",
          '"disable", jsx.development: false': "jsx",
          "bun build --env=disable": "jsxDEV",
        },
        stderr: "",
        exitCode: 0,
      },
      { printed: { "bun build --env=disable": "jsxDEV" }, stderr: "", exitCode: 0 },
    ]);
  });

  // The scripts of an imported .html file run in a browser, which has no `process`. They keep the mode of the build:
  // the page is the same, byte for byte, as in a build without `env`.
  test.concurrent('"disable" in a server build does not change the page of an HTML import', async () => {
    using dir = tempDir("bun-build-env-disable-html", {
      ...react,
      "server.ts": `import index from "./index.html";\nconsole.log("server:", process.env.NODE_ENV, process.env.BUN_ENV, process.browser);\nexport default index;`,
      "index.html": `<!DOCTYPE html><html><body><script type="module" src="./page.jsx"></script></body></html>`,
      "page.jsx": `console.log("page:", process.env.NODE_ENV, process.env.BUN_ENV, process.browser);\nglobalThis.element = <div />;`,
      "build-fixture.ts": /* ts */ `
        ${buildEachVariant}
        const calls = text => (text.includes("jsxDEV(") ? "jsxDEV" : text.includes("jsx(") ? "jsx" : "neither");
        // The chunk with the log of server.ts is the server's. Every other output belongs to the page.
        const parts = async result => {
          const built = { server: undefined, page: undefined, pageJsx: undefined, pageFiles: {} };
          for (const output of result.outputs) {
            const text = await output.text();
            if (text.includes('"server:"')) built.server = firstLog(text);
            else {
              built.pageFiles[output.path] = text;
              if (text.includes('"page:"')) Object.assign(built, { page: firstLog(text), pageJsx: calls(text) });
            }
          }
          return built;
        };
        const out = {};
        for (const [name, options] of Object.entries({
          "jsx not given": {},
          "jsx.development: false": { jsx: { development: false } },
          "jsx.development: true": { jsx: { development: true } },
          // The page then has the NODE_ENV of the define and the BUN_ENV of the build.
          "a define of NODE_ENV": { define: { "process.env.NODE_ENV": '"production"' } },
          // A define of some other NODE_ENV changes neither the server nor the page.
          'import.meta.env.NODE_ENV defined as "development"': { define: { "import.meta.env.NODE_ENV": '"development"' } },
          'import.meta.env.NODE_ENV defined as "production"': { define: { "import.meta.env.NODE_ENV": '"production"' } },
        })) {
          const base = { entrypoints: ["./server.ts"], target: "bun", ...options };
          const without = await parts(await Bun.build(base));
          const { pageFiles, ...disabled } = await parts(await Bun.build({ ...base, env: "disable" }));
          const pageIsAsWithoutEnv = Object.keys(pageFiles).length > 1 && Bun.deepEquals(pageFiles, without.pageFiles);
          out[name] = name.startsWith("import.meta") ? { server: disabled.server, pageIsAsWithoutEnv } : { ...disabled, pageIsAsWithoutEnv };
        }
        console.log(JSON.stringify(out));
      `,
    });

    const server = `console.log("server:", process.env.NODE_ENV, process.env.BUN_ENV, false);`;
    const built = (mode: string, jsx: [string, string, string]) => ({
      printed: {
        ...Object.fromEntries(
          ["jsx not given", "jsx.development: false", "jsx.development: true"].map((name, i) => [
            name,
            {
              server,
              page: `console.log("page:", ${JSON.stringify(mode)}, ${JSON.stringify(mode)}, false);`,
              pageJsx: jsx[i],
              pageIsAsWithoutEnv: true,
            },
          ]),
        ),
        "a define of NODE_ENV": {
          server: `console.log("server:", "production", process.env.BUN_ENV, false);`,
          page: `console.log("page:", "production", ${JSON.stringify(mode)}, false);`,
          pageJsx: "jsx",
          pageIsAsWithoutEnv: true,
        },
        'import.meta.env.NODE_ENV defined as "development"': { server, pageIsAsWithoutEnv: true },
        'import.meta.env.NODE_ENV defined as "production"': { server, pageIsAsWithoutEnv: true },
      },
      stderr: "",
      exitCode: 0,
    });
    expect(
      await Promise.all([
        runBuildScript(String(dir)),
        runBuildScript(String(dir), { NODE_ENV: "development" }),
        runBuildScript(String(dir), { NODE_ENV: "production" }),
        runBuildScript(String(dir), { BUN_ENV: "staging" }),
      ]),
    ).toEqual([
      built("development", ["jsxDEV", "jsx", "jsxDEV"]),
      built("development", ["jsxDEV", "jsxDEV", "jsxDEV"]),
      built("production", ["jsx", "jsx", "jsx"]),
      built("staging", ["jsxDEV", "jsx", "jsxDEV"]),
    ]);
  });

  // An HTML entry point of a build for bun is a page too. The page gets the mode of the build on every path that an
  // entry point can take: from the disk, through a plugin's onResolve, and from `files`.
  test.concurrent('"disable" for bun does not change the page of an HTML entry point', async () => {
    using dir = tempDir("bun-build-env-disable-html-entry", {
      "index.html": `<!DOCTYPE html><html><body><script type="module" src="./page.js"></script></body></html>`,
      "page.js": `console.log("page:", process.env.NODE_ENV, process.env.BUN_ENV);`,
      "build-fixture.ts": /* ts */ `
        import { readFileSync } from "node:fs";
        import { join } from "node:path";
        ${buildEachVariant}
        const declines = { name: "declines", setup(build) { build.onResolve({ filter: /.*/ }, () => undefined); } };
        const answers = { name: "answers", setup(build) { build.onResolve({ filter: /^page:/ }, () => ({ path: join(import.meta.dir, "index.html") })); } };
        const inMemory = join(import.meta.dir, "in-memory.html");
        const pageLog = async result => {
          for (const output of result.outputs) {
            const line = firstLog(await output.text());
            if (line) return line;
          }
        };
        const paths = {
          "from the disk": {},
          "a plugin declines the entry point": { plugins: [declines] },
          "a plugin answers the entry point": { entrypoints: ["page:index"], plugins: [answers] },
          "files gives the entry point": { entrypoints: [inMemory], files: { [inMemory]: readFileSync("./index.html", "utf8") } },
        };
        const out = {};
        for (const [name, options] of Object.entries(paths)) {
          Object.assign(out, await buildEach({ entrypoints: ["./index.html"], target: "bun", ...options }, {
            [name]: {},
            [name + ', "disable"']: { env: "disable" },
          }, pageLog));
        }
        console.log(JSON.stringify(out));
      `,
    });

    const page = `console.log("page:", "development", "development");`;
    expect(await runBuildScript(String(dir))).toEqual({
      printed: {
        "from the disk": page,
        'from the disk, "disable"': page,
        "a plugin declines the entry point": page,
        'a plugin declines the entry point, "disable"': page,
        "a plugin answers the entry point": page,
        'a plugin answers the entry point, "disable"': page,
        "files gives the entry point": page,
        'files gives the entry point, "disable"': page,
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // A transpiler has no env option, so it has no explicit "disable": it still replaces the three.
  test.concurrent("new Bun.Transpiler() still replaces NODE_ENV, BUN_ENV and process.browser", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const source = "console.log(process.env.NODE_ENV, process.env.BUN_ENV, process.browser);";
          for (const target of ["browser", "node"]) process.stdout.write(new Bun.Transpiler({ target }).transformSync(source));
        `,
      ],
      env: { ...bunEnv, NODE_ENV: "from_the_process", BUN_ENV: undefined },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout:
        'console.log("from_the_process", "from_the_process", true);\n' +
        'console.log("from_the_process", "from_the_process", false);\n',
      stderr: "",
      exitCode: 0,
    });
  });
});

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

    // Disable mode also leaves the mode of the build out of the bundle: the bundle reads NODE_ENV when it runs.
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
    cmd: [bunExe(), "build.ts"],
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

// build.ts of the fixtures: one Bun.build per named set of options, then `pick` reads each result.
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

  for (const [nodeEnv, mode] of [
    [undefined, "development"],
    ["production", "production"],
  ] as const) {
    // The bundler replaces NODE_ENV, BUN_ENV and process.browser on its own unless `env` says "disable". No `env`
    // at all is not "disable": a build that does not pass the option still gets the three.
    test.concurrent(`each value of the option, built with NODE_ENV ${nodeEnv ?? "unset"}`, async () => {
      using dir = tempDir("bun-build-env-values", {
        "a.js": source,
        "build.ts": /* ts */ `
          ${buildEachVariant}
          const out = {};
          for (const target of ["browser", "bun", "node"]) {
            out[target] = await buildEach({ entrypoints: ["./a.js"], target }, {
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
        return {
          "absent": ownOnly,
          "undefined": ownOnly,
          '"disable"': source,
          "false": source,
          "null": source,
          "0": source,
          '"inline"': everything,
          "true": everything,
          "1": everything,
          '"PUBLIC_*"': `console.log(${own}, "public_value", process.env.PRIVATE_BAR);`,
        };
      };
      expect(
        await runBuildScript(String(dir), {
          NODE_ENV: nodeEnv,
          PUBLIC_FOO: "public_value",
          PRIVATE_BAR: "private_value",
        }),
      ).toEqual({
        printed: { browser: outputs("browser"), bun: outputs("bun"), node: outputs("node") },
        stderr: "",
        exitCode: 0,
      });
    });
  }

  test.concurrent('"disable" next to plugins, define and minify', async () => {
    using dir = tempDir("bun-build-env-disable-options", {
      "a.js": source,
      "brackets.js": `console.log(process.env["NODE_ENV"], process.env["BUN_ENV"], process["browser"]);`,
      "build.ts": /* ts */ `
        ${buildEachVariant}
        const edit = change => ({ name: "edit-env", setup: build => change(build.config) });
        const out = await buildEach({ entrypoints: ["./a.js"], target: "node" }, {
          // The option is read after the plugins ran, so theirs is the value that counts.
          'a plugin assigns "disable"': { plugins: [edit(config => { config.env = "disable"; })] },
          'an async plugin assigns "disable"': { plugins: [edit(async config => { await Bun.file("a.js").exists(); config.env = "disable"; })] },
          '"disable", then a plugin assigns "inline"': { env: "disable", plugins: [edit(config => { config.env = "inline"; })] },
          '"disable", then a plugin deletes env': { env: "disable", plugins: [edit(config => { delete config.env; })] },
          // A define still replaces what it names.
          '"disable" and a define of process.env.NODE_ENV': { env: "disable", define: { "process.env.NODE_ENV": '"from_define"' } },
          '"disable" and a define of process.browser': { env: "disable", define: { "process.browser": "true" } },
          // Minifying turns the bracket forms into the dotted ones that a define would match.
          '"disable" and minify.syntax': { env: "disable", minify: { syntax: true }, entrypoints: ["./brackets.js"] },
        });
        console.log(JSON.stringify(out));
      `,
    });

    expect(await runBuildScript(String(dir), { PUBLIC_FOO: "public_value", PRIVATE_BAR: "private_value" })).toEqual({
      printed: {
        'a plugin assigns "disable"': source,
        'an async plugin assigns "disable"': source,
        '"disable", then a plugin assigns "inline"': `console.log("development", "development", false, "public_value", "private_value");`,
        '"disable", then a plugin deletes env': `console.log("development", "development", false, process.env.PUBLIC_FOO, process.env.PRIVATE_BAR);`,
        '"disable" and a define of process.env.NODE_ENV': `console.log("from_define", process.env.BUN_ENV, process.browser, process.env.PUBLIC_FOO, process.env.PRIVATE_BAR);`,
        '"disable" and a define of process.browser': `console.log(process.env.NODE_ENV, process.env.BUN_ENV, true, process.env.PUBLIC_FOO, process.env.PRIVATE_BAR);`,
        '"disable" and minify.syntax': `console.log(process.env.NODE_ENV, process.env.BUN_ENV, process.browser);`,
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // A bundle that reads NODE_ENV when it runs lets React pick its development or production build then, and only
  // the development build has jsxDEV. So a build that does not give NODE_ENV a value emits `jsx`, which both have.
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
    ${buildEachVariant}
    const calls = text => (text.includes("jsxDEV(") ? "jsxDEV" : text.includes("jsx(") ? "jsx" : "neither");
    const build = variants =>
      buildEach({ entrypoints: ["./app.jsx"], target: "bun" }, variants, async result => calls(await result.outputs[0].text()));
    // \`bun build\`, which is a different front end of the same bundler.
    const cli = (outdir, ...flags) => {
      const { stderr, exitCode } = Bun.spawnSync({ cmd: [process.execPath, "build", ...flags, "--target=bun", "./app.jsx", "--outdir=" + outdir], env: process.env });
      if (exitCode !== 0) throw new Error("bun build exited with " + exitCode + ": " + stderr);
      return calls(require("fs").readFileSync(outdir + "/app.js", "utf8"));
    };
    // What the bundle prints, but only for a run that also exits with 0 and writes nothing to stderr.
    const run = (file, NODE_ENV) => {
      const { stdout, stderr, exitCode } = Bun.spawnSync({ cmd: [process.execPath, file], env: { ...process.env, NODE_ENV } });
      if (exitCode === 0 && stderr.length === 0) return stdout.toString().trim();
      return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode };
    };
  `;

  test.concurrent(
    "a build that leaves NODE_ENV to the run of the bundle emits JSX that runs in either mode",
    async () => {
      using dir = tempDir("bun-build-env-disable-jsx", {
        ...react,
        "build.ts": /* ts */ `
        ${jsxBuildScript}
        const out = await build({
          "absent": {},
          '"disable"': { env: "disable", outdir: "./api-out" },
          // Asking for the development transform is still honored.
          '"disable", jsx.development: true': { env: "disable", jsx: { development: true } },
          '"disable", jsx.runtime: "react-jsxdev"': { env: "disable", jsx: { runtime: "react-jsxdev" } },
          // A define that gives NODE_ENV a value states the mode.
          '"disable", NODE_ENV defined as "development"': { env: "disable", define: { "process.env.NODE_ENV": '"development"' } },
          '"disable", NODE_ENV defined as "staging"': { env: "disable", define: { "process.env.NODE_ENV": '"staging"' } },
          // One that only moves the read does not, and neither does one for another NODE_ENV.
          "absent, NODE_ENV defined as an expression": { define: { "process.env.NODE_ENV": "globalThis.process.env.NODE_ENV" } },
          '"disable", import.meta.env.NODE_ENV defined': { env: "disable", define: { "import.meta.env.NODE_ENV": '"development"' } },
        });
        out["bun build"] = cli("./cli-default-out");
        out["bun build --env=disable"] = cli("./cli-out", "--env=disable");
        for (const NODE_ENV of ["production", "development"]) {
          out['the "disable" bundle run with NODE_ENV=' + NODE_ENV] = run("./api-out/app.js", NODE_ENV);
          out["the --env=disable bundle run with NODE_ENV=" + NODE_ENV] = run("./cli-out/app.js", NODE_ENV);
        }
        console.log(JSON.stringify(out));
      `,
      });

      expect(await runBuildScript(String(dir))).toEqual({
        printed: {
          "absent": "jsxDEV",
          '"disable"': "jsx",
          '"disable", jsx.development: true': "jsxDEV",
          '"disable", jsx.runtime: "react-jsxdev"': "jsxDEV",
          '"disable", NODE_ENV defined as "development"': "jsxDEV",
          '"disable", NODE_ENV defined as "staging"': "jsxDEV",
          "absent, NODE_ENV defined as an expression": "jsx",
          '"disable", import.meta.env.NODE_ENV defined': "jsx",
          "bun build": "jsxDEV",
          "bun build --env=disable": "jsx",
          'the "disable" bundle run with NODE_ENV=production': "jsx production",
          "the --env=disable bundle run with NODE_ENV=production": "jsx production",
          'the "disable" bundle run with NODE_ENV=development': "jsx development",
          "the --env=disable bundle run with NODE_ENV=development": "jsx development",
        },
        stderr: "",
        exitCode: 0,
      });
    },
  );

  // The jsx option of the build decides over the tsconfig.json of the working directory, in both directions. The
  // tsconfig.json alone does not bring jsxDEV back: it cannot know the mode the bundle will run in.
  test.concurrent('"disable" beside a tsconfig.json that names a JSX transform', async () => {
    const tsconfig = (jsx: string) => ({ "tsconfig.json": JSON.stringify({ compilerOptions: { jsx } }) });
    using dir = tempDir("bun-build-env-disable-jsx-tsconfig", {
      ...Object.fromEntries(
        Object.entries({ ...react, ...tsconfig("react-jsx") }).map(([k, v]) => ["react-jsx/" + k, v]),
      ),
      ...Object.fromEntries(
        Object.entries({ ...react, ...tsconfig("react-jsxdev") }).map(([k, v]) => ["react-jsxdev/" + k, v]),
      ),
      "react-jsx/build.ts": /* ts */ `
        ${jsxBuildScript}
        console.log(JSON.stringify(await build({
          '"disable"': { env: "disable" },
          '"disable", jsx.development: true': { env: "disable", jsx: { development: true } },
        })));
      `,
      "react-jsxdev/build.ts": /* ts */ `
        ${jsxBuildScript}
        const out = await build({
          '"disable"': { env: "disable" },
          '"disable", jsx.development: false': { env: "disable", jsx: { development: false } },
        });
        out["bun build --env=disable"] = cli("./cli-out", "--env=disable");
        console.log(JSON.stringify(out));
      `,
    });

    expect(
      await Promise.all([
        runBuildScript(path.join(String(dir), "react-jsx")),
        runBuildScript(path.join(String(dir), "react-jsxdev")),
      ]),
    ).toEqual([
      { printed: { '"disable"': "jsx", '"disable", jsx.development: true': "jsxDEV" }, stderr: "", exitCode: 0 },
      {
        printed: { '"disable"': "jsx", '"disable", jsx.development: false': "jsx", "bun build --env=disable": "jsx" },
        stderr: "",
        exitCode: 0,
      },
    ]);
  });

  // The scripts of an imported .html file are built with the defines of the server build that imports it, so they
  // keep the reads too. A browser has no `process`: such a build states the mode with `define`.
  test.concurrent('"disable" in a server build also applies to the scripts of an HTML import', async () => {
    using dir = tempDir("bun-build-env-disable-html", {
      "server.ts": `import index from "./index.html";\nexport default index;`,
      "index.html": `<!DOCTYPE html><html><body><script type="module" src="./client.ts"></script></body></html>`,
      "client.ts": `console.log(process.env.NODE_ENV, process.env.BUN_ENV);`,
      "build.ts": /* ts */ `
        ${buildEachVariant}
        const clientLog = async result => {
          for (const output of result.outputs) {
            const line = firstLog(await output.text());
            if (line) return line;
          }
        };
        const out = await buildEach({ entrypoints: ["./server.ts"], target: "bun" }, {
          "absent": {},
          '"disable"': { env: "disable" },
          '"disable" and a define': { env: "disable", define: { "process.env.NODE_ENV": '"production"' } },
        }, clientLog);
        console.log(JSON.stringify(out));
      `,
    });

    expect(await runBuildScript(String(dir))).toEqual({
      printed: {
        "absent": `console.log("development", "development");`,
        '"disable"': `console.log(process.env.NODE_ENV, process.env.BUN_ENV);`,
        '"disable" and a define': `console.log("production", process.env.BUN_ENV);`,
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // The entry points below have no explicit "disable" of their own, so they keep the three. A transpiler has no
  // env option. For the HTML routes of Bun.serve "disable" is the default of bunfig.toml, and the code runs in a
  // browser, which has no `process` to read NODE_ENV from.
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

  test.concurrent('bunfig [serve.static] env = "disable" still replaces NODE_ENV in an HTML route', async () => {
    const served = async (bunfig: string) => {
      using dir = tempDir("bun-serve-static-env", {
        "index.html": `<!DOCTYPE html><html><body><script type="module" src="./app.ts"></script></body></html>`,
        "app.ts": `console.log("mode:", process.env.NODE_ENV, "public:", process.env.PUBLIC_FOO);`,
        "bunfig.toml": bunfig,
        "serve.ts": /* ts */ `
          import index from "./index.html";
          const server = Bun.serve({ port: 0, development: false, routes: { "/": index } });
          const html = await (await fetch(server.url)).text();
          const script = await (await fetch(new URL(html.match(/src="([^"]+\\.js)"/)[1], server.url))).text();
          console.log(script.match(/console\\.log\\([^)]*\\)/)[0]);
          await server.stop(true);
        `,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "serve.ts"],
        cwd: String(dir),
        env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined, PUBLIC_FOO: "public_value" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stdout.trim(), stderr, exitCode };
    };

    const script = (stdout: string) => ({ stdout, stderr: "", exitCode: 0 });
    const replaced = script(`console.log("mode:","production","public:",process.env.PUBLIC_FOO)`);
    expect(
      await Promise.all([
        served(`[serve.static]`),
        served(`[serve.static]\nenv = "disable"`),
        served(`[serve.static]\nenv = false`),
        served(`[serve.static]\nenv = "inline"`),
      ]),
    ).toEqual([replaced, replaced, replaced, script(`console.log("mode:","production","public:","public_value")`)]);
  });
});

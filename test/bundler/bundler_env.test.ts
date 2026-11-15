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

// `bun build --env=disable` leaves `process.env.NODE_ENV` in the bundle, so React picks its development or its
// production build when the bundle runs. Only the development build has `jsxDEV`. This stand-in does the same.
describe("bun build: the JSX of a bundle that reads NODE_ENV when it runs", () => {
  const react = {
    "app.jsx": `const element = <div />;\nconsole.log(element.via, element.mode);`,
    "node_modules/react/package.json": JSON.stringify({ name: "react", version: "0.0.0" }),
    "node_modules/react/jsx-runtime.js": `exports.jsx = exports.jsxs = () => ({ via: "jsx", mode: process.env.NODE_ENV });`,
    "node_modules/react/jsx-dev-runtime.js": `if (process.env.NODE_ENV !== "production") exports.jsxDEV = () => ({ via: "jsxDEV", mode: process.env.NODE_ENV });`,
  };
  const tsconfig = (compilerOptions: object) => JSON.stringify({ compilerOptions });
  const inFolder = (folder: string, files: Record<string, string>) =>
    Object.fromEntries(Object.entries(files).map(([name, text]) => [`${folder}/${name}`, text]));

  async function spawned(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
    await using proc = Bun.spawn({
      cmd,
      cwd,
      env: { ...bunEnv, NODE_ENV: undefined, BUN_ENV: undefined, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  const callOf = (code: string) =>
    /jsxDEV\w*\("div"/.test(code) ? "jsxDEV" : /jsx\w*\("div"/.test(code) ? "jsx" : "neither";
  // `bun build`, which prints the code: the function that its JSX calls, or what a build that failed wrote.
  async function build(cwd: string, flags: string[], env: Record<string, string> = {}) {
    const { stdout, stderr, exitCode } = await spawned([bunExe(), "build", ...flags], cwd, env);
    return exitCode === 0 ? callOf(stdout) : stderr;
  }
  // One build after the other: each row is the flags of a build, or the flags and the environment of the build.
  async function buildEach(cwd: string, rows: Record<string, string[] | [string[], Record<string, string>]>) {
    const calls: Record<string, string> = {};
    for (const [name, row] of Object.entries(rows)) {
      const [flags, env] = Array.isArray(row[0]) ? (row as [string[], Record<string, string>]) : [row as string[]];
      calls[name] = await build(cwd, flags, env);
    }
    return calls;
  }

  test.concurrent("--env=disable calls jsx, and the bundle runs under either NODE_ENV", async () => {
    using dir = tempDir("bun-build-env-disable-jsx", react);
    const cwd = String(dir);

    expect(
      await buildEach(cwd, {
        "--env=disable": ["--env=disable", "./app.jsx"],
        "--env=0": ["--env=0", "./app.jsx"],
        "--env=disable --target=bun": ["--env=disable", "--target=bun", "./app.jsx"],
        "--env=disable --target=node": ["--env=disable", "--target=node", "./app.jsx"],
        "--env=disable --minify": ["--env=disable", "--minify", "./app.jsx"],
        "--env=disable --packages=external": ["--env=disable", "--packages=external", "./app.jsx"],
        // The NODE_ENV of the build is not the NODE_ENV of the run.
        "--env=disable, built under NODE_ENV=development": [
          ["--env=disable", "./app.jsx"],
          { NODE_ENV: "development" },
        ],
        "--env=disable, built under NODE_ENV=test": [["--env=disable", "./app.jsx"], { NODE_ENV: "test" }],
      }),
    ).toEqual({
      "--env=disable": "jsx",
      "--env=0": "jsx",
      "--env=disable --target=bun": "jsx",
      "--env=disable --target=node": "jsx",
      "--env=disable --minify": "jsx",
      "--env=disable --packages=external": "jsx",
      "--env=disable, built under NODE_ENV=development": "jsx",
      "--env=disable, built under NODE_ENV=test": "jsx",
    });

    const built = await spawned(
      [bunExe(), "build", "--env=disable", "--target=bun", "./app.jsx", "--outdir=out"],
      cwd,
      {},
    );
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const ran = async (NODE_ENV: string) => {
      const { stdout, exitCode } = await spawned([bunExe(), "./out/app.js"], cwd, { NODE_ENV });
      return { stdout, exitCode };
    };
    expect({ production: await ran("production"), development: await ran("development") }).toEqual({
      production: { stdout: "jsx production\n", exitCode: 0 },
      development: { stdout: "jsx development\n", exitCode: 0 },
    });
  });

  // An identifier in place of `process.env.NODE_ENV` is still a read when the bundle runs.
  test.concurrent("a define that only moves the read of NODE_ENV calls jsx", async () => {
    using dir = tempDir("bun-build-node-env-identifier-jsx", react);

    expect(
      await buildEach(String(dir), {
        "NODE_ENV defined as itself": ["--define", "process.env.NODE_ENV=process.env.NODE_ENV", "./app.jsx"],
        "--env=disable, NODE_ENV defined as a global": [
          "--env=disable",
          "--define",
          "process.env.NODE_ENV=globalThis.MODE",
          "./app.jsx",
        ],
        // A define of some other NODE_ENV does not say what `process.env.NODE_ENV` is.
        "--env=disable, import.meta.env.NODE_ENV defined, built under NODE_ENV=development": [
          ["--env=disable", "--define", 'import.meta.env.NODE_ENV="development"', "./app.jsx"],
          { NODE_ENV: "development" },
        ],
      }),
    ).toEqual({
      "NODE_ENV defined as itself": "jsx",
      "--env=disable, NODE_ENV defined as a global": "jsx",
      "--env=disable, import.meta.env.NODE_ENV defined, built under NODE_ENV=development": "jsx",
    });
  });

  // With a literal in place of `process.env.NODE_ENV` the bundle has the build of React that the literal selects.
  test.concurrent("a build that puts a value in place of NODE_ENV keeps jsxDEV", async () => {
    using dir = tempDir("bun-build-node-env-literal-jsx", react);

    expect(
      await buildEach(String(dir), {
        "no --env": ["./app.jsx"],
        "--env=inline": ["--env=inline", "./app.jsx"],
        "--env=PUBLIC_*": ["--env=PUBLIC_*", "./app.jsx"],
        '--env=disable, NODE_ENV defined as "development"': [
          "--env=disable",
          "--define",
          'process.env.NODE_ENV="development"',
          "./app.jsx",
        ],
        '--env=disable, NODE_ENV defined as "staging"': [
          "--env=disable",
          "--define",
          'process.env.NODE_ENV="staging"',
          "./app.jsx",
        ],
        "--env=disable, NODE_ENV defined as undefined": [
          "--env=disable",
          "--define",
          "process.env.NODE_ENV=undefined",
          "./app.jsx",
        ],
        "--env=disable, NODE_ENV defined as 0": ["--env=disable", "--define", "process.env.NODE_ENV=0", "./app.jsx"],
        '--env=disable, NODE_ENV defined as "production"': [
          "--env=disable",
          "--define",
          'process.env.NODE_ENV="production"',
          "./app.jsx",
        ],
      }),
    ).toEqual({
      "no --env": "jsxDEV",
      "--env=inline": "jsxDEV",
      "--env=PUBLIC_*": "jsxDEV",
      '--env=disable, NODE_ENV defined as "development"': "jsxDEV",
      '--env=disable, NODE_ENV defined as "staging"': "jsxDEV",
      "--env=disable, NODE_ENV defined as undefined": "jsxDEV",
      "--env=disable, NODE_ENV defined as 0": "jsxDEV",
      '--env=disable, NODE_ENV defined as "production"': "jsx",
    });
  });

  test.concurrent(
    "--env=disable beside a configuration that states the development transform keeps jsxDEV",
    async () => {
      const devPragma = { "app.jsx": `/** @jsxRuntime react-jsxdev */\n${react["app.jsx"]}` };
      using dir = tempDir("bun-build-env-disable-jsx-stated", {
        ...inFolder("bunfig", { ...react, "bunfig.toml": `jsx = "react-jsxDEV"` }),
        ...inFolder("tsconfig", { ...react, "tsconfig.json": tsconfig({ jsx: "react-jsxdev" }) }),
        ...inFolder("extends", {
          ...react,
          "tsconfig.json": JSON.stringify({ extends: "./base.json" }),
          "base.json": tsconfig({ jsx: "react-jsxdev" }),
        }),
        ...inFolder("override", { ...react, "dev.json": tsconfig({ jsx: "react-jsxdev" }) }),
        ...inFolder("pragma", { ...react, ...devPragma }),
        // The other direction: what states the production transform decides too.
        ...inFolder("both", {
          ...react,
          "bunfig.toml": `jsx = "react-jsxDEV"`,
          "tsconfig.json": tsconfig({ jsx: "react-jsx" }),
        }),
      });
      const cwd = (folder: string) => path.join(String(dir), folder);
      const disable = ["--env=disable", "./app.jsx"];

      expect({
        'bunfig.toml with jsx = "react-jsxDEV"': await build(cwd("bunfig"), disable),
        'tsconfig.json with "jsx": "react-jsxdev"': await build(cwd("tsconfig"), disable),
        "tsconfig.json that extends one with react-jsxdev": await build(cwd("extends"), disable),
        "--tsconfig-override with react-jsxdev": await build(cwd("override"), [
          "--tsconfig-override=dev.json",
          ...disable,
        ]),
        "a @jsxRuntime react-jsxdev comment": await build(cwd("pragma"), disable),
        "bunfig.toml with react-jsxDEV, built under NODE_ENV=production": await build(cwd("bunfig"), disable, {
          NODE_ENV: "production",
        }),
        "bunfig.toml with react-jsxDEV and --jsx-import-source": await build(cwd("bunfig"), [
          "--jsx-import-source=react",
          ...disable,
        ]),
        "bunfig.toml with react-jsxDEV beside tsconfig.json with react-jsx": await build(cwd("both"), disable),
      }).toEqual({
        'bunfig.toml with jsx = "react-jsxDEV"': "jsxDEV",
        'tsconfig.json with "jsx": "react-jsxdev"': "jsxDEV",
        "tsconfig.json that extends one with react-jsxdev": "jsxDEV",
        "--tsconfig-override with react-jsxdev": "jsxDEV",
        "a @jsxRuntime react-jsxdev comment": "jsxDEV",
        "bunfig.toml with react-jsxDEV, built under NODE_ENV=production": "jsx",
        "bunfig.toml with react-jsxDEV and --jsx-import-source": "jsx",
        "bunfig.toml with react-jsxDEV beside tsconfig.json with react-jsx": "jsx",
      });
    },
  );

  test.concurrent(
    "--no-bundle --env=disable calls jsx, and a nested tsconfig.json still decides for its files",
    async () => {
      using dir = tempDir("bun-build-env-disable-jsx-no-bundle", {
        ...react,
        "dev/app.jsx": react["app.jsx"],
        "dev/tsconfig.json": tsconfig({ jsx: "react-jsxdev" }),
      });

      expect(
        await buildEach(String(dir), {
          "--no-bundle --env=disable": ["--no-bundle", "--env=disable", "./app.jsx"],
          "--no-bundle --env=disable, a file under a tsconfig.json with react-jsxdev": [
            "--no-bundle",
            "--env=disable",
            "./dev/app.jsx",
          ],
        }),
      ).toEqual({
        "--no-bundle --env=disable": "jsx",
        "--no-bundle --env=disable, a file under a tsconfig.json with react-jsxdev": "jsxDEV",
      });
    },
  );

  // A call of `jsx` would not resolve there, and such a build works today.
  test.concurrent("--env=disable keeps jsxDEV for an import source that has only jsx-dev-runtime", async () => {
    const shim = {
      "node_modules/shim/package.json": JSON.stringify({ name: "shim", version: "0.0.0" }),
      "node_modules/shim/jsx-dev-runtime.js": `exports.jsxDEV = () => ({ via: "jsxDEV of shim", mode: process.env.NODE_ENV });`,
    };
    using dir = tempDir("bun-build-env-disable-jsx-only-dev-runtime", {
      ...inFolder("tsconfig", { ...react, ...shim, "tsconfig.json": tsconfig({ jsxImportSource: "shim" }) }),
      ...inFolder("bunfig", { ...react, ...shim, "bunfig.toml": `jsxImportSource = "shim"` }),
    });
    const cwd = (folder: string) => path.join(String(dir), folder);

    expect({
      "tsconfig.json with jsxImportSource": await build(cwd("tsconfig"), ["--env=disable", "./app.jsx"]),
      "bunfig.toml with jsxImportSource": await build(cwd("bunfig"), ["--env=disable", "./app.jsx"]),
    }).toEqual({
      "tsconfig.json with jsxImportSource": "jsxDEV",
      "bunfig.toml with jsxImportSource": "jsxDEV",
    });
  });

  test.concurrent("--env=disable calls jsx in the script of an .html entry point", async () => {
    using dir = tempDir("bun-build-env-disable-jsx-html", {
      ...react,
      "index.html": `<!doctype html><script type="module" src="./app.jsx"></script>`,
    });
    const cwd = String(dir);

    const built = await spawned([bunExe(), "build", "--env=disable", "./index.html", "--outdir=out"], cwd, {});
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const scripts = [...new Bun.Glob("*.js").scanSync(path.join(cwd, "out"))];
    expect(scripts).toHaveLength(1);
    expect(callOf(await Bun.file(path.join(cwd, "out", scripts[0])).text())).toBe("jsx");
  });
});

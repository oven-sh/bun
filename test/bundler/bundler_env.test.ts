import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

    // A `define` for `process.env.X` outranks the value that `env` inlines for X. The api backend builds in this process.
    if (backend === "api")
      for (const [name, dotenv] of [
        ["inline", "inline"],
        ["prefix", systemKey.slice(0, -1) + "*"],
      ]) {
        itBundled(`env/define outranks ${name} system`, {
          backend: backend,
          dotenv,
          define: {
            [`process.env.${systemKey}`]: '"FROMDEFINE"',
          },
          files: {
            "/a.js": `
          console.log(process.env.${systemKey});
        `,
          },
          run: {
            env: {
              [systemKey]: "the run-time value, which the define should have replaced",
            },
            stdout: "FROMDEFINE\n",
          },
        });

        // `bun test` sets NODE_ENV in this process.
        itBundled(`env/define outranks ${name}, NODE_ENV of bun test`, {
          backend: backend,
          dotenv: name === "inline" ? "inline" : "NODE_*",
          define: {
            "process.env.NODE_ENV": '"FROMDEFINE"',
          },
          files: {
            "/a.js": `
          console.log(process.env.NODE_ENV);
        `,
          },
          run: {
            env: {
              NODE_ENV: "runtime",
            },
            stdout: "FROMDEFINE\n",
          },
        });
      }

    if (backend === "cli") {
      // NODE_ENV and BUN_ENV have no define here. The default that Bun makes for them still yields to the environment.
      for (const target of ["browser", "node", "bun"] as const) {
        itBundled(`env/define outranks inline, target ${target}`, {
          env: {
            APP_MODE: "fromenv",
            NODE_ENV: "aaa",
            BUN_ENV: "bbb",
          },
          backend: backend,
          target,
          dotenv: "inline",
          define: {
            "process.env.APP_MODE": '"FROMDEFINE"',
          },
          files: {
            "/a.js": `
          console.log(process.env.APP_MODE, process.env.NODE_ENV, process.env.BUN_ENV);
        `,
          },
          run: {
            env: {
              APP_MODE: "runtime",
              NODE_ENV: "runtime",
              BUN_ENV: "runtime",
            },
            stdout: "FROMDEFINE aaa bbb\n",
          },
        });
      }

      itBundled("env/define outranks prefix", {
        env: {
          APP_MODE: "fromenv",
          APP_OTHER: "other_fromenv",
        },
        backend: backend,
        dotenv: "APP_*",
        define: {
          "process.env.APP_MODE": '"FROMDEFINE"',
        },
        files: {
          "/a.js": `
        console.log(process.env.APP_MODE, process.env.APP_OTHER);
      `,
        },
        run: {
          env: {
            APP_MODE: "runtime",
            APP_OTHER: "runtime",
          },
          stdout: "FROMDEFINE other_fromenv\n",
        },
      });

      // The values come from a .env file. A define of `undefined` keeps a variable out of the bundle.
      itBundled("env/define outranks inline, .env file", {
        backend: backend,
        dotenv: "inline",
        define: {
          "process.env.APP_MODE": '"FROMDEFINE"',
          "process.env.SECRET_KEY": "undefined",
        },
        files: {
          "/a.js": `
        console.log(process.env.APP_MODE, process.env.SECRET_KEY);
      `,
          "/.env": `APP_MODE=fromdotenv\nSECRET_KEY=hunter2\n`,
        },
        onAfterBundle(api) {
          api.expectFile("/out.js").not.toContain("hunter2");
        },
        run: {
          env: {
            APP_MODE: "runtime",
            SECRET_KEY: "runtime",
          },
          stdout: "FROMDEFINE undefined\n",
        },
      });

      // For NODE_ENV the define also selects the JSX runtime, as it does without `env`.
      for (const [ambient, defined, runtime] of [
        ["development", "production", "react/jsx-runtime"],
        ["production", "development", "react/jsx-dev-runtime"],
      ]) {
        itBundled(`env/define outranks inline, NODE_ENV=${ambient}`, {
          env: {
            NODE_ENV: ambient,
          },
          backend: backend,
          dotenv: "inline",
          packages: "external",
          define: {
            "process.env.NODE_ENV": JSON.stringify(defined),
          },
          files: {
            "/a.jsx": `
          console.log(process.env.NODE_ENV, <div />);
        `,
          },
          onAfterBundle(api) {
            const out = api.readFile("/out.js");
            expect({
              runtime: out.match(/from "(react\/[a-z-]+)"/)?.[1],
              nodeEnv: out.match(/console\.log\("([a-z]+)"/)?.[1],
            }).toEqual({ runtime, nodeEnv: defined });
          },
        });
      }

      // NODE_ENV is not set here. `--production` sets it, and the define outranks that value too.
      itBundled("env/define outranks inline, NODE_ENV of --production", {
        backend: backend,
        production: true,
        dotenv: "inline",
        define: {
          "process.env.NODE_ENV": '"staging"',
        },
        files: {
          "/a.js": `
        console.log(process.env.NODE_ENV);
      `,
        },
        run: {
          env: {
            NODE_ENV: "runtime",
          },
          stdout: "staging\n",
        },
      });

      // The transpiler of a macro inlines BUN_* variables, with no `env` option and with `--env disable`.
      for (const dotenv of [undefined, "disable"]) {
        itBundled(`env/define outranks the BUN_ prefix of a macro, ${dotenv ? "--env " + dotenv : "no --env"}`, {
          env: {
            BUN_APP_MODE: "fromenv",
          },
          backend: backend,
          dotenv,
          define: {
            "process.env.BUN_APP_MODE": '"FROMDEFINE"',
          },
          files: {
            "/a.ts": `
          import { mode } from "./macro.ts" with { type: "macro" };
          console.log(mode());
        `,
            "/macro.ts": `
          export function mode() {
            return process.env.BUN_APP_MODE;
          }
        `,
          },
          run: {
            env: {
              BUN_APP_MODE: "runtime",
            },
            stdout: "FROMDEFINE\n",
          },
        });
      }
    }
  });
}

// The fallback recipe of docs/bundler/index.mdx, next to a bunfig `[define]` of the same key.
test.concurrent.each([
  ["set", { FOO: "fromenv" }, "fromenv"],
  ["not set", {}, "fallback"],
])("a define computed in the build script is a fallback for a variable that is %s", async (_, env, expected) => {
  using dir = tempDir("bundler-env-fallback-recipe", {
    "bunfig.toml": `[define]\n"process.env.FOO" = '"BUNFIG"'\n`,
    "index.tsx": `console.log(process.env.FOO);`,
    "build.ts": `
      await Bun.build({
        entrypoints: ["./index.tsx"],
        outdir: "./out",
        env: "inline",
        define: {
          "process.env.FOO": JSON.stringify(Bun.env.FOO ?? "fallback"),
        },
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.ts"],
    env: { ...bunEnv, FOO: undefined, ...env },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  expect(await Bun.file(`${dir}/out/index.js`).text()).toContain(`console.log("${expected}");`);
});

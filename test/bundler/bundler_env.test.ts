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

    // env: "disable" must also suppress the implicit process.env.NODE_ENV define
    // so the bundle reads NODE_ENV at runtime (matches `bun build --env disable`).
    itBundled("env/disable-node-env", {
      backend: backend,
      dotenv: "disable",
      target: "node",
      files: {
        "/a.js": `
          console.log(JSON.stringify({
            dot: process.env.NODE_ENV,
            bracket: process.env["NODE_ENV"],
          }));
        `,
      },
      onAfterBundle(api) {
        const out = api.readFile("out.js");
        expect(out).toContain("process.env.NODE_ENV");
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

// The bundler reads the environment its process started with, and itBundled's
// api backend calls Bun.build() inside the test runner, so the builds below run
// in a child process whose environment holds the values being inlined.
test.concurrent("Bun.build env option: which process.env reads get inlined", async () => {
  using dir = tempDir("bun-build-env-option", {
    "a.js": `console.log(process.env.NODE_ENV, process.env.BUN_ENV, process.env.PUBLIC_FOO, process.env.PRIVATE_BAR);`,
    "build.ts": `
      const variants = {
        "unset": {},
        "disable": { env: "disable" },
        "disable, target bun": { env: "disable", target: "bun" },
        "false": { env: false },
        "null": { env: null },
        "0": { env: 0 },
        "inline": { env: "inline" },
        "true": { env: true },
        "1": { env: 1 },
        "PUBLIC_*": { env: "PUBLIC_*" },
        "bogus": { env: "bogus" },
      };
      const out = {};
      for (const [name, options] of Object.entries(variants)) {
        try {
          const result = await Bun.build({ entrypoints: ["./a.js"], target: "node", ...options });
          const text = await result.outputs[0].text();
          out[name] = text.split("\\n").find(line => line.startsWith("console.log("));
        } catch {
          out[name] = "threw";
        }
      }
      console.log(JSON.stringify(out));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build.ts"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      NODE_ENV: "from_build_env",
      BUN_ENV: "from_build_env",
      PUBLIC_FOO: "public_value",
      PRIVATE_BAR: "private_value",
    },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");

  const nothingInlined = `console.log(process.env.NODE_ENV, process.env.BUN_ENV, process.env.PUBLIC_FOO, process.env.PRIVATE_BAR);`;
  const everythingInlined = `console.log("from_build_env", "from_build_env", "public_value", "private_value");`;
  expect(JSON.parse(stdout)).toEqual({
    "unset": `console.log("from_build_env", "from_build_env", process.env.PUBLIC_FOO, process.env.PRIVATE_BAR);`,
    "disable": nothingInlined,
    "disable, target bun": nothingInlined,
    "false": nothingInlined,
    "null": nothingInlined,
    "0": nothingInlined,
    "inline": everythingInlined,
    "true": everythingInlined,
    "1": everythingInlined,
    "PUBLIC_*": `console.log("from_build_env", "from_build_env", "public_value", process.env.PRIVATE_BAR);`,
    "bogus": "threw",
  });
  expect(exitCode).toBe(0);
});

// Bun.build() shares the env loader of the process that calls it. env: "disable"
// must skip the implicit NODE_ENV define without taking the code path that loads
// .env files, or a build would add .env values to the calling process's
// environment (here: a process started with --no-env-file).
test.concurrent("Bun.build env: disable does not load .env files into the calling process", async () => {
  using dir = tempDir("bun-build-env-disable-dotenv", {
    ".env": "FROM_DOTENV=1\n",
    "a.js": `console.log(process.env.NODE_ENV, process.env.FROM_DOTENV);`,
    "build.ts": `
      const lines = {};
      for (const [name, env] of Object.entries({ "disable": "disable", "false": false, "null": null, "0": 0 })) {
        const result = await Bun.build({ entrypoints: ["./a.js"], target: "node", env });
        const text = await result.outputs[0].text();
        lines[name] = text.split("\\n").find(line => line.startsWith("console.log("));
      }
      // First read of process.env in this process, after the builds ran.
      console.log(JSON.stringify({ lines, FROM_DOTENV: process.env.FROM_DOTENV ?? null }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--no-env-file", "build.ts"],
    cwd: String(dir),
    env: { ...bunEnv, NODE_ENV: "from_build_env" },
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");

  const nothingInlined = `console.log(process.env.NODE_ENV, process.env.FROM_DOTENV);`;
  expect(JSON.parse(stdout)).toEqual({
    lines: { "disable": nothingInlined, "false": nothingInlined, "null": nothingInlined, "0": nothingInlined },
    FROM_DOTENV: null,
  });
  expect(exitCode).toBe(0);
});

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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

    itBundled("env/inline system", {
      env: {
        PATH: process.env.PATH,
      },
      backend: backend,
      dotenv: "inline",
      files: {
        "/a.js": `
        console.log(process.env.PATH);
      `,
      },
      run: {
        env: {
          PATH: "/fail",
        },
        stdout: process.env.PATH + "\n",
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

// A build inlines the env as of the Bun.build() call. The bundler thread reads
// its own copy of the env: a `process.env.X = ...` assignment while a build is
// in flight (on POSIX every assignment writes the native env map in place; on
// Windows only the proxy variables do, through their accessor) must not
// change, or free out from under, what the build inlines.
describe.concurrent("env is copied when the build is scheduled", () => {
  const key = isWindows ? "HTTPS_PROXY" : "BUNDLE_ENV_COPY";
  const prefixPattern = isWindows ? "HTTPS_*" : "BUNDLE_ENV_*";
  const atCall = "value-when-the-build-was-scheduled-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const duringBuild = "value-assigned-while-bundling-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  // The plugin's onLoad runs on the JS thread while the bundle is in flight,
  // after the bundler has built its defines.
  const pluginSource = (filter: string) => /* ts */ `
    export default {
      name: "assign-env-while-bundling",
      setup(build) {
        build.onLoad({ filter: ${filter} }, () => {
          process.env.${key} = ${JSON.stringify(duringBuild)};
          for (let i = 0; i < 64; i++) process.env["BUNDLE_ENV_COPY_GROW_" + i] = "grow-the-map";
          return { loader: "ts", contents: "console.log(process.env.${key});" };
        });
      },
    };
  `;

  test.each(["inline", prefixPattern] as const)("Bun.build({ env: %j })", async env => {
    using dir = tempDir("bun-build-env-copy", {
      "entry.ts": "export {};",
      "plugin.ts": pluginSource("/entry\\.ts$/"),
      "build-fixture.ts": /* ts */ `
        import plugin from "./plugin.ts";
        process.env.${key} = ${JSON.stringify(atCall)};
        const result = await Bun.build({
          entrypoints: ["./entry.ts"],
          env: ${JSON.stringify(env)},
          plugins: [plugin],
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
    expect(stdout).not.toContain(duringBuild);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // Bun.serve's HTML routes (without HMR) are built through the same bundler
  // thread, with env behavior and plugins coming from bunfig.
  test('Bun.serve HTML route with [serve.static] env = "inline"', async () => {
    using dir = tempDir("bun-serve-html-env-copy", {
      "bunfig.toml": /* toml */ `
        [serve.static]
        env = "inline"
        plugins = ["./plugin.ts"]
      `,
      "index.html": /* html */ `<!DOCTYPE html><html><body><script type="module" src="./app.ts"></script></body></html>`,
      "app.ts": "export {};",
      "plugin.ts": pluginSource("/app\\.ts$/"),
      "serve-fixture.ts": /* ts */ `
        import index from "./index.html";
        process.env.${key} = ${JSON.stringify(atCall)};
        using server = Bun.serve({
          port: 0,
          development: false,
          routes: { "/": index },
        });
        const html = await (await fetch(server.url)).text();
        const script = html.match(/src="([^"]+\\.js)"/)![1];
        process.stdout.write(await (await fetch(new URL(script, server.url))).text());
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "serve-fixture.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain(`console.log(${JSON.stringify(atCall)})`);
    expect(stdout).not.toContain(duringBuild);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  // Macros run in a VM that a bundler thread creates the first time a macro
  // runs on it and then reuses for every later build, so it must not keep
  // reading the env of the build that created it, which is freed with that
  // build. Two bundler threads and four builds guarantee that later builds run
  // their macro on a thread whose VM an earlier build created.
  test("macros in later builds reuse a VM created during an earlier build", async () => {
    const builds = 4;
    const env: Record<string, string> = { ...bunEnv, UV_THREADPOOL_SIZE: "2" };
    const files: Record<string, string> = {
      "macro.ts": /* ts */ `export function envValue(name: string) { return process.env[name]; }`,
      "build-fixture.ts": /* ts */ `
        for (let i = 0; i < ${builds}; i++) {
          const result = await Bun.build({ entrypoints: ["./entry" + i + ".ts"] });
          if (!result.success) throw new AggregateError(result.logs, "build " + i + " failed");
          process.stdout.write(await result.outputs[0].text());
        }
      `,
    };
    for (let i = 0; i < builds; i++) {
      // Each build reads a key no earlier build has read, so the lookup goes
      // to the VM's env instead of an already materialized process.env entry.
      env[`MACRO_ENV_${i}`] = `value-of-build-${i}`;
      files[`entry${i}.ts`] = /* ts */ `
        import { envValue } from "./macro.ts" with { type: "macro" };
        console.log(envValue("MACRO_ENV_${i}"));
      `;
    }
    using dir = tempDir("bun-build-env-macro-vm", files);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build-fixture.ts"],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.match(/console\.log\("(value-of-build-\d)"\)/g)).toEqual(
      Array.from({ length: builds }, (_, i) => `console.log("value-of-build-${i}")`),
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});

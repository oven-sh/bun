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
  });
}

// The define table is built from the env map when the build is configured.
// Assigning one of the proxy variables on process.env (the only process.env
// writes that reach the native env map) replaces the map entry that define was
// built from, so the define has to own its value: here that write happens
// while the build is still running, from a macro.
const proxyAtStart = "http://proxy-at-start.example:8080/" + Buffer.alloc(120, "a").toString();

describe("bundler/cli", () => {
  itBundled("env/inline survives macro proxy write", {
    backend: "cli",
    dotenv: "inline",
    env: { HTTPS_PROXY: proxyAtStart },
    files: {
      "/a.ts": /* ts */ `
        import { setProxy } from "./macro.ts" with { type: "macro" };
        setProxy();
        console.log(process.env.HTTPS_PROXY);
      `,
      "/macro.ts": /* ts */ `
        export function setProxy() {
          process.env.HTTPS_PROXY = "http://changed-by-macro.example:1/";
          return 0;
        }
      `,
    },
    onAfterBundle(api) {
      api.expectFile("/out.js").toContain(proxyAtStart);
      api.expectFile("/out.js").not.toContain("changed-by-macro");
    },
    run: {
      env: { HTTPS_PROXY: "http://not-inlined.example:1/" },
      stdout: proxyAtStart + "\n",
    },
  });
});

// A build inlines the env as of the call that started it. The bundler thread
// reads env from its own copy: `process.env.HTTPS_PROXY = ...` (one of the
// few assignments that write through to the native env map, replacing the
// stored value in place) while a build is in flight must not change, or free
// out from under, what the build inlines.
describe.concurrent("env is copied when the build is scheduled", () => {
  const atCall = "http://proxy-when-the-build-was-scheduled.example:1111/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const duringBuild = "http://proxy-assigned-while-bundling.example:2222/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  // The plugin's onLoad runs on the JS thread while the bundle is in flight,
  // after the bundler has built its defines.
  const pluginSource = (filter: string) => /* ts */ `
    export default {
      name: "assign-proxy-env-while-bundling",
      setup(build) {
        build.onLoad({ filter: ${filter} }, () => {
          process.env.HTTPS_PROXY = ${JSON.stringify(duringBuild)};
          return { loader: "ts", contents: "console.log(process.env.HTTPS_PROXY);" };
        });
      },
    };
  `;

  test.each(["inline", "HTTPS_*"] as const)("Bun.build({ env: %j })", async env => {
    using dir = tempDir("bun-build-env-copy", {
      "entry.ts": "export {};",
      "plugin.ts": pluginSource("/entry\\.ts$/"),
      "build-fixture.ts": /* ts */ `
        import plugin from "./plugin.ts";
        process.env.HTTPS_PROXY = ${JSON.stringify(atCall)};
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
        process.env.HTTPS_PROXY = ${JSON.stringify(atCall)};
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
  // runs on it and then reuses for every later build. It must not keep reading
  // the env of the build that created it: that env is freed with the build, and
  // a later build has its own. Two bundler threads and four builds guarantee
  // that later builds run their macro on a thread whose VM an earlier build
  // created.
  test("macros in later builds reuse a VM created during an earlier build", async () => {
    const builds = 4;
    const env: Record<string, string> = { ...bunEnv, UV_THREADPOOL_SIZE: "2" };
    // The first builds read a key set at process start. The later builds read
    // a proxy variable (the only process.env writes that reach the native env)
    // assigned right before that build is scheduled, after the VMs exist. A
    // VM's process.env only has the keys that existed when the VM was created,
    // so the proxy variables start with a placeholder value.
    const keys = ["MACRO_ENV_0", "MACRO_ENV_1", "HTTPS_PROXY", "HTTP_PROXY"];
    const files: Record<string, string> = {
      "macro.ts": /* ts */ `export function envValue(name: string) { return process.env[name]; }`,
      "build-fixture.ts": /* ts */ `
        const keys = ${JSON.stringify(keys)};
        for (let i = 0; i < ${builds}; i++) {
          if (i >= 2) process.env[keys[i]] = "value-of-build-" + i;
          const result = await Bun.build({ entrypoints: ["./entry" + i + ".ts"] });
          if (!result.success) throw new AggregateError(result.logs, "build " + i + " failed");
          process.stdout.write(await result.outputs[0].text());
        }
      `,
    };
    for (let i = 0; i < builds; i++) {
      // Each build reads a key no earlier build has read, so the lookup goes
      // to the VM's env instead of an already materialized process.env entry.
      env[keys[i]] = i < 2 ? `value-of-build-${i}` : `http://placeholder-for-build-${i}.example:1/`;
      files[`entry${i}.ts`] = /* ts */ `
        import { envValue } from "./macro.ts" with { type: "macro" };
        console.log(envValue(${JSON.stringify(keys[i])}));
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

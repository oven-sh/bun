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

// The define table is built from the env map when the build is configured.
// Assigning one of the proxy variables on process.env (the only process.env
// writes that reach the native env map) replaces the map entry that define was
// built from, so the define has to own its value: here that write happens
// while the build is still running, from a macro and from a plugin.
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

describe("bundler/api", () => {
  test.concurrent("env: inline survives a plugin assigning a proxy variable during the build", async () => {
    using dir = tempDir("bundler-env-inline-plugin-proxy", {
      "entry.ts": `export const replaced = "by the plugin";`,
      "build.ts": /* ts */ `
        const result = await Bun.build({
          entrypoints: ["./entry.ts"],
          env: "inline",
          plugins: [{
            name: "assign-proxy",
            setup(build) {
              build.onLoad({ filter: /entry\\.ts$/ }, () => {
                process.env.HTTPS_PROXY = "http://changed-by-plugin.example:1/";
                return { loader: "ts", contents: "export const proxy = process.env.HTTPS_PROXY;" };
              });
            },
          }],
        });
        if (!result.success) throw new AggregateError(result.logs, "build failed");
        process.stdout.write(await result.outputs[0].text());
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build.ts"],
      cwd: String(dir),
      env: { ...bunEnv, HTTPS_PROXY: proxyAtStart },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain(`var proxy = ${JSON.stringify(proxyAtStart)};`);
    expect(stdout).not.toContain("changed-by-plugin");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});

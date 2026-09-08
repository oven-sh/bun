import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { itBundled } from "./expectBundled";

for (let backend of ["api", "cli"] as const) {
  describe(`bundler/${backend}`, () => {
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

    // A variable from the process environment (not a .env file) is inlined at build time, spelled as the environment
    // spells it (on Windows the inlined name is case-sensitive even though process.env is not: `Path`, not `PATH`).
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

    // Test pattern matching - only vars with prefix are inlined
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

describe("Bun.build env", () => {
  // `env: "inline"` and `env: "PREFIX_*"` inline process.env as it is when Bun.build() is called, not the environment
  // the process started with: a variable the script deleted is not inlined, one it changed is inlined with the new
  // value, and one it added is inlined. The implicit `process.env.NODE_ENV` define reads the same environment.
  test("inlines the live process.env", async () => {
    using dir = tempDir("bun-build-live-env", {
      "entry.ts": `console.log([process.env.BUN_TEST_ENV_SECRET, process.env.BUN_TEST_ENV_PUB, process.env.BUN_TEST_ENV_LATE, process.env.OTHER_TEST_ENV_LATE, process.env.NODE_ENV].join(","));`,
      "build.ts": `
        delete process.env.BUN_TEST_ENV_SECRET;
        process.env.BUN_TEST_ENV_PUB = "changed-at-runtime";
        process.env.BUN_TEST_ENV_LATE = "set-at-runtime";
        process.env.OTHER_TEST_ENV_LATE = "other-set-at-runtime";
        process.env.NODE_ENV = "production";
        const results: Record<string, string | undefined> = {};
        for (const env of ["inline", "BUN_TEST_ENV_*"] as const) {
          const build = await Bun.build({ entrypoints: ["./entry.ts"], env });
          if (!build.success) throw new AggregateError(build.logs, "build failed");
          const output = await build.outputs[0].text();
          results[env] = output.split("\\n").find(line => line.startsWith("console.log"));
        }
        console.log(JSON.stringify(results));
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build.ts"],
      env: {
        ...bunEnv,
        BUN_TEST_ENV_SECRET: "hunter2",
        BUN_TEST_ENV_PUB: "startup-value",
        NODE_ENV: undefined,
        BUN_ENV: undefined,
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      inline: `console.log([process.env.BUN_TEST_ENV_SECRET, "changed-at-runtime", "set-at-runtime", "other-set-at-runtime", "production"].join(","));`,
      "BUN_TEST_ENV_*": `console.log([process.env.BUN_TEST_ENV_SECRET, "changed-at-runtime", "set-at-runtime", process.env.OTHER_TEST_ENV_LATE, "production"].join(","));`,
    });
    expect(exitCode).toBe(0);
  });
});

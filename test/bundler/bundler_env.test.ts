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

    // An explicit `--define process.env.X=...` must beat an env-derived value
    // for the same key. This is the cross-platform observable guarantee of
    // routing env-derived defines through a separate map that is consulted
    // only after the user define table.
    if (backend === "cli")
      itBundled("env/inline-explicit-define-wins", {
        env: {
          BUN_TEST_ENV_DEFINE_WINS: "from_env",
        },
        define: {
          "process.env.BUN_TEST_ENV_DEFINE_WINS": '"from_define"',
        },
        backend: backend,
        dotenv: "inline",
        files: {
          "/a.js": `
        console.log(process.env.BUN_TEST_ENV_DEFINE_WINS);
      `,
        },
        onAfterBundle(api) {
          const out = api.readFile("out.js");
          expect(out).toContain('"from_define"');
          expect(out).not.toContain("from_env");
        },
        run: {
          env: {
            BUN_TEST_ENV_DEFINE_WINS: "from_runtime",
          },
          stdout: "from_define\n",
        },
      });

    // On Windows the OS reports env-var names in their stored case (`Path`,
    // `SystemRoot`), but `process.env` reads are case-insensitive at runtime.
    // `env: "inline"` must match that: any casing in source resolves to the
    // same value. On POSIX env vars are case-sensitive, so only the exact
    // spelling inlines and the other two read the (unset) runtime env.
    if (backend === "cli")
      itBundled("env/inline-env-var-name-case", {
        env: {
          BUN_TEST_Env_Inline_MixedCase: "inlined",
        },
        backend: backend,
        dotenv: "inline",
        files: {
          "/a.js": `
        console.log(process.env.BUN_TEST_Env_Inline_MixedCase);
        console.log(process.env.BUN_TEST_ENV_INLINE_MIXEDCASE);
        console.log(process.env.bun_test_env_inline_mixedcase);
      `,
        },
        onAfterBundle(api) {
          const out = api.readFile("out.js");
          if (isWindows) expect(out).not.toContain("process.env.");
        },
        run: {
          env: {
            BUN_TEST_Env_Inline_MixedCase: "runtime",
          },
          stdout: isWindows ? "inlined\ninlined\ninlined\n" : "inlined\nundefined\nundefined\n",
        },
      });

    // `--env PREFIX_*` prefix matching is likewise case-insensitive on
    // Windows only.
    if (backend === "cli")
      itBundled("env/prefix-env-var-name-case", {
        env: {
          Bun_Test_Prefix_A: "a",
          BUN_TEST_PREFIX_B: "b",
        },
        backend: backend,
        dotenv: "BUN_TEST_PREFIX_*",
        files: {
          "/a.js": `
        console.log(process.env.Bun_Test_Prefix_A);
        console.log(process.env.bun_test_prefix_a);
        console.log(process.env.BUN_TEST_PREFIX_B);
      `,
        },
        run: {
          stdout: isWindows ? "a\na\nb\n" : "undefined\nundefined\nb\n",
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

// Direct `bun build` spawn so the Windows path is covered independently of the
// itBundled registration path (which currently skips on Windows, see #34552).
describe("bundler/env via spawn", () => {
  async function buildInline(
    src: string,
    extra: { env?: Record<string, string>; define?: Record<string, string>; dotenv?: string } = {},
  ) {
    using dir = tempDir("bundler-env-inline", { "a.js": src });
    const cmd = [bunExe(), "build", String(dir) + "/a.js", "--env", extra.dotenv ?? "inline"];
    for (const [k, v] of Object.entries(extra.define ?? {})) cmd.push(`--define:${k}=${v}`);
    await using proc = Bun.spawn({
      cmd,
      env: { ...bunEnv, ...(extra.env ?? {}) },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return stdout;
  }

  test("process.env.X matches the env-var name case-insensitively on Windows only", async () => {
    const out = await buildInline(
      `console.log(process.env.BUN_TEST_Env_Mixed);
console.log(process.env.BUN_TEST_ENV_MIXED);
console.log(process.env.bun_test_env_mixed);
`,
      { env: { BUN_TEST_Env_Mixed: "inlined" } },
    );
    const inlined = (out.match(/"inlined"/g) ?? []).length;
    if (isWindows) {
      expect(out).not.toContain("process.env.");
      expect(inlined).toBe(3);
    } else {
      expect(inlined).toBe(1);
      expect(out).toContain("process.env.BUN_TEST_ENV_MIXED");
      expect(out).toContain("process.env.bun_test_env_mixed");
    }
  });

  test("--env PREFIX_* matches case-insensitively on Windows only", async () => {
    const out = await buildInline(
      `console.log(process.env.Bun_Test_EnvPfx_A);
console.log(process.env.BUN_TEST_ENVPFX_B);
`,
      { env: { Bun_Test_EnvPfx_A: "a", BUN_TEST_ENVPFX_B: "b" }, dotenv: "BUN_TEST_ENVPFX_*" },
    );
    if (isWindows) {
      expect(out).not.toContain("process.env.");
      expect(out).toContain('"a"');
      expect(out).toContain('"b"');
    } else {
      expect(out).toContain("process.env.Bun_Test_EnvPfx_A");
      expect(out).toContain('"b"');
    }
  });

  test("process.env?.X is not inlined by --env inline", async () => {
    const out = await buildInline(`console.log(process.env?.BUN_TEST_ENV_OPT);\n`, {
      env: { BUN_TEST_ENV_OPT: "inlined" },
    });
    expect(out).toContain("process.env?.BUN_TEST_ENV_OPT");
    expect(out).not.toContain('"inlined"');
  });
});

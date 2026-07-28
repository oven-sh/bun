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

// Patterns that used to be silently accepted but are now rejected.
// A leading '*' ("*_PUBLIC", "*") previously meant "inline every env var",
// and any text after the first '*' ("A*B") was dropped with no diagnostic.
describe("env/invalid-pattern", () => {
  const source = `console.log(process.env.SECRET_ZZ, process.env.A_B);`;
  const childEnv = { ...bunEnv, SECRET_ZZ: "sec", A_B: "ab" };

  const cases = [
    { pattern: "*_PUBLIC", expect: "must be the final character" },
    { pattern: "A*B", expect: "must be the final character" },
    { pattern: "A*B*", expect: "must be the final character" },
    { pattern: "*", expect: "inline every environment variable" },
  ] as const;

  describe.each(cases)("$pattern", ({ pattern, expect: fragment }) => {
    test.concurrent("cli", async () => {
      using dir = tempDir("bundler-env-invalid", { "a.js": source });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "build", "a.js", `--env=${pattern}`],
        env: childEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(fragment);
      expect(stdout).not.toContain("sec");
      expect(exitCode).not.toBe(0);
    });

    test.concurrent("Bun.build", async () => {
      using dir = tempDir("bundler-env-invalid", { "a.js": source });
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `try { await Bun.build({ entrypoints: ["a.js"], env: ${JSON.stringify(pattern)} }); console.log("built"); } catch (e) { console.error(e.message); process.exitCode = 1; }`,
        ],
        env: childEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(fragment);
      expect(stdout).not.toContain("built");
      expect(exitCode).not.toBe(0);
    });
  });

  // Positive control: a single trailing '*' with a non-empty prefix is still
  // accepted and only inlines matching vars.
  test.concurrent("trailing-star prefix still works", async () => {
    using dir = tempDir("bundler-env-valid", {
      "a.js": `console.log(process.env.A_B, process.env.SECRET_ZZ);`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "a.js", "--env=A_*"],
      env: childEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toContain(`"ab"`);
    expect(stdout).toContain("process.env.SECRET_ZZ");
    expect(stdout).not.toContain(`"sec"`);
    expect(exitCode).toBe(0);
  });
});

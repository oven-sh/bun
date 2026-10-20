import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
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

describe("process.env.NODE_ENV in a build", () => {
  const unset = { NODE_ENV: undefined, BUN_ENV: undefined };

  async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
    await using proc = Bun.spawn({ cmd, env: { ...bunEnv, ...env }, cwd, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return stdout;
  }

  async function bundle(args: string[], buildEnv: Record<string, string> = {}) {
    using dir = tempDir("bundler-node-env", { "entry.js": "console.log(process.env.NODE_ENV);" });
    await run([bunExe(), "build", "entry.js", "--outfile=out.js", ...args], String(dir), { ...unset, ...buildEnv });
    return await Bun.file(join(String(dir), "out.js")).text();
  }

  const bunOutput = (value: string) => `// @bun\n// entry.js\nconsole.log(${value});\n`;

  test.concurrent("--target=bun reads it at runtime when the build did not set it", async () => {
    expect(await bundle(["--target=bun"])).toBe(bunOutput("process.env.NODE_ENV"));
  });

  test.concurrent("--target=node reads it at runtime when the build did not set it", async () => {
    expect(await bundle(["--target=node"])).toBe("// entry.js\nconsole.log(process.env.NODE_ENV);\n");
  });

  test.concurrent("--target=bun reads it at runtime when the build set it to an empty string", async () => {
    expect(await bundle(["--target=bun"], { NODE_ENV: "" })).toBe(bunOutput("process.env.NODE_ENV"));
  });

  test.concurrent("--target=bun --production uses production", async () => {
    expect(await bundle(["--target=bun", "--production"])).toBe(`// @bun\nconsole.log("production");\n`);
  });

  test.concurrent("--target=bun uses a NODE_ENV set at build time", async () => {
    expect(await bundle(["--target=bun"], { NODE_ENV: "staging" })).toBe(bunOutput(`"staging"`));
  });

  test.concurrent("--target=bun uses BUN_ENV before NODE_ENV", async () => {
    expect(await bundle(["--target=bun"], { BUN_ENV: "staging", NODE_ENV: "other" })).toBe(bunOutput(`"staging"`));
  });

  test.concurrent("--target=browser uses development when the build did not set it", async () => {
    expect(await bundle(["--target=browser"])).toBe(`// entry.js\nconsole.log("development");\n`);
  });

  test.concurrent("Bun.build with target bun reads it at runtime", async () => {
    using dir = tempDir("bundler-node-env-api", {
      "entry.js": "console.log(process.env.NODE_ENV, process.env.BUN_ENV);",
      "build.js": `
        const { outputs } = await Bun.build({ entrypoints: ["./entry.js"], target: "bun" });
        process.stdout.write(await outputs[0].text());
      `,
    });
    expect(await run([bunExe(), "build.js"], String(dir), unset)).toBe(
      "// @bun\n// entry.js\nconsole.log(process.env.NODE_ENV, process.env.BUN_ENV);\n",
    );
  });

  itBundled("env/CompileReadsNodeEnvAtRuntime", {
    backend: "cli",
    compile: true,
    env: unset,
    files: { "/entry.js": "console.log(process.env.NODE_ENV);" },
    run: { env: { NODE_ENV: "production" }, stdout: "production" },
  });

  test.concurrent("the browser chunks of a server build use development", async () => {
    using dir = tempDir("bundler-node-env-fullstack", {
      "server.js": `import page from "./index.html"; console.log(page, process.env.NODE_ENV);`,
      "index.html": `<!doctype html><html><body><script src="./client.jsx"></script></body></html>`,
      "client.jsx": `console.log(process.env.NODE_ENV, process.env.BUN_ENV, <p />);`,
    });
    await run(
      [bunExe(), "build", "server.js", "--target=bun", "--outdir=dist", "--external=react/*"],
      String(dir),
      unset,
    );

    const texts: Record<string, string> = {};
    for (const file of new Bun.Glob("*.js").scanSync(join(String(dir), "dist"))) {
      texts[file.startsWith("server") ? "server" : "client"] = await Bun.file(join(String(dir), "dist", file)).text();
    }
    expect(texts.server).toContain("process.env.NODE_ENV");
    expect(texts.client).toContain(`console.log("development", "development", `);
    expect(texts.client).toContain(`"react/jsx-dev-runtime"`);
  });

  describe("with JSX", () => {
    const files = {
      "app.jsx": `console.log(process.env.NODE_ENV, <div />.type);`,
      "build.js": `
        const { outputs } = await Bun.build({
          entrypoints: ["./app.jsx"],
          target: "bun",
          external: ["react/*"],
          jsx: JSON.parse(process.argv[2]),
        });
        process.stdout.write(await outputs[0].text());
      `,
    };

    test.concurrent.each([["production"], ["development"], [undefined]])(
      "a React server build with no NODE_ENV runs with NODE_ENV=%s",
      async nodeEnv => {
        using dir = tempDir("bundler-node-env-react", files);
        symlinkSync(join(import.meta.dir, "../node_modules"), join(String(dir), "node_modules"), "junction");
        await run([bunExe(), "build", "app.jsx", "--target=bun", "--outfile=out.js"], String(dir), unset);
        expect(await run([bunExe(), "out.js"], String(dir), { ...unset, NODE_ENV: nodeEnv })).toBe(`${nodeEnv} div\n`);
      },
    );

    async function jsxImport(
      args: string[],
      extraFiles: Record<string, string>,
      buildEnv: Record<string, string> = {},
    ) {
      using dir = tempDir("bundler-node-env-jsx", { ...files, ...extraFiles });
      const stdout = await run(
        [bunExe(), "build", "app.jsx", "--target=bun", "--external=react/*", ...args],
        String(dir),
        { ...unset, ...buildEnv },
      );
      return stdout.match(/"react\/[a-z-]+"/)?.[0];
    }

    test.concurrent("a build with no NODE_ENV emits the transform both React builds export", async () => {
      expect(await jsxImport([], {})).toBe(`"react/jsx-runtime"`);
    });

    test.concurrent("tsconfig react-jsxdev keeps jsxDEV", async () => {
      const tsconfig = JSON.stringify({ compilerOptions: { jsx: "react-jsxdev" } });
      expect(await jsxImport([], { "tsconfig.json": tsconfig })).toBe(`"react/jsx-dev-runtime"`);
    });

    test.concurrent("NODE_ENV=development at build time keeps jsxDEV", async () => {
      expect(await jsxImport([], {}, { NODE_ENV: "development" })).toBe(`"react/jsx-dev-runtime"`);
    });

    test.concurrent("a define of NODE_ENV keeps jsxDEV", async () => {
      const define = `--define=process.env.NODE_ENV="development"`;
      expect(await jsxImport([define], {})).toBe(`"react/jsx-dev-runtime"`);
    });

    test.concurrent.each([
      [{}, `"react/jsx-runtime"`],
      [{ development: true }, `"react/jsx-dev-runtime"`],
      [{ runtime: "react-jsxdev" }, `"react/jsx-dev-runtime"`],
    ])("Bun.build with jsx %j imports %s", async (jsx, expected) => {
      using dir = tempDir("bundler-node-env-jsx-api", files);
      const stdout = await run([bunExe(), "build.js", JSON.stringify(jsx)], String(dir), unset);
      expect(stdout.match(/"react\/[a-z-]+"/)?.[0]).toBe(expected);
    });
  });
});

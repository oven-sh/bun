import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/23959
// Bun.build always assumes "react-jsxdev" even when "react-jsx" should be used
describe("NODE_ENV=production should use production JSX transform", () => {
  test("bun build --no-bundle with NODE_ENV=production uses jsx instead of jsxDEV", async () => {
    using dir = tempDir("issue-23959", {
      "input.tsx": `console.log(<div>Hello</div>);`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "input.tsx"],
      cwd: String(dir),
      env: { ...bunEnv, NODE_ENV: "production" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

    // Should use production jsx runtime, not development jsxDEV
    expect(stdout).toContain("/jsx-runtime");
    expect(stdout).not.toContain("/jsx-dev-runtime");
    expect(stdout).not.toContain("jsxDEV");
    expect(await proc.exited).toBe(0);
  });

  test("bun build --no-bundle with --production uses jsx instead of jsxDEV", async () => {
    using dir = tempDir("issue-23959-flag", {
      "input.tsx": `console.log(<div>Hello</div>);`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "--production", "input.tsx"],
      cwd: String(dir),
      env: { ...bunEnv },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

    // Should use production jsx runtime
    expect(stdout).toContain("/jsx-runtime");
    expect(stdout).not.toContain("/jsx-dev-runtime");
    expect(stdout).not.toContain("jsxDEV");
    expect(await proc.exited).toBe(0);
  });

  test("bun build --no-bundle with NODE_ENV=production and tsconfig react-jsx uses jsx", async () => {
    using dir = tempDir("issue-23959-tsconfig", {
      "input.tsx": `console.log(<div>Hello</div>);`,
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          jsx: "react-jsx",
          jsxImportSource: "react",
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "input.tsx"],
      cwd: String(dir),
      env: { ...bunEnv, NODE_ENV: "production" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

    // Should use production jsx runtime
    expect(stdout).toContain("/jsx-runtime");
    expect(stdout).not.toContain("/jsx-dev-runtime");
    expect(stdout).not.toContain("jsxDEV");
    expect(await proc.exited).toBe(0);
  });

  test("bun build --no-bundle with NODE_ENV=development uses jsxDEV", async () => {
    using dir = tempDir("issue-23959-dev", {
      "input.tsx": `console.log(<div>Hello</div>);`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "input.tsx"],
      cwd: String(dir),
      env: { ...bunEnv, NODE_ENV: "development" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

    // Should use development jsxDEV runtime
    expect(stdout).toContain("jsxDEV");
    expect(stdout).toContain("/jsx-dev-runtime");
    expect(await proc.exited).toBe(0);
  });

  test("bun build (bundled) with NODE_ENV=production uses production jsx", async () => {
    using dir = tempDir("issue-23959-bundled", {
      "input.tsx": `
        import { jsx } from "react/jsx-runtime";
        console.log(jsx("div", { children: "Hello" }));
      `,
      "node_modules/react/jsx-runtime.js": `
        export function jsx(type, props, key) {
          return { type, props, key, runtime: "production" };
        }
      `,
      "node_modules/react/jsx-dev-runtime.js": `
        export function jsxDEV(type, props, key) {
          return { type, props, key, runtime: "development" };
        }
      `,
      "node_modules/react/package.json": JSON.stringify({ name: "react", version: "19.0.0" }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          jsx: "react-jsx",
          jsxImportSource: "react",
        },
      }),
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "input.tsx"],
      cwd: String(dir),
      env: { ...bunEnv, NODE_ENV: "production" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);

    // Bundled output should use production jsx, not jsxDEV
    expect(stdout).not.toContain("jsxDEV");
    expect(stdout).not.toContain("jsx_dev_runtime");
    expect(await proc.exited).toBe(0);
  });
});

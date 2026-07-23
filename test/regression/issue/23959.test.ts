import { test, expect } from "bun:test";
import { bunExe, bunEnv, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/23959
// With `NODE_ENV=production`, `bun build` must emit the production automatic
// runtime (`react/jsx-runtime`, `jsx(...)`) even when a tsconfig sets
// `jsx: "react-jsx"`. It regressed to always emitting the development runtime
// (`react/jsx-dev-runtime`, `jsxDEV(...)`).
test("bun build respects NODE_ENV=production for automatic JSX runtime (#23959)", () => {
  using dir = tempDir("23959", {
    "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
    "test.tsx": `console.log(<div>Hello</div>);`,
  });

  const result = Bun.spawnSync({
    cmd: [bunExe(), "build", "test.tsx", "--external", "react"],
    env: { ...bunEnv, NODE_ENV: "production" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();

  // Production: must use the production runtime, never the dev one.
  expect(stdout).toContain("react/jsx-runtime");
  expect(stdout).not.toContain("react/jsx-dev-runtime");
  expect(stdout).not.toContain("jsxDEV");

  // Surface stderr on failure, then assert the exit code last.
  if (result.exitCode !== 0) expect(stderr).toBe("");
  expect(result.exitCode).toBe(0);
});

// Counterpart: without NODE_ENV=production, the automatic runtime stays in
// development mode (this is the existing, intended behavior — guards against
// "fixing" #23959 by forcing production unconditionally).
test("bun build keeps the development JSX runtime by default (#23959)", () => {
  using dir = tempDir("23959-dev", {
    "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
    "test.tsx": `console.log(<div>Hello</div>);`,
  });

  const result = Bun.spawnSync({
    cmd: [bunExe(), "build", "test.tsx", "--external", "react"],
    env: { ...bunEnv, NODE_ENV: undefined },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = result.stdout.toString();
  const stderr = result.stderr.toString();

  expect(stdout).toContain("react/jsx-dev-runtime");
  expect(stdout).not.toContain("react/jsx-runtime");

  if (result.exitCode !== 0) expect(stderr).toBe("");
  expect(result.exitCode).toBe(0);
});

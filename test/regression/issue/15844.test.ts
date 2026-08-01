// https://github.com/oven-sh/bun/issues/15844
// bunfig.toml jsx* fields must override tsconfig.json compilerOptions.jsx*.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

const indexTsx = `export const App = () => <div className="app">hello</div>;\n`;

async function build(cwd: string, extra: string[] = []) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./index.tsx", "--external", "react", "--external", "preact", ...extra],
    env: bunEnv,
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe("bunfig jsx overrides tsconfig jsx (#15844)", () => {
  test.concurrent("bunfig jsx = 'react' wins over tsconfig jsx: 'react-jsx'", async () => {
    using dir = tempDir("bunfig-jsx-runtime", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
      "bunfig.toml": `jsx = "react"\njsxFactory = "React.createElement"\n`,
      "index.tsx": indexTsx,
    });
    const { stdout, stderr, exitCode } = await build(String(dir));
    expect(stderr).toBe("");
    expect(stdout).toContain("React.createElement");
    expect(stdout).not.toContain("jsx-dev-runtime");
    expect(stdout).not.toContain("jsx-runtime");
    expect(exitCode).toBe(0);
  });

  test.concurrent("bunfig jsxImportSource wins over tsconfig jsxImportSource", async () => {
    using dir = tempDir("bunfig-jsx-import-source", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "react" } }),
      "bunfig.toml": `jsxImportSource = "preact"\n`,
      "index.tsx": indexTsx,
    });
    const { stdout, stderr, exitCode } = await build(String(dir));
    expect(stderr).toBe("");
    // runtime is automatic (from tsconfig, bunfig did not set it), importSource preact (from bunfig)
    expect(stdout).toContain(`"preact/jsx-runtime"`);
    expect(stdout).not.toContain(`"react/jsx-`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("--jsx-runtime wins over tsconfig jsx", async () => {
    using dir = tempDir("cli-jsx-runtime", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
      "index.tsx": indexTsx,
    });
    const { stdout, stderr, exitCode } = await build(String(dir), ["--jsx-runtime", "classic"]);
    expect(stderr).toBe("");
    expect(stdout).toContain("React.createElement");
    expect(stdout).not.toContain("jsx-runtime");
    expect(exitCode).toBe(0);
  });

  test.concurrent("bunfig jsxFactory wins over tsconfig jsxFactory", async () => {
    using dir = tempDir("bunfig-jsx-factory", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react", jsxFactory: "React.createElement" } }),
      "bunfig.toml": `jsx = "react"\njsxFactory = "h"\n`,
      "index.tsx": indexTsx,
    });
    const { stdout, stderr, exitCode } = await build(String(dir));
    expect(stderr).toBe("");
    expect(stdout).toMatch(/\bh\(/);
    expect(stdout).not.toContain("React.createElement");
    expect(exitCode).toBe(0);
  });

  test.concurrent("tsconfig jsx still applies when bunfig has no jsx keys", async () => {
    using dir = tempDir("bunfig-no-jsx", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react", jsxFactory: "h" } }),
      "bunfig.toml": `logLevel = "error"\n`,
      "index.tsx": indexTsx,
    });
    const { stdout, stderr, exitCode } = await build(String(dir));
    expect(stderr).toBe("");
    expect(stdout).toMatch(/\bh\(/);
    expect(exitCode).toBe(0);
  });

  test.concurrent("--tsconfig-override does not emit 'directory mismatch'", async () => {
    using dir = tempDir("tsconfig-override-no-mismatch", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
      "config/tsconfig.build.json": JSON.stringify({ compilerOptions: { jsx: "react" } }),
      "index.tsx": indexTsx,
    });
    const override = path.join(String(dir), "config", "tsconfig.build.json");
    const { stdout, stderr, exitCode } = await build(String(dir), ["--tsconfig-override", override]);
    expect(stderr).not.toContain("Internal error: directory mismatch");
    expect(stderr).toBe("");
    expect(stdout).toContain("React.createElement");
    expect(exitCode).toBe(0);
  });
});

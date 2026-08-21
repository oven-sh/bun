// https://github.com/oven-sh/bun/issues/15844
// bunfig.toml jsx* fields must override tsconfig.json compilerOptions.jsx*.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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

  test.concurrent("tsconfig jsxImportSource reaches the key-after-spread createElement fallback", async () => {
    using dir = tempDir("tsconfig-import-source-pkgname", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx", jsxImportSource: "preact" } }),
      "index.tsx": `export const A = (p: any) => <div {...p} key="k" />;\n`,
    });
    const { stdout, stderr, exitCode } = await build(String(dir));
    // key-after-spread is the one automatic-runtime shape that falls back to createElement,
    // so this is the only warning expected on stderr.
    expect(stderr).toContain('"key" prop after a {...spread} is deprecated in JSX');
    expect(stderr).not.toContain("error:");
    expect(stdout).toContain(`from "preact"`);
    expect(stdout).not.toContain(`from "react"`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("bunfig jsx = 'react-jsxDEV' survives an unrelated --jsx-* flag", async () => {
    using dir = tempDir("bunfig-jsxdev-with-cli-flag", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
      "bunfig.toml": `jsx = "react-jsxDEV"\n`,
      "index.tsx": indexTsx,
    });
    const { stdout, stderr, exitCode } = await build(String(dir), ["--jsx-import-source", "react"]);
    expect(stderr).toBe("");
    expect(stdout).toContain("jsx-dev-runtime");
    expect(stdout).not.toContain(`"react/jsx-runtime"`);
    expect(exitCode).toBe(0);
  });

  test.concurrent("bun test --parallel workers apply the same precedence as a serial run", async () => {
    // bunfig sets only jsxImportSource, so tsconfig's classic runtime must still
    // apply. The parallel coordinator forwards the jsx config to each worker as
    // --jsx-* flags; forwarding a field the user did not set would lock it in the
    // worker and make the two modes transpile the same file differently.
    const runtimeStub = `export const jsx = () => "automatic"; export const jsxs = jsx; export const jsxDEV = jsx; export const Fragment = "F";\n`;
    const testFile = (name: string) =>
      `import { test } from "bun:test";\n` +
      `globalThis.React = { createElement: () => "classic" };\n` +
      `test(${JSON.stringify(name)}, () => { console.log("RUNTIME_${name}=" + (<div />)); });\n`;
    using dir = tempDir("bunfig-jsx-parallel-parity", {
      "tsconfig.json": JSON.stringify({ compilerOptions: { jsx: "react" } }),
      "bunfig.toml": `jsxImportSource = "preact"\n`,
      "node_modules/preact/package.json": JSON.stringify({ name: "preact", version: "0.0.0" }),
      "node_modules/preact/jsx-runtime.js": runtimeStub,
      "node_modules/preact/jsx-dev-runtime.js": runtimeStub,
      // Two files so --parallel=2 actually spawns workers instead of falling back to serial.
      "a.test.tsx": testFile("a"),
      "b.test.tsx": testFile("b"),
    });

    async function run(extraArgs: string[]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "test", ...extraArgs],
        env: { ...bunEnv, BUN_TEST_PARALLEL_SCALE_MS: "0" },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const runtimes = [...(stdout + stderr).matchAll(/RUNTIME_([ab])=(\w+)/g)].map(m => `${m[1]}=${m[2]}`).sort();
      // A failed run carries its stderr into the compared object so the diff says why.
      return { runtimes, exitCode, ...(exitCode === 0 ? {} : { stderr }) };
    }

    const expected = { runtimes: ["a=classic", "b=classic"], exitCode: 0 };
    expect(await run([])).toEqual(expected);
    expect(await run(["--parallel=2"])).toEqual(expected);
  });
});

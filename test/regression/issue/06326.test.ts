import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "node:path";

describe("tsconfig extends with package specifiers", () => {
  test("resolves extends from node_modules", async () => {
    using dir = tempDir("issue-6326", {
      "node_modules/@acme/configuration/tsconfig.base.json": JSON.stringify({
        compilerOptions: {
          jsxFactory: "h",
        },
      }),
      "tsconfig.json": JSON.stringify({
        extends: "@acme/configuration/tsconfig.base.json",
        compilerOptions: {
          jsx: "react",
        },
      }),
      // h() is only used as jsxFactory if the extends is properly resolved
      "index.tsx": `
function h(tag: string, props: any, ...children: any[]) {
  return { tag, props, children };
}
console.log(JSON.stringify(<div id="test" />));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", path.join(String(dir), "index.tsx")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // If jsxFactory "h" was inherited, we get our custom element object.
    // If not inherited, React.createElement is used and fails.
    expect(stdout).toContain('"tag":"div"');
    expect(exitCode).toBe(0);
  });

  test("resolves extends for scoped package", async () => {
    using dir = tempDir("issue-6326-scoped", {
      "node_modules/@acme/configuration/tsconfig.base.json": JSON.stringify({
        compilerOptions: {
          jsxFactory: "h",
          jsxFragmentFactory: "Fragment",
        },
      }),
      "tsconfig.json": JSON.stringify({
        extends: "@acme/configuration/tsconfig.base.json",
        compilerOptions: {
          jsx: "react",
        },
      }),
      "index.tsx": `
function h(tag: any, props: any, ...children: any[]) {
  return { tag: typeof tag === 'function' ? 'fragment' : tag, props, children };
}
function Fragment(props: any) { return props; }
console.log(JSON.stringify(<><span /></>));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", path.join(String(dir), "index.tsx")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain('"tag":"fragment"');
    expect(exitCode).toBe(0);
  });

  test("resolves extends for unscoped package", async () => {
    using dir = tempDir("issue-6326-unscoped", {
      "node_modules/my-config/tsconfig.json": JSON.stringify({
        compilerOptions: {
          jsxFactory: "h",
        },
      }),
      "tsconfig.json": JSON.stringify({
        extends: "my-config/tsconfig.json",
        compilerOptions: {
          jsx: "react",
        },
      }),
      "index.tsx": `
function h(tag: string, props: any, ...children: any[]) {
  return { tag, props, children };
}
console.log(JSON.stringify(<div />));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", path.join(String(dir), "index.tsx")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain('"tag":"div"');
    expect(exitCode).toBe(0);
  });

  test("relative extends still works", async () => {
    using dir = tempDir("issue-6326-relative", {
      "base/tsconfig.base.json": JSON.stringify({
        compilerOptions: {
          jsxFactory: "h",
        },
      }),
      "tsconfig.json": JSON.stringify({
        extends: "./base/tsconfig.base.json",
        compilerOptions: {
          jsx: "react",
        },
      }),
      "index.tsx": `
function h(tag: string, props: any, ...children: any[]) {
  return { tag, props, children };
}
console.log(JSON.stringify(<div />));
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", path.join(String(dir), "index.tsx")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain('"tag":"div"');
    expect(exitCode).toBe(0);
  });
});

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("jsxImportSource from nested tsconfig is used when running from workspace root", async () => {
  using dir = tempDir("issue-28605", {
    "package.json": JSON.stringify({
      private: true,
      workspaces: ["services/connect"],
    }),
    "node_modules/chat/package.json": JSON.stringify({
      name: "chat",
      version: "1.0.0",
      exports: {
        "./jsx-runtime": "./jsx-runtime.js",
        "./jsx-dev-runtime": "./jsx-dev-runtime.js",
      },
    }),
    "node_modules/chat/jsx-runtime.js": `
      export function jsx(type, props) { return JSON.stringify({ type, props }); }
      export function jsxs(type, props) { return JSON.stringify({ type, props }); }
      export const Fragment = "Fragment";
    `,
    "node_modules/chat/jsx-dev-runtime.js": `
      export function jsxDEV(type, props) { return JSON.stringify({ type, props }); }
      export const Fragment = "Fragment";
    `,
    "services/connect/package.json": JSON.stringify({
      name: "connect",
      version: "1.0.0",
    }),
    "services/connect/tsconfig.json": JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
        jsxImportSource: "chat",
      },
      include: ["src/**/*"],
    }),
    "services/connect/src/lib/prompt.tsx": `
      export function Prompt() {
        return <div>hello</div>;
      }
    `,
    "services/connect/src/app.ts": `
      import { Prompt } from "./lib/prompt.tsx";
      console.log(Prompt());
    `,
  });

  // Run from the workspace root (no tsconfig.json there)
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "./services/connect/src/app.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Cannot find module");
  expect(stdout).toContain('"type":"div"');
  expect(exitCode).toBe(0);
});

test("jsxImportSource from deeply nested tsconfig overrides root tsconfig", async () => {
  using dir = tempDir("issue-28605-nested", {
    "package.json": JSON.stringify({ private: true }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
        jsxImportSource: "root-jsx",
      },
    }),
    "node_modules/nested-jsx/package.json": JSON.stringify({
      name: "nested-jsx",
      version: "1.0.0",
      exports: {
        "./jsx-runtime": "./jsx-runtime.js",
        "./jsx-dev-runtime": "./jsx-dev-runtime.js",
      },
    }),
    "node_modules/nested-jsx/jsx-runtime.js": `
      export function jsx(type, props) { return JSON.stringify({ source: "nested", type, props }); }
      export function jsxs(type, props) { return JSON.stringify({ source: "nested", type, props }); }
      export const Fragment = "Fragment";
    `,
    "node_modules/nested-jsx/jsx-dev-runtime.js": `
      export function jsxDEV(type, props) { return JSON.stringify({ source: "nested", type, props }); }
      export const Fragment = "Fragment";
    `,
    "packages/ui/tsconfig.json": JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
        jsxImportSource: "nested-jsx",
      },
    }),
    "packages/ui/component.tsx": `
      export function Component() {
        return <span>nested</span>;
      }
    `,
    "packages/ui/dynamic-component.tsx": `
      export function DynamicComponent() {
        return <span>dynamic-nested</span>;
      }
    `,
    "entry.ts": `
      import { Component } from "./packages/ui/component.tsx";
      console.log(Component());
      // Dynamic import of a distinct file exercises RuntimeTranspilerStore (post-startup path)
      const { DynamicComponent } = await import("./packages/ui/dynamic-component.tsx");
      console.log(DynamicComponent());
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "./entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Cannot find module");
  expect(stdout).toContain('"source":"nested"');
  expect(exitCode).toBe(0);
});

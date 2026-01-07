// https://github.com/oven-sh/bun/issues/4774
// TypeScript project references should be supported
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("tsconfig.json references should work with paths", async () => {
  using dir = tempDir("tsconfig-references", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }],
    }),
    "tsconfig.app.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["./src/*"],
        },
      },
    }),
    "src/foo.ts": `export const foo = "hello from foo";`,
    "index.ts": `
      import { foo } from "@/foo";
      console.log(foo);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Cannot find module");
  expect(stdout).toBe("hello from foo\n");
  expect(exitCode).toBe(0);
});

// TODO: JSX settings from references don't work yet during transpilation
// This is a separate issue from path resolution which is the main focus of #4774
test.skip("tsconfig.json references should work with jsxImportSource", async () => {
  using dir = tempDir("tsconfig-jsx-references", {
    "package.json": JSON.stringify({ name: "test", type: "module" }),
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }],
    }),
    "tsconfig.app.json": JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
        jsxImportSource: "solid-js",
        baseUrl: ".",
        paths: {
          "@/*": ["./src/*"],
        },
      },
    }),
    "node_modules/solid-js/jsx-runtime/package.json": JSON.stringify({
      name: "solid-js",
      version: "1.0.0",
    }),
    "node_modules/solid-js/jsx-runtime/index.js": `
      export function jsx(type, props) {
        return { type, props, framework: 'solid-js' };
      }
    `,
    "node_modules/solid-js/package.json": JSON.stringify({
      name: "solid-js",
      version: "1.0.0",
      exports: {
        "./jsx-runtime": "./jsx-runtime/index.js",
      },
    }),
    "src/foo.ts": `export const foo = "test";`,
    "index.tsx": `
      import { foo } from "@/foo";
      const element = <div>Hello {foo}</div>;
      console.log(JSON.stringify(element));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.tsx"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Cannot find");
  expect(stderr).not.toContain("React is not defined");
  expect(stdout).toContain("solid-js");
  expect(exitCode).toBe(0);
});

test("tsconfig.json references should support multiple references", async () => {
  using dir = tempDir("tsconfig-multi-references", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.node.json" }],
    }),
    "tsconfig.app.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@app/*": ["./app/*"],
        },
      },
    }),
    "tsconfig.node.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@server/*": ["./server/*"],
        },
      },
    }),
    "app/component.ts": `export const component = "app component";`,
    "server/handler.ts": `export const handler = "server handler";`,
    "index.ts": `
      import { component } from "@app/component";
      import { handler } from "@server/handler";
      console.log(component, handler);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Cannot find module");
  expect(stdout).toBe("app component server handler\n");
  expect(exitCode).toBe(0);
});

test("tsconfig.json main config paths should override referenced config paths", async () => {
  using dir = tempDir("tsconfig-override-references", {
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["./override/*"],
        },
      },
      references: [{ path: "./tsconfig.app.json" }],
    }),
    "tsconfig.app.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["./src/*"],
        },
      },
    }),
    "override/foo.ts": `export const foo = "from override";`,
    "src/foo.ts": `export const foo = "from src";`,
    "index.ts": `
      import { foo } from "@/foo";
      console.log(foo);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Cannot find module");
  expect(stdout).toBe("from override\n");
  expect(exitCode).toBe(0);
});

test("tsconfig.json references can be a directory", async () => {
  using dir = tempDir("tsconfig-dir-references", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./app" }],
    }),
    "app/tsconfig.json": JSON.stringify({
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["./src/*"],
        },
      },
    }),
    "app/src/foo.ts": `export const foo = "hello from app";`,
    "index.ts": `
      import { foo } from "@/foo";
      console.log(foo);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.ts"],
    cwd: String(dir),
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("Cannot find module");
  expect(stdout).toBe("hello from app\n");
  expect(exitCode).toBe(0);
});

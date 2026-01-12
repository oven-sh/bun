import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("Bun.build respects NODE_ENV=production for JSX transform", async () => {
  using dir = tempDir("test-jsx-prod", {
    "test.tsx": `console.log(<div>Hello</div>);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "test.tsx", "--outfile=out.js", "--external", "react"],
    env: {
      ...bunEnv,
      NODE_ENV: "production",
    },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = await Bun.file(dir + "/out.js").text();

  // Should use production JSX runtime (jsx from react/jsx-runtime)
  // NOT development runtime (jsxDEV from react/jsx-dev-runtime)
  expect(output).toContain('from "react/jsx-runtime"');
  expect(output).toContain("jsx(");
  expect(output).not.toContain("jsxDEV");
  expect(output).not.toContain('from "react/jsx-dev-runtime"');

  expect(exitCode).toBe(0);
});

test("Bun.build uses development JSX transform when NODE_ENV=development", async () => {
  using dir = tempDir("test-jsx-dev", {
    "test.tsx": `console.log(<div>Hello</div>);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "test.tsx", "--outfile=out.js", "--external", "react"],
    env: {
      ...bunEnv,
      NODE_ENV: "development",
    },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = await Bun.file(dir + "/out.js").text();

  // Should use development JSX runtime
  expect(output).toContain('from "react/jsx-dev-runtime"');
  expect(output).toContain("jsxDEV");
  expect(output).not.toContain('from "react/jsx-runtime"');
  expect(output).not.toContain("jsx(");

  expect(exitCode).toBe(0);
});

test("Bun.build defaults to development JSX when NODE_ENV is not set", async () => {
  using dir = tempDir("test-jsx-default", {
    "test.tsx": `console.log(<div>Hello</div>);`,
  });

  const env = { ...bunEnv };
  delete env.NODE_ENV;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "test.tsx", "--outfile=out.js", "--external", "react"],
    env,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = await Bun.file(dir + "/out.js").text();

  // Should default to development JSX runtime
  expect(output).toContain('from "react/jsx-dev-runtime"');
  expect(output).toContain("jsxDEV");
  expect(output).not.toContain('from "react/jsx-runtime"');
  expect(output).not.toContain("jsx(");

  expect(exitCode).toBe(0);
});

test("Bun.build --production flag uses production JSX transform", async () => {
  using dir = tempDir("test-jsx-flag", {
    "test.tsx": `console.log(<div>Hello</div>);`,
  });

  const env = { ...bunEnv };
  delete env.NODE_ENV;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--production", "test.tsx", "--outfile=out.js", "--external", "react"],
    env,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = await Bun.file(dir + "/out.js").text();

  // Should use production JSX runtime (minified, so just check for the runtime)
  expect(output).toContain("react/jsx-runtime");
  expect(output).not.toContain("jsxDEV");
  expect(output).not.toContain("react/jsx-dev-runtime");

  expect(exitCode).toBe(0);
});

test("NODE_ENV=production overrides tsconfig.json jsx:react-jsx", async () => {
  using dir = tempDir("test-jsx-tsconfig-override", {
    "test.tsx": `console.log(<div>Hello</div>);`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "test.tsx", "--outfile=out.js", "--external", "react"],
    env: {
      ...bunEnv,
      NODE_ENV: "production",
    },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = await Bun.file(dir + "/out.js").text();

  // NODE_ENV=production should override tsconfig and use production JSX runtime
  expect(output).toContain('from "react/jsx-runtime"');
  expect(output).toContain("jsx(");
  expect(output).not.toContain("jsxDEV");
  expect(output).not.toContain('from "react/jsx-dev-runtime"');

  expect(exitCode).toBe(0);
});

test("NODE_ENV=production overrides tsconfig.json jsx:react-jsxdev", async () => {
  using dir = tempDir("test-jsx-prod-override-jsxdev", {
    "test.tsx": `console.log(<div>Hello</div>);`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        jsx: "react-jsxdev",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "test.tsx", "--outfile=out.js", "--external", "react"],
    env: {
      ...bunEnv,
      NODE_ENV: "production",
    },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = await Bun.file(dir + "/out.js").text();

  // NODE_ENV=production should override tsconfig react-jsxdev and force production runtime
  expect(output).toContain('from "react/jsx-runtime"');
  expect(output).toContain("jsx(");
  expect(output).not.toContain("jsxDEV");
  expect(output).not.toContain('from "react/jsx-dev-runtime"');

  expect(exitCode).toBe(0);
});

test("NODE_ENV=development overrides tsconfig.json jsx:react-jsx", async () => {
  using dir = tempDir("test-jsx-dev-override-jsx", {
    "test.tsx": `console.log(<div>Hello</div>);`,
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        jsx: "react-jsx",
      },
    }),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "test.tsx", "--outfile=out.js", "--external", "react"],
    env: {
      ...bunEnv,
      NODE_ENV: "development",
    },
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const output = await Bun.file(dir + "/out.js").text();

  // NODE_ENV=development should override tsconfig react-jsx and force development runtime
  expect(output).toContain('from "react/jsx-dev-runtime"');
  expect(output).toContain("jsxDEV");
  expect(output).not.toContain('from "react/jsx-runtime"');
  expect(output).not.toContain("jsx(");

  expect(exitCode).toBe(0);
});

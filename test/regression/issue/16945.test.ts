import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/16945
// Flow's `import typeof` syntax should be stripped during transpilation,
// analogous to TypeScript's `import type`.

test("import typeof default from module", async () => {
  using dir = tempDir("16945", {
    "flow_module.js": `
import typeof ActionSheetIOS from './action_sheet';
export default function hello() { return "hello"; }
`,
    "action_sheet.js": `export default class ActionSheetIOS {}`,
    "index.js": `import hello from './flow_module'; console.log(hello());`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("hello");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("import typeof with named imports", async () => {
  using dir = tempDir("16945", {
    "flow_module.js": `
import typeof { Foo, Bar } from './types';
export default function hello() { return "named"; }
`,
    "types.js": `export class Foo {} export class Bar {}`,
    "index.js": `import hello from './flow_module'; console.log(hello());`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("named");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("import typeof with namespace import", async () => {
  using dir = tempDir("16945", {
    "flow_module.js": `
import typeof * as Types from './types';
export default function hello() { return "namespace"; }
`,
    "types.js": `export class Foo {}`,
    "index.js": `import hello from './flow_module'; console.log(hello());`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("namespace");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("export typeof is stripped", async () => {
  using dir = tempDir("16945", {
    "flow_module.js": `
export typeof { Foo } from './types';
export default function hello() { return "export-typeof"; }
`,
    "types.js": `export class Foo {}`,
    "index.js": `import hello from './flow_module'; console.log(hello());`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("export-typeof");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("bun build --no-bundle strips import typeof", async () => {
  using dir = tempDir("16945", {
    "flow_module.js": `
import typeof ActionSheetIOS from './action_sheet';
export default function hello() { return "hello"; }
`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--no-bundle", `${dir}/flow_module.js`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The import typeof should be stripped, so it shouldn't appear in output
  expect(stdout).not.toContain("typeof");
  expect(stdout).toContain("hello");
  expect(exitCode).toBe(0);
});

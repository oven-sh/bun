import { test, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import path from "path";

// https://github.com/oven-sh/bun/issues/20718
// dynamic import() of a file that uses both `import` statements and
// `module.exports` throws "Expected CommonJS module to have a function wrapper"

test("dynamic import of file with import + module.exports in type:module project", async () => {
  using dir = tempDir("issue-20718", {
    "package.json": JSON.stringify({ type: "module" }),
    "dep.js": `export class Builder { constructor() { this.name = 'test'; } }`,
    "mixed.js": `
      import { Builder } from './dep.js';
      module.exports = { d: new Builder() };
    `,
    "entry.js": `import('./mixed.js').then(m => console.log(JSON.stringify(m.default)))`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "entry.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("Expected CommonJS module to have a function wrapper");
  expect(stdout.trim()).toBe(JSON.stringify({ d: { name: "test" } }));
  expect(exitCode).toBe(0);
});

test("import * as ns combined with module.exports", async () => {
  using dir = tempDir("issue-20718-star", {
    "package.json": JSON.stringify({ type: "module" }),
    "dep.js": `export const a = 1; export const b = 2;`,
    "mixed.js": `
      import * as dep from './dep.js';
      module.exports = { sum: dep.a + dep.b };
    `,
    "entry.js": `import('./mixed.js').then(m => console.log(JSON.stringify(m.default)))`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "entry.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("Expected CommonJS module to have a function wrapper");
  expect(stdout.trim()).toBe(JSON.stringify({ sum: 3 }));
  expect(exitCode).toBe(0);
});

test("import default combined with module.exports", async () => {
  using dir = tempDir("issue-20718-default", {
    "package.json": JSON.stringify({ type: "module" }),
    "dep.js": `export default 'hello';`,
    "mixed.js": `
      import greeting from './dep.js';
      module.exports = { greeting };
    `,
    "entry.js": `import('./mixed.js').then(m => console.log(JSON.stringify(m.default)))`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "entry.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("Expected CommonJS module to have a function wrapper");
  expect(stdout.trim()).toBe(JSON.stringify({ greeting: "hello" }));
  expect(exitCode).toBe(0);
});

test("import default with named imports combined with module.exports", async () => {
  using dir = tempDir("issue-20718-def-named", {
    "package.json": JSON.stringify({ type: "module" }),
    "dep.js": `export default 'def'; export const x = 1; export const y = 2;`,
    "mixed.js": `
      import d, { x, y } from './dep.js';
      module.exports = { d, x, y };
    `,
    "entry.js": `import('./mixed.js').then(m => console.log(JSON.stringify(m.default)))`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "entry.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("Expected CommonJS module to have a function wrapper");
  expect(stdout.trim()).toBe(JSON.stringify({ d: "def", x: 1, y: 2 }));
  expect(exitCode).toBe(0);
});

test("bare side-effect import combined with module.exports", async () => {
  using dir = tempDir("issue-20718-bare", {
    "package.json": JSON.stringify({ type: "module" }),
    "side.js": `globalThis.sideEffect = true;`,
    "mixed.js": `
      import './side.js';
      module.exports = { ran: globalThis.sideEffect };
    `,
    "entry.js": `import('./mixed.js').then(m => console.log(JSON.stringify(m.default)))`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "entry.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("Expected CommonJS module to have a function wrapper");
  expect(stdout.trim()).toBe(JSON.stringify({ ran: true }));
  expect(exitCode).toBe(0);
});

test("default import of Node builtin combined with module.exports", async () => {
  using dir = tempDir("issue-20718-builtin", {
    "package.json": JSON.stringify({ type: "module" }),
    "mixed.js": `
      import path from 'path';
      import fs from 'fs';
      module.exports = { sep: path.sep, hasReadFile: typeof fs.readFileSync === 'function' };
    `,
    "entry.js": `import('./mixed.js').then(m => console.log(JSON.stringify(m.default)))`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "entry.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).not.toContain("Expected CommonJS module to have a function wrapper");
  expect(stdout.trim()).toBe(JSON.stringify({ sep: path.sep, hasReadFile: true }));
  expect(exitCode).toBe(0);
});

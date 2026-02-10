import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Module._compile handles ESM import/export syntax", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const Module = require('module');

const source = \`
import path from "node:path";
import { fileURLToPath } from "node:url";

const config = {
  value: 42,
};

export default config;
\`;

const m = new Module('/tmp/test-26874.ts');
m.filename = '/tmp/test-26874.ts';
m.paths = Module._nodeModulePaths('/tmp/');
m._compile(source, '/tmp/test-26874.ts');
console.log(JSON.stringify(m.exports.default));
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('{"value":42}');
  expect(exitCode).toBe(0);
});

test("Module._compile handles TypeScript syntax", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const Module = require('module');

const source = \`
interface Config {
  value: number;
  name: string;
}

const config: Config = {
  value: 123,
  name: "test",
};

module.exports = config;
\`;

const m = new Module('/tmp/test-26874-ts.ts');
m.filename = '/tmp/test-26874-ts.ts';
m.paths = Module._nodeModulePaths('/tmp/');
m._compile(source, '/tmp/test-26874-ts.ts');
console.log(JSON.stringify(m.exports));
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('{"value":123,"name":"test"}');
  expect(exitCode).toBe(0);
});

test("Module._compile still works with plain CJS source", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const Module = require('module');

const source = \`
const x = 10;
const y = 20;
module.exports = { sum: x + y };
\`;

const m = new Module('/tmp/test-26874-cjs.js');
m.filename = '/tmp/test-26874-cjs.js';
m.paths = Module._nodeModulePaths('/tmp/');
m._compile(source, '/tmp/test-26874-cjs.js');
console.log(JSON.stringify(m.exports));
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('{"sum":30}');
  expect(exitCode).toBe(0);
});

test("Module._compile handles ESM with .js filename", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const Module = require('module');

const source = \`
export const hello = "world";
export default { greeting: "hi" };
\`;

const m = new Module('/tmp/test-26874-esm.js');
m.filename = '/tmp/test-26874-esm.js';
m.paths = Module._nodeModulePaths('/tmp/');
m._compile(source, '/tmp/test-26874-esm.js');
console.log(JSON.stringify(m.exports.default));
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('{"greeting":"hi"}');
  expect(exitCode).toBe(0);
});

test("Module._compile handles ESM TypeScript with imports and exports", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
const Module = require('module');

const source = \`
import path from "node:path";
import { fileURLToPath } from "node:url";

interface Config {
  turbopack: { root: string };
}

const config: Config = {
  turbopack: {
    root: "/test",
  },
};

export default config;
\`;

const m = new Module('/tmp/test-26874-esm-ts.ts');
m.filename = '/tmp/test-26874-esm-ts.ts';
m.paths = Module._nodeModulePaths('/tmp/');
m._compile(source, '/tmp/test-26874-esm-ts.ts');
console.log(JSON.stringify(m.exports.default));
`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe('{"turbopack":{"root":"/test"}}');
  expect(exitCode).toBe(0);
});

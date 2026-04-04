import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

const TIMEOUT = 30_000;

test(
  "dynamic import with unsupported attribute throws ERR_IMPORT_ATTRIBUTE_UNSUPPORTED",
  async () => {
    using dir = tempDir("28510", {
      "data.json": JSON.stringify({ life: 42 }),
      "test.mjs": `
      const result = await import('./data.json', { with: { type: 'json', notARealAssertion: 'value' } })
        .then(() => 'should not reach')
        .catch(err => ({ code: err.code, name: err.name }));
      console.log(JSON.stringify(result));
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const result = JSON.parse(stdout.trim());
    expect(result).toEqual({
      code: "ERR_IMPORT_ATTRIBUTE_UNSUPPORTED",
      name: "TypeError",
    });
    expect(exitCode).toBe(0);
  },
  TIMEOUT,
);

test(
  "dynamic import with only unsupported attribute (no type) throws ERR_IMPORT_ATTRIBUTE_UNSUPPORTED",
  async () => {
    using dir = tempDir("28510-no-type", {
      "data.json": JSON.stringify({ life: 42 }),
      "test.mjs": `
      const result = await import('./data.json', { with: { notARealAssertion: 'value' } })
        .then(() => 'should not reach')
        .catch(err => ({ code: err.code, name: err.name }));
      console.log(JSON.stringify(result));
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const result = JSON.parse(stdout.trim());
    expect(result).toEqual({
      code: "ERR_IMPORT_ATTRIBUTE_UNSUPPORTED",
      name: "TypeError",
    });
    expect(exitCode).toBe(0);
  },
  TIMEOUT,
);

test(
  "dynamic import with only type attribute succeeds",
  async () => {
    using dir = tempDir("28510-valid", {
      "data.json": JSON.stringify({ life: 42 }),
      "test.mjs": `
      const ns = await import('./data.json', { with: { type: 'json' } });
      console.log(JSON.stringify(ns.default));
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(JSON.parse(stdout.trim())).toEqual({ life: 42 });
    expect(exitCode).toBe(0);
  },
  TIMEOUT,
);

test(
  "static import with unsupported attribute fails",
  async () => {
    using dir = tempDir("28510-static", {
      "data.json": JSON.stringify({ life: 42 }),
      "test.mjs": `import data from './data.json' with { type: 'json', notARealAssertion: 'value' };`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain('Import attribute "notARealAssertion" with value "value" is not supported');
    expect(exitCode).not.toBe(0);
  },
  TIMEOUT,
);

test(
  "error message includes attribute key and value",
  async () => {
    using dir = tempDir("28510-msg", {
      "data.json": JSON.stringify({ x: 1 }),
      "test.mjs": `
      const result = await import('./data.json', { with: { type: 'json', myAttr: 'myVal' } })
        .catch(err => err.message);
      console.log(result);
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe('Import attribute "myAttr" with value "myVal" is not supported');
    expect(exitCode).toBe(0);
  },
  TIMEOUT,
);

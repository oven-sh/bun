import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { join } from "path";

describe("bun -e CJS error propagation", () => {
  test("throw in CJS mode (require) exits with code 1", () => {
    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "-e", "require('fs'); throw new Error('cjs-error-test')"],
      env: bunEnv,
    });
    expect(stderr.toString()).toInclude("cjs-error-test");
    expect(exitCode).toBe(1);
  });

  test("throw in CJS mode (module.exports) exits with code 1", () => {
    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "-e", "module.exports = {}; throw new Error('cjs-module-exports')"],
      env: bunEnv,
    });
    expect(stderr.toString()).toInclude("cjs-module-exports");
    expect(exitCode).toBe(1);
  });

  test("throw in CJS mode (exports) exits with code 1", () => {
    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "-e", "exports.foo = 1; throw new Error('cjs-exports')"],
      env: bunEnv,
    });
    expect(stderr.toString()).toInclude("cjs-exports");
    expect(exitCode).toBe(1);
  });

  test("throw in CJS mode (__dirname) exits with code 1", () => {
    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "-e", "__dirname; throw new Error('cjs-dirname')"],
      env: bunEnv,
    });
    expect(stderr.toString()).toInclude("cjs-dirname");
    expect(exitCode).toBe(1);
  });

  test("throw in CJS mode (__filename) exits with code 1", () => {
    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "-e", "__filename; throw new Error('cjs-filename')"],
      env: bunEnv,
    });
    expect(stderr.toString()).toInclude("cjs-filename");
    expect(exitCode).toBe(1);
  });

  test("SyntaxError in new Function with literal string exits with code 1", () => {
    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "-e", "new Function('let a=1,a=2')"],
      env: bunEnv,
    });
    expect(stderr.toString()).toInclude("SyntaxError");
    expect(exitCode).toBe(1);
  });

  test("SyntaxError in new Function via readFileSync exits with code 1", () => {
    const dir = tempDirWithFiles("eval-cjs-syntax", {
      "bad.js": "let a=1,a=2",
    });
    const filePath = join(dir, "bad.js");
    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [
        bunExe(),
        "-e",
        `new Function(require('fs').readFileSync(${JSON.stringify(filePath)},'utf8'))`,
      ],
      env: bunEnv,
    });
    expect(stderr.toString()).toInclude("SyntaxError");
    expect(exitCode).toBe(1);
  });

  test("throw in ESM mode still works (regression check)", () => {
    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "-e", "throw new Error('esm-error-test')"],
      env: bunEnv,
    });
    expect(stderr.toString()).toInclude("esm-error-test");
    expect(exitCode).toBe(1);
  });

  test("throw in ESM mode with import still works (regression check)", () => {
    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [bunExe(), "-e", "import 'fs'; throw new Error('esm-import-error')"],
      env: bunEnv,
    });
    expect(stderr.toString()).toInclude("esm-import-error");
    expect(exitCode).toBe(1);
  });

  test("successful CJS eval exits with code 0", () => {
    const { exitCode, stdout } = Bun.spawnSync({
      cmd: [bunExe(), "-e", "require('fs'); console.log('ok')"],
      env: bunEnv,
    });
    expect(stdout.toString().trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  test("successful ESM eval exits with code 0", () => {
    const { exitCode, stdout } = Bun.spawnSync({
      cmd: [bunExe(), "-e", "console.log('ok')"],
      env: bunEnv,
    });
    expect(stdout.toString().trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  test("setTimeout throw in CJS mode works (not affected by this bug)", () => {
    const { exitCode, stderr } = Bun.spawnSync({
      cmd: [
        bunExe(),
        "-e",
        "require('fs'); setTimeout(() => { throw new Error('delayed-error') }, 10)",
      ],
      env: bunEnv,
    });
    expect(stderr.toString()).toInclude("delayed-error");
    expect(exitCode).toBe(1);
  });

  test("process.exitCode is respected in CJS mode on success", () => {
    const { exitCode } = Bun.spawnSync({
      cmd: [bunExe(), "-e", "require('fs'); process.exitCode = 42"],
      env: bunEnv,
    });
    expect(exitCode).toBe(42);
  });

  test("uncaughtException handler is invoked in CJS -e evaluation errors", () => {
    const { exitCode, stdout } = Bun.spawnSync({
      cmd: [
        bunExe(),
        "-e",
        "process.on('uncaughtException', e => { console.log('HANDLED'); process.exit(0); }); require('fs'); throw new Error('cjs-uncaught')",
      ],
      env: bunEnv,
    });
    expect(stdout.toString()).toInclude("HANDLED");
    expect(exitCode).toBe(0);
  });
});

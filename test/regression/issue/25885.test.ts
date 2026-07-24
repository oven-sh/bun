import { $ } from "bun";
import { expect, test } from "bun:test";
import { chmod } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { isWindows, tempDir } from "harness";

// Regression tests for shell command resolution ignoring PATH changes:
// https://github.com/oven-sh/bun/issues/25885 (.env() PATH ignored)
// https://github.com/oven-sh/bun/issues/9747 (same, oldest report)
// https://github.com/oven-sh/bun/issues/10865 (runtime process.env.PATH mutation ignored)
//
// The `which` builtin resolved through the shell environment, but spawning an
// external command resolved through the process-startup PATH snapshot, so a
// PATH set via `.env()`, `export`, a `PATH=… cmd` prefix, or a runtime
// `process.env.PATH` mutation found commands with `which` yet failed to run
// them.

// A directory containing one executable `name` that prints `message`.
const cmdDir = async (base: string, name: string, message: string) => {
  const dir = isWindows
    ? tempDir(base, { [`${name}.cmd`]: `@echo ${message}\r\n` })
    : tempDir(base, { [name]: `#!/bin/sh\necho ${message}\n` });
  if (!isWindows) await chmod(join(String(dir), name), 0o755);
  return dir;
};

test("PATH set via .env() is used for command resolution", async () => {
  using dir = await cmdDir("shell-path-env", "mytest-env", "hello from env");
  const PATH = `${String(dir)}${delimiter}${process.env.PATH}`;
  const result = await $`mytest-env`.env({ ...process.env, PATH }).quiet();
  expect(result.stdout.toString().trim()).toBe("hello from env");
  expect(result.exitCode).toBe(0);
});

test("PATH set via export is used for command resolution", async () => {
  using dir = await cmdDir("shell-path-export", "mytest-export", "hello from export");
  const PATH = `${String(dir)}${delimiter}${process.env.PATH}`;
  const result = await $`export PATH=${PATH}; mytest-export`.quiet();
  expect(result.stdout.toString().trim()).toBe("hello from export");
  expect(result.exitCode).toBe(0);
});

test("PATH prefix assignment is used for command resolution, beating export", async () => {
  using dir1 = await cmdDir("shell-path-prefix-1", "mytest-priority", "from prefix");
  using dir2 = await cmdDir("shell-path-prefix-2", "mytest-priority", "from export");
  const path1 = `${String(dir1)}${delimiter}${process.env.PATH}`;
  const path2 = `${String(dir2)}${delimiter}${process.env.PATH}`;
  // cmd_local_env (the `PATH=… cmd` prefix) takes priority over export_env
  const result = await $`export PATH=${path2}; PATH=${path1} mytest-priority`.quiet();
  expect(result.stdout.toString().trim()).toBe("from prefix");
  expect(result.exitCode).toBe(0);
});

test("runtime process.env.PATH mutation is used for command resolution", async () => {
  using dir = await cmdDir("shell-path-mutate", "mytest-mutate", "hello from mutation");
  const saved = process.env.PATH;
  process.env.PATH = `${String(dir)}${delimiter}${saved}`;
  try {
    const result = await $`mytest-mutate`.quiet();
    expect(result.stdout.toString().trim()).toBe("hello from mutation");
    expect(result.exitCode).toBe(0);
  } finally {
    process.env.PATH = saved;
  }
});

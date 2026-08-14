// https://github.com/oven-sh/bun/issues/26249
// Test that bun:ffi's cc() respects C_INCLUDE_PATH and LIBRARY_PATH environment variables.
// This is important for systems like NixOS where standard FHS paths don't exist.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import path from "path";

test.skipIf(isWindows)("cc() respects C_INCLUDE_PATH environment variable", async () => {
  // Create a temp directory with a custom include dir and header file
  using dir = tempDir("ffi-include-path-test", {
    "custom_include": {
      "myheader.h": `
#define MY_MAGIC_NUMBER 42
`,
    },
    "test.c": `
#include <myheader.h>
int get_magic() {
    return MY_MAGIC_NUMBER;
}
`,
    "test.js": `
import { cc } from "bun:ffi";
import path from "path";

// Closed at the end: a library that is never close()d stays loaded on purpose,
// which CI's leak check would otherwise report.
const lib = cc({
  source: path.join(import.meta.dir, "test.c"),
  symbols: {
    get_magic: {
      returns: "int",
    },
  },
});

console.log(lib.symbols.get_magic());
lib.close();
`,
  });

  // Run with C_INCLUDE_PATH set to our custom include directory
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      C_INCLUDE_PATH: path.join(String(dir), "custom_include"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Check that the header was found and the code compiled successfully
  expect(stderr).not.toContain("myheader.h");
  expect(stdout.trim()).toBe("42");
  expect(exitCode).toBe(0);
});

test.skipIf(isWindows)("cc() respects multiple paths in C_INCLUDE_PATH", async () => {
  // Create a temp directory with multiple custom include dirs
  using dir = tempDir("ffi-multi-include-path-test", {
    "include1": {
      "header1.h": `
#define VALUE_A 10
`,
    },
    "include2": {
      "header2.h": `
#define VALUE_B 20
`,
    },
    "test.c": `
#include <header1.h>
#include <header2.h>
int get_sum() {
    return VALUE_A + VALUE_B;
}
`,
    "test.js": `
import { cc } from "bun:ffi";
import path from "path";

const lib = cc({
  source: path.join(import.meta.dir, "test.c"),
  symbols: {
    get_sum: {
      returns: "int",
    },
  },
});

console.log(lib.symbols.get_sum());
lib.close();
`,
  });

  // Run with C_INCLUDE_PATH set to multiple directories (colon-separated)
  const include1 = path.join(String(dir), "include1");
  const include2 = path.join(String(dir), "include2");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    cwd: String(dir),
    env: {
      ...bunEnv,
      C_INCLUDE_PATH: `${include1}:${include2}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("header1.h");
  expect(stderr).not.toContain("header2.h");
  expect(stdout.trim()).toBe("30");
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/26249
// bun:ffi's cc() adds the directories in C_INCLUDE_PATH and LIBRARY_PATH, the
// standard C compiler search path variables, to TinyCC's search paths. Systems
// without FHS paths (NixOS) rely on them.
//
// Each test spawns a child bun. cc() reads both variables through a
// process-wide cache (bun_core::env_var) that fills on the first cc() call, so
// setting process.env in the test runner would not reach it.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir, type DirectoryTree } from "harness";
import path from "path";

const systemCC = Bun.which("cc") || Bun.which("clang") || Bun.which("gcc");

// Compiles the test.c next to it, prints get_value(), and closes the library.
function fixtureJs(library: string[] = []) {
  return `
import { cc } from "bun:ffi";
import path from "path";

const lib = cc({
  source: path.join(import.meta.dir, "test.c"),
  library: ${JSON.stringify(library)},
  symbols: { get_value: { returns: "int" } },
});
console.log(lib.symbols.get_value());
lib.close();
`;
}

async function runFixture(cwd: string, env: Record<string, string>) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.js"],
    cwd,
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// `headers` maps each include directory to its header files.
const includeCases: { label: string; headers: DirectoryTree; source: string; stdout: string }[] = [
  {
    label: "one directory",
    headers: { custom_include: { "myheader.h": "#define MY_MAGIC_NUMBER 42\n" } },
    source: `
#include <myheader.h>
int get_value(void) { return MY_MAGIC_NUMBER; }
`,
    stdout: "42\n",
  },
  {
    label: "two directories",
    headers: {
      include1: { "header1.h": "#define VALUE_A 10\n" },
      include2: { "header2.h": "#define VALUE_B 20\n" },
    },
    source: `
#include <header1.h>
#include <header2.h>
int get_value(void) { return VALUE_A + VALUE_B; }
`,
    stdout: "30\n",
  },
];

test.concurrent.skipIf(isWindows).each(includeCases)(
  "cc() finds headers through C_INCLUDE_PATH ($label)",
  async ({ headers, source, stdout }) => {
    using dir = tempDir("ffi-include-path", { ...headers, "test.c": source, "test.js": fixtureJs() });
    const includeDirs = Object.keys(headers).map(name => path.join(String(dir), name));

    const result = await runFixture(String(dir), { C_INCLUDE_PATH: includeDirs.join(":") });
    expect(result).toEqual({ stdout, stderr: "", exitCode: 0 });
  },
);

test.concurrent.skipIf(isWindows || !systemCC)("cc() finds libraries through LIBRARY_PATH", async () => {
  using dir = tempDir("ffi-library-path", {
    lib: { "libbunffitest.c": "int value_from_library(void) { return 7; }\n" },
    "test.c": `
int value_from_library(void);
int get_value(void) { return value_from_library(); }
`,
    "test.js": fixtureJs(["bunffitest"]),
  });
  const libDir = path.join(String(dir), "lib");

  // TinyCC looks for lib<name>.so on Linux and lib<name>.dylib on macOS.
  const libFile = `libbunffitest.${isMacOS ? "dylib" : "so"}`;
  {
    await using proc = Bun.spawn({
      cmd: [systemCC!, "-shared", "-fPIC", "-o", libFile, "libbunffitest.c"],
      cwd: libDir,
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) throw new Error(`${systemCC} -shared failed (exit ${exitCode}):\n${stderr}`);
  }

  const result = await runFixture(String(dir), { LIBRARY_PATH: libDir });
  expect(result).toEqual({ stdout: "7\n", stderr: "", exitCode: 0 });
});

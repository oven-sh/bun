import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";

// Regression test for https://github.com/oven-sh/bun/issues/27955
// `bun build --compile --bytecode --format esm` produced broken binaries
// when importing from barrel files (packages with sideEffects: false).
// The barrel import optimization deferred unused sub-module imports, but
// the ModuleInfo for ESM bytecode incorrectly included these deferred
// imports as requested modules, causing "Cannot find module" at runtime.

describe("issue #27955: --compile --bytecode --format esm with barrel imports", () => {
  const ext = isWindows ? ".exe" : "";

  test("named import from barrel package works with --compile --bytecode --format esm", async () => {
    // Simulate a barrel package like `diff` with sideEffects: false.
    // The barrel index re-exports from multiple sub-modules, but only
    // one export is actually used. Barrel optimization should defer the
    // unused sub-module imports without breaking the compiled binary.
    using dir = tempDir("bytecode-esm-barrel", {
      "index.ts": `
        import { greet } from './barrel-pkg';
        console.log(greet("World"));
      `,
      "barrel-pkg/package.json": JSON.stringify({
        name: "barrel-pkg",
        sideEffects: false,
        main: "./index.js",
      }),
      "barrel-pkg/index.js": [
        `import { greet } from './greet.js';`,
        `import { unused1 } from './unused1.js';`,
        `import { unused2 } from './unused2.js';`,
        `import { unused3 } from './unused3.js';`,
        `export { greet, unused1, unused2, unused3 };`,
      ].join("\n"),
      "barrel-pkg/greet.js": `export function greet(name) { return "Hello, " + name + "!"; }`,
      "barrel-pkg/unused1.js": `export function unused1() { return "unused1"; }`,
      "barrel-pkg/unused2.js": `export function unused2() { return "unused2"; }`,
      "barrel-pkg/unused3.js": `export function unused3() { return "unused3"; }`,
    });

    const outfile = join(String(dir), `app${ext}`);

    // Build with --compile --bytecode --format esm (the failing combination)
    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--bytecode",
        "--format",
        "esm",
        join(String(dir), "index.ts"),
        "--outfile",
        outfile,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [buildStdout, buildStderr, buildExitCode] = await Promise.all([
      build.stdout.text(),
      build.stderr.text(),
      build.exited,
    ]);

    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    // Run the compiled executable — this was failing with:
    //   error: Cannot find module './unused1.js' from '/$bunfs/root/app'
    await using exe = Bun.spawn({
      cmd: [outfile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exeStdout, exeStderr, exeExitCode] = await Promise.all([exe.stdout.text(), exe.stderr.text(), exe.exited]);

    expect(exeStdout).toContain("Hello, World!");
    expect(exeStderr).not.toContain("Cannot find module");
    expect(exeExitCode).toBe(0);
  });

  test("default import from barrel sub-module works with --compile --bytecode --format esm", async () => {
    // The original bug involved `import Diff from './diff/base.js'` pattern
    // (default export of a class). Test default imports from barrel sub-modules.
    using dir = tempDir("bytecode-esm-barrel-default", {
      "index.ts": `
        import { create } from './barrel-pkg';
        console.log(create());
      `,
      "barrel-pkg/package.json": JSON.stringify({
        name: "barrel-pkg",
        sideEffects: false,
        main: "./index.js",
      }),
      "barrel-pkg/index.js": [
        `import Base from './base.js';`,
        `import Extra from './extra.js';`,
        `export function create() { return new Base().name; }`,
        `export function createExtra() { return new Extra().name; }`,
      ].join("\n"),
      "barrel-pkg/base.js": `export default class Base { get name() { return "base-ok"; } }`,
      "barrel-pkg/extra.js": `export default class Extra { get name() { return "extra"; } }`,
    });

    const outfile = join(String(dir), `app${ext}`);

    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--bytecode",
        "--format",
        "esm",
        join(String(dir), "index.ts"),
        "--outfile",
        outfile,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [, buildStderr, buildExitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);

    expect(buildStderr).toBe("");
    expect(buildExitCode).toBe(0);

    await using exe = Bun.spawn({
      cmd: [outfile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exeStdout, exeStderr, exeExitCode] = await Promise.all([exe.stdout.text(), exe.stderr.text(), exe.exited]);

    expect(exeStdout).toContain("base-ok");
    expect(exeStderr).not.toContain("Cannot find module");
    expect(exeExitCode).toBe(0);
  });
});

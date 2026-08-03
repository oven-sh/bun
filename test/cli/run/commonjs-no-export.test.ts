import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

describe.concurrent("commonjs-no-export", () => {
  test("CommonJS entry point with no exports", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "--bun", join(import.meta.dir, "commonjs-no-exports-fixture.js")],
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    expect(stdout.trim().endsWith("--pass--")).toBe(true);
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/8908
  // A bare top-level `return` is only legal inside the CJS function wrapper, so
  // its presence alone must switch the module to CommonJS.
  test("top-level return switches an entry point to CommonJS", async () => {
    using dir = tempDir("cjs-top-level-return-entry", {
      "entry.js": `console.log("before");\nreturn;\nconsole.log("after");\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", join(String(dir), "entry.js")],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("before\n");
    expect(exitCode).toBe(0);
  });

  for (const [label, source] of [
    [".mjs", { "entry.mjs": `return 1;\n` }],
    ["import statement", { "entry.js": `import "node:os";\nreturn 1;\n` }],
    ["import.meta", { "entry.js": `void import.meta;\nreturn 1;\n` }],
  ] as const) {
    test(`top-level return does not flip a file with ${label} to CommonJS`, async () => {
      using dir = tempDir("cjs-top-level-return-esm", source);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", join(String(dir), Object.keys(source)[0])],
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain("Return statements are only valid inside functions");
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    });
  }

  test("top-level return switches a required module to CommonJS", async () => {
    using dir = tempDir("cjs-top-level-return-require", {
      "main.js": `const lib = require("./lib.js"); console.log("got", JSON.stringify(lib));`,
      "lib.js": `console.log("lib: before");\nif (typeof global !== "undefined") return;\nconsole.log("lib: after");\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", join(String(dir), "main.js")],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("lib: before\ngot {}\n");
    expect(exitCode).toBe(0);
  });
});

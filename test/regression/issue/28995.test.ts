// https://github.com/oven-sh/bun/issues/28995
//
// Root-level wildcard subpath imports like `"#/*": "./*"` must be supported.
// Node.js allowed these starting with https://github.com/nodejs/node/pull/60864,
// and TypeScript 6.0 follows suit. Bun previously rejected any specifier
// starting with `"#/"` before the `imports` map was consulted.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe.concurrent("issue/28995 root-level wildcard subpath imports", () => {
  test("#/* wildcard maps to ./*", async () => {
    using dir = tempDir("issue-28995-wildcard", {
      "package.json": JSON.stringify({
        name: "issue-28995-wildcard",
        version: "1.0.0",
        imports: {
          "#/*": "./*",
        },
      }),
      "logger/index.ts": `export const foo = "hello from logger";`,
      "server/index.ts": `
        import { foo } from "#/logger/index.ts";
        console.log(foo);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "server/index.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("hello from logger\n");
    expect(exitCode).toBe(0);
  });

  test("nested #/components/* wildcard", async () => {
    using dir = tempDir("issue-28995-nested", {
      "package.json": JSON.stringify({
        name: "issue-28995-nested",
        version: "1.0.0",
        imports: {
          "#/components/*": "./src/components/*",
        },
      }),
      "src/components/button.ts": `export const button = "the button";`,
      "entry.ts": `
        import { button } from "#/components/button.ts";
        console.log(button);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "entry.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("the button\n");
    expect(exitCode).toBe(0);
  });

  test("literal #/foo entry (no wildcard)", async () => {
    using dir = tempDir("issue-28995-literal", {
      "package.json": JSON.stringify({
        name: "issue-28995-literal",
        version: "1.0.0",
        imports: {
          "#/logger": "./logger.ts",
        },
      }),
      "logger.ts": `export const msg = "literal works";`,
      "entry.ts": `
        import { msg } from "#/logger";
        console.log(msg);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "entry.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("literal works\n");
    expect(exitCode).toBe(0);
  });

  test("bare # is still rejected", async () => {
    // A bare "#" specifier is invalid per the Node.js spec and should
    // still be rejected even after allowing "#/...".
    using dir = tempDir("issue-28995-bare-hash", {
      "package.json": JSON.stringify({
        name: "issue-28995-bare-hash",
        version: "1.0.0",
        imports: {
          "#": "./target.ts",
        },
      }),
      "target.ts": `export const x = 1;`,
      "entry.ts": `import "#";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "entry.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Cannot find");
    expect(exitCode).not.toBe(0);
  });

  test("bare #/ does not match a #/* wildcard entry", async () => {
    // Per PACKAGE_IMPORTS_EXPORTS_RESOLVE step 5c, a wildcard key like
    // "#/*" only matches specifiers that start with AND are strictly longer
    // than the pattern base ("#/"). Without the length guard in
    // resolveImportsExports, `import "#/"` would substitute an empty
    // subpath into the target and resolve to `./target.ts` — a real file
    // — with exit code 0. The concrete target here ensures the test
    // actually exercises the length guard: without the fix the import
    // succeeds to target.ts; with the fix the match is skipped and the
    // specifier is rejected with "Cannot find".
    using dir = tempDir("issue-28995-bare-hash-slash", {
      "package.json": JSON.stringify({
        name: "issue-28995-bare-hash-slash",
        version: "1.0.0",
        imports: {
          "#/*": "./target.ts",
        },
      }),
      "target.ts": `console.log("should not load");`,
      "entry.ts": `import "#/";`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "entry.ts"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("Cannot find");
    expect(exitCode).not.toBe(0);
  });

  test("#/* works when bundled", async () => {
    using dir = tempDir("issue-28995-bundle", {
      "package.json": JSON.stringify({
        name: "issue-28995-bundle",
        version: "1.0.0",
        imports: {
          "#/*": "./*",
        },
      }),
      "lib/util.ts": `export const util = "bundled util";`,
      "entry.ts": `
        import { util } from "#/lib/util.ts";
        console.log(util);
      `,
    });

    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "entry.ts", "--target=bun", "--outfile=out.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(await build.exited).toBe(0);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "out.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toBe("bundled util\n");
    expect(exitCode).toBe(0);
  });
});

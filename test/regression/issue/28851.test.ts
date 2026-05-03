import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/28851
//
// Support `[resolve] conditions = [...]` in bunfig.toml so custom export
// conditions (e.g. "source") don't have to be re-passed as `--conditions`
// on every CLI invocation.

const packageFiles = {
  "node_modules/pkg/package.json": JSON.stringify({
    name: "pkg",
    type: "module",
    exports: {
      ".": {
        source: "./src.js",
        import: "./dist.js",
        default: "./dist.js",
      },
    },
  }),
  "node_modules/pkg/src.js": "export const value = 'source-file';",
  "node_modules/pkg/dist.js": "export const value = 'dist-file';",
  "package.json": JSON.stringify({ name: "host", type: "module" }),
  "entry.js": "import { value } from 'pkg'; console.log(value);",
  "entry.test.js":
    "import { value } from 'pkg';\nimport { test, expect } from 'bun:test';\ntest('t', () => { expect(value).toBe('source-file'); });",
};

test("bunfig.toml [resolve] conditions applies to bun run", async () => {
  using dir = tempDir("bunfig-resolve-conditions-run", {
    ...packageFiles,
    "bunfig.toml": `[resolve]\nconditions = ["source"]\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("source-file\n");
  expect(exitCode).toBe(0);
});

test("without bunfig.toml, the default condition is used", async () => {
  using dir = tempDir("bunfig-resolve-conditions-no-bunfig", {
    ...packageFiles,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("dist-file\n");
  expect(exitCode).toBe(0);
});

test("bunfig.toml [resolve] conditions applies to bun build", async () => {
  using dir = tempDir("bunfig-resolve-conditions-build", {
    ...packageFiles,
    "bunfig.toml": `[resolve]\nconditions = ["source"]\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "entry.js", "--target", "bun"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toContain("source-file");
  expect(stdout).not.toContain("dist-file");
  expect(exitCode).toBe(0);
});

test("bunfig.toml [resolve] conditions applies to bun test", async () => {
  using dir = tempDir("bunfig-resolve-conditions-test", {
    ...packageFiles,
    "bunfig.toml": `[resolve]\nconditions = ["source"]\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "entry.test.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // bun test prints its summary to stderr; assert both 1 pass and 0 fail.
  expect(stderr).toContain("1 pass");
  expect(stderr).toContain("0 fail");
  expect(exitCode).toBe(0);
});

test("CLI --conditions appends to bunfig.toml [resolve] conditions", async () => {
  using dir = tempDir("bunfig-resolve-conditions-cli-append", {
    "node_modules/pkg/package.json": JSON.stringify({
      name: "pkg",
      type: "module",
      exports: {
        ".": {
          source: "./src.js",
          cli: "./cli.js",
          import: "./dist.js",
          default: "./dist.js",
        },
      },
    }),
    "node_modules/pkg/src.js": "export const value = 'source-file';",
    "node_modules/pkg/cli.js": "export const value = 'cli-file';",
    "node_modules/pkg/dist.js": "export const value = 'dist-file';",
    "package.json": JSON.stringify({ name: "host", type: "module" }),
    "entry.js": "import { value } from 'pkg'; console.log(value);",
    "bunfig.toml": `[resolve]\nconditions = ["source"]\n`,
  });

  // Both "source" (from bunfig) and "cli" (from CLI) are active conditions.
  // The order of keys in the `exports` object determines which matches first;
  // since "source" appears before "cli", it wins — proving the CLI flag didn't
  // clobber the bunfig condition.
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--conditions=cli", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout, _stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("source-file\n");
  expect(exitCode).toBe(0);

  // Drop the "source" option from exports so only "cli" remains — bunfig's
  // "source" condition isn't hit and CLI's "cli" condition must still work.
  const pkgPath = String(dir) + "/node_modules/pkg/package.json";
  const pkg = JSON.parse(await Bun.file(pkgPath).text());
  delete pkg.exports["."].source;
  await Bun.write(pkgPath, JSON.stringify(pkg));

  await using proc2 = Bun.spawn({
    cmd: [bunExe(), "run", "--conditions=cli", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });
  const [stdout2, _stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);
  expect(stdout2).toBe("cli-file\n");
  expect(exitCode2).toBe(0);
});

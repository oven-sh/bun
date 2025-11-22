import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

test("error message shows resolved file path when package exports points to non-existent file", async () => {
  using dir = tempDir("package-exports-file-not-found", {
    "node_modules/testpkg/package.json": JSON.stringify({
      name: "testpkg",
      version: "1.0.0",
      exports: {
        bun: {
          import: "./worker.js",
        },
        default: {
          import: "./node.js",
        },
      },
    }),
    "node_modules/testpkg/node.js": `export default "node version";`,
    // Note: worker.js intentionally missing
    "index.js": `import pkg from "testpkg"; console.log(pkg);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // The error message should show the resolved file path, not just "Cannot find package 'testpkg'"
  expect(normalizeBunSnapshot(stderr, dir)).toMatchInlineSnapshot(`
    "error: Cannot find module "<dir>/node_modules/testpkg/worker.js" imported from "<dir>/index.js"

    Bun v<bun-version>"
  `);

  expect(exitCode).toBe(1);
});

test("error message with subpath exports pointing to non-existent file", async () => {
  using dir = tempDir("package-exports-subpath-not-found", {
    "node_modules/mypkg/package.json": JSON.stringify({
      name: "mypkg",
      version: "1.0.0",
      exports: {
        "./utils": "./dist/utils.js",
        "./core": "./dist/core.js",
      },
    }),
    "node_modules/mypkg/dist/core.js": `export const core = true;`,
    // Note: dist/utils.js intentionally missing
    "index.js": `import { util } from "mypkg/utils";`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // Note: Subpath exports currently don't show the resolved path (could be improved in the future)
  expect(stderr).toContain("Cannot find module 'mypkg/utils'");

  expect(exitCode).toBe(1);
});

test("successful import still works when file exists", async () => {
  using dir = tempDir("package-exports-success", {
    "node_modules/testpkg/package.json": JSON.stringify({
      name: "testpkg",
      version: "1.0.0",
      exports: {
        bun: {
          import: "./bun.js",
        },
        default: {
          import: "./node.js",
        },
      },
    }),
    "node_modules/testpkg/bun.js": `export default "bun version";`,
    "node_modules/testpkg/node.js": `export default "node version";`,
    "index.js": `import pkg from "testpkg"; console.log(pkg);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toBe("bun version\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("truly missing package still shows old error message", async () => {
  using dir = tempDir("package-truly-missing", {
    "index.js": `import pkg from "nonexistent-package-12345"; console.log(pkg);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  // Should still use the old "Cannot find package" message when the package doesn't exist at all
  expect(stderr).toContain("Cannot find package 'nonexistent-package-12345'");
  expect(exitCode).toBe(1);
});

test("nested conditional exports with missing file", async () => {
  using dir = tempDir("package-exports-nested-conditions", {
    "node_modules/complexpkg/package.json": JSON.stringify({
      name: "complexpkg",
      version: "1.0.0",
      exports: {
        ".": {
          bun: {
            import: "./esm/index.mjs",
            require: "./cjs/index.cjs",
          },
          import: "./esm/index.js",
          require: "./cjs/index.js",
        },
      },
    }),
    "node_modules/complexpkg/esm/index.js": `export const version = "esm";`,
    // Note: esm/index.mjs intentionally missing
    "index.js": `import pkg from "complexpkg"; console.log(pkg);`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(normalizeBunSnapshot(stderr, dir)).toMatchInlineSnapshot(`
    "error: Cannot find module "<dir>/node_modules/complexpkg/esm/index.mjs" imported from "<dir>/index.js"

    Bun v<bun-version>"
  `);

  expect(exitCode).toBe(1);
});

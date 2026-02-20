import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Test that Bun falls back to the next conditional export when a file doesn't exist
// https://github.com/oven-sh/bun/issues/24184
//
// This issue occurs in Next.js standalone builds where the file tracer only copies
// files needed for the Node.js runtime, not Bun-specific files like server.bun.js.
// When react-dom/server is resolved, Bun should fall back from "bun" to "node" condition
// when server.bun.js doesn't exist.

test("conditional export fallback when bun condition file is missing", async () => {
  // Create a test directory simulating Next.js standalone output
  using dir = tempDir("issue-24184", {
    "node_modules/react-dom/package.json": JSON.stringify({
      name: "react-dom",
      exports: {
        "./server": {
          bun: "./server.bun.js",
          node: "./server.node.js",
          default: "./server.node.js",
        },
      },
    }),
    // Only create the node version, simulating Next.js file tracing
    "node_modules/react-dom/server.node.js": `module.exports = { renderToStaticMarkup: () => "rendered" };`,
    // Note: server.bun.js is intentionally NOT created
    "index.js": `
      const { renderToStaticMarkup } = require('react-dom/server');
      console.log(typeof renderToStaticMarkup);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Should resolve to server.node.js and output "function"
  expect(stdout.trim()).toBe("function");
  expect(exitCode).toBe(0);
});

test("conditional export fallback with ESM import", async () => {
  using dir = tempDir("issue-24184-esm", {
    "node_modules/test-pkg/package.json": JSON.stringify({
      name: "test-pkg",
      type: "module",
      exports: {
        ".": {
          bun: "./index.bun.js",
          node: "./index.node.js",
          default: "./index.node.js",
        },
      },
    }),
    // Only create the node version
    "node_modules/test-pkg/index.node.js": `export const value = "from-node";`,
    "index.mjs": `
      import { value } from 'test-pkg';
      console.log(value);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("from-node");
  expect(exitCode).toBe(0);
});

test("conditional export uses first matching file that exists", async () => {
  // When bun condition file exists, it should be used
  using dir = tempDir("issue-24184-exists", {
    "node_modules/test-pkg/package.json": JSON.stringify({
      name: "test-pkg",
      exports: {
        ".": {
          bun: "./index.bun.js",
          node: "./index.node.js",
          default: "./index.node.js",
        },
      },
    }),
    // Both files exist, bun should be preferred
    "node_modules/test-pkg/index.bun.js": `module.exports = { source: "bun" };`,
    "node_modules/test-pkg/index.node.js": `module.exports = { source: "node" };`,
    "index.js": `
      const { source } = require('test-pkg');
      console.log(source);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Should use bun version when it exists
  expect(stdout.trim()).toBe("bun");
  expect(exitCode).toBe(0);
});

test("conditional export fallback with multiple missing conditions", async () => {
  // When multiple conditions don't exist, should fall through to one that does
  using dir = tempDir("issue-24184-multiple", {
    "node_modules/test-pkg/package.json": JSON.stringify({
      name: "test-pkg",
      exports: {
        ".": {
          bun: "./index.bun.js",
          deno: "./index.deno.js",
          node: "./index.node.js",
          default: "./index.default.js",
        },
      },
    }),
    // Only default exists
    "node_modules/test-pkg/index.default.js": `module.exports = { source: "default" };`,
    "index.js": `
      const { source } = require('test-pkg');
      console.log(source);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Should fall through to default when bun and node files don't exist
  expect(stdout.trim()).toBe("default");
  expect(exitCode).toBe(0);
});

test("conditional export fallback with subpath exports", async () => {
  // Test with subpath exports like react-dom/server
  using dir = tempDir("issue-24184-subpath", {
    "node_modules/my-pkg/package.json": JSON.stringify({
      name: "my-pkg",
      exports: {
        ".": {
          bun: "./index.bun.js",
          default: "./index.js",
        },
        "./server": {
          bun: "./server.bun.js",
          node: "./server.node.js",
          default: "./server.default.js",
        },
      },
    }),
    // Main entry exists with bun condition
    "node_modules/my-pkg/index.bun.js": `module.exports = { main: true };`,
    // Subpath only has node version (like Next.js tracing)
    "node_modules/my-pkg/server.node.js": `module.exports = { server: "node" };`,
    "index.js": `
      const main = require('my-pkg');
      const server = require('my-pkg/server');
      console.log(main.main, server.server);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  // Main uses bun (exists), server falls back to node
  expect(stdout.trim()).toBe("true node");
  expect(exitCode).toBe(0);
});

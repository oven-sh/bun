// Test for https://github.com/oven-sh/bun/issues/26536
// diagnostics_channel subscribers should persist across preload and app scripts

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("diagnostics_channel subscribers persist from preload to main script", async () => {
  // Create temp directory with test files
  using dir = tempDir("issue-26536", {
    "preload.mjs": `
import dc from 'node:diagnostics_channel';

const channel = dc.channel('test.channel.26536');
channel.subscribe((msg) => {
  console.log("HOOK CALLED:", JSON.stringify(msg));
});
console.log("[preload] hasSubscribers:", channel.hasSubscribers);
`,
    "app.mjs": `
import dc from 'node:diagnostics_channel';

const channel = dc.channel('test.channel.26536');
console.log("[app] hasSubscribers:", channel.hasSubscribers);

// Publish a message - should trigger the subscriber from preload
channel.publish({ test: true });
`,
  });

  // Run with preload
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload", "./preload.mjs", "./app.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("[preload] hasSubscribers: true");
  expect(stdout).toContain("[app] hasSubscribers: true");
  expect(stdout).toContain('HOOK CALLED: {"test":true}');
  expect(exitCode).toBe(0);
});

test("diagnostics_channel subscribers persist with CJS preload", async () => {
  // Create temp directory with test files
  using dir = tempDir("issue-26536-cjs", {
    "preload.cjs": `
const dc = require('node:diagnostics_channel');

const channel = dc.channel('test.channel.26536.cjs');
channel.subscribe((msg) => {
  console.log("HOOK CALLED:", JSON.stringify(msg));
});
console.log("[preload] hasSubscribers:", channel.hasSubscribers);
`,
    "app.mjs": `
import dc from 'node:diagnostics_channel';

const channel = dc.channel('test.channel.26536.cjs');
console.log("[app] hasSubscribers:", channel.hasSubscribers);

// Publish a message - should trigger the subscriber from preload
channel.publish({ fromApp: "hello" });
`,
  });

  // Run with CJS preload
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload", "./preload.cjs", "./app.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("[preload] hasSubscribers: true");
  expect(stdout).toContain("[app] hasSubscribers: true");
  expect(stdout).toContain('HOOK CALLED: {"fromApp":"hello"}');
  expect(exitCode).toBe(0);
});

test("diagnostics_channel channel() returns same instance", async () => {
  // Create temp directory with test files
  using dir = tempDir("issue-26536-same-instance", {
    "preload.mjs": `
import dc from 'node:diagnostics_channel';

const channel = dc.channel('test.channel.26536.same');
channel.subscribe(() => {});

// Store reference on globalThis
globalThis.__testChannel = channel;
console.log("[preload] stored channel");
`,
    "app.mjs": `
import dc from 'node:diagnostics_channel';

const channel = dc.channel('test.channel.26536.same');
console.log("[app] same channel:", channel === globalThis.__testChannel);
`,
  });

  // Run with preload
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload", "./preload.mjs", "./app.mjs"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toContain("[preload] stored channel");
  expect(stdout).toContain("[app] same channel: true");
  expect(exitCode).toBe(0);
});

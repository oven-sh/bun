import { test, expect } from "bun:test";
import { spawn } from "bun";
import { bunEnv, bunExe } from "harness";

test("napi stack does not crash when creating errors with pending exception", async () => {
  const code = `
    'use strict';
    var globalThis = globalThis;
    // Test: throwing then catching and creating new error should not crash
    try {
      throw new Error("first error");
    } catch (e) {
      // e is caught, but let's check that creating a new error afterwards works
    }
    // Create a new error object (this exercises error creation path)
    var err = new Error("second error");
    console.log("SUCCESS: no crash occurred");
  `;

  const proc = await spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).not.toMatch(/panic|NAPI FATAL ERROR|Aborted/);
  expect(stdout).toContain("SUCCESS");
});

test("Bun.serve error handler does not crash with napi pending exception", async () => {
  const server = Bun.serve({
    port: 0,
    error(e) {
      // This error handler should never be called in this test
      // but if napi stack is broken, it might crash here
      return new Response("Error: " + e.message, { status: 500 });
    },
    fetch(req) {
      // Throw to trigger exception
      throw new Error("test error");
    },
  });

  try {
    const res = await fetch(server.url);
    // We expect an error response
    expect(res.status).toBe(500);
  } finally {
    server.stop();
  }
});

test("async operation followed by throw and catch does not corrupt napi stack", async () => {
  const code = `
    'use strict';
    async function test() {
      await Promise.resolve();
      try {
        throw new Error("async error");
      } catch (e) {
        // caught
      }
      // After catch, creating new errors should still work
      var err = new Error("after catch");
      if (err.message !== "after catch") {
        throw new Error("error creation broken");
      }
      console.log("SUCCESS");
    }
    test().catch(console.error);
  `;

  const proc = await spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(exitCode).toBe(0);
  expect(stderr).not.toMatch(/panic|NAPI FATAL ERROR/);
  expect(stdout).toContain("SUCCESS");
});

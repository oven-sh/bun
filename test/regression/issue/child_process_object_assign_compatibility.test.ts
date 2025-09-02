// Regression test for https://github.com/microlinkhq/youtube-dl-exec/issues/246
// Child process stdio properties should be enumerable for Object.assign() compatibility

import { test, expect } from "bun:test";
import { spawn, exec } from "child_process";
import { Readable } from "stream";

test("child process stdio properties should be enumerable for Object.assign()", () => {
  const child = spawn("echo", ["hello"]);
  
  // The real issue: stdio properties must be enumerable for Object.assign() to work
  // This is what libraries like tinyspawn depend on
  expect(Object.keys(child)).toContain("stdin");
  expect(Object.keys(child)).toContain("stdout"); 
  expect(Object.keys(child)).toContain("stderr");
  expect(Object.keys(child)).toContain("stdio");
  
  // Property descriptors should show enumerable: true
  expect(Object.getOwnPropertyDescriptor(child, "stdout")?.enumerable).toBe(true);
  expect(Object.getOwnPropertyDescriptor(child, "stderr")?.enumerable).toBe(true);
});

test("Object.assign should copy child process stdio properties", () => {
  const child = spawn("echo", ["hello"]);
  
  // This is what tinyspawn does: Object.assign(promise, childProcess)
  const merged = {};
  Object.assign(merged, child);
  
  // The merged object should have the stdio properties
  expect(merged.stdout).toBeTruthy();
  expect(merged.stderr).toBeTruthy(); 
  expect(merged.stdin).toBeTruthy();
  expect(merged.stdio).toBeTruthy();
  
  // Should maintain stream functionality
  expect(typeof merged.stdout.pipe).toBe("function");
  expect(typeof merged.stdout.on).toBe("function");
});

test("tinyspawn-like library usage should work", () => {
  // Simulate the exact pattern from tinyspawn library
  const { spawn } = require("child_process");
  
  let childProcess;
  const promise = new Promise((resolve) => {
    childProcess = spawn("echo", ["test"]);
    childProcess.on("exit", () => resolve(childProcess));
  });
  
  // This is the critical line that was failing in Bun
  const subprocess = Object.assign(promise, childProcess);
  
  // Should have stdio properties immediately after Object.assign
  expect(subprocess.stdout).toBeTruthy();
  expect(subprocess.stderr).toBeTruthy();
  expect(subprocess.stdin).toBeTruthy();
  
  // Should still be a Promise
  expect(subprocess instanceof Promise).toBe(true);
  
  // Should have stream methods available
  expect(typeof subprocess.stdout.pipe).toBe("function");
  expect(typeof subprocess.stdout.on).toBe("function");
});

test("youtube-dl-exec compatibility through tinyspawn", async () => {
  // This simulates what youtube-dl-exec does internally
  const $ = require("tinyspawn");
  
  // This should work without errors now
  const result = $("echo", ["youtube-dl-test"]);
  
  // Should be a Promise with child process properties
  expect(result instanceof Promise).toBe(true);
  expect(result.stdout).toBeTruthy();
  expect(result.stderr).toBeTruthy();
  
  // Should resolve properly
  const resolved = await result;
  expect(resolved.stdout).toBe("youtube-dl-test");
});
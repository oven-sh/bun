import { spawn } from "bun";
import { test } from "bun:test";
import { bunExe } from "harness";

// This test checks for hangs when writing to stdin

test("double stdin.end() should not hang", async () => {
  const proc = spawn({
    cmd: [bunExe(), "-e", "await Bun.sleep(10)"],
    stdin: "pipe",
    stdout: "ignore",
  });

  proc.stdin.end();
  proc.stdin.end(); // Second end() - should not hang

  await proc.exited;
}, 3000);

test("write after end should not hang", async () => {
  const proc = spawn({
    cmd: [bunExe(), "-e", "await Bun.sleep(10)"],
    stdin: "pipe",
    stdout: "ignore",
  });

  proc.stdin.end();

  try {
    proc.stdin.write(new Uint8Array(10));
  } catch (e) {
    // Expected to throw, but should not hang
  }

  await proc.exited;
}, 3000);

test("write to stdin of short-lived process should not hang", async () => {
  const data = new Uint8Array(1000).fill(65);

  const proc = spawn({
    cmd: [bunExe(), "-e", "console.log('done')"],
    stdin: "pipe",
    stdout: "ignore",
  });

  try {
    proc.stdin.write(data);
    proc.stdin.end();
  } catch (e) {
    // Might throw if process exits quickly
  }

  await proc.exited;
}, 3000);

import { $, generateHeapSnapshot } from "bun";

import { test } from "bun:test";
import { isWindows } from "harness";

// We skip this test on Windows becasue:
// 1. Windows didn't have this problem to begin with
// 2. We need system cat.
test.skipIf(isWindows)("writing > send buffer size doesn't block the main thread", async () => {
  const expected = Buffer.alloc(1024 * 1024, "bun!").toString();
  const massiveComamnd = "echo " + expected + " | " + Bun.which("cat");
  const pendingResult = $`${{
    raw: massiveComamnd,
  }}`.text();

  // Ensure that heap snapshot works, to excercise the memoryCost & estimated fields.
  generateHeapSnapshot("v8");

  const result = await pendingResult;

  if (result !== expected + "\n") {
    throw new Error("Expected " + expected + "\n but got " + result);
  }
});

test.skipIf(isWindows)("writing > send buffer size (with a variable) doesn't block the main thread", async () => {
  const expected = Buffer.alloc(1024 * 1024, "bun!").toString();
  const result = await $`echo ${expected} | ${Bun.which("cat")}`.text();

  if (result !== expected + "\n") {
    throw new Error("Expected " + expected + "\n but got " + result);
  }
});

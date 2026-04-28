// Exercises bun:ffi cc() with option strings that get duped on the native
// side (source, include, define, flags) and verifies they are freed on the
// success path. Before the fix, CompileC.deinit() was only called when an
// exception was pending, so every successful cc() call leaked all of these
// duped strings.
//
// We make the `define` value large so the leak is easily observable via
// RSS growth compared to a baseline run with a tiny value. Taking the
// delta cancels out per-call overhead that is unrelated to the leaked
// option strings (TinyCC allocations, ASAN quarantine, JIT code, etc).
import { cc } from "bun:ffi";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = mkdtempSync(path.join(tmpdir(), "bun-ffi-cc-leak-"));
const source = path.join(dir, "add.c");
writeFileSync(source, "int add(int a, int b) { return a + b; }\n");

const ITERATIONS = 30;
const WARMUP = 5;
const BIG_BYTES = 4 * 1024 * 1024;

const bigValue = Buffer.alloc(BIG_BYTES, "x").toString();

function once(value) {
  const lib = cc({
    source,
    define: {
      BIG_MACRO: value,
    },
    flags: ["-DFROM_FLAGS=1"],
    symbols: {
      add: {
        args: ["int", "int"],
        returns: "int",
      },
    },
  });
  if (lib.symbols.add(1, 2) !== 3) {
    throw new Error("add(1, 2) !== 3");
  }
  lib.close();
}

function measure(value) {
  for (let i = 0; i < WARMUP; i++) once(value);
  Bun.gc(true);
  const before = process.memoryUsage.rss();
  for (let i = 0; i < ITERATIONS; i++) once(value);
  Bun.gc(true);
  return process.memoryUsage.rss() - before;
}

// Baseline first so the second run inherits any allocator high-water mark
// from the first, not the other way around.
const baselineGrowth = measure("x");
const bigGrowth = measure(bigValue);

const deltaMB = (bigGrowth - baselineGrowth) / 1024 / 1024;
console.log(
  JSON.stringify({
    baselineMB: +(baselineGrowth / 1024 / 1024).toFixed(2),
    bigMB: +(bigGrowth / 1024 / 1024).toFixed(2),
    deltaMB: +deltaMB.toFixed(2),
  }),
);

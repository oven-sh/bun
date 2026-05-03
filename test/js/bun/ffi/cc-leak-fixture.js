// Exercises bun:ffi cc() with option strings that get duped on the native
// side (source, include, define, flags) and verifies they are freed on the
// success path. Before the fix, CompileC.deinit() was only called when an
// exception was pending, so every successful cc() call leaked all of these
// duped strings.
//
// We pass the payload via `flags` (whitespace-padded) rather than `define`
// so the measurement isolates the Zig-side dup of the options string: Bun
// copies the full flags string into CompileC.flags, while TinyCC only
// *parses* it (tcc_set_options) and does not retain the whole string. Using
// `define` would also make TinyCC copy the value into its macro table,
// which on some platforms (observed on macOS aarch64) is not returned to
// RSS after tcc_delete and would be misattributed to this leak.
//
// The delta between a run with a large padding and a run with a tiny one
// cancels out per-call overhead that is unrelated to the leaked option
// strings (TinyCC allocations, ASAN quarantine, JIT code, etc).
//
// The C source path is passed in argv[2] by cc.test.ts, which owns the
// temp directory and cleans it up.
import { cc } from "bun:ffi";

const source = process.argv[2];
if (!source) throw new Error("usage: bun cc-leak-fixture.js <path/to/add.c>");

const ITERATIONS = 30;
const WARMUP = 5;
const BIG_BYTES = 4 * 1024 * 1024;

const bigPadding = Buffer.alloc(BIG_BYTES, " ").toString();

function once(padding) {
  const lib = cc({
    source,
    define: { SMALL_MACRO: "1" },
    // Array form: Bun concatenates default TCC options + these entries into
    // a single owned [:0]u8 stored in CompileC.flags. TinyCC's option parser
    // skips the whitespace and does not keep a copy of the full string.
    flags: ["-DFROM_FLAGS=1", padding],
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

function measure(padding) {
  for (let i = 0; i < WARMUP; i++) once(padding);
  Bun.gc(true);
  const before = process.memoryUsage.rss();
  for (let i = 0; i < ITERATIONS; i++) once(padding);
  Bun.gc(true);
  return process.memoryUsage.rss() - before;
}

// Baseline first so the second run inherits any allocator high-water mark
// from the first, not the other way around.
const baselineGrowth = measure(" ");
const bigGrowth = measure(bigPadding);

const deltaMB = (bigGrowth - baselineGrowth) / 1024 / 1024;
console.log(
  JSON.stringify({
    baselineMB: +(baselineGrowth / 1024 / 1024).toFixed(2),
    bigMB: +(bigGrowth / 1024 / 1024).toFixed(2),
    deltaMB: +deltaMB.toFixed(2),
  }),
);

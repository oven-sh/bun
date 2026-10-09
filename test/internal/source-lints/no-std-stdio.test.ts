import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// A release build of Bun has no symbol of `std::io::stdio`. The first use of `println!`, `eprintln!`, `dbg!`,
// `std::io::stdout()`, `std::io::stderr()` or `std::process::exit` (which flushes stdout) brings in the output capture
// that the default panic hook of the standard library shares. The hook is then no longer inlined, its backtrace
// printer stays, and that imports `_Unwind_Backtrace` from libgcc_s.so.1. musl and FreeBSD link libgcc_s only if it is
// needed, so `verify-binary` fails there, far from the line that caused it.
//
// Print with `bun_core::Output`, or `bun_sys::File::stdout().write_all(..)` where that is not set up. End the process
// with `bun_core::Global::exit` or `std::process::abort`.
test("Rust sources linked into Bun do not use the streams of the standard library", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const banned =
    /(?:(?<![\w:!])|(?<=\bstd::))(?:e?println!|e?print!|dbg!)\s*\(|\bstd::io::(?:stdout|stderr)\s*\(|\bstd::process::exit\s*\(/;

  // Not compiled into a release build: tests, debug output, Windows debug macros, and the message of the allocator.
  const known = new Map([
    ["src/bun_alloc/lib.rs", 1],
    ["src/bun_core/Global.rs", 1],
    ["src/libuv_sys/libuv.rs", 1],
    ["src/react_compiler/pipeline.rs", 3],
    ["src/router/lib.rs", 4],
  ]);
  // Programs of their own.
  const isLinked = (file: string) =>
    !file.endsWith("/build.rs") && !file.includes("/benches/") && !file.startsWith("src/sema/standalone/");

  const found = new Map<string, number>();
  let scanned = 0;
  for await (const rel of new Glob("**/*.rs").scan({ cwd: path.join(repoRoot, "src") })) {
    const file = path.join("src", rel).replaceAll("\\", "/");
    if (!isLinked(file)) continue;
    scanned++;
    const lines = readFileSync(path.join(repoRoot, file), "utf8").split("\n");
    const count = lines.filter(line => !/^\s*\/\//.test(line) && banned.test(line)).length;
    if (count > 0) found.set(file, count);
  }
  // Guard against repoRoot resolving wrong, which would make the ban pass vacuously.
  expect(scanned).toBeGreaterThan(1000);
  expect(Object.fromEntries([...found].sort())).toEqual(Object.fromEntries([...known].sort()));
});

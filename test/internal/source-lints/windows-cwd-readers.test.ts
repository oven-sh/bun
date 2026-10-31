import { Glob } from "bun";
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// Windows keeps a `\\?\` prefix in the working directory of a process that starts in, or changes into, a directory
// spelled with one. `bun_core::getcwd_w` reads the working directory without that prefix, and `bun_core::getcwd` and
// `bun_sys::getcwd` both read through it. A second reader of `GetCurrentDirectoryW` gives one process two spellings of
// its working directory. A module path made from the spelling with the prefix is cut at the `?`
// (https://github.com/oven-sh/bun/issues/11953).
//
// Read the working directory with `bun_core::getcwd` or `bun_sys::getcwd`.
test("the Windows working directory has one reader", async () => {
  const repoRoot = path.resolve(import.meta.dir, "..", "..", "..");
  const call = /(?<!\bfn\s+)\bGetCurrentDirectoryW\s*\(/g;

  const known = new Map([
    // `getcwd_w`.
    ["src/bun_core/util.rs", 1],
    // The `.bunx` fast path of `bun run <bin>`. Its path does not open with the prefix, and the slower path, which
    // starts the program in the directory as Bun names it, takes over.
    ["src/runtime/cli/run_command.rs", 1],
    // `process.report()` says what the OS says.
    ["src/jsc/bindings/BunProcessReportObjectWindows.cpp", 1],
  ]);

  const found = new Map<string, number>();
  let scanned = 0;
  for await (const rel of new Glob("**/*.{rs,c,cpp,h}").scan({ cwd: path.join(repoRoot, "src") })) {
    const file = path.join("src", rel).replaceAll("\\", "/");
    scanned++;
    const source = readFileSync(path.join(repoRoot, file), "utf8");
    if (!source.includes("GetCurrentDirectoryW")) continue;
    const code = source.split("\n").filter(line => !/^\s*\/\//.test(line));
    const count = code.join("\n").match(call)?.length ?? 0;
    if (count > 0) found.set(file, count);
  }
  // Guard against repoRoot resolving wrong, which would make the lint pass vacuously.
  expect(scanned).toBeGreaterThan(1000);
  expect(Object.fromEntries([...found].sort())).toEqual(Object.fromEntries([...known].sort()));
});
